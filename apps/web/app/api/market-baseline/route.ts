import { marketBaselineResponseSchema } from "@dinopump/contracts";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const origin = process.env.GAME_SERVER_ORIGIN ?? "http://127.0.0.1:3001";
    const response = await fetch(new URL("/api/market-baseline", origin), {
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
      redirect: "error",
    });
    if (!response.ok) throw new Error("Market service unavailable");
    const baseline = marketBaselineResponseSchema.parse(await response.json());
    return Response.json(baseline, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return Response.json(
      { error: "MARKET_INFORMATION_UNAVAILABLE" },
      {
        status: 503,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
