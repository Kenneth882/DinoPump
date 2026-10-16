import assert from "node:assert/strict";
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer as httpsServer } from "node:https";
import { createServer, request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { Pool } from "pg";
import { prepareStaging } from "../packages/database/src/staging.js";

// Production binaries and HTTPS on loopback, backed only by Compose tmpfs.
// This exercises the SAME staged adapter without claiming provider placement.
const port = "55435";
const composeEnv = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  DINOPUMP_TEST_PORT: port,
  DINOPUMP_TEST_PROJECT: "dinopump-staging-local",
};
const compose = ["compose", "-f", "compose.test.yaml"];
const children: ReturnType<typeof spawn>[] = [];
const directory = await mkdtemp(join(tmpdir(), "dinopump-staging-local-"));
const id = randomUUID().replaceAll("-", "");
const schema = `staging_${id}`;
let operator: Pool | undefined;
let tls: ReturnType<typeof httpsServer> | undefined;
async function freePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}
function run(command: string, args: string[], env: NodeJS.ProcessEnv) {
  const result = spawnSync(command, args, { env, stdio: "inherit" });
  assert.equal(result.status, 0, `${command} failed`);
}
async function ready(url: string) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url, { signal: AbortSignal.timeout(1000) })).ok) return;
    } catch {
      /* startup */
    }
    await delay(100);
  }
  throw new Error("Local production readiness timeout");
}
try {
  run("docker", [...compose, "up", "-d", "--wait"], composeEnv);
  const databaseUrl = `postgresql://dinopump_test:synthetic_test_only@127.0.0.1:${port}/dinopump_test`;
  operator = new Pool({
    connectionString: databaseUrl,
    options: `-c search_path=${schema}`,
  });
  await prepareStaging(operator, {
    id,
    schema,
    gameRole: `game_${id}`,
    auditRole: `audit_${id}`,
    gamePassword: "synthetic",
    auditPassword: "synthetic",
  });
  const gamePort = await freePort();
  const webPort = await freePort();
  const httpsPort = await freePort();
  const gameOrigin = `http://127.0.0.1:${gamePort}`;
  const webOrigin = `https://localhost:${httpsPort}`;
  const base = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    TMPDIR: process.env.TMPDIR,
    NODE_ENV: "production",
    DATABASE_URL: "",
    GAME_SERVER_HOSTPORT: `127.0.0.1:${gamePort}`,
    WEB_ORIGIN: webOrigin,
  };
  run("pnpm", ["build"], base);
  const gameUrl = new URL(databaseUrl);
  gameUrl.username = `game_${id}`;
  gameUrl.password = "synthetic";
  const auditUrl = new URL(databaseUrl);
  auditUrl.username = `audit_${id}`;
  auditUrl.password = "synthetic";
  const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  children.push(
    spawn("node", ["apps/game-server/dist/index.js"], {
      env: {
        ...base,
        PORT: String(gamePort),
        GAME_SERVER_HOST: "0.0.0.0",
        DATABASE_URL: gameUrl.href,
        DATABASE_SCHEMA: schema,
        DINOPUMP_DEPLOYMENT_ID: id,
        SOURCE_COMMIT: sourceCommit,
      },
      stdio: "inherit",
    }),
  );
  await ready(`${gameOrigin}/readyz`);
  children.push(
    spawn("pnpm", ["--filter", "@dinopump/web", "start"], {
      detached: true,
      env: { ...base, PORT: String(webPort) },
      stdio: "inherit",
    }),
  );
  await ready(`http://127.0.0.1:${webPort}/api/market-baseline`);
  const key = join(directory, "key.pem");
  const cert = join(directory, "cert.pem");
  run(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-days",
      "1",
      "-keyout",
      key,
      "-out",
      cert,
      "-subj",
      "/CN=localhost",
      "-addext",
      "subjectAltName=DNS:localhost,IP:127.0.0.1",
    ],
    base,
  );
  tls = httpsServer(
    { key: await readFile(key), cert: await readFile(cert) },
    (request, response) => {
      const upstream = httpRequest(
        {
          host: "127.0.0.1",
          port: webPort,
          path: request.url,
          method: request.method,
          headers: request.headers,
        },
        (result) => {
          response.writeHead(result.statusCode ?? 502, result.headers);
          result.pipe(response);
        },
      );
      upstream.on("error", () => {
        response.writeHead(502);
        response.end();
      });
      request.pipe(upstream);
    },
  );
  tls.on("upgrade", (request, socket, head) => {
    const upstream = httpRequest({
      host: "127.0.0.1",
      port: webPort,
      path: request.url,
      headers: request.headers,
    });
    upstream.on("upgrade", (response, target, targetHead) => {
      socket.write(
        `HTTP/1.1 101 Switching Protocols\r\n${response.rawHeaders.reduce((lines, value, index, headers) => (index % 2 === 0 ? `${lines}${value}: ${headers[index + 1]}\r\n` : lines), "")}\r\n`,
      );
      if (targetHead.length) socket.write(targetHead);
      if (head.length) target.write(head);
      target.on("error", () => socket.destroy());
      socket.on("error", () => target.destroy());
      socket.on("close", () => target.destroy());
      target.on("close", () => socket.destroy());
      socket.pipe(target).pipe(socket);
    });
    upstream.on("response", () => socket.destroy());
    upstream.on("error", () => socket.destroy());
    upstream.end();
  });
  tls.listen(httpsPort, "127.0.0.1");
  await once(tls, "listening");
  // Async child: the local TLS proxy must keep servicing traffic during the run.
  const workload = spawn(
    "node",
    [
      "--import",
      "tsx",
      "tests/load/eight-client.ts",
      "--staging",
      "--rehearsal",
      "--sustained",
      ...process.argv.slice(2),
    ],
    {
      env: {
        ...base,
        NODE_EXTRA_CA_CERTS: cert,
        DINOPUMP_DEPLOYMENT_ID: id,
        DATABASE_SCHEMA: schema,
        STAGING_AUDIT_DATABASE_URL: auditUrl.href,
        DINOPUMP_LOAD_ORIGIN: webOrigin,
        DINOPUMP_METRICS_HOSTPORT: `127.0.0.1:${gamePort}`,
      },
      stdio: "inherit",
    },
  );
  children.push(workload);
  const [status] = await once(workload, "exit");
  assert.equal(status, 0, "Staging rehearsal failed; retain its report");
} finally {
  for (const child of children.reverse()) {
    if (child.exitCode !== null || child.signalCode !== null || !child.pid)
      continue;
    if (child.spawnargs[0] === "pnpm") process.kill(-child.pid, "SIGTERM");
    else child.kill("SIGTERM");
    await Promise.race([once(child, "exit"), delay(5000)]);
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGKILL");
  }
  tls?.closeAllConnections();
  tls?.close();
  await operator?.end();
  run("docker", [...compose, "down"], composeEnv);
  await rm(directory, { recursive: true, force: true });
}
