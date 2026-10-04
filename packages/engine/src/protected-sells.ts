import {
  sellCommandSchema,
  sellStateSchema,
  type SellResult,
  type SellFill,
} from "@dinopump/contracts";

import { completeOrder, invalid, reject } from "./protected-orders.js";

/** One complete, immutable engine transition; the caller owns commit/broadcast. */
export function executeSell(input: unknown, order: unknown): SellResult {
  const parsedState = sellStateSchema.safeParse(input);
  if (!parsedState.success)
    return invalid("INVALID_SELL_STATE", parsedState.error);
  const parsedCommand = sellCommandSchema.safeParse(order);
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
  const seller = state.humans.find(
    (human) => human.playerId === command.playerId,
  );
  if (!seller)
    return reject(
      "PLAYER_NOT_IN_ROUND",
      ["playerId"],
      "Seller is not a round participant",
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
  if (seller.holdings[command.symbol] < command.quantity)
    return reject(
      "INSUFFICIENT_HOLDINGS",
      ["quantity"],
      "Insufficient holdings for full requested quantity",
    );
  const fills: SellFill[] = [];
  let remainingQuantity = command.quantity;
  let totalValueCents = 0;
  const bids = state.quotes
    .filter(
      (quote) =>
        quote.side === "bid" &&
        quote.symbol === command.symbol &&
        quote.priceCents >= command.protectionPriceCents,
    )
    .sort(
      (a, b) =>
        b.priceCents - a.priceCents ||
        a.creationSequence - b.creationSequence ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
  for (const quote of bids) {
    if (remainingQuantity === 0) break;
    const quantity = Math.min(remainingQuantity, quote.quantity);
    const value = Number(BigInt(quantity) * BigInt(quote.priceCents));
    fills.push({
      quoteId: quote.id,
      buyerId: "system:bot",
      sellerId: command.playerId,
      symbol: command.symbol,
      quantity,
      priceCents: quote.priceCents,
      totalValueCents: value,
    });
    remainingQuantity -= quantity;
    totalValueCents += value;
  }
  const filledQuantity = command.quantity - remainingQuantity;
  const sellerCash = BigInt(seller.cashCents) + BigInt(totalValueCents);
  const botUnits =
    BigInt(state.market.bot.holdings[command.symbol]) + BigInt(filledQuantity);
  if (sellerCash > BigInt(Number.MAX_SAFE_INTEGER))
    return reject(
      "UNSAFE_SETTLEMENT",
      ["humans", state.humans.indexOf(seller), "cashCents"],
      "Resulting cash exceeds safe integer range",
    );
  if (botUnits > BigInt(Number.MAX_SAFE_INTEGER))
    return reject(
      "UNSAFE_SETTLEMENT",
      ["market", "bot", "holdings", command.symbol],
      "Resulting holdings exceed safe integer range",
    );
  seller.cashCents = Number(sellerCash);
  seller.holdings[command.symbol] -= filledQuantity;
  state.market.bot.cashCents -= totalValueCents;
  state.market.bot.holdings[command.symbol] = Number(botUnits);
  const completed = completeOrder(state, command, fills, "INVALID_SELL_STATE");
  if (!completed.ok) return completed;
  return { ...completed, command, fills };
}
