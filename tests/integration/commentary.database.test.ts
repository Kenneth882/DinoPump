import { spawn } from "node:child_process";
import { once } from "node:events";
import { CommentaryWorker } from "../../apps/commentary-worker/src/worker.js";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, it } from "vitest";
import { isolatedDatabase } from "../helpers/database.js";
import {
  claimCommentary,
  finishCommentary,
  LobbyStore,
  migrate,
  readOpenedRound,
} from "../../packages/database/src/index.js";
import { loadBaseline } from "../../packages/game-content/src/index.js";

let database: Awaited<ReturnType<typeof isolatedDatabase>>;
let store: LobbyStore;
let now: number;
beforeEach(async () => {
  now = 1_800_000_000_000;
  database = await isolatedDatabase();
  await migrate(database.pool);
  const baseline = loadBaseline();
  // A single authored source makes independent expected prices unambiguous.
  baseline.eventCatalog = [
    baseline.eventCatalog.find((event) => event.id === "fern-herd")!,
  ];
  store = await LobbyStore.open(
    database.pool,
    () => now,
    baseline.rules.room,
    baseline,
  );
});
afterEach(async () => {
  await store?.close();
  await database?.close();
});
async function openRound() {
  const host = await store.createSession({
    displayName: "Host",
    avatar: "trex",
  });
  const guest = await store.createSession({
    displayName: "Guest",
    avatar: "stegosaurus",
  });
  const { code } = await store.createRoom(host.secret);
  await store.join(guest.secret, code);
  for (const player of [host, guest]) {
    await store.connect(player.secret, code);
    await store.ready(player.secret, code, {
      ready: true,
      requestId: randomUUID(),
    });
  }
  await store.start(host.secret, code, { requestId: randomUUID() });
  now += 5000;
  await store.processDue();
  const snapshot = await store.snapshot(host.secret, code);
  return { host, guest, code, opening: snapshot.round! };
}

it("keeps complete authored news without a provider (AC-09/13/14)", async () => {
  const { host, code } = await openRound();
  now += 60000;
  await store.processDue();
  const before = (await store.snapshot(host.secret, code)).round!;
  const worker = new CommentaryWorker(database.pool, undefined, () => now);
  expect(await worker.processOne()).toBe(true);
  await store.processDue();
  const fallback = (await store.snapshot(host.secret, code)).round!;
  expect(fallback.news[0]).toMatchObject({
    ...before.news[0],
    narrationStatus: "fallback",
  });
  expect(fallback.news[0]?.narration).toBeUndefined();
  expect(await worker.processOne()).toBe(false);
});

const accepted = {
  provider: "synthetic",
  model: "stub-v1",
  promptVersion: "test-v1",
  async narrate() {
    return {
      status: "accepted" as const,
      headline: "Herd report",
      commentary:
        "The hungry herd lifts the FERN reference; prior trading remains historical.",
      provenance: {
        provider: "synthetic",
        model: "stub-v1",
        promptVersion: "test-v1",
        durationMs: 0,
        validationStatus: "accepted" as const,
      },
    };
  },
};

it("adds late narration to the same authored card without changing market history or frozen results (AC-09/11/14)", async () => {
  const { host, code, opening } = await openRound();
  now += 60000;
  await store.processDue();
  const source = (await store.snapshot(host.secret, code)).round!.news[0]!;
  const leased = await claimCommentary(database.pool, now);
  expect(leased?.input.success).toBe(true);
  now = opening.closesAt;
  await store.processDue();
  const before = await store.snapshot(host.secret, code);
  const history = await readOpenedRound(database.pool, opening.roundId);
  // Renew by expiry: the old worker cannot publish even after it resumes.
  expect(
    await finishCommentary(
      database.pool,
      leased!,
      await accepted.narrate(),
      now,
    ),
  ).toBe(false);
  const worker = new CommentaryWorker(database.pool, accepted, () => now);
  expect(await worker.processOne()).toBe(true);
  expect((await store.snapshot(host.secret, code)).round!.news[0]).toEqual(
    source,
  );
  await store.processDue();
  const after = await store.snapshot(host.secret, code);
  expect(after.terminal).toEqual(before.terminal);
  expect(await readOpenedRound(database.pool, opening.roundId)).toEqual(
    history,
  );
  expect(after.round!.news).toHaveLength(9);
  const published = after.round!.news[0]!;
  expect(published).toMatchObject({
    ...source,
    narrationStatus: "published",
    narration: {
      commentary:
        "The hungry herd lifts the FERN reference; prior trading remains historical.",
      capturedAtMs: source.appliedAtMs,
      elapsedMs: 60000,
    },
    narrationProvenance: {
      provider: "synthetic",
      model: "stub-v1",
      promptVersion: "test-v1",
      validationStatus: "accepted",
    },
  });
  await store.processDue();
  expect((await store.snapshot(host.secret, code)).round).toEqual(after.round);
});

it("fences two workers, recovers abandoned leases, and bounds attempts across crashes (AC-13/14)", async () => {
  await openRound();
  now += 60000;
  await store.processDue();
  const claims = await Promise.all([
    claimCommentary(database.pool, now),
    claimCommentary(database.pool, now),
  ]);
  expect(claims.filter(Boolean)).toHaveLength(1);
  const first = claims.find(Boolean)!;
  expect(await claimCommentary(database.pool, now + 14999)).toBeNull();
  const replacement = await claimCommentary(database.pool, now + 15000);
  expect(replacement).toMatchObject({
    sourceEventId: first.sourceEventId,
    attempts: 2,
  });
  expect(replacement!.input).toEqual(first.input);
  expect(
    await finishCommentary(
      database.pool,
      first,
      await accepted.narrate(),
      now + 15000,
    ),
  ).toBe(false);
  expect(await claimCommentary(database.pool, now + 30000)).toBeNull();
  expect(
    await finishCommentary(
      database.pool,
      replacement!,
      await accepted.narrate(),
      now + 30000,
    ),
  ).toBe(false);
  await store.processDue();
  const jobs = await database.pool.query(
    "SELECT status,attempts FROM commentary_jobs",
  );
  expect(jobs.rows).toEqual([{ status: "failed", attempts: 2 }]);
});

it("freezes first and preceding-event activity windows and excludes private identities (AC-09/13)", async () => {
  const { host, code, opening } = await openRound();
  const trade = async () =>
    store.submitOrder(host.secret, code, {
      roundId: opening.roundId,
      requestId: randomUUID(),
      symbol: "FERN",
      side: "buy",
      quantity: 2,
      protectionPriceCents: 10000,
    });
  now += 1000;
  await trade();
  now = opening.opensAt + 60000;
  await store.processDue();
  const first = await claimCommentary(database.pool, now);
  expect(first!.input.success).toBe(true);
  if (!first!.input.success) throw new Error("Expected approved context");
  const frozen = first!.input.data;
  expect(frozen.context).toMatchObject({
    elapsedMs: 60000,
    windowStartMs: opening.opensAt,
    assets: [
      {
        symbol: "FERN",
        lastExecutedPriceCents: 4040,
        activity: {
          fillCount: 1,
          boughtUnits: 2,
          soldUnits: 0,
          totalValueCents: 8080,
        },
      },
    ],
  });
  await finishCommentary(database.pool, first!, await accepted.narrate(), now);
  // At the exact next deadline due effects precede the newly submitted trade.
  now = opening.opensAt + 120000;
  await trade();
  const second = await claimCommentary(database.pool, now);
  expect(second!.input.success).toBe(true);
  if (!second!.input.success) throw new Error("Expected approved context");
  expect(second!.input.data.context).toMatchObject({
    windowStartMs: opening.opensAt + 60000,
    assets: [
      {
        symbol: "FERN",
        activity: {
          fillCount: 0,
          boughtUnits: 0,
          soldUnits: 0,
          totalValueCents: 0,
        },
      },
    ],
  });
  expect(
    await finishCommentary(
      database.pool,
      second!,
      await accepted.narrate(),
      now,
    ),
  ).toBe(true);
  expect(await claimCommentary(database.pool, now)).toBeNull();
  expect(JSON.stringify(frozen)).not.toContain(host.player.playerId);
  expect(JSON.stringify(frozen)).not.toContain("Host");
  await store.close();
  store = await LobbyStore.open(database.pool, () => now);
  expect(await readOpenedRound(database.pool, opening.roundId)).not.toBeNull();
});

it("retries provider outages on a persisted schedule, then retains authored fallback (AC-13)", async () => {
  const { host, code } = await openRound();
  now += 60000;
  await store.processDue();
  const worker = new CommentaryWorker(
    database.pool,
    {
      ...accepted,
      async narrate() {
        throw new Error("synthetic provider outage");
      },
    },
    () => now,
  );
  expect(await worker.processOne()).toBe(true);
  expect(await worker.processOne()).toBe(false);
  now += 999;
  expect(await worker.processOne()).toBe(false);
  now++;
  expect(await worker.processOne()).toBe(true);
  now += 1000;
  expect(await worker.processOne()).toBe(false);
  await store.processDue();
  expect(
    (await store.snapshot(host.secret, code)).round!.news[0],
  ).toMatchObject({
    narrationStatus: "fallback",
    narrationProvenance: { validationStatus: "unavailable" },
  });
});

it("retries committed output after publication rollback and service restart without regeneration (AC-14)", async () => {
  const { host, code, opening } = await openRound();
  now += 60000;
  await store.processDue();
  await new CommentaryWorker(database.pool, accepted, () => now).processOne();
  await database.pool.query(
    `CREATE FUNCTION fail_publication() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic publication failure'; END $$; CREATE TRIGGER fail_publication BEFORE INSERT ON commentary_publications FOR EACH ROW EXECUTE FUNCTION fail_publication()`,
  );
  await expect(store.processDue()).rejects.toThrow(
    "synthetic publication failure",
  );
  expect(
    (await store.snapshot(host.secret, code)).round!.news[0]?.narrationStatus,
  ).toBe("pending");
  await database.pool.query(
    "DROP TRIGGER fail_publication ON commentary_publications",
  );
  await store.close();
  store = await LobbyStore.open(database.pool, () => now);
  expect(
    (await store.snapshot(host.secret, code)).round!.news[0]?.narrationStatus,
  ).toBe("published");
  expect(await claimCommentary(database.pool, now)).toBeNull();
  expect(await readOpenedRound(database.pool, opening.roundId)).not.toBeNull();
});

it("database permissions expose only approved jobs and commentary functions (AC-13)", async () => {
  await openRound();
  now += 60000;
  await store.processDue();
  const client = await database.pool.connect();
  try {
    await client.query("SET ROLE dinopump_commentary");
    for (const sql of [
      "SELECT * FROM guest_sessions",
      "SELECT * FROM rounds",
      "SELECT * FROM round_results",
      "SELECT * FROM round_projections",
      "SELECT * FROM trades",
      "SELECT * FROM game_events",
      "SELECT * FROM room_members",
      "UPDATE round_projections SET state='{}'",
      "UPDATE round_results SET public_result='{}'",
      "UPDATE commentary_jobs SET attempts=0",
      "UPDATE commentary_jobs SET input='{}'",
      "INSERT INTO commentary_publications SELECT source_event_id,input FROM commentary_jobs",
    ])
      await expect(client.query(sql)).rejects.toMatchObject({ code: "42501" });
    const claim = await client.query("SELECT claim_commentary($1,$2) AS job", [
      now,
      randomUUID(),
    ]);
    expect(claim.rows[0].job.input.context.assets[0].activity.fillCount).toBe(
      0,
    );
    const result = await client.query(
      "SELECT finish_commentary($1,$2,$3,$4) AS saved",
      [
        claim.rows[0].job.sourceEventId,
        claim.rows[0].job.leaseId,
        await accepted.narrate(),
        now,
      ],
    );
    expect(result.rows[0].saved).toBe(true);
  } finally {
    await client.query("RESET ROLE");
    client.release();
  }
});

it("keeps captured inputs across later trades and a crashed worker retry (AC-09/13)", async () => {
  const { host, code, opening } = await openRound();
  now += 60000;
  await store.processDue();
  const original = await claimCommentary(database.pool, now);
  now += 1000;
  await store.submitOrder(host.secret, code, {
    roundId: opening.roundId,
    requestId: randomUUID(),
    symbol: "FERN",
    side: "buy",
    quantity: 3,
    protectionPriceCents: 10000,
  });
  now += 14000;
  const retry = await claimCommentary(database.pool, now);
  expect(retry!.input).toEqual(original!.input);
  expect(retry!.attempts).toBe(2);
});

it("two live processors publish one accepted result and store safe provenance", async () => {
  const { host, code } = await openRound();
  now += 60000;
  await store.processDue();
  const processors = [
    new CommentaryWorker(database.pool, accepted, () => now),
    new CommentaryWorker(database.pool, accepted, () => now),
  ];
  const outcomes = await Promise.all(
    processors.map((worker) => worker.processOne()),
  );
  expect(outcomes.filter(Boolean)).toHaveLength(1);
  await store.processDue();
  expect((await store.snapshot(host.secret, code)).round!.news).toHaveLength(1);
  const attempts = await database.pool.query(
    "SELECT attempt,result->'provenance' AS provenance FROM commentary_attempts",
  );
  expect(attempts.rows).toMatchObject([
    {
      attempt: 1,
      provenance: {
        provider: "synthetic",
        model: "stub-v1",
        promptVersion: "test-v1",
        validationStatus: "accepted",
      },
    },
  ]);
});

it("rejects malformed or executable accepted output and preserves authored copy (AC-13)", async () => {
  const { host, code } = await openRound();
  now += 60000;
  await store.processDue();
  const source = (await store.snapshot(host.secret, code)).round!.news[0]!;
  const worker = new CommentaryWorker(
    database.pool,
    {
      ...accepted,
      async narrate() {
        return {
          ...(await accepted.narrate()),
          commentary: "<script>alert('synthetic')</script>",
        };
      },
    },
    () => now,
  );
  await worker.processOne();
  await store.processDue();
  expect(
    (await store.snapshot(host.secret, code)).round!.news[0],
  ).toMatchObject({
    ...source,
    narrationStatus: "fallback",
    narrationProvenance: { validationStatus: "invalid" },
  });
});

it("bounds a hung provider call without blocking market closing (AC-11/13)", async () => {
  const { host, code, opening } = await openRound();
  now += 60000;
  await store.processDue();
  const worker = new CommentaryWorker(
    database.pool,
    {
      ...accepted,
      narrate() {
        return new Promise(() => {});
      },
    },
    () => now,
  );
  const attempt = worker.processOne();
  // Market processing uses a different connection and never waits for narration.
  now = opening.closesAt;
  await store.processDue();
  expect((await store.snapshot(host.secret, code)).terminal?.status).toBe(
    "FINISHED",
  );
  expect(await attempt).toBe(true);
}, 10000);

it("runs the separate process using a real restricted login without an AI key (AC-13/18)", async () => {
  const { host, code } = await openRound();
  now += 60000;
  await store.processDue();
  await database.pool.query("UPDATE commentary_jobs SET next_attempt_at_ms=0");
  const login = "worker_" + randomUUID().replaceAll("-", "");
  const schema = (await database.pool.query("SELECT current_schema() AS name"))
    .rows[0].name as string;
  const url = new URL(process.env.TEST_DATABASE_URL!);
  url.username = login;
  url.password = "synthetic_worker_only";
  url.searchParams.set("options", `-c search_path=${schema}`);
  const provision = spawn(
    process.execPath,
    ["--import", "tsx", "packages/database/src/provision-commentary.ts"],
    {
      env: {
        ...process.env,
        DATABASE_URL: process.env.TEST_DATABASE_URL!,
        COMMENTARY_DATABASE_URL: url.href,
      },
      stdio: "ignore",
    },
  );
  expect(await once(provision, "exit")).toEqual([0, null]);
  const privilegedUrl = new URL(process.env.TEST_DATABASE_URL!);
  privilegedUrl.searchParams.set("options", `-c search_path=${schema}`);
  const privileged = spawn(
    process.execPath,
    ["--import", "tsx", "apps/commentary-worker/src/index.ts"],
    {
      env: { ...process.env, COMMENTARY_DATABASE_URL: privilegedUrl.href },
      stdio: "ignore",
    },
  );
  expect(await once(privileged, "exit")).toEqual([1, null]);
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "apps/commentary-worker/src/index.ts"],
    {
      env: { ...process.env, COMMENTARY_DATABASE_URL: url.href },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let output = "";
  const exited = once(child, "exit");
  child.stdout.on("data", (chunk: Buffer) => {
    output += chunk.toString();
  });
  try {
    await expect
      .poll(() => output, { timeout: 8000 })
      .toContain('"event":"commentary.attempt"');
    await store.processDue();
    expect(
      (await store.snapshot(host.secret, code)).round!.news[0]?.narrationStatus,
    ).toBe("fallback");
    expect(output).not.toContain("synthetic_worker_only");
  } finally {
    child.kill("SIGTERM");
    await exited;
    await database.pool.query(`DROP ROLE ${login}`);
  }
}, 15000);
