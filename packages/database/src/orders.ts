import { isDeepStrictEqual } from "node:util";
import type { PoolClient } from "pg";
import {
  orderSubmitSchema,
  orderResultSchema,
  tradingRejectionCodeSchema,
  type OrderSubmit,
  type OrderReceipt,
  type EngineState,
  type EngineBatch,
} from "@dinopump/contracts";

/** Build the immutable private outcome from deterministic facts at its commit. */
export function orderOutcome(
  state: Pick<EngineState, "sequence"> & {
    trading: Pick<EngineState["trading"], "humans">;
  },
  request: OrderSubmit,
  playerId: string,
  receipt: OrderReceipt | null,
) {
  const human = state.trading.humans.find((h) => h.playerId === playerId);
  if (!human) throw new Error("Missing order owner");
  const result = receipt?.result;
  const outcome = result?.ok ? result.outcome : null;
  return orderResultSchema.parse({
    ...request,
    sequence: state.sequence,
    status: outcome?.status ?? "REJECTED",
    rejectionCode: result?.ok
      ? null
      : tradingRejectionCodeSchema.parse(result?.code ?? "MARKET_CLOSED"),
    fills: result?.ok ? result.fills : [],
    filledQuantity: outcome?.filledQuantity ?? 0,
    remainingQuantity: outcome?.remainingQuantity ?? request.quantity,
    totalValueCents: outcome?.totalValueCents ?? 0,
    averagePrice: outcome?.averagePrice ?? null,
    portfolio: { cashCents: human.cashCents, holdings: human.holdings },
  });
}
export async function readOrder(
  client: PoolClient,
  request: OrderSubmit,
  playerId: string,
) {
  const row = (
    await client.query(
      "SELECT request,outcome FROM orders WHERE round_id=$1 AND player_id=$2 AND request_id=$3",
      [request.roundId, playerId, request.requestId],
    )
  ).rows[0];
  if (!row) return null;
  return {
    matches: isDeepStrictEqual(orderSubmitSchema.parse(row.request), request),
    outcome: orderResultSchema.parse(row.outcome),
  };
}
export async function persistOrder(
  client: PoolClient,
  state: EngineState,
  request: OrderSubmit,
  playerId: string,
  receipt: OrderReceipt | null,
  batch: EngineBatch | null,
  now: number,
) {
  const outcome = orderOutcome(state, request, playerId, receipt);
  await client.query("INSERT INTO orders VALUES ($1,$2,$3,$4,$5,$6,$7)", [
    request.roundId,
    playerId,
    request.requestId,
    request,
    outcome,
    state.sequence,
    now,
  ]);
  for (const event of batch?.events ?? [])
    if (event.type === "TradeExecuted") {
      await client.query("INSERT INTO trades VALUES ($1,$2,$3,$4,$5)", [
        request.roundId,
        event.sequence,
        playerId,
        request.requestId,
        event.payload,
      ]);
    }
  return outcome;
}

/** Bound only the owner-visible history; never truncate durable identities. */
export async function readRecentOrders(
  client: PoolClient,
  roundId: string,
  playerId: string,
) {
  return (
    await client.query(
      "SELECT outcome FROM orders WHERE round_id=$1 AND player_id=$2 ORDER BY processed_at_ms DESC,committed_sequence DESC,request_id LIMIT 20",
      [roundId, playerId],
    )
  ).rows.map((row) => orderResultSchema.parse(row.outcome));
}
