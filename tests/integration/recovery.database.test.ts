import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, it } from "vitest";
import { isolatedDatabase } from "../helpers/database.js";
import { loadBaseline } from "../../packages/game-content/src/index.js";
import {
  LobbyStore,
  migrate,
  readOpenedRound,
} from "../../packages/database/src/index.js";

let database: Awaited<ReturnType<typeof isolatedDatabase>>;
let store: LobbyStore;
let now: number;
beforeEach(async () => {
  now = 1_800_000_000_000;
  database = await isolatedDatabase();
  await migrate(database.pool);
  store = await LobbyStore.open(database.pool, () => now);
});
afterEach(async () => {
  await store?.close();
  await database?.close();
});
async function openRound() {
  const host = await store.createSession({
    displayName: "Rex",
    avatar: "trex",
  });
  const guest = await store.createSession({
    displayName: "Fern",
    avatar: "stegosaurus",
  });
  const { code } = await store.createRoom(host.secret);
  await store.join(guest.secret, code);
  for (const player of [host, guest]) {
    await store.connect(player.secret, code);
    await store.ready(player.secret, code, {
      requestId: randomUUID(),
      ready: true,
    });
  }
  await store.start(host.secret, code, { requestId: randomUUID() });
  now += 5000;
  await store.processDue();
  const round = (await store.snapshot(host.secret, code)).round!;
  const request = {
    roundId: round.roundId,
    requestId: randomUUID(),
    symbol: "FERN",
    side: "buy",
    quantity: 150,
    protectionPriceCents: 4100,
  };
  const outcome = await store.submitOrder(host.secret, code, request);
  return { host, guest, code, round, request, outcome };
}
async function legacyPublicViews(roundId: string, settlementTime?: number) {
  // Fault injection is restricted to this test's disposable synthetic schema.
  await database.pool.query(
    "ALTER TABLE round_batches DISABLE TRIGGER immutable_batch",
  );
  try {
    await database.pool.query(
      "UPDATE round_batches SET public_view=NULL WHERE round_id=$1 AND batch->'command'->>'type'<>'SettleRound'",
      [roundId],
    );
    if (settlementTime !== undefined)
      await database.pool.query(
        "UPDATE round_batches SET public_view=jsonb_set(public_view,'{quoteUpdatedAtMs}',$2::jsonb) WHERE round_id=$1 AND batch->'command'->>'type'='SettleRound'",
        [roundId, JSON.stringify(settlementTime)],
      );
  } finally {
    await database.pool.query(
      "ALTER TABLE round_batches ENABLE TRIGGER immutable_batch",
    );
  }
}
it("rebuilds a discarded projection from committed trades without refunding or losing original outcomes (AC-07/12)", async () => {
  const { host, code, round, request, outcome } = await openRound();
  const original = await readOpenedRound(database.pool, round.roundId);
  await store.close();
  await database.pool.query("DELETE FROM round_projections WHERE round_id=$1", [
    round.roundId,
  ]);
  const changedDefaults = loadBaseline();
  changedDefaults.rules.player.startingCashCents = 2000000;
  changedDefaults.rules.bot.startingUnitsPerAsset = 200000;
  store = await LobbyStore.open(
    database.pool,
    () => now,
    changedDefaults.rules.room,
    changedDefaults,
  );
  expect(await store.isReady()).toBe(true);
  expect(await readOpenedRound(database.pool, round.roundId)).toEqual(original);
  expect(await store.submitOrder(host.secret, code, request)).toEqual(outcome);
  expect((await store.snapshot(host.secret, code)).round?.portfolio).toEqual(
    outcome.portfolio,
  );
});
it("rebuilds historical finished projections after lobby reset while preserving immutable private results (AC-11/12/15)", async () => {
  const { host, code, round } = await openRound();
  now = round.closesAt;
  await store.processDue();
  const original = await store.results(host.secret, round.roundId);
  const state = await readOpenedRound(database.pool, round.roundId);
  await store.returnToLobby(host.secret, code, {
    roundId: round.roundId,
    requestId: randomUUID(),
  });
  await store.close();
  await database.pool.query("DELETE FROM round_projections WHERE round_id=$1", [
    round.roundId,
  ]);
  store = await LobbyStore.open(database.pool, () => now);
  expect(await store.results(host.secret, round.roundId)).toEqual(original);
  expect(await readOpenedRound(database.pool, round.roundId)).toEqual(state);
  expect((await store.snapshot(host.secret, code)).status).toBe("LOBBY");
});
it("recovers legacy batches without public views through settlement without changing history or final results (AC-07/11/12/15)", async () => {
  const { host, guest, code, round, request, outcome } = await openRound();
  now = round.closesAt - 1;
  await store.processDue();
  await store.close();
  await legacyPublicViews(round.roundId);
  const legacy = (
    await database.pool.query(
      "SELECT * FROM round_batches WHERE round_id=$1 ORDER BY end_sequence",
      [round.roundId],
    )
  ).rows;
  store = await LobbyStore.open(database.pool, () => now);
  now = round.closesAt;
  await store.processDue();
  const settlementView = (
    await database.pool.query(
      "SELECT public_view FROM round_batches WHERE round_id=$1 ORDER BY end_sequence DESC LIMIT 1",
      [round.roundId],
    )
  ).rows[0].public_view;
  const lastQuoteAt = (
    await database.pool.query(
      "SELECT occurred_at_ms FROM game_events WHERE round_id=$1 AND type='QuotesRebuilt' ORDER BY sequence DESC LIMIT 1",
      [round.roundId],
    )
  ).rows[0].occurred_at_ms;
  expect(settlementView.quoteUpdatedAtMs).toBe(Number(lastQuoteAt));
  const originals = await Promise.all(
    [host, guest].map((player) => store.results(player.secret, round.roundId)),
  );
  const results = (
    await database.pool.query("SELECT * FROM round_results WHERE round_id=$1", [
      round.roundId,
    ])
  ).rows;
  await store.close();
  store = await LobbyStore.open(database.pool, () => now);
  expect(await store.isReady()).toBe(true);
  const state = await readOpenedRound(database.pool, round.roundId);
  expect(state?.trading.status).toBe("FINISHED");
  expect(await store.submitOrder(host.secret, code, request)).toEqual(outcome);
  expect(
    await Promise.all(
      [host, guest].map((player) =>
        store.results(player.secret, round.roundId),
      ),
    ),
  ).toEqual(originals);
  expect(
    (
      await database.pool.query(
        "SELECT * FROM round_results WHERE round_id=$1",
        [round.roundId],
      )
    ).rows,
  ).toEqual(results);
  expect(
    (
      await database.pool.query(
        "SELECT * FROM round_batches WHERE round_id=$1 AND public_view IS NULL ORDER BY end_sequence",
        [round.roundId],
      )
    ).rows,
  ).toEqual(legacy);
});
it("recovers an already recorded legacy settlement timestamp without rewriting immutable evidence (AC-07/11/12/15)", async () => {
  const { host, guest, code, round, request, outcome } = await openRound();
  now = round.closesAt - 1;
  await store.processDue();
  const quoteTime = (await store.snapshot(host.secret, code)).round!
    .quoteUpdatedAtMs;
  now = round.closesAt;
  await store.processDue();
  const state = await readOpenedRound(database.pool, round.roundId);
  const originals = await Promise.all(
    [host, guest].map((player) => store.results(player.secret, round.roundId)),
  );
  await store.close();
  await legacyPublicViews(round.roundId, round.opensAt);
  const evidence = async () =>
    (
      await database.pool.query(
        `SELECT
          (SELECT jsonb_agg(b ORDER BY end_sequence) FROM round_batches b WHERE round_id=$1) AS batches,
          (SELECT jsonb_agg(e ORDER BY sequence) FROM game_events e WHERE round_id=$1) AS events,
          (SELECT jsonb_agg(o ORDER BY committed_sequence) FROM orders o WHERE round_id=$1) AS orders,
          (SELECT jsonb_agg(t ORDER BY sequence) FROM trades t WHERE round_id=$1) AS trades,
          (SELECT jsonb_agg(r) FROM round_results r WHERE round_id=$1) AS results`,
        [round.roundId],
      )
    ).rows;
  const recorded = await evidence();
  await database.pool.query("DELETE FROM round_projections WHERE round_id=$1", [
    round.roundId,
  ]);
  store = await LobbyStore.open(database.pool, () => now);
  expect(await store.isReady()).toBe(true);
  expect(await readOpenedRound(database.pool, round.roundId)).toEqual(state);
  expect(
    (await store.snapshot(host.secret, code)).round?.quoteUpdatedAtMs,
  ).toBe(quoteTime);
  const updates = await store.marketUpdates(
    host.secret,
    code,
    round.roundId,
    3,
  );
  expect(updates.at(-1)?.quoteUpdatedAtMs).toBe(quoteTime);
  const settlementOnly = await store.marketUpdates(
    host.secret,
    code,
    round.roundId,
    state!.sequence - 1,
  );
  expect(settlementOnly).toHaveLength(1);
  expect(settlementOnly[0]?.quoteUpdatedAtMs).toBe(quoteTime);
  expect(await store.submitOrder(host.secret, code, request)).toEqual(outcome);
  expect(
    await Promise.all(
      [host, guest].map((player) =>
        store.results(player.secret, round.roundId),
      ),
    ),
  ).toEqual(originals);
  expect(await evidence()).toEqual(recorded);
});
it.each([
  "timestamp",
  "totals",
  "quotes",
  "modern predecessor",
  "final result",
])(
  "rejects %s corruption around a legacy settlement and preserves final evidence (AC-11/12)",
  async (damage) => {
    const { round } = await openRound();
    now = round.closesAt - 1;
    await store.processDue();
    const predecessor = (
      await database.pool.query(
        "SELECT end_sequence,public_view FROM round_batches WHERE round_id=$1 ORDER BY end_sequence DESC LIMIT 1",
        [round.roundId],
      )
    ).rows[0];
    now = round.closesAt;
    await store.processDue();
    await store.close();
    await legacyPublicViews(
      round.roundId,
      round.opensAt + (damage === "timestamp" ? 1 : 0),
    );
    await database.pool.query(
      "ALTER TABLE round_batches DISABLE TRIGGER immutable_batch",
    );
    try {
      if (damage === "modern predecessor")
        await database.pool.query(
          "UPDATE round_batches SET public_view=$3 WHERE round_id=$1 AND end_sequence=$2",
          [round.roundId, predecessor.end_sequence, predecessor.public_view],
        );
      if (damage === "totals" || damage === "quotes")
        await database.pool.query(
          "UPDATE round_batches SET public_view=jsonb_set(public_view,$2,'[]') WHERE round_id=$1 AND batch->'command'->>'type'='SettleRound'",
          [round.roundId, [damage]],
        );
    } finally {
      await database.pool.query(
        "ALTER TABLE round_batches ENABLE TRIGGER immutable_batch",
      );
    }
    if (damage === "final result") {
      await database.pool.query(
        "ALTER TABLE round_results DISABLE TRIGGER immutable_result",
      );
      try {
        await database.pool.query(
          "UPDATE round_results SET public_result=jsonb_set(public_result,'{marks,FERN}','1') WHERE round_id=$1",
          [round.roundId],
        );
      } finally {
        await database.pool.query(
          "ALTER TABLE round_results ENABLE TRIGGER immutable_result",
        );
      }
    }
    const finalRows = (
      await database.pool.query(
        "SELECT * FROM round_results WHERE round_id=$1",
        [round.roundId],
      )
    ).rows;
    const error =
      damage === "final result"
        ? "Final result disagrees with history"
        : "Public view disagrees with history";
    await expect(readOpenedRound(database.pool, round.roundId)).rejects.toThrow(
      error,
    );
    await expect(LobbyStore.open(database.pool, () => now)).rejects.toThrow(
      error,
    );
    expect(
      (
        await database.pool.query(
          "SELECT * FROM round_results WHERE round_id=$1",
          [round.roundId],
        )
      ).rows,
    ).toEqual(finalRows);
    expect(
      (
        await database.pool.query(
          "SELECT * FROM round_aborts WHERE round_id=$1",
          [round.roundId],
        )
      ).rows,
    ).toEqual([]);
  },
);
it("aborts unverifiable committed outcomes on startup without replacing evidence or serving a false retry balance (AC-07/12)", async () => {
  const { host, code, round, request } = await openRound();
  await store.close();
  await database.pool.query(
    "ALTER TABLE orders DISABLE TRIGGER immutable_order",
  );
  await database.pool.query(
    "UPDATE orders SET outcome=jsonb_set(outcome,'{portfolio,cashCents}','0') WHERE round_id=$1",
    [round.roundId],
  );
  await database.pool.query("DELETE FROM round_projections WHERE round_id=$1", [
    round.roundId,
  ]);
  store = await LobbyStore.open(database.pool, () => now);
  const snapshot = await store.snapshot(host.secret, code);
  expect(snapshot).toMatchObject({
    status: "ABORTED",
    round: null,
    terminal: { status: "ABORTED" },
  });
  expect(snapshot.terminal).not.toHaveProperty("rankings");
  await expect(readOpenedRound(database.pool, round.roundId)).rejects.toThrow(
    "Order result disagrees",
  );
  await expect(
    store.submitOrder(host.secret, code, request),
  ).rejects.toMatchObject({ code: "MARKET_CLOSED" });
  await store.returnToLobby(host.secret, code, {
    roundId: round.roundId,
    requestId: randomUUID(),
  });
  // Ticket 12 allows old-round readback after reset; Ticket 13 must still
  // prevent readback from this round's unverifiable immutable history.
  await expect(
    store.submitOrder(host.secret, code, request),
  ).rejects.toMatchObject({ code: "MARKET_CLOSED" });
});
it("refuses an unsupported initialization event version instead of rebuilding a plausible projection (AC-12)", async () => {
  const { host, code, round } = await openRound();
  await store.close();
  await database.pool.query(
    "ALTER TABLE game_events DISABLE TRIGGER immutable_event",
  );
  await database.pool.query(
    "UPDATE game_events SET schema_version=2 WHERE round_id=$1 AND sequence=1",
    [round.roundId],
  );
  await database.pool.query("DELETE FROM round_projections WHERE round_id=$1", [
    round.roundId,
  ]);
  store = await LobbyStore.open(database.pool, () => now);
  expect(await store.snapshot(host.secret, code)).toMatchObject({
    status: "ABORTED",
    terminal: { status: "ABORTED" },
  });
});
it("repairs a malformed stale projection on an owned read before returning cash, quotes or rankings (AC-12/16)", async () => {
  const { host, code, round } = await openRound();
  const original = await store.snapshot(host.secret, code);
  const state = await readOpenedRound(database.pool, round.roundId);
  await database.pool.query(
    "UPDATE round_projections SET sequence=1,schema_version=99,state='{}' WHERE round_id=$1",
    [round.roundId],
  );
  expect(await store.snapshot(host.secret, code)).toEqual(original);
  expect(await readOpenedRound(database.pool, round.roundId)).toEqual(state);
});
