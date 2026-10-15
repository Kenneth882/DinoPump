import {
  persistFinalResult,
  participantResult,
  RoundIntegrityError,
  verifyFinalResult,
  persistIntegrityAbort,
} from "./results.js";
import { isDeepStrictEqual } from "node:util";
import { readOrder, persistOrder, readRecentOrders } from "./orders.js";
import { processEngineCommand } from "@dinopump/engine";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { publicMarketView, readQuoteUpdatedAtMs } from "./market-view.js";
import { readMarketUpdates } from "./market-updates.js";
import { applyDueEvents } from "./scheduled-events.js";
import { loadBaseline } from "@dinopump/game-content";
import {
  persistRoundOpening,
  persistEngineBatch,
  recoverOpenedRound,
} from "./opened-round.js";
import {
  guestRequestSchema,
  roundReturnSchema,
  orderSubmitSchema,
  type TradingErrorCode,
  type LobbySnapshot,
  type MarketBatch,
  newsItemSchema,
  gameplayRulesSchema,
  type Baseline,
  type EngineState,
  playerSchema,
  lobbySnapshotSchema,
  roomCodeSchema,
  roomReadySchema,
  roundStartSchema,
  roundInitializationSchema,
  baselineSchema,
  roomCommandOutcomeSchema,
  type GuestPlayer,
  type LobbyErrorCode,
  type RoomCommandOutcome,
} from "@dinopump/contracts";

export class LobbyError extends Error {
  constructor(readonly code: LobbyErrorCode) {
    super(code);
  }
}
export class TradingError extends Error {
  constructor(readonly code: TradingErrorCode) {
    super(code);
  }
}
const hashSecret = (secret: string) =>
  createHash("sha256").update(secret).digest("hex");

/** One dedicated database connection owns and serializes the MVP lobby. */
export class LobbyStore {
  private tail: Promise<unknown> = Promise.resolve();
  private available = true;
  private engineCache = new Map<string, EngineState>();
  private transactionCache = new Map<string, EngineState>();
  private constructor(
    private client: PoolClient,
    private clock: () => number,
    private roomRules: Baseline["rules"]["room"],
    private baseline: Baseline,
  ) {
    client.on("error", () => {
      this.available = false;
      this.engineCache.clear();
    });
  }
  static async open(
    pool: Pool,
    clock: () => number = Date.now,
    roomRules: Baseline["rules"]["room"] = loadBaseline().rules.room,
    baseline: Baseline = loadBaseline(),
  ) {
    const rules = gameplayRulesSchema.shape.room.parse(roomRules);
    const client = await pool.connect();
    try {
      const lock = await client.query<{ owned: boolean }>(
        "SELECT pg_try_advisory_lock(18474, hashtext(current_schema())) AS owned",
      );
      if (!lock.rows[0]?.owned) throw new LobbyError("SERVICE_UNAVAILABLE");
      const store = new LobbyStore(
        client,
        clock,
        rules,
        baselineSchema.parse({
          ...baseline,
          rules: { ...baseline.rules, room: rules },
        }),
      );
      const recover = () =>
        store.run(async (db, now) => {
          const opened = await db.query(
            "SELECT current_round_id FROM rooms WHERE current_round_id IS NOT NULL AND status<>'ABORTED'",
          );
          for (const room of opened.rows) {
            if (!(await recoverOpenedRound(db, room.current_round_id)))
              throw new Error("Missing active round");
          }
          // A previous process's sockets cannot survive ownership takeover.
          await db.query(
            "UPDATE rooms SET sequence=sequence+1, host_transfer_at=COALESCE(host_transfer_at,$1), expires_at=COALESCE(expires_at,$2) WHERE status='LOBBY' AND EXISTS(SELECT 1 FROM room_members m WHERE m.code=rooms.code AND m.connected_at IS NOT NULL)",
            [now + rules.hostDisconnectGraceMs, now + rules.emptyLobbyExpiryMs],
          );
          await db.query(
            "UPDATE room_members SET connected_at=NULL WHERE connected_at IS NOT NULL",
          );
        });
      await recover().catch(async (error) => {
        if (!(error instanceof RoundIntegrityError)) throw error;
        await recover();
      });
      await store.processDue().catch((error) => {
        if (!(error instanceof RoundIntegrityError)) throw error;
      });
      return store;
    } catch (error) {
      client.release(true);
      throw error;
    }
  }
  private run<T>(
    work: (client: PoolClient, now: number) => Promise<T>,
  ): Promise<T> {
    const result = this.tail.then(async () => {
      if (!this.available) throw new LobbyError("SERVICE_UNAVAILABLE");
      try {
        await this.client.query("BEGIN");
        await this.assertOwnership();
        this.transactionCache = new Map(this.engineCache);
        const value = await work(this.client, this.clock());
        await this.assertOwnership();
        await this.client.query("COMMIT");
        this.engineCache = this.transactionCache;
        return value;
      } catch (error) {
        this.engineCache.clear();
        this.transactionCache.clear();
        await this.client.query("ROLLBACK").catch(() => {
          this.available = false;
        });
        if (error instanceof RoundIntegrityError) {
          await this.client.query("BEGIN");
          try {
            await this.assertOwnership();
            const aborted = await persistIntegrityAbort(
              this.client,
              error.roundId,
            );
            const room = (
              await this.client.query(
                "SELECT code FROM rooms WHERE current_round_id=$1",
                [error.roundId],
              )
            ).rows[0];
            if (room && aborted)
              await this.record(
                this.client,
                room.code,
                "RoundAborted",
                null,
                this.clock(),
              );
            await this.assertOwnership();
            await this.client.query("COMMIT");
          } catch (abortError) {
            await this.client.query("ROLLBACK").catch(() => {
              this.available = false;
            });
            throw abortError;
          }
        }
        throw error;
      }
    });
    this.tail = result.catch(() => {});
    return result;
  }
  /** Only committed, verified states enter the cache. Compare replaceable projection on every read. */
  private async readState(client: PoolClient, roundId: string) {
    const cached = this.transactionCache.get(roundId);
    if (cached) {
      const row = (
        await client.query(
          "SELECT sequence,state FROM round_projections WHERE round_id=$1",
          [roundId],
        )
      ).rows[0];
      if (
        !row ||
        Number(row.sequence) !== cached.sequence ||
        !isDeepStrictEqual(row.state, cached)
      ) {
        const recovered = await recoverOpenedRound(client, roundId);
        if (recovered) this.transactionCache.set(roundId, recovered);
        return recovered;
      }
      try {
        await verifyFinalResult(client, cached);
      } catch (error) {
        if (error instanceof Error && "code" in error) throw error;
        throw new RoundIntegrityError(
          roundId,
          "Final result disagrees with committed state",
        );
      }
      return cached;
    }
    const verified = await recoverOpenedRound(client, roundId);
    if (verified) this.transactionCache.set(roundId, verified);
    return verified;
  }
  private async assertOwnership() {
    const owned = await this.client.query<{ owned: boolean }>(`SELECT EXISTS(
      SELECT 1 FROM pg_locks WHERE locktype='advisory' AND pid=pg_backend_pid()
      AND classid=18474 AND objid=(hashtext(current_schema())::bigint & 4294967295)::oid
      AND objsubid=2 AND granted) AS owned`);
    if (!owned.rows[0]?.owned) {
      this.available = false;
      throw new LobbyError("SERVICE_UNAVAILABLE");
    }
  }
  async isReady() {
    try {
      return await this.run(async (client, now) => {
        const rooms = await client.query(
          "SELECT current_round_id FROM rooms WHERE current_round_id IS NOT NULL AND status<>'ABORTED'",
        );
        for (const room of rooms.rows) {
          const state = await recoverOpenedRound(client, room.current_round_id);
          if (!state) throw new Error("Missing active round");
          // Ready only after due effects catch up; terminal results remain ready.
          const next = state.round.schedule[state.nextScheduledEvent];
          if (
            state.trading.status === "OPEN" &&
            (now >= state.round.closesAtMs || (next && now >= next.dueAtMs))
          )
            return false;
        }
        return true;
      });
    } catch {
      return false;
    }
  }
  async close() {
    await this.tail;
    if (this.closed) return;
    this.closed = true;
    this.available = false;
    this.engineCache.clear();
    this.orderBudgets.clear();
    // Release ownership before the socket closes asynchronously, so immediate
    // takeover cannot race PostgreSQL processing the old connection's EOF.
    await this.client
      .query("SELECT pg_advisory_unlock(18474, hashtext(current_schema()))")
      .catch(() => {});
    this.client.release(true);
  }
  private closed = false;
  private orderBudgets = new Map<string, { tokens: number; at: number }>();
  private rejectionCounts: Record<string, number> = {};
  private lastRejectionLog = 0;
  private transportRejection(code: "INVALID_REQUEST" | "RATE_LIMITED") {
    this.rejectionCounts[code] = (this.rejectionCounts[code] ?? 0) + 1;
    const at = this.clock();
    if (at - this.lastRejectionLog >= 30_000) {
      console.info(
        JSON.stringify({
          event: "orders.transport_rejected",
          counts: this.rejectionCounts,
        }),
      );
      this.rejectionCounts = {};
      this.lastRejectionLog = at;
    }
    return new TradingError(code);
  }
  private consumeOrderToken(playerId: string, now: number) {
    for (const [id, budget] of this.orderBudgets)
      if (now - budget.at > 60_000) this.orderBudgets.delete(id);
    const previous = this.orderBudgets.get(playerId) ?? {
      tokens: 10_000,
      at: now,
    };
    const tokens = Math.min(
      10_000,
      previous.tokens + Math.max(0, now - previous.at) * 5,
    );
    this.orderBudgets.set(playerId, {
      tokens: tokens >= 1000 ? tokens - 1000 : tokens,
      at: Math.max(now, previous.at),
    });
    if (tokens < 1000) throw this.transportRejection("RATE_LIMITED");
  }
  submitOrder(secret: string, code: string, input: unknown) {
    const parsed = orderSubmitSchema.safeParse(input);
    if (!parsed.success)
      return Promise.reject(this.transportRejection("INVALID_REQUEST"));
    const request = parsed.data;
    return this.run(async (client, now) => {
      const player = await this.member(client, secret, code, now);
      const room = (
        await client.query(
          "SELECT current_round_id,status FROM rooms WHERE code=$1",
          [code],
        )
      ).rows[0];
      const baseline = (
        await client.query("SELECT baseline FROM rounds WHERE round_id=$1", [
          request.roundId,
        ])
      ).rows[0]?.baseline;
      if (!baseline && room.current_round_id !== request.roundId)
        throw new TradingError("ROUND_MISMATCH");
      if (
        !baseline?.initialState.humans.some(
          (participant: { playerId: string }) =>
            participant.playerId === player.playerId,
        )
      )
        throw new TradingError("PLAYER_NOT_IN_ROUND");
      this.consumeOrderToken(player.playerId, now);
      // Historical retries remain readable after reset only for verified rounds.
      // The abort belongs to the requested round, even after the room moves on.
      const aborted = await client.query(
        "SELECT 1 FROM round_aborts WHERE round_id=$1",
        [request.roundId],
      );
      if (
        aborted.rowCount ||
        (room.status === "ABORTED" && room.current_round_id === request.roundId)
      )
        throw new TradingError("MARKET_CLOSED");
      const previous = await readOrder(client, request, player.playerId);
      if (previous) {
        if (!previous.matches) throw new TradingError("IDEMPOTENCY_CONFLICT");
        return previous.outcome;
      }
      if (room.current_round_id !== request.roundId)
        throw new TradingError("ROUND_MISMATCH");
      const { state } = await this.catchUpRound(client, request.roundId, now);
      let resultState = state;
      let receipt = null;
      let batch = null;
      if (state.trading.status === "OPEN" && now < state.round.closesAtMs) {
        const result = processEngineCommand(state, {
          type: "SubmitOrder",
          atMs: now,
          order: { ...request, playerId: player.playerId },
        });
        if (!result.ok || !result.receipt || !result.batch)
          throw new RoundIntegrityError(
            request.roundId,
            "Unsafe order processing",
          );
        // Integrity/overflow failures are never disguised as player rejections.
        if (
          !result.receipt.result.ok &&
          ![
            "INVALID_ORDER",
            "INSUFFICIENT_CASH",
            "INSUFFICIENT_HOLDINGS",
            "MARKET_CLOSED",
          ].includes(result.receipt.result.code)
        )
          throw new RoundIntegrityError(request.roundId, "Unsafe settlement");
        resultState = result.state;
        receipt = result.receipt;
        batch = result.batch;
        await persistEngineBatch(client, resultState, batch);
      }
      this.transactionCache.set(request.roundId, resultState);
      const outcome = await persistOrder(
        client,
        resultState,
        request,
        player.playerId,
        receipt,
        batch,
        now,
      );
      await client.query("UPDATE rooms SET sequence=sequence+1 WHERE code=$1", [
        code,
      ]);
      return outcome;
    });
  }
  createSession(input: unknown) {
    const parsed = guestRequestSchema.safeParse(input);
    if (!parsed.success)
      return Promise.reject(new LobbyError("INVALID_REQUEST"));
    return this.run(async (client, now) => {
      const player = { playerId: randomUUID(), ...parsed.data };
      const secret = randomBytes(32).toString("hex");
      await client.query(
        "INSERT INTO guest_sessions VALUES ($1,$2,$3,$4,$5,$6)",
        [
          player.playerId,
          player.displayName,
          player.displayName.toLowerCase(),
          player.avatar,
          hashSecret(secret),
          now + 86_400_000,
        ],
      );
      return { player, secret };
    });
  }
  private async authenticateAt(
    client: PoolClient,
    secret: string,
    now: number,
  ): Promise<GuestPlayer> {
    const result = await client.query(
      "SELECT player_id, display_name, avatar FROM guest_sessions WHERE secret_hash=$1 AND expires_at_ms>$2",
      [hashSecret(secret), now],
    );
    const row = result.rows[0];
    if (!row) throw new LobbyError("UNAUTHENTICATED");
    return playerSchema.parse({
      playerId: row.player_id,
      displayName: row.display_name,
      avatar: row.avatar,
    });
  }
  authenticate(secret: string) {
    return this.run((client, now) => this.authenticateAt(client, secret, now));
  }

  private async record(
    client: PoolClient,
    code: string,
    type: string,
    playerId: string | null,
    now: number,
  ) {
    await client.query(
      "INSERT INTO room_lifecycle(code,type,player_id,occurred_at_ms) VALUES ($1,$2,$3,$4)",
      [code, type, playerId, now],
    );
  }
  private async visible(
    client: PoolClient,
    code: string,
    now: number,
    playerId?: string,
  ) {
    const result = await client.query("SELECT * FROM rooms WHERE code=$1", [
      code,
    ]);
    const room = result.rows[0];
    if (!room || room.status === "EXPIRED")
      throw new LobbyError("ROOM_NOT_FOUND");
    const members = await client.query(
      "SELECT s.player_id,s.display_name,s.avatar,m.connected_at,m.ready FROM room_members m JOIN guest_sessions s USING(player_id) WHERE m.code=$1 ORDER BY m.join_order",
      [code],
    );
    const countdownRow = await client.query(
      "SELECT initialization FROM room_countdowns WHERE code=$1",
      [code],
    );
    const initialization = countdownRow.rows[0]
      ? roundInitializationSchema.parse(countdownRow.rows[0].initialization)
      : null;
    const engine =
      room.current_round_id && room.status !== "ABORTED"
        ? await this.readState(client, room.current_round_id)
        : null;
    const publicRows = engine
      ? (
          await client.query(
            "SELECT public_view FROM round_batches WHERE round_id=$1 AND jsonb_array_length(public_view->'trades')>0 ORDER BY end_sequence DESC LIMIT 30",
            [engine.round.roundId],
          )
        ).rows
      : [];
    const latestRow = engine
      ? (
          await client.query(
            "SELECT public_view FROM round_batches WHERE round_id=$1 ORDER BY end_sequence DESC LIMIT 1",
            [engine.round.roundId],
          )
        ).rows[0]
      : null;
    const latestView =
      latestRow?.public_view ?? (engine ? publicMarketView(engine) : null);
    const quoteUpdatedAtMs = engine
      ? await readQuoteUpdatedAtMs(client, engine)
      : undefined;
    const recentOrders =
      engine && playerId
        ? await readRecentOrders(client, engine.round.roundId, playerId)
        : [];
    const human = engine?.trading.humans.find(
      (human) => human.playerId === playerId,
    );
    if (engine && !human) throw new LobbyError("FORBIDDEN");
    return lobbySnapshotSchema.parse({
      code,
      terminal:
        room.current_round_id && playerId
          ? await participantResult(client, room.current_round_id, playerId)
          : null,
      status: room.status,
      hostId: room.host_id,
      sequence: room.sequence,
      serverTime: now,
      hostTransferAt:
        room.host_transfer_at === null ? null : Number(room.host_transfer_at),
      expiresAt: room.expires_at === null ? null : Number(room.expires_at),
      countdown: initialization
        ? {
            roundId: initialization.roundId,
            opensAt: initialization.opensAtMs,
            closesAt:
              initialization.opensAtMs +
              initialization.config.rules.round.durationMs,
            participantIds: initialization.participantIds,
          }
        : null,
      round:
        engine && human
          ? {
              roundId: engine.round.roundId,
              sequence: engine.sequence,
              openingAssets: engine.round.config.assets,
              priceHistory: (
                await client.query(
                  "SELECT sequence,occurred_at_ms,payload FROM game_events WHERE round_id=$1 AND type='TradeExecuted' ORDER BY sequence",
                  [engine.round.roundId],
                )
              ).rows.map((row) => ({
                sequence: Number(row.sequence),
                atMs: Number(row.occurred_at_ms),
                symbol: row.payload.symbol,
                priceCents: row.payload.priceCents,
              })),
              opensAt: engine.round.opensAtMs,
              closesAt: engine.round.closesAtMs,
              ...latestView,
              quoteUpdatedAtMs,
              trades: publicRows
                .reverse()
                .flatMap((row) => row.public_view?.trades ?? [])
                .slice(-30),
              totals: publicMarketView(engine).totals,
              tradingRules: {
                rulesVersion: engine.round.rulesVersion,
                prices: engine.round.config.rules.prices,
                orders: engine.round.config.rules.orders,
              },
              portfolioSequence: engine.sequence,
              recentOrders,
              news: (
                await client.query(
                  "SELECT item FROM news_items WHERE round_id=$1 ORDER BY (item->>'sequence')::bigint",
                  [engine.round.roundId],
                )
              ).rows.map((row) => newsItemSchema.parse(row.item)),
              portfolio: {
                cashCents: human.cashCents,
                holdings: human.holdings,
              },
            }
          : null,
      players: members.rows.map((row) => ({
        playerId: row.player_id,
        displayName: row.display_name,
        avatar: row.avatar,
        connected: row.connected_at !== null,
        ready: row.ready,
      })),
    });
  }
  private async member(
    client: PoolClient,
    secret: string,
    code: string,
    now: number,
  ) {
    const player = await this.authenticateAt(client, secret, now);
    if (!roomCodeSchema.safeParse(code).success)
      throw new LobbyError("INVALID_REQUEST");
    const room = await client.query("SELECT status FROM rooms WHERE code=$1", [
      code,
    ]);
    if (!room.rows[0] || room.rows[0].status === "EXPIRED")
      throw new LobbyError("ROOM_NOT_FOUND");
    const result = await client.query(
      "SELECT 1 FROM room_members WHERE code=$1 AND player_id=$2",
      [code, player.playerId],
    );
    if (!result.rowCount) throw new LobbyError("FORBIDDEN");
    return player;
  }
  createRoom(secret: string) {
    return this.run(async (client, now) => {
      const player = await this.authenticateAt(client, secret, now);
      const active = await client.query(
        "SELECT 1 FROM rooms WHERE status <> 'EXPIRED'",
      );
      if (active.rowCount) throw new LobbyError("ACTIVE_ROOM_EXISTS");
      const code = randomBytes(3).toString("hex").toUpperCase();
      await client.query(
        "INSERT INTO rooms(code,host_id,host_transfer_at,expires_at) VALUES ($1,$2,$3,$4)",
        [
          code,
          player.playerId,
          now + this.roomRules.hostDisconnectGraceMs,
          now + this.roomRules.emptyLobbyExpiryMs,
        ],
      );
      await client.query(
        "INSERT INTO room_members(code,player_id,normalized_name,join_order) VALUES ($1,$2,$3,0)",
        [code, player.playerId, player.displayName.toLowerCase()],
      );
      await this.record(client, code, "RoomCreated", player.playerId, now);
      return this.visible(client, code, now, player.playerId);
    });
  }
  snapshot(secret: string, code: string) {
    return this.run(async (client, now) => {
      const player = await this.member(client, secret, code, now);
      return this.visible(client, code, now, player.playerId);
    });
  }

  private async replayCommand(
    client: PoolClient,
    code: string,
    playerId: string,
    requestId: string,
    command:
      | { type: "Ready"; ready: boolean }
      | { type: "Start" }
      | { type: "Return"; roundId: string },
  ): Promise<RoomCommandOutcome | null> {
    const previous = await client.query(
      "SELECT command=$4::jsonb AS matches,outcome FROM room_commands WHERE code=$1 AND player_id=$2 AND request_id=$3",
      [code, playerId, requestId, command],
    );
    if (!previous.rows[0]) return null;
    if (!previous.rows[0].matches) throw new LobbyError("IDEMPOTENCY_CONFLICT");
    return roomCommandOutcomeSchema.parse(previous.rows[0].outcome);
  }

  private async recordCommand(
    client: PoolClient,
    code: string,
    playerId: string,
    command:
      | { type: "Ready"; ready: boolean }
      | { type: "Start" }
      | { type: "Return"; roundId: string },
    outcome: RoomCommandOutcome,
  ) {
    await client.query("INSERT INTO room_commands VALUES ($1,$2,$3,$4,$5)", [
      code,
      playerId,
      outcome.requestId,
      command,
      outcome,
    ]);
  }

  ready(secret: string, code: string, value: unknown) {
    const parsed = roomReadySchema.safeParse(value);
    if (!parsed.success)
      return Promise.reject(new LobbyError("INVALID_REQUEST"));
    const { requestId, ready } = parsed.data;
    return this.run(async (client, now) => {
      const player = await this.member(client, secret, code, now);
      const command = { type: "Ready" as const, ready };
      const previous = await this.replayCommand(
        client,
        code,
        player.playerId,
        requestId,
        command,
      );
      if (previous) return previous;
      const room = await this.visible(client, code, now, player.playerId);
      if (room.status !== "LOBBY") throw new LobbyError("INVALID_ROOM_STATE");
      if (
        !room.players.find((member) => member.playerId === player.playerId)
          ?.connected
      )
        throw new LobbyError("FORBIDDEN");
      const changed = await client.query(
        "UPDATE room_members SET ready=$3 WHERE code=$1 AND player_id=$2 AND ready<>$3",
        [code, player.playerId, ready],
      );
      if (changed.rowCount)
        await client.query(
          "UPDATE rooms SET sequence=sequence+1 WHERE code=$1",
          [code],
        );
      const updated = await this.visible(client, code, now, player.playerId);
      const outcome = roomCommandOutcomeSchema.parse({
        requestId,
        sequence: updated.sequence,
        status: "LOBBY",
        roundId: null,
      });
      await this.recordCommand(client, code, player.playerId, command, outcome);
      return outcome;
    });
  }

  start(secret: string, code: string, value: unknown) {
    const parsed = roundStartSchema.safeParse(value);
    if (!parsed.success)
      return Promise.reject(new LobbyError("INVALID_REQUEST"));
    const { requestId } = parsed.data;
    return this.run(async (client, now) => {
      const player = await this.member(client, secret, code, now);
      const command = { type: "Start" as const };
      const previous = await this.replayCommand(
        client,
        code,
        player.playerId,
        requestId,
        command,
      );
      if (previous) return previous;
      const room = await this.visible(client, code, now, player.playerId);
      if (room.hostId !== player.playerId) throw new LobbyError("FORBIDDEN");
      if (room.status !== "LOBBY") throw new LobbyError("INVALID_ROOM_STATE");
      const ready = await client.query(
        "SELECT 1 FROM room_members m JOIN guest_sessions s USING(player_id) WHERE code=$1 AND connected_at IS NOT NULL AND ready AND expires_at_ms>$2",
        [code, now],
      );
      if ((ready.rowCount ?? 0) < this.roomRules.minPlayers)
        throw new LobbyError("NOT_ENOUGH_READY_PLAYERS");
      const initialization = roundInitializationSchema.parse({
        roundId: randomUUID(),
        seed: randomBytes(4).readUInt32BE(),
        configVersion: this.baseline.contentVersion,
        participantIds: room.players.map((member) => member.playerId),
        createdAtMs: now,
        opensAtMs: now + this.roomRules.countdownMs,
        config: this.baseline,
      });
      await client.query("INSERT INTO room_countdowns VALUES ($1,$2)", [
        code,
        initialization,
      ]);
      await client.query(
        "UPDATE rooms SET status='COUNTDOWN',sequence=sequence+1,host_transfer_at=NULL,expires_at=NULL WHERE code=$1",
        [code],
      );
      await this.record(client, code, "CountdownStarted", player.playerId, now);
      const outcome = roomCommandOutcomeSchema.parse({
        requestId,
        sequence: room.sequence + 1,
        status: "COUNTDOWN",
        roundId: initialization.roundId,
      });
      await this.recordCommand(client, code, player.playerId, command, outcome);
      return outcome;
    });
  }

  results(secret: string, roundId: string) {
    return this.run(async (client, now) => {
      const identity = roundReturnSchema.shape.roundId.safeParse(roundId);
      if (!identity.success) throw new LobbyError("INVALID_REQUEST");
      roundId = identity.data;
      const player = await this.authenticateAt(client, secret, now);
      const row = (
        await client.query(
          "SELECT initialization FROM rounds WHERE round_id=$1",
          [roundId],
        )
      ).rows[0];
      if (
        !row ||
        !roundInitializationSchema
          .parse(row.initialization)
          .participantIds.includes(player.playerId)
      )
        throw new LobbyError("FORBIDDEN");
      const abort = (
        await client.query("SELECT 1 FROM round_aborts WHERE round_id=$1", [
          roundId,
        ])
      ).rowCount;
      if (!abort) await recoverOpenedRound(client, roundId);
      const result = await participantResult(client, roundId, player.playerId);
      if (!result) throw new LobbyError("INVALID_ROOM_STATE");
      return result;
    });
  }
  returnToLobby(secret: string, code: string, value: unknown) {
    const parsed = roundReturnSchema.safeParse(value);
    if (!parsed.success)
      return Promise.reject(new LobbyError("INVALID_REQUEST"));
    const { roundId, requestId } = parsed.data;
    return this.run(async (client, now) => {
      const player = await this.member(client, secret, code, now);
      const command = { type: "Return" as const, roundId };
      const previous = await this.replayCommand(
        client,
        code,
        player.playerId,
        requestId,
        command,
      );
      if (previous) return previous;
      const room = (
        await client.query("SELECT * FROM rooms WHERE code=$1", [code])
      ).rows[0];
      if (room.host_id !== player.playerId) throw new LobbyError("FORBIDDEN");
      if (
        room.current_round_id !== roundId ||
        !["FINISHED", "ABORTED"].includes(room.status)
      )
        throw new LobbyError("INVALID_ROOM_STATE");
      if (!(await participantResult(client, roundId, player.playerId)))
        throw new LobbyError("SERVICE_UNAVAILABLE");
      await client.query("UPDATE room_members SET ready=false WHERE code=$1", [
        code,
      ]);
      await client.query("DELETE FROM room_countdowns WHERE code=$1", [code]);
      await client.query(
        `UPDATE rooms SET status='LOBBY', current_round_id=NULL,sequence=sequence+1,
        host_transfer_at=CASE WHEN EXISTS(SELECT 1 FROM room_members m JOIN guest_sessions s USING(player_id) WHERE m.code=$1 AND m.player_id=rooms.host_id AND m.connected_at IS NOT NULL AND s.expires_at_ms>$2) THEN NULL ELSE $3::bigint END,
        expires_at=CASE WHEN EXISTS(SELECT 1 FROM room_members m JOIN guest_sessions s USING(player_id) WHERE m.code=$1 AND m.connected_at IS NOT NULL AND s.expires_at_ms>$2) THEN NULL ELSE $4::bigint END WHERE code=$1`,
        [
          code,
          now,
          now + this.roomRules.hostDisconnectGraceMs,
          now + this.roomRules.emptyLobbyExpiryMs,
        ],
      );
      await this.record(client, code, "ReturnedToLobby", player.playerId, now);
      const outcome = roomCommandOutcomeSchema.parse({
        requestId,
        sequence: room.sequence + 1,
        status: "LOBBY",
        roundId: null,
      });
      await this.recordCommand(client, code, player.playerId, command, outcome);
      return outcome;
    });
  }

  private async cancelDisconnectedCountdowns(client: PoolClient, now: number) {
    const cancelled = await client.query(
      `UPDATE rooms SET status='LOBBY',sequence=sequence+1,
      host_transfer_at=CASE WHEN NOT EXISTS(SELECT 1 FROM room_members m JOIN guest_sessions s USING(player_id) WHERE m.code=rooms.code AND m.player_id=rooms.host_id AND connected_at IS NOT NULL AND expires_at_ms>$1) THEN $2::bigint ELSE NULL END,
      expires_at=CASE WHEN NOT EXISTS(SELECT 1 FROM room_members m JOIN guest_sessions s USING(player_id) WHERE m.code=rooms.code AND connected_at IS NOT NULL AND expires_at_ms>$1) THEN $3::bigint ELSE NULL END
      WHERE status='COUNTDOWN' AND (SELECT count(*) FROM room_members m JOIN guest_sessions s USING(player_id) WHERE m.code=rooms.code AND connected_at IS NOT NULL AND expires_at_ms>$1)<$4 RETURNING code`,
      [
        now,
        now + this.roomRules.hostDisconnectGraceMs,
        now + this.roomRules.emptyLobbyExpiryMs,
        this.roomRules.minPlayers,
      ],
    );
    for (const { code } of cancelled.rows) {
      await client.query("DELETE FROM room_countdowns WHERE code=$1", [code]);
      await client.query("UPDATE room_members SET ready=false WHERE code=$1", [
        code,
      ]);
      await this.record(client, code, "CountdownCancelled", null, now);
    }
  }

  join(secret: string, code: string) {
    return this.run(async (client, now) => {
      const player = await this.authenticateAt(client, secret, now);
      if (!roomCodeSchema.safeParse(code).success)
        throw new LobbyError("INVALID_REQUEST");
      const admission = await client.query(
        "SELECT status,EXISTS(SELECT 1 FROM room_members WHERE code=$1 AND player_id=$2) AS member FROM rooms WHERE code=$1",
        [code, player.playerId],
      );
      const current = admission.rows[0];
      if (!current || current.status === "EXPIRED")
        throw new LobbyError("ROOM_NOT_FOUND");
      if (!current.member && current.status !== "LOBBY")
        throw new LobbyError("JOIN_LOCKED");
      const room = await this.visible(client, code, now, player.playerId);
      if (current.member) return room;
      if (
        room.players.some(
          (member) =>
            member.displayName.toLowerCase() ===
            player.displayName.toLowerCase(),
        )
      )
        throw new LobbyError("NAME_TAKEN");
      if (room.players.length >= this.roomRules.maxPlayers)
        throw new LobbyError("ROOM_FULL");
      await client.query(
        "INSERT INTO room_members(code,player_id,normalized_name,join_order) VALUES ($1,$2,$3,$4)",
        [
          code,
          player.playerId,
          player.displayName.toLowerCase(),
          room.players.length,
        ],
      );
      await client.query("UPDATE rooms SET sequence=sequence+1 WHERE code=$1", [
        code,
      ]);
      await this.record(client, code, "PlayerJoined", player.playerId, now);
      return this.visible(client, code, now, player.playerId);
    });
  }

  connect(secret: string, code: string) {
    return this.run(async (client, now) => {
      const player = await this.member(client, secret, code, now);
      const changed = await client.query(
        "UPDATE room_members SET connected_at=$3 WHERE code=$1 AND player_id=$2 AND connected_at IS NULL",
        [code, player.playerId, now],
      );
      if (changed.rowCount)
        await client.query(
          "UPDATE rooms SET sequence=sequence+1, expires_at=NULL, host_transfer_at=CASE WHEN host_id=$2 THEN NULL ELSE host_transfer_at END WHERE code=$1",
          [code, player.playerId],
        );
      return this.visible(client, code, now, player.playerId);
    });
  }
  disconnect(playerId: string, code: string) {
    return this.run(async (client, now) => {
      const changed = await client.query(
        "UPDATE room_members SET connected_at=NULL WHERE code=$1 AND player_id=$2 AND connected_at IS NOT NULL",
        [code, playerId],
      );
      if (!changed.rowCount) return;
      await client.query(
        "UPDATE rooms SET sequence=sequence+1, host_transfer_at=CASE WHEN status='LOBBY' AND host_id=$2 THEN $3 ELSE host_transfer_at END, expires_at=CASE WHEN status='LOBBY' AND NOT EXISTS(SELECT 1 FROM room_members WHERE code=$1 AND connected_at IS NOT NULL) THEN $4 ELSE expires_at END WHERE code=$1",
        [
          code,
          playerId,
          now + this.roomRules.hostDisconnectGraceMs,
          now + this.roomRules.emptyLobbyExpiryMs,
        ],
      );
      await this.cancelDisconnectedCountdowns(client, now);
    });
  }

  /** Internal service seam: authenticate commands before entering; persist their result here. */
  withMarketRound<T>(
    roundId: string,
    work: (client: PoolClient, state: EngineState, now: number) => Promise<T>,
  ) {
    roundInitializationSchema.shape.roundId.parse(roundId);
    return this.run(async (client, now) => {
      const { state } = await this.catchUpRound(client, roundId, now);
      return work(client, state, now);
    });
  }

  private async catchUpRound(client: PoolClient, roundId: string, now: number) {
    const room = await client.query(
      "SELECT code FROM rooms WHERE current_round_id=$1 AND status IN ('OPEN','FINISHED')",
      [roundId],
    );
    if (!room.rowCount) throw new LobbyError("INVALID_ROOM_STATE");
    const initial = await this.readState(client, roundId);
    if (!initial) throw new Error("Missing active round");
    let state = await applyDueEvents(client, initial, now);
    if (state.trading.status === "OPEN" && now >= state.round.closesAtMs) {
      await client.query(
        "UPDATE rooms SET status='SETTLING' WHERE current_round_id=$1",
        [roundId],
      );
      await this.record(client, room.rows[0].code, "RoundSettling", null, now);
      const settled = processEngineCommand(state, {
        type: "SettleRound",
        atMs: now,
      });
      if (!settled.ok || !settled.batch)
        throw new RoundIntegrityError(roundId, "Unsafe round settlement");
      await persistEngineBatch(client, settled.state, settled.batch);
      await persistFinalResult(client, settled.state);
      state = settled.state;
      await client.query(
        "UPDATE rooms SET status='FINISHED' WHERE current_round_id=$1",
        [roundId],
      );
      await this.record(client, room.rows[0].code, "RoundFinished", null, now);
    }
    this.transactionCache.set(roundId, state);
    const applied = initial.round.schedule
      .slice(initial.nextScheduledEvent, state.nextScheduledEvent)
      .map((event) => ({
        roundId,
        scheduledEventId: event.scheduledEventId,
        dueAtMs: event.dueAtMs,
      }));
    if (state.sequence !== initial.sequence)
      await client.query("UPDATE rooms SET sequence=sequence+1 WHERE code=$1", [
        room.rows[0].code,
      ]);
    return { state, applied };
  }

  marketUpdates(
    secret: string,
    code: string,
    roundId: string,
    afterSequence: number,
  ) {
    return this.run(async (client, now) => {
      const player = await this.member(client, secret, code, now);
      const snapshot = await this.visible(client, code, now, player.playerId);
      if (snapshot.round?.roundId !== roundId)
        throw new LobbyError("INVALID_REQUEST");
      const state = await this.readState(client, roundId);
      if (!state) throw new Error("Missing active round");
      return readMarketUpdates(client, state, afterSequence, now);
    });
  }

  /** Coherent publication read: authorize every recipient, share verified public work. */
  publication(
    recipients: {
      secret: string;
      code: string;
      roundId?: string | undefined;
      roundSequence?: number | undefined;
    }[],
  ) {
    return this.run(async (client, now) => {
      const shared = new Map<string, LobbySnapshot>();
      const updates = new Map<string, MarketBatch[]>();
      const deliveries: {
        snapshot: LobbySnapshot | null;
        batches: MarketBatch[];
        error: LobbyErrorCode | null;
      }[] = [];
      for (const recipient of recipients) {
        try {
          const player = await this.member(
            client,
            recipient.secret,
            recipient.code,
            now,
          );
          let snapshot = shared.get(recipient.code);
          if (!snapshot) {
            snapshot = await this.visible(
              client,
              recipient.code,
              now,
              player.playerId,
            );
            shared.set(recipient.code, snapshot);
          } else if (snapshot.round) {
            const state = this.transactionCache.get(snapshot.round.roundId);
            const human = state?.trading.humans.find(
              (h) => h.playerId === player.playerId,
            );
            if (!human) throw new LobbyError("FORBIDDEN");
            const recentOrders = await readRecentOrders(
              client,
              snapshot.round.roundId,
              player.playerId,
            );
            snapshot = {
              ...snapshot,
              terminal: await participantResult(
                client,
                snapshot.round.roundId,
                player.playerId,
              ),
              round: {
                ...snapshot.round,
                recentOrders,
                portfolio: {
                  cashCents: human.cashCents,
                  holdings: human.holdings,
                },
              },
            };
          }
          let batches: MarketBatch[] = [];
          if (
            snapshot.round &&
            recipient.roundId === snapshot.round.roundId &&
            recipient.roundSequence !== undefined &&
            recipient.roundSequence < snapshot.round.sequence
          ) {
            const key = `${recipient.roundId}:${recipient.roundSequence}`;
            const existing = updates.get(key);
            if (existing) batches = existing;
            else {
              const state = this.transactionCache.get(snapshot.round.roundId);
              if (!state) throw new Error("Missing publication state");
              batches = await readMarketUpdates(
                client,
                state,
                recipient.roundSequence,
                now,
              );
              updates.set(key, batches);
            }
          }
          deliveries.push({ snapshot, batches, error: null });
        } catch (error) {
          if (
            !(error instanceof LobbyError) ||
            !["UNAUTHENTICATED", "FORBIDDEN", "ROOM_NOT_FOUND"].includes(
              error.code,
            )
          )
            throw error;
          deliveries.push({ snapshot: null, batches: [], error: error.code });
        }
      }
      return deliveries;
    });
  }

  authorizeOrderRecipient(secret: string, code: string, roundId: string) {
    return this.run(async (client, now) => {
      await this.member(client, secret, code, now);
      const row = (
        await client.query("SELECT current_round_id FROM rooms WHERE code=$1", [
          code,
        ])
      ).rows[0];
      return row.current_round_id === roundId;
    });
  }

  processDue() {
    return this.run(async (client, now) => {
      const applied: {
        roundId: string;
        scheduledEventId: string;
        dueAtMs: number;
      }[] = [];
      await this.cancelDisconnectedCountdowns(client, now);
      const countdowns = await client.query(
        "SELECT code,initialization FROM room_countdowns c JOIN rooms r USING(code) WHERE r.status='COUNTDOWN'",
      );
      for (const { code, initialization } of countdowns.rows) {
        const input = roundInitializationSchema.parse(initialization);
        if (now < input.opensAtMs) continue;
        const state = await persistRoundOpening(client, input);
        this.transactionCache.set(state.round.roundId, state);
        await client.query(
          "UPDATE rooms SET status='OPEN',current_round_id=$2,sequence=sequence+1,host_transfer_at=NULL,expires_at=NULL WHERE code=$1",
          [code, state.round.roundId],
        );
        await client.query("DELETE FROM room_countdowns WHERE code=$1", [code]);
        await this.record(client, code, "RoundOpened", null, now);
      }
      const active = await client.query(
        "SELECT code,current_round_id FROM rooms WHERE status='OPEN'",
      );
      for (const room of active.rows) {
        const result = await this.catchUpRound(
          client,
          room.current_round_id,
          now,
        );
        applied.push(...result.applied);
      }
      const rooms = await client.query(
        "SELECT * FROM rooms WHERE status='LOBBY'",
      );
      for (const room of rooms.rows) {
        const connected = await client.query(
          "SELECT m.player_id FROM room_members m JOIN guest_sessions s USING(player_id) WHERE code=$1 AND connected_at IS NOT NULL AND s.expires_at_ms>$2 ORDER BY connected_at, join_order",
          [room.code, now],
        );
        if (
          room.expires_at !== null &&
          Number(room.expires_at) <= now &&
          !connected.rowCount
        ) {
          await client.query(
            "UPDATE rooms SET status='EXPIRED',sequence=sequence+1 WHERE code=$1",
            [room.code],
          );
          await this.record(client, room.code, "RoomExpired", null, now);
        } else if (
          room.host_transfer_at !== null &&
          Number(room.host_transfer_at) <= now &&
          connected.rowCount &&
          !connected.rows.some((member) => member.player_id === room.host_id)
        ) {
          const hostId = connected.rows[0].player_id;
          await client.query(
            "UPDATE rooms SET host_id=$2,host_transfer_at=NULL,sequence=sequence+1 WHERE code=$1",
            [room.code, hostId],
          );
          await this.record(client, room.code, "HostTransferred", hostId, now);
        }
      }
      return applied;
    }).then((applied) => {
      const committedAtMs = this.clock();
      return applied.map((event) => ({
        ...event,
        committedAtMs,
        lagMs: Math.max(0, committedAtMs - event.dueAtMs),
      }));
    });
  }
}
