import { expect, it } from "vitest";
import {
  orderSubmitSchema,
  orderResultSchema,
  publicExecutionSchema,
} from "../src/index.js";
const submit = {
  roundId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  requestId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  symbol: "FERN",
  side: "buy",
  quantity: 150,
  protectionPriceCents: 4100,
};
it("validates a strict public order without trusting player identity (AC-05/07)", () => {
  expect(orderSubmitSchema.parse(submit)).toEqual(submit);
  expect(
    orderSubmitSchema.parse({
      ...submit,
      requestId: submit.requestId.toUpperCase(),
    }),
  ).toEqual(submit);
  for (const changed of [
    { playerId: submit.roundId },
    { extra: true },
    { quantity: 1.5 },
    { quantity: 0 },
    { quantity: Number.MAX_SAFE_INTEGER + 1 },
    { protectionPriceCents: NaN },
    { roundId: "bad" },
    { symbol: "USD" },
  ])
    expect(orderSubmitSchema.safeParse({ ...submit, ...changed }).success).toBe(
      false,
    );
});
it("represents filled, partial, zero-fill and durable rejected outcomes with exact ratios", () => {
  const result = {
    ...submit,
    sequence: 9,
    status: "FILLED",
    rejectionCode: null,
    fills: [
      {
        quoteId: "ask1",
        buyerId: submit.roundId,
        sellerId: "system:bot",
        symbol: "FERN",
        quantity: 100,
        priceCents: 4040,
        totalValueCents: 404000,
      },
      {
        quoteId: "ask2",
        buyerId: submit.roundId,
        sellerId: "system:bot",
        symbol: "FERN",
        quantity: 50,
        priceCents: 4080,
        totalValueCents: 204000,
      },
    ],
    filledQuantity: 150,
    remainingQuantity: 0,
    totalValueCents: 608000,
    averagePrice: { numeratorCents: 608000, denominatorUnits: 150 },
    portfolio: {
      cashCents: 392000,
      holdings: { FERN: 150, AMBR: 0, VOLC: 0, BONE: 0 },
    },
  };
  expect(orderResultSchema.safeParse(result).success).toBe(true);
  const partial = {
    ...result,
    status: "PARTIALLY_FILLED",
    fills: result.fills.slice(0, 1),
    filledQuantity: 100,
    remainingQuantity: 50,
    totalValueCents: 404000,
    averagePrice: { numeratorCents: 404000, denominatorUnits: 100 },
  };
  const empty = {
    ...result,
    fills: [],
    filledQuantity: 0,
    remainingQuantity: 150,
    totalValueCents: 0,
    averagePrice: null,
  };
  for (const outcome of [
    partial,
    { ...empty, status: "NO_LIQUIDITY_WITHIN_PROTECTION" },
    { ...empty, status: "REJECTED", rejectionCode: "INSUFFICIENT_CASH" },
  ])
    expect(orderResultSchema.safeParse(outcome).success).toBe(true);
  expect(
    orderResultSchema.safeParse({
      ...result,
      averagePrice: { numeratorCents: 4053.33, denominatorUnits: 1 },
    }).success,
  ).toBe(false);
  expect(
    publicExecutionSchema.safeParse({
      sequence: 5,
      symbol: "FERN",
      quantity: 100,
      priceCents: 4040,
      totalValueCents: 404000,
      buyerId: submit.roundId,
      sellerId: "system:bot",
      protectionPriceCents: 4100,
    }).success,
  ).toBe(false);
});
it("rejects contradictory settlement summaries and public private-ledger fields", () => {
  const result = {
    ...submit,
    sequence: 9,
    status: "FILLED",
    rejectionCode: null,
    fills: [],
    filledQuantity: 150,
    remainingQuantity: 0,
    totalValueCents: 608000,
    averagePrice: { numeratorCents: 608000, denominatorUnits: 150 },
    portfolio: {
      cashCents: 392000,
      holdings: { FERN: 150, AMBR: 0, VOLC: 0, BONE: 0 },
    },
  };
  expect(orderResultSchema.safeParse(result).success).toBe(false);
});
