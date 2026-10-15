import { z } from "zod";
import { roomCodeSchema } from "./lobby.js";

export const reactionIdSchema = z.enum([
  "big-roar",
  "tiny-arms-big-gains",
  "meteor-incoming",
]);
export type ReactionId = z.infer<typeof reactionIdSchema>;
export const reactionLabels: Record<ReactionId, string> = {
  "big-roar": "Big roar",
  "tiny-arms-big-gains": "Tiny arms, big gains",
  "meteor-incoming": "Meteor incoming",
};
export const reactionSendSchema = z.strictObject({
  requestId: z.uuid().toLowerCase(),
  reactionId: reactionIdSchema,
});
export const reactionPublishedSchema = z.strictObject({
  id: z.uuid().toLowerCase(),
  code: roomCodeSchema,
  roundId: z.uuid().toLowerCase().nullable(),
  playerId: z.uuid().toLowerCase(),
  reactionId: reactionIdSchema,
  serverTime: z.number().int().nonnegative(),
});
export type PublishedReaction = z.infer<typeof reactionPublishedSchema>;
export const reactionAcceptedSchema = z.strictObject({
  requestId: z.uuid().toLowerCase(),
  publishedId: z.uuid().toLowerCase(),
});
export const reactionErrorMessages = {
  INVALID_REQUEST: "Choose an approved dinosaur reaction.",
  UNAUTHENTICATED:
    "Your guest session has expired. Choose a name to react again.",
  FORBIDDEN: "You cannot send reactions to this room.",
  ROOM_NOT_FOUND: "This room is no longer available for reactions.",
  RATE_LIMITED: "Wait one second between reactions.",
  SERVICE_UNAVAILABLE:
    "Reactions are temporarily unavailable. Try again shortly.",
} as const;
export const reactionErrorCodeSchema = z.enum([
  "INVALID_REQUEST",
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "ROOM_NOT_FOUND",
  "RATE_LIMITED",
  "SERVICE_UNAVAILABLE",
]);
export const reactionCommandErrorSchema = z.strictObject({
  error: reactionErrorCodeSchema,
  message: z.string(),
  requestId: z.uuid().toLowerCase().optional(),
});
