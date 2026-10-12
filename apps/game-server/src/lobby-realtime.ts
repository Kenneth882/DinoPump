import type { Server as HttpServer } from "node:http";
import { Server, type Socket } from "socket.io";
import {
  lobbySubscriptionSchema,
  lobbyResyncSchema,
  roundStartSchema,
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
    {
      secret: string;
      code: string;
      playerId: string;
      sequence: number;
      roundId?: string | undefined;
      roundSequence?: number | undefined;
    }
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
        if (
          snapshot.round &&
          member.roundId === snapshot.round.roundId &&
          member.roundSequence !== undefined &&
          snapshot.round.sequence > member.roundSequence
        ) {
          const batches = await options.store.marketUpdates(
            member.secret,
            member.code,
            member.roundId,
            member.roundSequence,
          );
          for (const batch of batches) {
            socket.emit("market:batch", batch);
            for (const news of batch.news) socket.emit("news:update", news);
          }
        }
        member.roundId = snapshot.round?.roundId;
        member.roundSequence = snapshot.round?.sequence;
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
    function commandError(payload: unknown, ack: unknown, error: unknown) {
      const requestId = roundStartSchema.passthrough().safeParse(payload);
      const body = {
        ...safeError(error),
        ...(requestId.success ? { requestId: requestId.data.requestId } : {}),
      };
      socket.emit("command:error", body);
      if (typeof ack === "function") ack(body);
    }
    socket.on("round:start", (payload: unknown, ack: unknown) => {
      void execute(async () => {
        const member = members.get(socket);
        if (!member) throw new LobbyError("FORBIDDEN");
        return options.store.start(member.secret, member.code, payload);
      }).then(
        (outcome) => {
          if (typeof ack === "function") ack(outcome);
        },
        (error: unknown) => commandError(payload, ack, error),
      );
    });
    socket.on("room:ready", (payload: unknown, ack: unknown) => {
      void execute(async () => {
        const member = members.get(socket);
        if (!member) throw new LobbyError("FORBIDDEN");
        return options.store.ready(member.secret, member.code, payload);
      }).then(
        (outcome) => {
          if (typeof ack === "function") ack(outcome);
        },
        (error: unknown) => commandError(payload, ack, error),
      );
    });
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
        member.sequence = snapshot.sequence;
        member.roundId = snapshot.round?.roundId;
        member.roundSequence = snapshot.round?.sequence;
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
  let ticking = false;
  const timer = setInterval(() => {
    if (ticking) return;
    ticking = true;
    void execute(async () => {
      const applied = await options.store.processDue();
      for (const event of applied)
        console.info(JSON.stringify({ event: "scheduler.applied", ...event }));
    })
      .catch(() => {
        io.disconnectSockets(true);
      })
      .finally(() => {
        ticking = false;
      });
  }, 250);
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
