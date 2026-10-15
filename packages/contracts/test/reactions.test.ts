import { expect, it } from "vitest";
import { reactionSendSchema, reactionPublishedSchema } from "../src/index.js";

it("accepts only catalog reactions and server-owned publication fields (AC-05)", () => {
  const requestId = "F3E31BF1-389A-49DB-8AE0-158D01D4A865";
  expect(
    reactionSendSchema.parse({ requestId, reactionId: "big-roar" }),
  ).toEqual({
    requestId: requestId.toLowerCase(),
    reactionId: "big-roar",
  });
  for (const payload of [
    { requestId, reactionId: "<script>roar</script>" },
    { requestId, reactionId: "big-roar", playerId: requestId },
    { requestId, reactionId: "big-roar", text: "free chat" },
    { requestId: "bad", reactionId: "big-roar" },
  ])
    expect(reactionSendSchema.safeParse(payload).success).toBe(false);
  const published = {
    id: requestId,
    code: "ABC123",
    roundId: null,
    playerId: requestId,
    reactionId: "meteor-incoming",
    serverTime: 1800000000000,
  };
  expect(reactionPublishedSchema.safeParse(published).success).toBe(true);
  expect(
    reactionPublishedSchema.safeParse({ ...published, requestId }).success,
  ).toBe(false);
});
