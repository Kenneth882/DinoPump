import { once } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGameServer } from "../../apps/game-server/src/server.js";
import { loadBaseline } from "../../packages/game-content/src/index.js";
import { GET } from "../../apps/web/app/api/market-baseline/route.js";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("read-only baseline service and web boundary", () => {
  it("serves the same validated content through real HTTP and the web proxy", async () => {
    const server = createGameServer();
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      const address = server.address();
      if (!address || typeof address === "string")
        throw new Error("Expected TCP listener");
      const origin = `http://127.0.0.1:${address.port}`;
      vi.stubEnv("GAME_SERVER_ORIGIN", origin);
      const direct = await fetch(`${origin}/api/market-baseline`);
      const proxied = await GET();
      expect(direct.status).toBe(200);
      expect(proxied.status).toBe(200);
      expect(direct.headers.get("cache-control")).toBe("no-store");
      expect(proxied.headers.get("cache-control")).toBe("no-store");
      const body = await direct.json();
      expect(await proxied.json()).toEqual(body);
      expect(body).toEqual({
        schemaVersion: 1,
        contentVersion: "1.0",
        rulesVersion: "1.0",
        assets: loadBaseline().assets,
      });
      const rejected = await fetch(`${origin}/api/market-baseline`, {
        method: "POST",
      });
      expect(rejected.status).toBe(405);
      expect(rejected.headers.get("allow")).toBe("GET");
      expect((await fetch(`${origin}/missing`)).status).toBe(404);
      expect((await fetch(`${origin}//[`)).status).toBe(404);
      expect(await (await fetch(`${origin}/health`)).json()).toEqual({
        status: "ok",
      });
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
    // Closed service is a real connection failure, never a bundled fallback.
    const unavailable = await GET();
    expect(unavailable.status).toBe(503);
    expect(await unavailable.json()).toEqual({
      error: "MARKET_INFORMATION_UNAVAILABLE",
    });
  });

  it("fails before listening even if only an unused event is invalid", () => {
    const baseline = loadBaseline();
    expect(() =>
      createGameServer({
        ...baseline,
        eventCatalog: [
          {
            ...baseline.eventCatalog[0],
            effects: [{ symbol: "TREX", referenceChangeBps: 500 }],
          },
        ],
      }),
    ).toThrow(/symbol/);
  });

  it.each([
    [
      "non-200",
      () =>
        Promise.resolve(
          new Response("private upstream error", { status: 500 }),
        ),
    ],
    ["invalid JSON", () => Promise.resolve(new Response("not JSON"))],
    ["invalid contract", () => Promise.resolve(Response.json({ assets: [] }))],
    [
      "timeout",
      () => Promise.reject(new DOMException("Timed out", "TimeoutError")),
    ],
  ])(
    "maps %s to a safe uncached unavailable response",
    async (_label, fetcher) => {
      vi.stubGlobal("fetch", fetcher);
      const response = await GET();
      expect(response.status).toBe(503);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toEqual({
        error: "MARKET_INFORMATION_UNAVAILABLE",
      });
    },
  );
});
