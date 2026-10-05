import type { Server as HttpServer } from "node:http";
import { Server, type Socket } from "socket.io";
import {
  lobbySubscriptionSchema,
  lobbyResyncSchema,
} from "@dinopump/contracts";
import { LobbyError } from "@dinopump/database";
import { safeError, sessionSecret, type LobbyOptions } from "./lobby-http.js";

/** Serialize subscription, committed mutations and fresh snapshots in one owner. */
export function attachLobby(server: HttpServer, options: LobbyOptions) {
  const io = new Server(server, {
    maxHttpBufferSize: 4096,
    cors: { origin: options.webOrigin, credentials: true },
    allowRequest: (request, callback) =>
      callback(null, request.headers.origin === options.webOrigin),
  });
  const members = new Map<
    Socket,
    { secret: string; code: string; playerId: string; sequence: number }
  >();
  let tail: Promise<unknown> = Promise.resolve();
  function serial<T>(work: () => Promise<T>) {
    const result = tail.then(work);
    tail = result.catch(() => {});
    return result;
  }
  async function remove(socket: Socket) {
    const member = members.get(socket);
    members.delete(socket);
    if (
      member &&
      ![...members.values()].some(
        (other) =>
          other.playerId === member.playerId && other.code === member.code,
      )
    ) {
      await options.store.disconnect(member.playerId, member.code);
    }
  }
  async function publish() {
    for (const [socket, member] of members) {
      try {
        const snapshot = await options.store.snapshot(
          member.secret,
          member.code,
        );
        if (snapshot.sequence !== member.sequence) {
          socket.emit("room:snapshot", snapshot);
          socket.emit("presence:update", snapshot);
          member.sequence = snapshot.sequence;
        }
      } catch (error) {
        socket.emit("command:error", safeError(error));
        socket.disconnect(true);
        await remove(socket);
      }
    }
  }
  const execute = <T>(work: () => Promise<T>) =>
    serial(async () => {
      const result = await work();
      await publish();
      return result;
    });
  io.use((socket, next) => {
    void serial(async () => {
      const parsed = lobbySubscriptionSchema.safeParse(socket.handshake.auth);
      if (!parsed.success) throw new LobbyError("INVALID_REQUEST");
      await options.store.snapshot(
        sessionSecret(socket.handshake.headers.cookie),
        parsed.data.code,
      );
    }).then(
      () => next(),
      (error: unknown) =>
        next(
          Object.assign(new Error(safeError(error).message), {
            data: safeError(error),
          }),
        ),
    );
  });
  io.on("connection", (socket) => {
    socket.on("disconnect", () => {
      void execute(() => remove(socket)).catch(() => {});
    });
    void execute(async () => {
      if (!socket.connected) return;
      const { code } = lobbySubscriptionSchema.parse(socket.handshake.auth);
      const secret = sessionSecret(socket.handshake.headers.cookie);
      const player = await options.store.authenticate(secret);
      await options.store.connect(secret, code);
      members.set(socket, {
        secret,
        code,
        playerId: player.playerId,
        sequence: -1,
      });
    }).catch((error: unknown) => {
      socket.emit("command:error", safeError(error));
      socket.disconnect(true);
    });
    socket.on("room:resync", (payload: unknown, ack: unknown) => {
      void serial(async () => {
        const parsed = lobbyResyncSchema.safeParse(payload);
        const member = members.get(socket);
        if (!parsed.success) throw new LobbyError("INVALID_REQUEST");
        if (!member || parsed.data.code !== member.code)
          throw new LobbyError("FORBIDDEN");
        const snapshot = await options.store.snapshot(
          member.secret,
          member.code,
        );
        socket.emit("room:snapshot", snapshot);
        if (typeof ack === "function")
          ack({ requestId: parsed.data.requestId, snapshot });
      }).catch((error: unknown) => {
        const parsed = lobbyResyncSchema.safeParse(payload);
        const body = {
          ...safeError(error),
          ...(parsed.success ? { requestId: parsed.data.requestId } : {}),
        };
        socket.emit("command:error", body);
        if (typeof ack === "function") ack(body);
      });
    });
  });
  const timer = setInterval(() => {
    void execute(() => options.store.processDue()).catch(() => {
      io.disconnectSockets(true);
    });
  }, 1000);
  timer.unref();
  // Close upgraded connections before waiting for the HTTP listener to close.
  const close = server.close.bind(server);
  server.close = (callback) => {
    clearInterval(timer);
    io.disconnectSockets(true);
    io.engine.close();
    return close(callback);
  };
  return execute;
}
