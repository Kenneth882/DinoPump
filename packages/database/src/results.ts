import { isDeepStrictEqual } from "node:util";
import type { Pool, PoolClient } from "pg";
import {
  type EngineState,
  type RoundEnded,
  publicRoundResultSchema,
  abortedRoundSchema,
  roundEndedSchema,
  privatePortfolioSchema,
  portfolioRankingSchema,
} from "@dinopump/contracts";

export class RoundIntegrityError extends Error {
  constructor(
    readonly roundId: string,
    message: string,
  ) {
    super(message);
  }
}
export async function persistIntegrityAbort(
  client: PoolClient,
  roundId: string,
) {
  // A committed result is terminal authority. Projection repair is a later
  // slice; failed verification must not replace an existing winner with abort.
  if (
    (
      await client.query("SELECT 1 FROM round_results WHERE round_id=$1", [
        roundId,
      ])
    ).rowCount
  )
    return false;
  const abort = abortedRoundSchema.parse({
    status: "ABORTED",
    roundId,
    message:
      "This round ended safely because its recorded state could not be verified.",
  });
  const inserted = await client.query(
    "INSERT INTO round_aborts(round_id,public_view) VALUES ($1,$2) ON CONFLICT DO NOTHING",
    [roundId, abort],
  );
  if (!inserted.rowCount) return false;
  await client.query(
    "UPDATE rooms SET status='ABORTED',sequence=sequence+1 WHERE current_round_id=$1 AND status<>'ABORTED'",
    [roundId],
  );
  return true;
}

async function readTimeline(db: Pool | PoolClient, roundId: string) {
  return (
    await db.query(
      "SELECT item FROM news_items WHERE round_id=$1 ORDER BY (item->>'sequence')::bigint",
      [roundId],
    )
  ).rows.map(({ item }) => ({
    sourceEventId: item.sourceEventId,
    sequence: item.sequence,
    dueAtMs: item.dueAtMs,
    headline: item.headline,
    facts: item.facts,
    effects: item.effects,
  }));
}

/** Immutable storage is private; only participantResult may leave this boundary. */
export async function persistFinalResult(
  client: PoolClient,
  state: EngineState,
) {
  if (!state.finalResult) throw new Error("Missing engine result");
  const names = (
    await client.query(
      "SELECT player_id,display_name FROM guest_sessions WHERE player_id=ANY($1::uuid[])",
      [state.trading.humans.map((h) => h.playerId)],
    )
  ).rows;
  const timeline = await readTimeline(client, state.round.roundId);
  const publicResult = publicRoundResultSchema.parse({
    status: "FINISHED",
    roundId: state.round.roundId,
    closesAtMs: state.round.closesAtMs,
    ...state.finalResult,
    rankings: state.finalResult.rankings.map((r) => ({
      ...r,
      displayName: names.find((n) => n.player_id === r.playerId)?.display_name,
    })),
    timeline,
  });
  const portfolios = Object.fromEntries(
    state.trading.humans.map((h) => [
      h.playerId,
      privatePortfolioSchema.parse({
        cashCents: h.cashCents,
        holdings: h.holdings,
      }),
    ]),
  );
  await client.query(
    "INSERT INTO round_results(round_id,settlement_sequence,public_result,portfolios) VALUES ($1,$2,$3,$4)",
    [
      state.round.roundId,
      state.finalResult.settlementSequence,
      publicResult,
      portfolios,
    ],
  );
}
export async function participantResult(
  db: Pool | PoolClient,
  roundId: string,
  playerId: string,
): Promise<RoundEnded | null> {
  const abort = (
    await db.query("SELECT public_view FROM round_aborts WHERE round_id=$1", [
      roundId,
    ])
  ).rows[0];
  if (abort) return abortedRoundSchema.parse(abort.public_view);
  const row = (
    await db.query(
      "SELECT public_result,portfolios FROM round_results WHERE round_id=$1",
      [roundId],
    )
  ).rows[0];
  if (!row) return null;

  return roundEndedSchema.parse({
    ...publicRoundResultSchema.parse(row.public_result),
    playerId,
    portfolio: row.portfolios[playerId],
  });
}
/** Validate private and public result projections against replay, not current defaults. */
export async function verifyFinalResult(
  db: Pool | PoolClient,
  state: EngineState,
) {
  const row = (
    await db.query(
      "SELECT public_result,portfolios,settlement_sequence FROM round_results WHERE round_id=$1",
      [state.round.roundId],
    )
  ).rows[0];
  return verifyRecordedFinalResult(db, state, row);
}

/** Verify a freshly selected result, including absence during an open round. */
export async function verifyRecordedFinalResult(
  db: Pool | PoolClient,
  state: EngineState,
  row:
    | {
        public_result: unknown;
        portfolios: unknown;
        settlement_sequence: string | number;
      }
    | null
    | undefined,
) {
  if (!state.finalResult) {
    if (row) throw new Error("Unexpected final result");
    return;
  }
  if (!row) throw new Error("Missing final result");
  const result = publicRoundResultSchema.parse(row.public_result);
  const rankings = result.rankings.map((r) =>
    portfolioRankingSchema.strip().parse(r),
  );
  const portfolios = Object.fromEntries(
    state.trading.humans.map((h) => [
      h.playerId,
      { cashCents: h.cashCents, holdings: h.holdings },
    ]),
  );
  const news = await readTimeline(db, state.round.roundId);
  if (
    result.roundId !== state.round.roundId ||
    result.closesAtMs !== state.round.closesAtMs ||
    Number(row.settlement_sequence) !== state.finalResult.settlementSequence ||
    !isDeepStrictEqual(
      {
        marks: result.marks,
        rankings,
        settlementSequence: result.settlementSequence,
      },
      state.finalResult,
    ) ||
    !isDeepStrictEqual(portfolios, row.portfolios) ||
    !isDeepStrictEqual(news, result.timeline)
  )
    throw new Error("Final result disagrees with history");
}
