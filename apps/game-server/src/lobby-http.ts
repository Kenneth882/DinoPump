import type { IncomingMessage, ServerResponse } from "node:http";
import {
  emptyCommandSchema,
  sessionResponseSchema,
  lobbyErrorMessages,
  type LobbyErrorCode,
} from "@dinopump/contracts";
import { LobbyError, type LobbyStore } from "@dinopump/database";

export interface LobbyOptions {
  store: LobbyStore;
  webOrigin: string;
  secureCookies: boolean;
  execute?: <T>(work: () => Promise<T>) => Promise<T>;
}
export function sessionSecret(cookie: string | undefined) {
  return (
    cookie
      ?.split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith("dino_session="))
      ?.slice(13) ?? ""
  );
}
export function safeError(error: unknown) {
  const code: LobbyErrorCode =
    error instanceof LobbyError ? error.code : "SERVICE_UNAVAILABLE";
  return { error: code, message: lobbyErrorMessages[code] };
}
const statuses: Record<LobbyErrorCode, number> = {
  INVALID_REQUEST: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  ACTIVE_ROOM_EXISTS: 409,
  ROOM_NOT_FOUND: 404,
  ROOM_FULL: 409,
  NAME_TAKEN: 409,
  JOIN_LOCKED: 409,
  SERVICE_UNAVAILABLE: 503,
};
async function readBody(request: IncomingMessage): Promise<unknown> {
  request.setEncoding("utf8");
  let body = "";
  for await (const chunk of request) {
    body += String(chunk);
    if (body.length > 4096) throw new LobbyError("INVALID_REQUEST");
  }
  try {
    return JSON.parse(body || "{}");
  } catch {
    throw new LobbyError("INVALID_REQUEST");
  }
}
export async function lobbyHttp(
  request: IncomingMessage,
  response: ServerResponse,
  options: LobbyOptions,
) {
  try {
    if (
      request.headers.origin !== options.webOrigin &&
      request.method !== "GET"
    )
      throw new LobbyError("FORBIDDEN");
    const path = request.url?.split("?", 1)[0];
    if (path === "/api/session" && request.method === "POST") {
      const session = await options.store.createSession(
        await readBody(request),
      );
      response.statusCode = 201;
      response.setHeader(
        "Set-Cookie",
        `dino_session=${session.secret}; Path=/; Max-Age=86400; HttpOnly; SameSite=Strict${options.secureCookies ? "; Secure" : ""}`,
      );
      response.end(
        JSON.stringify(sessionResponseSchema.parse({ player: session.player })),
      );
      return;
    }
    const secret = sessionSecret(request.headers.cookie);
    if (path === "/api/session" && request.method === "GET") {
      response.end(
        JSON.stringify(
          sessionResponseSchema.parse({
            player: await options.store.authenticate(secret),
          }),
        ),
      );
      return;
    }
    const execute = options.execute ?? (<T>(work: () => Promise<T>) => work());
    if (path === "/api/rooms" && request.method === "POST") {
      if (!emptyCommandSchema.safeParse(await readBody(request)).success)
        throw new LobbyError("INVALID_REQUEST");
      const room = await execute(() => options.store.createRoom(secret));
      response.statusCode = 201;
      response.end(JSON.stringify(room));
      return;
    }
    const match = path?.match(/^\/api\/rooms\/([^/]+)\/(join|snapshot)$/);
    if (match) {
      const code = match[1]!;
      if (match[2] === "join" && request.method === "POST") {
        if (!emptyCommandSchema.safeParse(await readBody(request)).success)
          throw new LobbyError("INVALID_REQUEST");
        response.end(
          JSON.stringify(await execute(() => options.store.join(secret, code))),
        );
        return;
      }
      if (match[2] === "snapshot" && request.method === "GET") {
        response.end(
          JSON.stringify(await options.store.snapshot(secret, code)),
        );
        return;
      }
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: "NOT_FOUND" }));
  } catch (error) {
    const body = safeError(error);
    response.statusCode = statuses[body.error];
    response.end(JSON.stringify(body));
  }
}
