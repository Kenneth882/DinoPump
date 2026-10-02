import { baselineSchema } from "@dinopump/contracts";

// One authored source for the introduction and future frozen round snapshots.
// Keep this JSON-compatible. Tune content under a new version; never mutate an active round.
const authoredBaseline = {
  contentVersion: "1.0",
  rulesVersion: "1.0",
  assets: [
    {
      symbol: "FERN",
      name: "Fern Farms",
      description: "Food for hungry herbivore herds",
      iconId: "fern",
      initialPriceCents: 4_000,
    },
    {
      symbol: "AMBR",
      name: "Amber Works",
      description: "Collectible amber and trapped ancient treasures",
      iconId: "amber",
      initialPriceCents: 7_500,
    },
    {
      symbol: "VOLC",
      name: "Volcano Energy",
      description: "Geothermal power from unpredictable volcanoes",
      iconId: "volcano",
      initialPriceCents: 10_000,
    },
    {
      symbol: "BONE",
      name: "Fossil Finds",
      description: "Excavations and rare fossil discoveries",
      iconId: "fossil",
      initialPriceCents: 2_500,
    },
  ],
  rules: {
    room: {
      minPlayers: 2,
      maxPlayers: 8,
      countdownMs: 5_000,
      hostDisconnectGraceMs: 15_000,
      emptyLobbyExpiryMs: 300_000,
    },
    round: { durationMs: 600_000, eventIntervalMs: 60_000 },
    player: { startingCashCents: 1_000_000, startingUnitsPerAsset: 0 },
    prices: { minCents: 100, maxCents: 1_000_000, tickCents: 1 },
    orders: {
      minQuantity: 1,
      maxQuantity: 500,
      feeBps: 0,
      defaultProtectionBps: 500,
    },
    bot: {
      startingCashCents: 1_000_000_000,
      startingUnitsPerAsset: 100_000,
      quoteOffsetsBps: [100, 200, 300],
      unitsPerLevel: 100,
      referenceImpactBpsPerFilledOrder: 10,
    },
    events: { minShockBps: -1_500, maxShockBps: 1_500 },
  },
  eventCatalog: [
    {
      id: "fern-herd",
      facts:
        "A brachiosaurus herd discovers Fern Farms’ all-you-can-eat valley.",
      template: {
        headline:
          "A brachiosaurus herd discovers Fern Farms’ all-you-can-eat valley.",
        commentary:
          "Hungry visitors arrive at Fern Farms. The herd has found its next feast.",
      },
      iconId: "fern",
      effects: [{ symbol: "FERN", referenceChangeBps: 500 }],
    },
    {
      id: "amber-deposits",
      facts:
        "Fresh amber deposits uncovered beneath the Triceratops tram line.",
      template: {
        headline:
          "Fresh amber deposits uncovered beneath the Triceratops tram line.",
        commentary:
          "Amber Works uncovers ancient treasures. The tram crew takes a closer look.",
      },
      iconId: "amber",
      effects: [{ symbol: "AMBR", referenceChangeBps: 500 }],
    },
    {
      id: "volcano-sneeze",
      facts:
        "Volcano Energy shuts down a vent after an unusually dramatic sneeze.",
      template: {
        headline:
          "Volcano Energy shuts down a vent after an unusually dramatic sneeze.",
        commentary:
          "A vent closes at Volcano Energy. The maintenance crew asks everyone to stand back.",
      },
      iconId: "volcano",
      effects: [{ symbol: "VOLC", referenceChangeBps: -500 }],
    },
    {
      id: "fossil-record-dig",
      facts:
        "Fossil Finds announces a record dig. Paleontologists demand a recount.",
      template: {
        headline:
          "Fossil Finds announces a record dig. Paleontologists demand a recount.",
        commentary:
          "Fossil Finds celebrates its discovery. Paleontologists check the count.",
      },
      iconId: "fossil",
      effects: [{ symbol: "BONE", referenceChangeBps: 500 }],
    },
  ],
};

// Validate the whole baseline even when a caller only needs the assets. Each caller
// receives an independent copy; later round creation must persist its own snapshot.
export function loadBaseline() {
  return baselineSchema.parse(authoredBaseline);
}
