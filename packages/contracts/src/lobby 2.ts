import { z } from "zod";
import { assetSymbolSchema } from "./baseline.js";
import { botQuoteSchema } from "./bot-quotes.js";
import { frozenRoundSchema } from "./round-baseline.js";

export const avatarSchema = z.enum([
  "trex",
  "triceratops",
  "stegosaurus",
  "brachiosaurus",
]);
export const displayNameSchema = z
  .string()
  .max(200)
  .transform((name) => name.normalize("NFKC").trim().replace(/\s+/gu, " "))
  .pipe(z.string().min(2).max(20));
export const guestRequestSchema = z
  .object({ displayName: displayNameSchema, avatar: avatarSchema })
  .strict();
export const playerSchema = z
  .object({
    playerId: z.uuid(),
    displayName: displayNameSchema,
    avatar: avatarSchema,
  })
  .strict();
export const sessionResponseSchema = z
  .object({ player: playerSchema })
  .strict();
export const roomCodeSchema = z.string().regex(/^[A-Z0-9]{6}$/);
export const emptyCommandSchema = z.object({}).strict();
export const lobbySubscriptionSchema = z
  .object({ code: roomCodeSchema })
  .strict();
export const lobbyResyncSchema = lobbySubscriptionSchema
  .extend({ requestId: z.uuid() })
  .strict();
export const roomReadySchema = z.strictObject({
  ready: z.boolean(),
  requestId: z.uuid(),
});
export const roundStartSchema = z.strictObject({ requestId: z.uuid() });
export const roomCommandOutcomeSchema = z.strictObject({
  requestId: z.uuid(),
  sequence: z.number().int().nonnegative(),
  status: z.enum(["LOBBY", "COUNTDOWN"]),
  roundId: z.uuid().nullable(),
});
export const openedRoundViewSchema = z.strictObject({
  roundId: z.uuid(),
  sequence: z.number().int().positive(),
  opensAt: z.number().int().nonnegative(),
  closesAt: z.number().int().nonnegative(),
  assets: z
    .array(
      z.strictObject({
        symbol: assetSymbolSchema,
        referencePriceCents: z.number().int().positive(),
        lastPriceCents: z.number().int().positive(),
      }),
    )
    .length(4),
  quotes: z.array(botQuoteSchema).max(24),
  portfolio: frozenRoundSchema.shape.initialState.shape.humans.element.omit({
    playerId: true,
    joinOrder: true,
  }),
});
export const lobbySnapshotSchema = z
  .object({
    code: roomCodeSchema,
    status: z.enum([
      "LOBBY",
      "COUNTDOWN",
      "OPEN",
      "SETTLING",
      "FINISHED",
      "ABORTED",
      "EXPIRED",
    ]),
    hostId: z.uuid(),
    sequence: z.number().int().nonnegative(),
    serverTime: z.number().int().nonnegative(),
    hostTransferAt: z.number().int().nonnegative().nullable(),
    expiresAt: z.number().int().nonnegative().nullable(),
    countdown: z
      .strictObject({
        roundId: z.uuid(),
        opensAt: z.number().int().nonnegative(),
        closesAt: z.number().int().nonnegative(),
        participantIds: z.array(z.uuid()).min(2).max(8),
      })
      .nullable(),
    round: openedRoundViewSchema.nullable(),
    players: z
      .array(
        playerSchema
          .extend({ connected: z.boolean(), ready: z.boolean() })
          .strict(),
      )
      .min(1)
      .max(8),
  })
  .strict();
export const lobbyErrorMessages = {
  INVALID_REQUEST: "Check your name, dinosaur, or room code.",
  UNAUTHENTICATED:
    "Your guest session has expired. Choose a name to play again.",
  FORBIDDEN: "You cannot access this room.",
  ACTIVE_ROOM_EXISTS: "A room is already active. Ask its host for the code.",
  ROOM_NOT_FOUND:
    "That room is unavailable. Check the code or create a new lobby.",
  ROOM_FULL: "This lobby already has eight players.",
  NAME_TAKEN: "That display name is already in this lobby.",
  JOIN_LOCKED: "This round has locked its players. Join the next lobby.",
  INVALID_ROOM_STATE: "This action is only available in the lobby.",
  NOT_ENOUGH_READY_PLAYERS: "At least two connected players must be ready.",
  IDEMPOTENCY_CONFLICT:
    "That request ID was already used for a different command.",
  SERVICE_UNAVAILABLE: "The lobby is temporarily unavailable. Please retry.",
} as const;
export const lobbyErrorCodeSchema = z.enum(
  Object.keys(lobbyErrorMessages) as [
    keyof typeof lobbyErrorMessages,
    ...(keyof typeof lobbyErrorMessages)[],
  ],
);
export const lobbyErrorSchema = z
  .object({ error: lobbyErrorCodeSchema, message: z.string() })
  .strict();
export const lobbyCommandErrorSchema = lobbyErrorSchema
  .extend({ requestId: z.uuid().optional() })
  .strict();
export type LobbyErrorCode = keyof typeof lobbyErrorMessages;
export type GuestPlayer = z.infer<typeof playerSchema>;
export type LobbySnapshot = z.infer<typeof lobbySnapshotSchema>;
export type RoomCommandOutcome = z.infer<typeof roomCommandOutcomeSchema>;
