import assert from "node:assert/strict";
import { execFileSync, fork } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdir, writeFile } from "node:fs/promises";
import { cpus, platform, release, totalmem } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { io, type Socket } from "socket.io-client";
import {
  engineStateSchema,
  lobbySnapshotSchema,
  marketBatchSchema,
  orderResultSchema,
  tradingCommandErrorSchema,
  type LobbySnapshot,
  type OrderSubmit,
} from "../../packages/contracts/dist/index.js";
import {
  migrate,
  readOpenedRound,
} from "../../packages/database/dist/index.js";
import { isolatedDatabase } from "../helpers/database.js";

const smoke = process.argv.includes("--smoke");
const sustained = process.argv.includes("--sustained");
assert(
  process.argv
    .slice(2)
    .every((arg) => ["--smoke", "--sustained"].includes(arg)),
  "Unknown load option",
);
const directory = `test-results/load-${new Date().toISOString().replaceAll(":", "-")}`;
await mkdir(directory, { recursive: true });
const startedAt = new Date().toISOString();
const failures: string[] = [];
const report: Record<string, unknown> = {
  startedAt,
  sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim(),
  sourceIncludesWorkingTreeChanges: true,
  mode: smoke ? "smoke (not acceptance)" : "full real-time round",
  environment: {
    region:
      process.env.DINOPUMP_TEST_REGION ?? "local; deployment region unverified",
    host: `${platform()} ${release()}`,
    cpu: cpus()[0]?.model,
    logicalCpus: cpus().length,
    memoryBytes: totalmem(),
    node: process.version,
    topology:
      "separate load and game processes, same host; loopback PostgreSQL",
    llmKey: "not supplied; no worker or provider configured",
  },
  workload: {
    players: 8,
    peakOrdersPerPlayerPerSecond: 5,
    peakSeconds: sustained ? 600 : 10,
    subsequentOrdersPerPlayerPerSecond: sustained ? 5 : 0.2,
    mix: "rotating four assets; 4 buys, 4 sells, 1 protected-zero buy, 1 exact retry per 10 attempts; quantity 1",
    clock: "Date.now; no acceleration or changed rules",
  },
};
let phase = "database setup";
const database = await isolatedDatabase();
const sockets: Socket[] = [];
let child: ReturnType<typeof fork> | undefined;
let submitted = 0;
let completed = 0;
let skipped = 0;
const outcomes: Record<string, number> = {};
const commandMix: Record<string, number> = {};
const pending = new Set<Promise<void>>();
const rtt: number[] = [];
const timeline: unknown[] = [];
report.timeline = timeline;
try {
  await migrate(database.pool);
  report.postgres = (
    await database.pool.query("SHOW server_version")
  ).rows[0].server_version;
  const schema = (await database.pool.query("SELECT current_schema() AS name"))
    .rows[0].name as string;
  child = fork(new URL("../helpers/load-game-server.ts", import.meta.url), [], {
    execArgv: ["--import", "tsx"],
    // Do not inherit provider credentials or the development database URL.
    env: {
      PATH: process.env.PATH,
      TEST_DATABASE_URL: process.env.TEST_DATABASE_URL,
      DINOPUMP_TEST_PORT: process.env.DINOPUMP_TEST_PORT,
      DINOPUMP_LOAD_SCHEMA: schema,
    },
    stdio: ["ignore", "ignore", "ignore", "ipc"],
  });
  const [address] = await Promise.race([
    once(child, "message"),
    once(child, "exit").then(() => {
      throw new Error("Load service exited during startup");
    }),
    delay(15000).then(() => {
      throw new Error("Load service startup timeout");
    }),
  ]);
  assert(
    address && typeof address.port === "number",
    "Service did not supply a port",
  );
  const origin = `http://127.0.0.1:${address.port}`;
  const webOrigin = "http://127.0.0.1:3000";
  async function post(path: string, body: unknown, cookie = "") {
    const response = await fetch(`${origin}${path}`, {
      method: "POST",
      headers: {
        Origin: webOrigin,
        "Content-Type": "application/json",
        Cookie: cookie,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
    assert(response.ok, `HTTP command failed (${response.status})`);
    return response;
  }
  phase = "connect eight clients";
  const clients: {
    socket: Socket;
    snapshot: LobbySnapshot | undefined;
    hash: ReturnType<typeof createHash>;
    batches: number;
    cursor: number | undefined;
    previous?: { order: OrderSubmit; result: unknown };
  }[] = [];
  let code = "";
  for (let index = 0; index < 8; index++) {
    const session = await post("/api/session", {
      displayName: `Load Dino ${index + 1}`,
      avatar: "trex",
    });
    const cookie = session.headers.get("set-cookie")?.split(";")[0];
    assert(cookie, "Missing synthetic session");
    if (!code)
      code = (await (await post("/api/rooms", {}, cookie)).json()).code;
    else await post(`/api/rooms/${code}/join`, {}, cookie);
    const socket = io(origin, {
      autoConnect: false,
      reconnection: false,
      transports: ["websocket"],
      extraHeaders: { Origin: webOrigin, Cookie: cookie },
      auth: { code },
    });
    sockets.push(socket);
    const client: (typeof clients)[number] = {
      socket,
      snapshot: undefined,
      hash: createHash("sha256"),
      batches: 0,
      cursor: undefined,
    };
    clients.push(client);
    socket.on("room:snapshot", (payload: unknown) => {
      const parsed = lobbySnapshotSchema.safeParse(payload);
      if (!parsed.success) {
        failures.push("Invalid snapshot");
        return;
      }
      client.snapshot = parsed.data;
    });
    socket.on("market:batch", (payload: unknown, ack?: () => void) => {
      const parsed = marketBatchSchema.safeParse(payload);
      if (!parsed.success) {
        failures.push("Invalid batch");
        return;
      }
      const batch = parsed.data;
      if (
        client.cursor !== undefined &&
        batch.startSequence !== client.cursor + 1
      )
        failures.push("Gap or duplicate in connected client batch stream");
      client.cursor = batch.endSequence;
      client.hash.update(JSON.stringify(batch));
      client.batches++;
      ack?.();
    });
    socket.on("disconnect", () =>
      failures.push("Unexpected load client disconnect"),
    );
    socket.connect();
    const deadline = Date.now() + 10000;
    while (!client.snapshot && Date.now() < deadline) await delay(25);
    assert(client.snapshot, "Initial client snapshot timeout");
  }
  phase = "ready and open";
  for (const client of clients) {
    const result = await client.socket
      .timeout(10000)
      .emitWithAck("room:ready", { ready: true, requestId: randomUUID() });
    assert(!result.error, "Readiness command failed");
  }
  const start = await clients[0]!.socket
    .timeout(10000)
    .emitWithAck("round:start", { requestId: randomUUID() });
  assert(!start.error, "Round start failed");
  const openingDeadline = Date.now() + 15000;
  while (
    !clients.every((client) => client.snapshot?.status === "OPEN") &&
    Date.now() < openingDeadline
  )
    await delay(25);
  const initial = clients[0]!.snapshot?.round;
  assert(
    initial && clients.every((client) => client.snapshot?.status === "OPEN"),
    "Eight clients did not open",
  );
  assert.equal(initial.closesAt - initial.opensAt, 600000);
  report.round = {
    roundId: initial.roundId,
    opensAtMs: initial.opensAt,
    closesAtMs: initial.closesAt,
    rulesVersion: initial.tradingRules.rulesVersion,
  };
  for (const client of clients)
    client.cursor = client.snapshot!.round!.sequence;
  const loadStarted = performance.now();
  report.loadStartedAt = new Date().toISOString();
  const stopAt = smoke ? Date.now() + 12000 : initial.closesAt;
  let tick = 0;
  let nextScrape = 0;
  const indexes = clients.map(() => 0);
  phase = "submit workload";
  while (Date.now() < stopAt) {
    const elapsed = performance.now() - loadStarted;
    const peak = sustained || elapsed < 10000;
    if (peak || tick % 25 === 0) {
      for (const [index, client] of clients.entries()) {
        // Open-loop workload: slow acknowledgements do not silently reduce offered load.
        if (pending.size >= 160) {
          skipped++;
          continue;
        }
        const ordinal = indexes[index]!++;
        const slot = ordinal % 10;
        const side = slot % 2 === 0 ? "buy" : "sell";
        const round = client.snapshot!.round!;
        const symbol = round.assets[Math.floor(slot / 2) % 4]!.symbol;
        const protectionPriceCents =
          slot === 8
            ? round.tradingRules.prices.minCents
            : side === "buy"
              ? Math.min(
                  round.tradingRules.prices.maxCents,
                  Math.ceil(
                    round.assets.find((asset) => asset.symbol === symbol)!
                      .referencePriceCents * 1.2,
                  ),
                )
              : round.tradingRules.prices.minCents;
        const previous = client.previous;
        const order: OrderSubmit =
          slot === 9 && previous
            ? previous.order
            : {
                roundId: initial.roundId,
                requestId: randomUUID(),
                symbol,
                side,
                quantity: 1,
                protectionPriceCents,
              };
        const commandKind = `${order.symbol}:${order.side}:${slot === 9 && previous ? "retry" : "new"}`;
        commandMix[commandKind] = (commandMix[commandKind] ?? 0) + 1;
        submitted++;
        const sent = performance.now();
        const task = (async () => {
          try {
            const response: unknown = await client.socket
              .timeout(30000)
              .emitWithAck("order:submit", order);
            const error = tradingCommandErrorSchema.safeParse(response);
            if (error.success) {
              outcomes[error.data.error] =
                (outcomes[error.data.error] ?? 0) + 1;
              failures.push(`Transport rejected order: ${error.data.error}`);
              return;
            }
            const result = orderResultSchema.parse(response);
            outcomes[result.status] = (outcomes[result.status] ?? 0) + 1;
            if (slot === 9 && previous)
              assert.deepEqual(
                result,
                previous.result,
                "Retry changed its outcome",
              );
            else client.previous = { order, result };
            completed++;
            rtt.push(performance.now() - sent);
          } catch {
            failures.push(
              "Order failed validation, retry equality or acknowledgement deadline",
            );
          }
        })();
        pending.add(task);
        void task.finally(() => pending.delete(task));
      }
    }
    if (elapsed >= nextScrape) {
      const metrics = await (
        await fetch(`${origin}/metrics`, { signal: AbortSignal.timeout(10000) })
      ).json();
      timeline.push({ elapsedMs: Math.round(elapsed), metrics });
      nextScrape += 60000;
      console.info(
        JSON.stringify({
          elapsedSeconds: Math.floor(elapsed / 1000),
          submitted,
          completed,
          inFlight: pending.size,
        }),
      );
    }
    tick++;
    await delay(Math.max(0, tick * 200 - (performance.now() - loadStarted)));
  }
  phase = "drain workload";
  await Promise.all(pending);
  report.metrics = await (
    await fetch(`${origin}/metrics`, { signal: AbortSignal.timeout(10000) })
  ).json();
  if (!smoke) {
    const deadline = Date.now() + 15000;
    while (
      !clients.every((client) => client.snapshot?.status === "FINISHED") &&
      Date.now() < deadline
    )
      await delay(100);
    assert(
      clients.every((client) => client.snapshot?.status === "FINISHED"),
      "Round did not finish on all clients",
    );
  }
  phase = "resync final snapshots";
  for (const client of clients) {
    const resync = await client.socket
      .timeout(30000)
      .emitWithAck("room:resync", {
        roundId: initial.roundId,
        lastSequence: client.cursor ?? 0,
      });
    client.snapshot = lobbySnapshotSchema.parse(resync.snapshot);
    assert.equal(
      client.cursor,
      client.snapshot.round!.sequence,
      "Resync concealed missing connected batches",
    );
  }
  await delay(1100); // Include outstanding confirmation timeouts in evidence.
  const metrics = await (await fetch(`${origin}/metrics`)).json();
  report.metrics = metrics;
  report.timeline = timeline;
  report.workloadResult = {
    commandMix,
    submitted,
    completed,
    skipped,
    outcomes,
    durationMs: Math.round(performance.now() - loadStarted),
  };
  rtt.sort((a, b) => a - b);
  report.clientRoundTripMs = {
    count: rtt.length,
    p95: rtt[Math.ceil(rtt.length * 0.95) - 1],
    max: rtt.at(-1),
  };
  const streams = clients.map((client) => ({
    batches: client.batches,
    cursor: client.cursor,
    sha256: client.hash.digest("hex"),
  }));
  report.streams = streams;
  phase = "compare connected batch streams";
  for (const stream of streams)
    assert.deepEqual(
      stream,
      streams[0],
      "Connected clients received different batches",
    );
  phase = "verify persisted history and projection";
  const replay = engineStateSchema.parse(
    await readOpenedRound(database.pool, initial.roundId),
  );
  phase = "compare final clients and results";
  const first = clients[0]!.snapshot!;
  for (const client of clients) {
    const snapshot = client.snapshot!;
    assert.deepEqual(snapshot.round!.assets, first.round!.assets);
    assert.deepEqual(snapshot.round!.quotes, first.round!.quotes);
    assert.deepEqual(snapshot.round!.totals, first.round!.totals);
    assert.equal(snapshot.round!.sequence, replay.sequence);
    const terminal = snapshot.terminal;
    if (!smoke) {
      assert(terminal?.status === "FINISHED");
      assert.deepEqual(terminal.marks, replay.finalResult!.marks);
      assert.deepEqual(
        terminal.rankings.map((rank) => ({
          playerId: rank.playerId,
          joinOrder: rank.joinOrder,
          rank: rank.rank,
          portfolioValueCents: rank.portfolioValueCents,
          profitCents: rank.profitCents,
          returnPercent: rank.returnPercent,
        })),
        replay.finalResult!.rankings,
      );
      const owner = replay.trading.humans.find(
        (human) => human.playerId === terminal.playerId,
      )!;
      assert.deepEqual(terminal.portfolio, {
        cashCents: owner.cashCents,
        holdings: owner.holdings,
      });
      assert.equal(terminal.timeline.length, 9);
    }
  }
  // readOpenedRound verifies immutable fills, orders, public views, news, results and projection against replay.
  // engineStateSchema checks covered resources, nonnegative balances and integer cash/unit conservation.
  report.integrity = {
    replayMatchesProjectionAndResults: true,
    conservedNonnegativeCoveredResources: true,
    identicalClientStreams: true,
    scheduledEvents: replay.nextScheduledEvent,
    sequence: replay.sequence,
    receipts: replay.receipts.length,
    roundId: initial.roundId,
  };
  report.finalResults = clients.map((client) => client.snapshot!.terminal);
  report.news = first.round!.news;
  assert(
    first.round!.news.every((item) => item.narration === undefined),
    "Unexpected generated narration",
  );
  const percentileUpper = (name: string) => {
    const histogram = metrics.histograms[name];
    if (!histogram?.count) return null;
    const bucket = Object.entries<number>(histogram.buckets).find(
      ([, count]) => count >= Math.ceil(histogram.count * 0.95),
    );
    return bucket ? Math.min(Number(bucket[0]), histogram.max) : histogram.max;
  };
  const ackUpper = percentileUpper("order_ack_ms");
  const deliveryUpper = percentileUpper("commit_to_client_ms");
  const gates = {
    orderAckP95Under300: ackUpper !== null && ackUpper < 300,
    deliveryP95Under500: deliveryUpper !== null && deliveryUpper < 500,
    snapshotUnder1000:
      metrics.histograms.snapshot_ms?.count > 0 &&
      metrics.histograms.snapshot_ms.max < 1000,
    schedulerLagAtMost1000:
      metrics.histograms.scheduler_lag_ms?.count === 9 &&
      metrics.histograms.scheduler_lag_ms.max <= 1000,
    noMissingDeliveries:
      (metrics.counters.delivery_timeouts ?? 0) === 0 &&
      metrics.histograms.commit_to_client_ms?.count ===
        streams.reduce((sum, stream) => sum + stream.batches, 0),
    allAcknowledgementsMeasured:
      metrics.histograms.order_ack_ms?.count === submitted,
    completeWorkload: completed === submitted && skipped === 0 && submitted > 0,
    eightConnected:
      metrics.gauges.connected_players === 8 &&
      metrics.gauges.connected_sockets === 8,
    fullTenMinuteRound:
      !smoke &&
      replay.trading.status === "FINISHED" &&
      replay.nextScheduledEvent === 9,
  };
  report.percentileUpperBoundsMs = {
    orderAckP95: ackUpper,
    commitToClientP95: deliveryUpper,
  };
  report.gates = gates;
  report.deploymentRegionAcceptance =
    "unverified; this isolated same-host run is supporting evidence only";
  if (!smoke)
    for (const [name, passed] of Object.entries(gates))
      if (!passed) failures.push(`Gate failed: ${name}`);
  if (skipped || completed !== submitted)
    failures.push("Incomplete offered workload");
} catch (error) {
  report.failureKind =
    error instanceof assert.AssertionError
      ? `assertion: ${error.operator}`
      : error instanceof Error
        ? error.name
        : "unknown";
  // Never serialize driver/transport errors, cookies, connection URLs or arbitrary payloads.
  failures.push(
    "Harness stopped before all integrity checks completed; inspect the last recorded phase",
  );
} finally {
  report.workloadResult = {
    commandMix,
    submitted,
    completed,
    skipped,
    outcomes,
    durationMs:
      typeof report.loadStartedAt === "string"
        ? Date.now() - Date.parse(report.loadStartedAt)
        : null,
  };
  rtt.sort((a, b) => a - b);
  report.clientRoundTripMs = {
    count: rtt.length,
    p95: rtt[Math.ceil(rtt.length * 0.95) - 1],
    max: rtt.at(-1),
  };
  report.lastPhase = phase;
  report.failures = [...new Set(failures)];
  report.finishedAt = new Date().toISOString();
  report.passed = failures.length === 0;
  report.submitted = submitted;
  report.completed = completed;
  await writeFile(
    `${directory}/report.json`,
    `${JSON.stringify(report, null, 2)}\n`,
  );
  for (const socket of sockets) {
    socket.removeAllListeners("disconnect");
    socket.disconnect();
  }
  if (child && child.exitCode === null && child.signalCode === null) {
    child.kill("SIGTERM");
    await Promise.race([once(child, "exit"), delay(5000)]);
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      await once(child, "exit");
    }
  }
  await database.close();
  console.info(
    `Load evidence: ${directory}/report.json; ${failures.length ? "FAILED" : smoke ? "SMOKE ONLY" : "local gates passed"}`,
  );
  if (failures.length) process.exitCode = 1;
}
