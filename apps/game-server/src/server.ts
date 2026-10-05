import { attachLobby } from "./lobby-realtime.js";
import { lobbyHttp, type LobbyOptions } from "./lobby-http.js";
import { createServer } from "node:http";
import {
  baselineSchema,
  marketBaselineResponseSchema,
} from "@dinopump/contracts";
import { loadBaseline } from "@dinopump/game-content";

export function createGameServer(
  content: unknown = loadBaseline(),
  lobby?: LobbyOptions,
) {
  // Validate before creating a listener, including content unused by this endpoint.
  const baseline = baselineSchema.parse(content);
  const publicBaseline = JSON.stringify(
    marketBaselineResponseSchema.parse({
      schemaVersion: 1,
      contentVersion: baseline.contentVersion,
      rulesVersion: baseline.rulesVersion,
      assets: baseline.assets,
    }),
  );

  const server = createServer((request, response) => {
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.setHeader("Cache-Control", "no-store");
    const path = request.url?.split("?", 1)[0];
    if (path === "/api/market-baseline" || path === "/health") {
      if (request.method !== "GET") {
        response.statusCode = 405;
        response.setHeader("Allow", "GET");
        response.end(JSON.stringify({ error: "METHOD_NOT_ALLOWED" }));
        return;
      }
      response.end(
        path === "/health" ? JSON.stringify({ status: "ok" }) : publicBaseline,
      );
      return;
    }
    if (lobby) {
      void lobbyHttp(request, response, lobby);
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: "NOT_FOUND" }));
  });
  if (lobby) lobby.execute = attachLobby(server, lobby);
  return server;
}
