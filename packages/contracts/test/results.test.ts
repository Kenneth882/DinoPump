import { expect, it } from "vitest";
import { roundEndedSchema, roundReturnSchema } from "../src/index.js";

it("accepts a safe abort with no winner and rejects private or invented result fields", () => {
  const abort = {
    status: "ABORTED",
    roundId: "10000000-0000-4000-8000-000000000001",
    message:
      "This round ended safely because its recorded state could not be verified.",
  };
  expect(roundEndedSchema.parse(abort)).toEqual(abort);
  expect(roundEndedSchema.safeParse({ ...abort, rankings: [] }).success).toBe(
    false,
  );
  expect(roundEndedSchema.safeParse({ ...abort, portfolios: {} }).success).toBe(
    false,
  );
  expect(
    roundReturnSchema.safeParse({
      roundId: abort.roundId,
      requestId: abort.roundId,
      playerId: abort.roundId,
    }).success,
  ).toBe(false);
});
it("shares final rankings while accepting only a single owner's portfolio", () => {
  const result = {
    status: "FINISHED",
    roundId: "10000000-0000-4000-8000-000000000001",
    closesAtMs: 1800000600000,
    marks: { AMBR: 7500, BONE: 12000, FERN: 4000, VOLC: 20000 },
    settlementSequence: 31,
    rankings: [
      {
        playerId: "10000000-0000-4000-8000-000000000002",
        displayName: "Host",
        joinOrder: 0,
        rank: 1,
        portfolioValueCents: 1000000,
        profitCents: 0,
        returnPercent: 0,
      },
      {
        playerId: "10000000-0000-4000-8000-000000000003",
        displayName: "Guest",
        joinOrder: 1,
        rank: 1,
        portfolioValueCents: 1000000,
        profitCents: 0,
        returnPercent: 0,
      },
    ],
    timeline: [],
    playerId: "10000000-0000-4000-8000-000000000002",
    portfolio: {
      cashCents: 1000000,
      holdings: { AMBR: 0, BONE: 0, FERN: 0, VOLC: 0 },
    },
  };
  expect(roundEndedSchema.parse(result)).toEqual(result);
  expect(
    roundEndedSchema.safeParse({
      ...result,
      portfolios: { guest: result.portfolio },
    }).success,
  ).toBe(false);
  expect(
    roundEndedSchema.safeParse({
      ...result,
      rankings: result.rankings.map((r) => ({ ...r, cashCents: 1000000 })),
    }).success,
  ).toBe(false);
});
