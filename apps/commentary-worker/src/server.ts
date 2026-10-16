import { createServer } from "node:http";
import type { Operations } from "@dinopump/database";

/** Loopback operator probes; provider availability never defines readiness. */
export function createWorkerServer(operations: Operations) {
  return createServer((request, response) => {
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.setHeader("Cache-Control", "no-store");
    const path = request.url?.split("?", 1)[0];
    if (!["/healthz", "/readyz", "/metrics"].includes(path ?? "")) {
      response.statusCode = 404;
      response.end(JSON.stringify({ error: "NOT_FOUND" }));
      return;
    }
    if (request.method !== "GET") {
      response.statusCode = 405;
      response.setHeader("Allow", "GET");
      response.end(JSON.stringify({ error: "METHOD_NOT_ALLOWED" }));
      return;
    }
    const metrics = operations.snapshot();
    if (path === "/metrics") response.end(JSON.stringify(metrics));
    else {
      const ready = path === "/healthz" || metrics.gauges.ready === 1;
      response.statusCode = ready ? 200 : 503;
      response.end(JSON.stringify({ status: ready ? "ok" : "unavailable" }));
    }
  });
}
