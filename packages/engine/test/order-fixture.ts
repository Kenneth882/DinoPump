import {
  buildRoundBaseline,
  loadBaseline,
} from "../../game-content/src/index.js";
import { initializeBotQuotes, rebuildBotQuotes } from "../src/index.js";
import type { BuyState } from "../../contracts/src/index.js";

export const playerId = "00000000-0000-4000-8000-000000000001";
export const roundId = "00000000-0000-4000-8000-000000000003";

export function fixture() {
  const round = buildRoundBaseline({
    roundId,
    seed: 3,
    configVersion: "1.0",
    participantIds: [playerId, "00000000-0000-4000-8000-000000000002"],
    createdAtMs: 0,
    opensAtMs: 5_000,
    config: loadBaseline(),
  });
  const quotes = initializeBotQuotes(round);
  if (!quotes.ok) throw new Error(JSON.stringify(quotes));
  return {
    market: quotes.state,
    quotes: quotes.quotes,
    reservations: quotes.reservations,
    status: "OPEN" as const,
    humans: round.initialState.humans,
    lastPrices: { AMBR: 7500, BONE: 2500, FERN: 4000, VOLC: 10000 },
  };
}

export function replaceQuotes(state: BuyState) {
  const replacement = rebuildBotQuotes(state.market);
  if (!replacement.ok) throw new Error(JSON.stringify(replacement));
  state.market = replacement.state;
  state.quotes = replacement.quotes;
  state.reservations = replacement.reservations;
}
