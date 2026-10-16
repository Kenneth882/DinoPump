import type { Server as HttpServer } from "node:http";
import { randomUUID } from "node:crypto";
import { Server, type Socket } from "socket.io";
import {
  lobbySubscriptionSchema,
  lobbyResyncSchema,
  roomResyncSchema,
  roundStartSchema,
  tradingErrorMessages,
  reactionSendSchema,
  reactionPublishedSchema,
  reactionErrorCodeSchema,
  reactionErrorMessages,
  type OrderResult,
} from "@dinopump/contracts";
import { LobbyError, TradingError } from "@dinopump/database";
import { safeError, sessionSecret, type LobbyOptions } from "./lobby-http.js";

/** Serialize subscription, committed mutations and fresh snapshots in one owner. */
export function attachLobby(server: HttpServer, options: LobbyOptions) {
  const operations = options.store.operations;
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
      heartbeatAt?: number;
      visibilityKey?: string | undefined;
      roundId?: string | undefined;
      roundSequence?: number | undefined;
      terminalRoundId?: string | undefined;
    }
  >();
  let tail: Promise<unknown> = Promise.resolve();
  function connections() {
    operations.gauge("connected_sockets", members.size);
    operations.gauge(
      "connected_players",
      new Set([...members.values()].map((member) => member.playerId)).size,
    );
  }
  const reactionCooldowns = new Map<string, number>();
  const initialSnapshots = new WeakMap<Socket, number>();
  function serial<T>(work: () => Promise<T>) {
    const result = tail.then(work);
    tail = result.catch(() => {});
    return result;
  }
  async function remove(socket: Socket) {
    const member = members.get(socket);
    members.delete(socket);
    connections();
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
  async function publish(forceSnapshot = false) {
    const recipients = [...members];
    const authorized = new Map<
      Socket,
      { playerId: string; roundId: string | undefined }
    >();
    const deliveries = await options.store.publication(
      recipients.map(([, member]) => member),
      forceSnapshot,
    );
    for (const [index, [socket, member]] of recipients.entries()) {
      const delivery = deliveries[index]!;
      if (delivery.error || (!delivery.snapshot && !delivery.current)) {
        socket.emit(
          "command:error",
          safeError(new LobbyError(delivery.error ?? "SERVICE_UNAVAILABLE")),
        );
        socket.disconnect(true);
        await remove(socket);
        continue;
      }
      const snapshot = delivery.snapshot;
      for (const batch of delivery.batches) {
        const committedAt = operations.deliveryStart(
          batch.roundId,
          batch.endSequence,
        );
        if (committedAt === undefined) socket.emit("market:batch", batch);
        else
          socket.timeout(1000).emit("market:batch", batch, (error: unknown) => {
            if (error) operations.count("delivery_timeouts");
            else
              operations.observe(
                "commit_to_client_ms",
                operations.monotonic() - committedAt,
              );
          });
        for (const news of batch.news) socket.emit("news:update", news);
      }
      member.visibilityKey = delivery.visibilityKey;
      const serverTime = snapshot?.serverTime ?? delivery.current!.serverTime;
      const roundId = snapshot?.round?.roundId ?? delivery.current?.roundId;
      const roundSequence =
        snapshot?.round?.sequence ?? delivery.current?.roundSequence;
      if (serverTime - (member.heartbeatAt ?? 0) >= 1000) {
        socket.emit("room:heartbeat", {
          serverTime,
          roundId: roundId ?? null,
          sequence: roundSequence ?? 0,
        });
        member.heartbeatAt = serverTime;
      }
      authorized.set(socket, { playerId: delivery.playerId!, roundId });
      member.roundId = roundId;
      member.roundSequence = roundSequence;
      if (!snapshot) {
        member.sequence = delivery.current!.sequence;
        continue;
      }
      if (
        snapshot.terminal &&
        member.terminalRoundId !== snapshot.terminal.roundId
      ) {
        socket.emit("round:ended", snapshot.terminal);
        member.terminalRoundId = snapshot.terminal.roundId;
      }
      if (!snapshot.terminal) member.terminalRoundId = undefined;
      member.roundId = snapshot.round?.roundId;
      member.roundSequence = snapshot.round?.sequence;
      if (snapshot.sequence !== member.sequence) {
        // Publication is committed by this owner before any delivery. Reconnect
        // recovers the same item from the snapshot; repeated messages are idempotent.
        for (const item of snapshot.round?.news ?? [])
          if (item.narrationStatus !== "pending")
            socket.emit("news:update", item);
        socket.emit("room:snapshot", snapshot);
        const started = initialSnapshots.get(socket);
        if (started !== undefined) {
          operations.observe("snapshot_ms", operations.monotonic() - started);
          initialSnapshots.delete(socket);
        }
        socket.emit("presence:update", snapshot);
        member.sequence = snapshot.sequence;
      }
    }
    return authorized;
  }
  function deliverOrder(
    playerId: string,
    code: string,
    result: OrderResult,
    authorized: Map<Socket, { playerId: string; roundId: string | undefined }>,
  ) {
    // Reuse this publication's fresh authorization, with no await between the
    // public batch and owner-only result. Never retain it for a later command.
    for (const [socket, audience] of authorized) {
      const member = members.get(socket);
      if (
        socket.connected &&
        member?.code === code &&
        audience.playerId === playerId &&
        audience.roundId === result.roundId
      )
        socket.emit("order:result", result);
    }
  }
  const execute = <T>(work: () => Promise<T>) =>
    serial(async () => {
      const result = await work();
      await publish();
      return result;
    });
  io.use((socket, next) => {
    initialSnapshots.set(socket, operations.monotonic());
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
    socket.on("reaction:send", (payload: unknown, ack: unknown) => {
      void serial(async () => {
        const parsed = reactionSendSchema.safeParse(payload);
        if (!parsed.success) throw new LobbyError("INVALID_REQUEST");
        const member = members.get(socket);
        if (!member || !socket.connected) throw new LobbyError("FORBIDDEN");
        const recipients = [...members];
        const audience = await options.store.reactionAudience(
          member.secret,
          member.code,
          recipients.map(([, recipient]) => recipient),
        );
        for (const [playerId, at] of reactionCooldowns)
          if (audience.serverTime - at >= 1000)
            reactionCooldowns.delete(playerId);
        const previous = reactionCooldowns.get(audience.playerId);
        if (previous !== undefined && audience.serverTime - previous < 1000)
          return {
            error: "RATE_LIMITED",
            message: reactionErrorMessages.RATE_LIMITED,
            requestId: parsed.data.requestId,
          };
        const published = reactionPublishedSchema.parse({
          id: randomUUID(),
          code: member.code,
          roundId: audience.roundId,
          playerId: audience.playerId,
          reactionId: parsed.data.reactionId,
          serverTime: audience.serverTime,
        });
        reactionCooldowns.set(audience.playerId, audience.serverTime);
        for (const [index, [recipient]] of recipients.entries())
          if (audience.allowed[index] && recipient.connected)
            recipient.emit("reaction:published", published);
        return { requestId: parsed.data.requestId, publishedId: published.id };
      })
        .then((outcome) => {
          if (typeof ack === "function") ack(outcome);
        })
        .catch((error: unknown) => {
          const parsed = roundStartSchema.passthrough().safeParse(payload);
          const code = reactionErrorCodeSchema.safeParse(
            error instanceof LobbyError ? error.code : "SERVICE_UNAVAILABLE",
          );
          const errorCode = code.success ? code.data : "SERVICE_UNAVAILABLE";
          const body = {
            error: errorCode,
            message: reactionErrorMessages[errorCode],
            ...(parsed.success
              ? { requestId: parsed.data.requestId.toLowerCase() }
              : {}),
          };
          if (typeof ack === "function") ack(body);
        });
    });
    function commandError(payload: unknown, ack: unknown, error: unknown) {
      const requestId = roundStartSchema.passthrough().safeParse(payload);
      const body = {
        ...safeError(error),
        ...(requestId.success ? { requestId: requestId.data.requestId } : {}),
      };
      socket.emit("command:error", body);
      if (typeof ack === "function") ack(body);
    }
    socket.on("order:submit", (payload: unknown, ack: unknown) => {
      const receivedAt = operations.monotonic();
      operations.count("orders_received");
      const acknowledge = (body: unknown) => {
        if (typeof ack === "function") {
          ack(body);
          operations.observe(
            "order_ack_ms",
            operations.monotonic() - receivedAt,
          );
        }
      };
      void serial(async () => {
        operations.observe(
          "order_queue_ms",
          operations.monotonic() - receivedAt,
        );
        const member = members.get(socket);
        if (!member) throw new LobbyError("FORBIDDEN");
        let started = operations.monotonic();
        const result = await options.store.submitOrder(
          member.secret,
          member.code,
          payload,
        );
        operations.observe("order_store_ms", operations.monotonic() - started);
        started = operations.monotonic();
        const authorized = await publish();
        operations.observe(
          "order_publication_ms",
          operations.monotonic() - started,
        );
        started = operations.monotonic();
        deliverOrder(member.playerId, member.code, result, authorized);
        operations.observe(
          "order_private_delivery_ms",
          operations.monotonic() - started,
        );
        if (result.status === "REJECTED") operations.count("orders_rejected");
        acknowledge(result);
      }).catch((error: unknown) => {
        const code =
          error instanceof TradingError || error instanceof LobbyError
            ? error.code
            : "SERVICE_UNAVAILABLE";
        const requestId = roundStartSchema.passthrough().safeParse(payload);
        const body = {
          error: code,
          message:
            code in tradingErrorMessages
              ? tradingErrorMessages[code as keyof typeof tradingErrorMessages]
              : safeError(error).message,
          ...(requestId.success
            ? { requestId: requestId.data.requestId.toLowerCase() }
            : {}),
        };
        socket.emit("command:error", body);
        operations.count("orders_rejected");
        operations.log("order.rejected", {
          rejectionCode: code,
          ...(requestId.success ? { requestId: requestId.data.requestId } : {}),
        });
        acknowledge(body);
      });
    });
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
    socket.on("room:return-to-lobby", (payload: unknown, ack: unknown) => {
      void execute(async () => {
        const member = members.get(socket);
        if (!member) throw new LobbyError("FORBIDDEN");
        return options.store.returnToLobby(member.secret, member.code, payload);
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
      connections();
    }).catch((error: unknown) => {
      socket.emit("command:error", safeError(error));
      socket.disconnect(true);
    });
    socket.on("room:resync", (payload: unknown, ack: unknown) => {
      const receivedAt = operations.monotonic();
      void serial(async () => {
        const parsed = roomResyncSchema
          .or(lobbyResyncSchema)
          .safeParse(payload);
        const member = members.get(socket);
        if (!parsed.success) throw new LobbyError("INVALID_REQUEST");
        if (
          !member ||
          ("code" in parsed.data && parsed.data.code !== member.code)
        )
          throw new LobbyError("FORBIDDEN");
        // The same queue owns subscription, snapshot capture and publication.
        // Commits after N remain buffered in durable batches and are published
        // only after this snapshot, starting strictly after its market cursor.
        const snapshot = await options.store.snapshot(
          member.secret,
          member.code,
        );
        member.sequence = snapshot.sequence;
        member.roundId = snapshot.round?.roundId;
        member.roundSequence = snapshot.round?.sequence;
        socket.emit("room:snapshot", snapshot);
        if (typeof ack === "function")
          ack({
            ...(parsed.data.requestId
              ? { requestId: parsed.data.requestId }
              : {}),
            snapshot,
          });
        operations.observe("snapshot_ms", operations.monotonic() - receivedAt);
      }).catch((error: unknown) => {
        const parsed = roundStartSchema.passthrough().safeParse(payload);
        const body = {
          ...safeError(error),
          ...(parsed.success
            ? { requestId: parsed.data.requestId.toLowerCase() }
            : {}),
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
      await options.store.processDue();
    })
      .then(() =>
        serial(async () => {
          // Market changes have already committed and reached clients. A failed
          // optional publication cannot roll them back or disconnect the room.
          let publishedCount = 0;
          try {
            publishedCount = await options.store.processCommentary();
          } catch {
            operations.count("narration_publication_failures");
            operations.log("commentary.publication_failed");
          }
          if (publishedCount) await publish(true);
        }),
      )
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
