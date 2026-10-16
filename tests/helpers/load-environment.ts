import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { Pool } from "pg";
import {
  databaseConnection,
  migrate,
} from "../../packages/database/dist/index.js";
import { isolatedDatabase } from "./database.js";

export type LoadEnvironment = {
  pool: Pool;
  origin: string;
  webOrigin: string;
  metricsOrigin: string;
  metadata: Record<string, unknown>;
  close(): Promise<void>;
};

export async function localLoadEnvironment(): Promise<LoadEnvironment> {
  const database = await isolatedDatabase();
  let child: ReturnType<typeof fork> | undefined;
  async function close() {
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
      await Promise.race([once(child, "exit"), delay(5000)]);
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
        await once(child, "exit");
      }
    }
    await database.close();
  }
  try {
    await migrate(database.pool);
    const schema = (
      await database.pool.query("SELECT current_schema() AS name")
    ).rows[0].name as string;
    child = fork(new URL("./load-game-server.ts", import.meta.url), [], {
      execArgv: ["--import", "tsx"],
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
    return {
      pool: database.pool,
      origin,
      webOrigin: "http://127.0.0.1:3000",
      metricsOrigin: origin,
      metadata: {
        topology:
          "separate load and game processes, same host; loopback PostgreSQL",
      },
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}

/** Existing hosted data is never migrated, reset, or removed by the runner. */
export async function stagingLoadEnvironment(
  sourceCommit: string,
  rehearsal: boolean,
): Promise<LoadEnvironment> {
  const id = process.env.DINOPUMP_DEPLOYMENT_ID ?? "";
  assert(/^[a-f0-9]{32}$/.test(id), "A unique staging identity is required");
  const origin = new URL(process.env.DINOPUMP_LOAD_ORIGIN ?? "");
  const metrics = new URL(
    process.env.DINOPUMP_METRICS_ORIGIN ??
      (process.env.DINOPUMP_METRICS_HOSTPORT
        ? `http://${process.env.DINOPUMP_METRICS_HOSTPORT}`
        : ""),
  );
  assert(
    origin.protocol === "https:" &&
      origin.href === `${origin.origin}/` &&
      !origin.username &&
      !origin.password,
    "Expected exact public HTTPS origin",
  );
  assert(
    metrics.protocol === "http:" &&
      metrics.href === `${metrics.origin}/` &&
      !metrics.username &&
      !metrics.password,
    "Expected exact private HTTP origin",
  );
  const loopback = ["127.0.0.1", "localhost", "[::1]"];
  assert(
    rehearsal
      ? loopback.includes(origin.hostname) &&
          loopback.includes(metrics.hostname)
      : !loopback.includes(origin.hostname) &&
          !loopback.includes(metrics.hostname),
    "Origin does not match run mode",
  );
  assert(
    process.env.DATABASE_SCHEMA === `staging_${id}`,
    "Staging schema identity mismatch",
  );
  const url = new URL(process.env.STAGING_AUDIT_DATABASE_URL ?? "");
  assert(
    decodeURIComponent(url.username).split(".")[0] === `audit_${id}`,
    "Read-only staging login required",
  );
  const pool = new Pool(
    databaseConnection({ ...process.env, DATABASE_URL: url.href }),
  );
  try {
    const marker = await pool.query(
      "SELECT id, purpose FROM deployment_identity",
    );
    assert.deepEqual(marker.rows, [{ id, purpose: "synthetic-staging" }]);
    const empty = await pool.query(
      "SELECT (SELECT count(*) FROM guest_sessions)::int AS guests, (SELECT count(*) FROM rounds)::int AS rounds",
    );
    assert.deepEqual(
      empty.rows,
      [{ guests: 0, rounds: 0 }],
      "Load requires a fresh synthetic deployment",
    );
    const readOnly = await pool.query(
      "SELECT has_table_privilege(current_user, 'guest_sessions', 'INSERT') AS writable",
    );
    assert.equal(
      readOnly.rows[0].writable,
      false,
      "Audit login must not write gameplay",
    );
    const identityResponse = await fetch(
      `${metrics.origin}/operator/deployment`,
      { signal: AbortSignal.timeout(10000) },
    );
    assert(identityResponse.ok, "Private deployment identity unavailable");
    const identity = await identityResponse.json();
    assert.equal(identity.id, id, "Game/database deployment identity mismatch");
    assert.equal(
      identity.sourceCommit,
      sourceCommit,
      "Runner/game source mismatch",
    );
    assert.equal(identity.purpose, "synthetic-staging");
    assert.equal(identity.webOrigin, origin.origin);
    const ready = await fetch(`${metrics.origin}/readyz`, {
      signal: AbortSignal.timeout(10000),
    });
    assert(ready.ok, "Staging game is not ready");
    for (const path of [
      "/metrics",
      "/operator/deployment",
      "/api/metrics",
      "/api/operator/deployment",
    ]) {
      const response = await fetch(`${origin.origin}${path}`, {
        redirect: "manual",
        signal: AbortSignal.timeout(10000),
      });
      assert(
        [400, 404].includes(response.status),
        "Operator routes must not be public",
      );
    }
    const metricsResponse = await fetch(`${metrics.origin}/metrics`, {
      signal: AbortSignal.timeout(10000),
    });
    assert(metricsResponse.ok);
    const initial = await metricsResponse.json();
    assert.equal(
      initial.histograms.order_ack_ms?.count ?? 0,
      0,
      "Restart game before measurement",
    );
    assert.equal(initial.histograms.scheduler_lag_ms?.count ?? 0, 0);
    assert.equal(initial.gauges.connected_sockets ?? 0, 0);
    return {
      pool,
      origin: origin.origin,
      webOrigin: origin.origin,
      metricsOrigin: metrics.origin,
      metadata: {
        topology:
          "HTTPS web proxy -> private game -> durable PostgreSQL; separate load process",
        deployment: identity,
        llmKey:
          "staging runner supplies no provider; verify game/worker deployment inventory",
        region: rehearsal
          ? "local production rehearsal; no regional evidence"
          : "candidate Render virginia / Supabase us-east-1; actual placement requires provider inventory",
        rehearsal,
      },
      async close() {
        await pool.end();
      },
    };
  } catch (error) {
    await pool.end();
    throw error;
  }
}
