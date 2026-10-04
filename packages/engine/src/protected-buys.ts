import {
  buyCommandSchema,
  buyStateSchema,
  type BuyResult,
  type BuyFill,
} from "@dinopump/contracts";

import { completeOrder, invalid, reject } from "./protected-orders.js";

/** One complete, immutable engine transition; the caller owns commit/broadcast. */
export function executeBuy(input: unknown, order: unknown): BuyResult {
  const parsedState = buyStateSchema.safeParse(input);
  if (!parsedState.success)
    return invalid("INVALID_BUY_STATE", parsedState.error);
  const parsedCommand = buyCommandSchema.safeParse(order);
  if (!parsedCommand.success)
    return invalid("INVALID_ORDER", parsedCommand.error);
  const state = parsedState.data;
  const command = parsedCommand.data;
  if (command.roundId !== state.market.roundId)
    return reject(
      "ROUND_MISMATCH",
      ["roundId"],
      "Order belongs to a different round",
    );
  if (state.status !== "OPEN")
    return reject("MARKET_CLOSED", ["status"], "Round is not open for trading");
  const buyer = state.humans.find(
    (human) => human.playerId === command.playerId,
  );
  if (!buyer)
    return reject(
      "PLAYER_NOT_IN_ROUND",
      ["playerId"],
      "Buyer is not a round participant",
    );
  const { rules } = state.market;
  if (command.quantity > rules.orders.maxQuantity)
    return reject(
      "INVALID_ORDER",
      ["quantity"],
      "Quantity exceeds frozen order limit",
    );
  if (
    command.protectionPriceCents < rules.prices.minCents ||
    command.protectionPriceCents > rules.prices.maxCents
  )
    return reject(
      "INVALID_ORDER",
      ["protectionPriceCents"],
      "Protection is outside frozen price bounds",
    );
  if (
    BigInt(buyer.cashCents) <
    BigInt(command.quantity) * BigInt(command.protectionPriceCents)
  )
    return reject(
      "INSUFFICIENT_CASH",
      ["quantity"],
      "Insufficient cash for full protected quantity",
    );
  const fills: BuyFill[] = [];
  let remainingQuantity = command.quantity;
  let totalValueCents = 0;
  const asks = state.quotes
    .filter(
      (quote) =>
        quote.side === "ask" &&
        quote.symbol === command.symbol &&
        quote.priceCents <= command.protectionPriceCents,
    )
    .sort(
      (a, b) =>
        a.priceCents - b.priceCents ||
        a.creationSequence - b.creationSequence ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
  for (const quote of asks) {
    if (remainingQuantity === 0) break;
    const quantity = Math.min(remainingQuantity, quote.quantity);
    const value = Number(BigInt(quantity) * BigInt(quote.priceCents));
    fills.push({
      quoteId: quote.id,
      buyerId: command.playerId,
      sellerId: "system:bot",
      symbol: command.symbol,
      quantity,
      priceCents: quote.priceCents,
      totalValueCents: value,
    });
    remainingQuantity -= quantity;
    totalValueCents += value;
  }
  const filledQuantity = command.quantity - remainingQuantity;
  const botCash = BigInt(state.market.bot.cashCents) + BigInt(totalValueCents);
  const buyerUnits =
    BigInt(buyer.holdings[command.symbol]) + BigInt(filledQuantity);
  if (botCash > BigInt(Number.MAX_SAFE_INTEGER))
    return reject(
      "UNSAFE_SETTLEMENT",
      ["market", "bot", "cashCents"],
      "Resulting cash exceeds safe integer range",
    );
  if (buyerUnits > BigInt(Number.MAX_SAFE_INTEGER))
    return reject(
      "UNSAFE_SETTLEMENT",
      ["humans", state.humans.indexOf(buyer), "holdings", command.symbol],
      "Resulting holdings exceed safe integer range",
    );
  buyer.cashCents -= totalValueCents;
  buyer.holdings[command.symbol] = Number(buyerUnits);
  state.market.bot.cashCents = Number(botCash);
  state.market.bot.holdings[command.symbol] -= filledQuantity;
  const completed = completeOrder(state, command, fills, "INVALID_BUY_STATE");
  if (!completed.ok) return completed;
  return { ...completed, command, fills };
}
