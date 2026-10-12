import { expect, it } from "vitest";
import { newsItemSchema } from "../src/news.js";
const news = {
  sourceEventId: "00000000-0000-4000-8000-000000000001",
  roundId: "00000000-0000-4000-8000-000000000002",
  scheduledEventId: "00000000-0000-4000-8000-000000000002:1",
  sequence: 4,
  dueAtMs: 60000,
  appliedAtMs: 60200,
  catalogEventId: "fern-herd",
  facts: "A hungry herd arrives.",
  headline: "Hungry herd",
  commentary: "Fern Farms has visitors.",
  iconId: "fern",
  effects: [
    { symbol: "FERN", beforeCents: 4000, afterCents: 4200, changeBps: 500 },
  ],
  narrationStatus: "pending",
};
it("accepts authored news and rejects early timestamps, duplicate effects, and private extras", () => {
  expect(newsItemSchema.safeParse(news).success).toBe(true);
  for (const input of [
    { ...news, appliedAtMs: 59999 },
    { ...news, effects: [...news.effects, ...news.effects] },
    { ...news, holdings: { FERN: 123 } },
    { ...news, effects: [{ ...news.effects[0], changeBps: 1501 }] },
    { ...news, effects: [{ ...news.effects[0], symbol: "REAL" }] },
  ])
    expect(newsItemSchema.safeParse(input).success).toBe(false);
});
