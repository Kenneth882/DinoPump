import { fork, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { io, type Socket } from "socket.io-client";
import { afterEach, beforeEach, expect, it } from "vitest";
import type { LobbySnapshot } from "../../packages/contracts/src/index.js";
import { processEngineCommand } from "../../packages/engine/src/index.js";
import { isolatedDatabase } from "../helpers/database.js";
import {
  LobbyStore,
  migrate,
  readOpenedRound,
} from "../../packages/database/src/index.js";

type Message = { type: string; port?: number };
type Service = { child: ChildProcess; messages: Message[]; origin: string };
let database: Awaited<ReturnType<typeof isolatedDatabase>>;
let store: LobbyStore;
let schema: string;
let now: number;
const services: Service[] = [];
const sockets: Socket[] = [];
const cleanups: (() => Promise<void>)[] = [];
const webOrigin = "http://127.0.0.1:3100";
beforeEach(async () => {
  now = 1_800_000_000_000;
  database = await isolatedDatabase();
  schema = (await database.pool.query("SELECT current_schema() AS name"))
    .rows[0].name;
  await migrate(database.pool);
  store = await LobbyStore.open(database.pool, () => now);
});
async function kill(service: Service) {
  if (service.child.exitCode !== null || service.child.signalCode !== null)
    return;
  const exited = once(service.child, "exit");
  service.child.kill("SIGKILL");
  await exited;
}
afterEach(async () => {
  sockets.splice(0).forEach((s) => s.disconnect());
  for (const service of services.splice(0)) await kill(service);
  for (const cleanup of cleanups.splice(0)) await cleanup();
  await store?.close();
  await database?.close();
});
async function message(service: Service, type: string) {
  await expect
    .poll(() => service.messages.some((m) => m.type === type), {
      timeout: 8000,
    })
    .toBe(true);
  return service.messages.splice(
    service.messages.findIndex((m) => m.type === type),
    1,
  )[0]!;
}
async function start(fault = "", unavailable = false) {
  const child = fork(
    new URL("../helpers/recovery-game-server.ts", import.meta.url),
    [],
    {
      execArgv: ["--import", "tsx"],
      stdio: ["ignore", "ignore", "inherit", "ipc"],
      env: {
        PATH: process.env.PATH,
        NODE_ENV: "test",
        TEST_DATABASE_URL: process.env.TEST_DATABASE_URL,
        DINOPUMP_TEST_PORT: process.env.DINOPUMP_TEST_PORT,
        DINOPUMP_RECOVERY_SCHEMA: schema,
        DINOPUMP_RECOVERY_TIME: String(now),
        DINOPUMP_RECOVERY_FAULT: fault,
      },
    },
  );
  const service: Service = { child, messages: [], origin: "" };
  services.push(service);
  child.on("message", (value: Message) => service.messages.push(value));
  const ready = await message(
    service,
    unavailable ? "unavailable" : "listening",
  );
  service.origin = `http://127.0.0.1:${ready.port}`;
  return service;
}
async function seedRound() {
  const host = await store.createSession({
    displayName: "Rex",
    avatar: "trex",
  });
  const guest = await store.createSession({
    displayName: "Fern",
    avatar: "stegosaurus",
  });
  const { code } = await store.createRoom(host.secret);
  await store.join(guest.secret, code);
  for (const player of [host, guest]) {
    await store.connect(player.secret, code);
    await store.ready(player.secret, code, {
      requestId: randomUUID(),
      ready: true,
    });
  }
  await store.start(host.secret, code, { requestId: randomUUID() });
  now += 5000;
  await store.processDue();
  const round = (await store.snapshot(host.secret, code)).round!;
  await store.close();
  const request = {
    roundId: round.roundId,
    requestId: randomUUID(),
    symbol: "FERN",
    side: "buy",
    quantity: 150,
    protectionPriceCents: 4100,
  };
  return { host, guest, code, round, request };
}
async function connect(service: Service, secret: string, code: string) {
  const socket = io(service.origin, {
    autoConnect: false,
    reconnection: false,
    transports: ["websocket"],
    extraHeaders: { Origin: webOrigin, Cookie: `dino_session=${secret}` },
    auth: { code },
  });
  sockets.push(socket);
  const snapshot = new Promise<LobbySnapshot>((resolve, reject) => {
    socket.once("room:snapshot", resolve);
    socket.once("connect_error", reject);
  });
  socket.connect();
  return { socket, snapshot: await snapshot };
}
async function advance(service: Service, at: number) {
  now = at;
  service.child.send({ type: "clock", now });
  await message(service, "clock");
}
async function pauseWrite(
  table: "orders" | "commentary_jobs" | "round_results",
) {
  const blocker = await database.pool.connect();
  await blocker.query(
    "SELECT pg_advisory_lock(18475,hashtext(current_schema()))",
  );
  await database.pool
    .query(`CREATE FUNCTION pause_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    PERFORM pg_advisory_xact_lock(18475,hashtext(current_schema())); RETURN NEW;
    END $$; CREATE TRIGGER pause_write BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION pause_write()`);
  const release = async () => {
    await blocker.query(
      "SELECT pg_advisory_unlock(18475,hashtext(current_schema()))",
    );
    blocker.release();
    // A blocked backend notices the killed client's EOF after this lock releases.
    // DDL waits for that transaction to finish before removing the test trigger.
    await database.pool.query(`DROP TRIGGER pause_write ON ${table}`);
  };
  cleanups.push(release);
  return async () => {
    cleanups.splice(cleanups.indexOf(release), 1);
    await release();
  };
}
async function blocked() {
  await expect
    .poll(
      async () =>
        (
          await database.pool.query(
            `SELECT EXISTS(SELECT 1 FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid
     WHERE starts_with(a.application_name,$1) AND l.locktype='advisory' AND l.classid=18475 AND NOT l.granted) AS waiting`,
            [`recovery_${schema}`],
          )
        ).rows[0].waiting,
      { timeout: 8000 },
    )
    .toBe(true);
}
it("recovers an order committed before SIGKILL and before broadcast through owner-only snapshots and unchanged retries (AC-07/10/12/14)", async () => {
  const { host, guest, code, round, request } = await seedRound();
  const service = await start("after-order-commit");
  const { socket } = await connect(service, host.secret, code);
  const batches: unknown[] = [],
    results: unknown[] = [];
  socket.on("market:batch", (value) => batches.push(value));
  socket.on("order:result", (value) => results.push(value));
  socket.emit("order:submit", request);
  await message(service, "committed");
  const committed = await readOpenedRound(database.pool, round.roundId);
  expect(batches).toEqual([]);
  expect(results).toEqual([]);
  await kill(service);
  const recovered = await start();
  expect((await fetch(`${recovered.origin}/readyz`)).status).toBe(200);
  const owner = await connect(recovered, host.secret, code);
  const peer = await connect(recovered, guest.secret, code);
  const original = owner.snapshot.round!.recentOrders[0]!;
  expect(original).toMatchObject({
    status: "FILLED",
    totalValueCents: 608000,
    portfolio: { cashCents: 392000, holdings: { FERN: 150 } },
  });
  expect(owner.snapshot.round?.trades).toHaveLength(2);
  expect(peer.snapshot.round?.recentOrders).toEqual([]);
  expect(peer.snapshot.round?.portfolio.cashCents).toBe(1000000);
  const retries: unknown[] = [];
  owner.socket.on("market:batch", (value) => retries.push(value));
  expect(
    await owner.socket.timeout(2000).emitWithAck("order:submit", request),
  ).toEqual(original);
  expect(
    await owner.socket
      .timeout(2000)
      .emitWithAck("order:submit", { ...request, quantity: 1 }),
  ).toMatchObject({ error: "IDEMPOTENCY_CONFLICT" });
  expect(retries).toEqual([]);
  expect(await readOpenedRound(database.pool, round.roundId)).toEqual(
    committed,
  );
}, 20000);
it.each(["scheduler", "settlement"] as const)(
  "SIGKILL during %s rolls back the batch and catches up recorded deadlines once before readiness (AC-09/11/12/14/15/16)",
  async (boundary) => {
    const { host, code, round, request } = await seedRound();
    const service = await start();
    const owner = await connect(service, host.secret, code);
    const outcome = await owner.socket
      .timeout(2000)
      .emitWithAck("order:submit", request);
    let expected = (await readOpenedRound(database.pool, round.roundId))!;
    const original = structuredClone(expected);
    const release = await pauseWrite(
      boundary === "scheduler" ? "commentary_jobs" : "round_results",
    );
    const batches: unknown[] = [],
      ended: unknown[] = [];
    owner.socket.on("market:batch", (value) => batches.push(value));
    owner.socket.on("round:ended", (value) => ended.push(value));
    await advance(
      service,
      boundary === "scheduler" ? round.opensAt + 180000 : round.closesAt + 1,
    );
    await blocked();
    expect(await readOpenedRound(database.pool, round.roundId)).toEqual(
      original,
    );
    expect(batches).toEqual([]);
    expect(ended).toEqual([]);
    await kill(service);
    await release();
    for (const scheduled of expected.round.schedule) {
      if (scheduled.dueAtMs > now || scheduled.dueAtMs >= round.closesAt) break;
      const applied = processEngineCommand(expected, {
        type: "ApplyScheduledEvent",
        atMs: now,
        scheduledEventId: scheduled.scheduledEventId,
      });
      if (!applied.ok) throw new Error("Invalid expected event");
      expected = applied.state;
    }
    if (boundary === "settlement") {
      const settled = processEngineCommand(expected, {
        type: "SettleRound",
        atMs: now,
      });
      if (!settled.ok) throw new Error("Invalid expected settlement");
      expected = settled.state;
    }
    const recovered = await start();
    expect((await fetch(`${recovered.origin}/readyz`)).status).toBe(200);
    expect(await readOpenedRound(database.pool, round.roundId)).toEqual(
      expected,
    );
    const restored = await connect(recovered, host.secret, code);
    const news = restored.snapshot.round!.news;
    expect(news.map((item) => item.dueAtMs)).toEqual(
      Array.from(
        { length: boundary === "scheduler" ? 3 : 9 },
        (_, index) => round.opensAt + (index + 1) * 60000,
      ),
    );
    expect(new Set(news.map((item) => item.scheduledEventId)).size).toBe(
      news.length,
    );
    expect(restored.snapshot.round?.closesAt).toBe(round.closesAt);
    expect(
      await restored.socket.timeout(2000).emitWithAck("order:submit", request),
    ).toEqual(outcome);
    if (boundary === "settlement") {
      expect(restored.snapshot.terminal).toMatchObject({
        status: "FINISHED",
        marks: { FERN: 4080 },
        portfolio: { cashCents: 392000, holdings: { FERN: 150 } },
      });
      expect(
        await restored.socket
          .timeout(2000)
          .emitWithAck("order:submit", { ...request, requestId: randomUUID() }),
      ).toMatchObject({ rejectionCode: "MARKET_CLOSED", fills: [] });
    }
    await kill(recovered);
    const second = await start();
    const snapshot = (await connect(second, host.secret, code)).snapshot;
    expect(snapshot.round?.news).toEqual(news);
    expect(snapshot.terminal).toEqual(restored.snapshot.terminal);
    expect(await readOpenedRound(database.pool, round.roundId)).toEqual(
      expected,
    );
  },
  20000,
);
it.each(["database", "ownership"] as const)(
  "%s loss stops writes and a second process accepts commands only after exclusive recovery (AC-08/14/15)",
  async (loss) => {
    const { host, code, round, request } = await seedRound();
    const service = await start();
    const original = await readOpenedRound(database.pool, round.roundId);
    const owner = await connect(service, host.secret, code);
    const competitor = await start("", true);
    expect(competitor.messages.some((m) => m.type === "listening")).toBe(false);
    if (loss === "database") {
      await database.pool.query(
        "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name=$1",
        [`recovery_${schema}_${service.child.pid}`],
      );
    } else {
      await database.pool
        .query(`CREATE FUNCTION lose_owner() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        PERFORM pg_advisory_unlock(18474,hashtext(current_schema())); RETURN NEW;
        END $$; CREATE TRIGGER lose_owner BEFORE INSERT ON orders FOR EACH ROW EXECUTE FUNCTION lose_owner()`);
      expect(
        await owner.socket.timeout(2000).emitWithAck("order:submit", request),
      ).toMatchObject({ error: "SERVICE_UNAVAILABLE" });
      await database.pool.query("DROP TRIGGER lose_owner ON orders");
    }
    expect((await fetch(`${service.origin}/readyz`)).status).toBe(503);
    expect((await fetch(`${service.origin}/healthz`)).status).toBe(200);
    expect(
      (
        await fetch(`${service.origin}/api/rooms/${code}/snapshot`, {
          headers: { Cookie: `dino_session=${host.secret}` },
        })
      ).status,
    ).toBe(503);
    expect(await readOpenedRound(database.pool, round.roundId)).toEqual(
      original,
    );
    now = round.opensAt + 120000;
    const replacement = await start();
    const restored = await connect(replacement, host.secret, code);
    expect(restored.snapshot.round?.news).toHaveLength(2);
    expect((await fetch(`${replacement.origin}/readyz`)).status).toBe(200);
    const result = await restored.socket
      .timeout(2000)
      .emitWithAck("order:submit", {
        ...request,
        protectionPriceCents: 10000,
        quantity: 1,
      });
    expect(result.status).toBe("FILLED");
    expect((await fetch(`${service.origin}/readyz`)).status).toBe(503);
    expect(
      (await readOpenedRound(database.pool, round.roundId))?.receipts,
    ).toHaveLength(1);
  },
  20000,
);
it("keeps startup inaccessible until replay and one overdue event finish, without extending the deadline (AC-09/15)", async () => {
  const { host, code, round } = await seedRound();
  const release = await pauseWrite("commentary_jobs");
  now = round.opensAt + 60000;
  const pending = start();
  await blocked();
  expect(services.at(-1)!.messages.some((m) => m.type === "listening")).toBe(
    false,
  );
  await release();
  const service = await pending;
  expect((await fetch(`${service.origin}/readyz`)).status).toBe(200);
  const snapshot = (await connect(service, host.secret, code)).snapshot;
  expect(snapshot.round?.news).toHaveLength(1);
  expect(snapshot.round?.closesAt).toBe(round.closesAt);
}, 20000);
it("SIGKILL before order commit leaves no trade or partial publication, and the unchanged request can execute once (AC-07/14)", async () => {
  const { host, code, round, request } = await seedRound();
  const original = await readOpenedRound(database.pool, round.roundId);
  const service = await start();
  const { socket } = await connect(service, host.secret, code);
  const batches: unknown[] = [];
  socket.on("market:batch", (value) => batches.push(value));
  const release = await pauseWrite("orders");
  socket.emit("order:submit", request);
  await blocked();
  expect(await readOpenedRound(database.pool, round.roundId)).toEqual(original);
  expect(batches).toEqual([]);
  await kill(service);
  await release();
  const recovered = await start();
  const owner = await connect(recovered, host.secret, code);
  expect(owner.snapshot.round?.portfolio.cashCents).toBe(1000000);
  expect(owner.snapshot.round?.trades).toEqual([]);
  expect(owner.snapshot.round?.recentOrders).toEqual([]);
  const result = await owner.socket
    .timeout(2000)
    .emitWithAck("order:submit", request);
  expect(result).toMatchObject({ status: "FILLED", totalValueCents: 608000 });
  expect(
    await owner.socket.timeout(2000).emitWithAck("order:submit", request),
  ).toEqual(result);
  expect(
    (await readOpenedRound(database.pool, round.roundId))?.receipts,
  ).toHaveLength(1);
}, 20000);
