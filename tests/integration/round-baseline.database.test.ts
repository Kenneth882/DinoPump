import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterEach, beforeEach, expect, it } from "vitest";
import {
  createRoundBaseline,
  readRoundBaseline,
  readRoundRecovery,
  migrate,
} from "../../packages/database/src/index.js";
import { loadBaseline } from "../../packages/game-content/src/index.js";

// This suite may only touch the dedicated loopback synthetic database.
const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString)
  throw new Error("Run pnpm db:verify to start the isolated database");
const target = new URL(connectionString);
if (
  target.hostname !== "127.0.0.1" ||
  target.port !== "55433" ||
  target.pathname !== "/dinopump_test"
) {
  throw new Error("Refusing to test outside the isolated synthetic database");
}
const schema = `test_${randomUUID().replaceAll("-", "")}`;
let pool: Pool;
beforeEach(async () => {
  const admin = new Pool({ connectionString });
  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
  } finally {
    await admin.end();
  }
  pool = new Pool({ connectionString, options: `-c search_path=${schema}` });
});
afterEach(async () => {
  await pool.end();
  const admin = new Pool({ connectionString });
  try {
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
  } finally {
    await admin.end();
  }
});

it("migrates a fresh database and safely repeats migration", async () => {
  expect(await migrate(pool)).toEqual([1, 2, 3]);
  expect(await migrate(pool)).toEqual([]);
});

it("serializes concurrent migration runners", async () => {
  const results = await Promise.all([migrate(pool), migrate(pool)]);
  expect(results.flat()).toEqual([1, 2, 3]);
});

const participantIds = [
  "00000000-0000-4000-8000-000000000001",
  "00000000-0000-4000-8000-000000000002",
];
function initialization() {
  return {
    roundId: randomUUID(),
    seed: 42,
    configVersion: "1.0",
    participantIds,
    createdAtMs: 1_800_000_000_000,
    opensAtMs: 1_800_000_005_000,
    config: loadBaseline(),
  };
}

it("persists exact funding, versions and nine fixed events before opening (AC-02/09)", async () => {
  await migrate(pool);
  const input = initialization();
  const created = await createRoundBaseline(pool, input);
  expect(await readRoundBaseline(pool, input.roundId)).toEqual(created);
  expect(created).toMatchObject({
    roundId: input.roundId,
    seed: 42,
    rulesVersion: "1.1",
    configVersion: "1.0",
    catalogVersion: "1.0",
    opensAtMs: 1_800_000_005_000,
    closesAtMs: 1_800_000_605_000,
    initialState: {
      assets: [
        {
          symbol: "FERN",
          referencePriceCents: 4000,
          lastPriceCents: 4000,
          quoteGeneration: 0,
        },
        {
          symbol: "AMBR",
          referencePriceCents: 7500,
          lastPriceCents: 7500,
          quoteGeneration: 0,
        },
        {
          symbol: "VOLC",
          referencePriceCents: 10000,
          lastPriceCents: 10000,
          quoteGeneration: 0,
        },
        {
          symbol: "BONE",
          referencePriceCents: 2500,
          lastPriceCents: 2500,
          quoteGeneration: 0,
        },
      ],
      humans: participantIds.map((playerId, joinOrder) => ({
        playerId,
        joinOrder,
        cashCents: 1_000_000,
        holdings: { FERN: 0, AMBR: 0, VOLC: 0, BONE: 0 },
      })),
      bot: {
        cashCents: 1_000_000_000,
        holdings: {
          FERN: 100_000,
          AMBR: 100_000,
          VOLC: 100_000,
          BONE: 100_000,
        },
      },
    },
  });
  expect(
    created.schedule.map((event) => event.dueAtMs - created.opensAtMs),
  ).toEqual([
    60_000, 120_000, 180_000, 240_000, 300_000, 360_000, 420_000, 480_000,
    540_000,
  ]);
  for (const event of created.schedule) {
    expect(event.catalogEvent).toEqual(
      input.config.eventCatalog.find(
        (entry) => entry.id === event.catalogEvent.id,
      ),
    );
  }
  expect(
    new Set(created.schedule.map((event) => event.scheduledEventId)).size,
  ).toBe(9);
  expect(await readRoundBaseline(pool, randomUUID())).toBeNull();
});

it("returns the original initialization for concurrent retries and rejects changed content", async () => {
  await migrate(pool);
  const input = initialization();
  const [first, retry] = await Promise.all([
    createRoundBaseline(pool, input),
    createRoundBaseline(pool, input),
  ]);
  expect(retry).toEqual(first);
  await expect(
    createRoundBaseline(pool, { ...input, seed: 43 }),
  ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  expect(await readRoundBaseline(pool, input.roundId)).toEqual(first);
});

it("rolls back the whole initialization if the final projection write fails", async () => {
  await migrate(pool);
  const input = initialization();
  // Inject a real database failure at the last write, without mocking persistence.
  await pool.query(`CREATE FUNCTION fail_projection() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic write failure'; END $$;
    CREATE TRIGGER fail_projection BEFORE INSERT ON round_projections FOR EACH ROW EXECUTE FUNCTION fail_projection()`);
  await expect(createRoundBaseline(pool, input)).rejects.toThrow(
    "synthetic write failure",
  );
  expect(await readRoundBaseline(pool, input.roundId)).toBeNull();
  await pool.query("DROP TRIGGER fail_projection ON round_projections");
  expect(await createRoundBaseline(pool, input)).toMatchObject({
    roundId: input.roundId,
  });
});

it("keeps persisted resources and selected outcomes frozen across configuration changes and reconnects", async () => {
  await migrate(pool);
  const input = initialization();
  const originalInput = structuredClone(input);
  const first = await createRoundBaseline(pool, input);
  expect(first.schedule.map((event) => event.catalogEvent.id)).toEqual([
    "amber-deposits",
    "fern-herd",
    "volcano-sneeze",
    "fern-herd",
    "amber-deposits",
    "fern-herd",
    "amber-deposits",
    "fern-herd",
    "fossil-record-dig",
  ]);
  input.config.rulesVersion = "2.0";
  input.config.contentVersion = "2.0";
  input.config.rules.player.startingCashCents = 2_000_000;
  input.config.eventCatalog = [
    {
      id: "new-event",
      iconId: "fern",
      facts: "Synthetic future event",
      template: { headline: "Synthetic", commentary: "Synthetic" },
      effects: [{ symbol: "FERN", referenceChangeBps: -1000 }],
    },
  ];
  const future = await createRoundBaseline(pool, {
    ...input,
    roundId: randomUUID(),
    configVersion: "2.0",
  });
  expect(future.initialState.humans[0]?.cashCents).toBe(2_000_000);
  expect(
    future.schedule.every((event) => event.catalogEvent.id === "new-event"),
  ).toBe(true);
  await pool.end();
  pool = new Pool({ connectionString, options: `-c search_path=${schema}` });
  expect(await readRoundBaseline(pool, input.roundId)).toEqual(first);
  expect(await createRoundBaseline(pool, originalInput)).toEqual(first);
  const repeatedSeed = await createRoundBaseline(pool, {
    ...originalInput,
    roundId: randomUUID(),
  });
  expect(repeatedSeed.schedule.map((event) => event.catalogEvent)).toEqual(
    first.schedule.map((event) => event.catalogEvent),
  );
});

it("reads a committed versioned initialization event and matching projection for baseline recovery (AC-12/15)", async () => {
  await migrate(pool);
  const input = initialization();
  const first = await createRoundBaseline(pool, input);
  await createRoundBaseline(pool, input);
  const recovery = await readRoundRecovery(pool, input.roundId);
  expect(recovery).toEqual({
    events: [
      {
        roundId: input.roundId,
        sequence: 1,
        eventId: input.roundId,
        schemaVersion: 1,
        type: "RoundInitialized",
        payload: first,
        causeId: input.roundId,
        occurredAtMs: input.createdAtMs,
      },
    ],
    projection: {
      roundId: input.roundId,
      sequence: 1,
      schemaVersion: 1,
      state: first.initialState,
    },
  });
  expect(await readRoundRecovery(pool, randomUUID())).toBeNull();
});

it("rejects a projection that disagrees with the committed baseline", async () => {
  await migrate(pool);
  const input = initialization();
  await createRoundBaseline(pool, input);
  // Simulate projection damage, keeping the immutable source event intact.
  await pool.query(
    "UPDATE round_projections SET state = jsonb_set(state, '{bot,cashCents}', '0') WHERE round_id = $1",
    [input.roundId],
  );
  await expect(readRoundRecovery(pool, input.roundId)).rejects.toThrow(
    /projection/i,
  );
});

it.each([
  [
    "the same participant in different UUID casing",
    {
      participantIds: [
        "aaaaaaaa-0000-4000-8000-000000000001",
        "AAAAAAAA-0000-4000-8000-000000000001",
      ],
    },
    "participantIds",
  ],
  [
    "duplicate participants",
    { participantIds: [participantIds[0], participantIds[0]] },
    "participantIds",
  ],
  [
    "one participant",
    { participantIds: participantIds.slice(0, 1) },
    "participantIds",
  ],
  ["fractional seed", { seed: 1.5 }, "seed"],
  ["negative seed", { seed: -1 }, "seed"],
  ["unversioned configuration", { configVersion: "" }, "configVersion"],
  [
    "initialization after opening",
    { createdAtMs: 1_800_000_006_000 },
    "opensAtMs",
  ],
  [
    "overflowing closing deadline",
    { opensAtMs: 8_640_000_000_000_000 },
    "opensAtMs",
  ],
])("rejects %s without persisting a round", async (_label, changes, field) => {
  await migrate(pool);
  const input = initialization();
  await expect(
    createRoundBaseline(pool, { ...input, ...changes }),
  ).rejects.toThrow(field);
  expect(await readRoundBaseline(pool, input.roundId)).toBeNull();
});

it("normalizes UUID casing for initialization and retries", async () => {
  await migrate(pool);
  const input = {
    ...initialization(),
    roundId: "BBBBBBBB-0000-4000-8000-000000000001",
  };
  const original = await createRoundBaseline(pool, input);
  expect(original.roundId).toBe("bbbbbbbb-0000-4000-8000-000000000001");
  expect(
    await createRoundBaseline(pool, {
      ...input,
      roundId: input.roundId.toLowerCase(),
    }),
  ).toEqual(original);
  expect(await readRoundBaseline(pool, input.roundId)).toEqual(original);
  expect(
    (await readRoundRecovery(pool, input.roundId))?.events[0]?.payload,
  ).toEqual(original);
});
