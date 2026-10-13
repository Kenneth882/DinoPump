import {
  lobbyErrorMessages,
  lobbyErrorSchema,
  lobbySnapshotSchema,
  sessionResponseSchema,
} from "@dinopump/contracts";

async function proxy(
  request: Request,
  context: { params: Promise<{ lobby: string[] }> },
) {
  const { lobby } = await context.params;
  const path = lobby.join("/");
  if (!/^(session|rooms|rooms\/[A-Z0-9]{6}\/(join|snapshot))$/.test(path))
    return Response.json(
      { error: "INVALID_REQUEST", message: lobbyErrorMessages.INVALID_REQUEST },
      { status: 400 },
    );
  try {
    const headers = new Headers({ "Content-Type": "application/json" });
    for (const key of ["cookie", "origin"]) {
      const value = request.headers.get(key);
      if (value) headers.set(key, value);
    }
    const response = await fetch(
      `${process.env.GAME_SERVER_ORIGIN ?? "http://127.0.0.1:3001"}/api/${path}`,
      {
        method: request.method,
        headers,
        ...(request.method === "POST" ? { body: await request.text() } : {}),
        cache: "no-store",
        signal: AbortSignal.timeout(5000),
      },
    );
    const raw: unknown = await response.json();
    const body = response.ok
      ? path === "session"
        ? sessionResponseSchema.parse(raw)
        : lobbySnapshotSchema.parse(raw)
      : lobbyErrorSchema.parse(raw);
    const output = new Headers({ "Cache-Control": "no-store" });
    const cookie = response.headers.get("set-cookie");
    if (response.ok && path === "session" && cookie)
      output.set("Set-Cookie", cookie);
    return Response.json(body, { status: response.status, headers: output });
  } catch {
    return Response.json(
      {
        error: "SERVICE_UNAVAILABLE",
        message: lobbyErrorMessages.SERVICE_UNAVAILABLE,
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
export const GET = proxy;
export const POST = proxy;
