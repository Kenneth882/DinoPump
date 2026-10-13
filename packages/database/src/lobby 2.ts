import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { loadBaseline } from "@dinopump/game-content";
import { persistRoundOpening, readOpenedRound } from "./opened-round.js";
import {
  guestRequestSchema,
  gameplayRulesSchema,
  type Baseline,
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
const hashSecret = (secret: string) =>
  createHash("sha256").update(secret).digest("hex");

/** One dedicated database connection owns and serializes the MVP lobby. */
export class LobbyStore {
  private tail: Promise<unknown> = Promise.resolve();
  private available = true;
  private constructor(
    private client: PoolClient,
    private clock: () => number,
    private roomRules: Baseline["rules"]["room"],
    private baseline: Baseline,
  ) {
    client.on("error", () => {
      this.available = false;
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
      await store.run(async (db, now) => {
        const opened = await db.query(
          "SELECT current_round_id FROM rooms WHERE current_round_id IS NOT NULL",
        );
        for (const room of opened.rows) {
          if (!(await readOpenedRound(db, room.current_round_id)))
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
      await store.processDue();
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
        const value = await work(this.client, this.clock());
        await this.assertOwnership();
        await this.client.query("COMMIT");
        return value;
      } catch (error) {
        await this.client.query("ROLLBACK").catch(() => {
          this.available = false;
        });
        throw error;
      }
    });
    this.tail = result.catch(() => {});
    return result;
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
          "SELECT current_round_id FROM rooms WHERE current_round_id IS NOT NULL",
        );
        for (const room of rooms.rows) {
          const state = await readOpenedRound(client, room.current_round_id);
          if (!state) throw new Error("Missing active round");
          // Due-event and close recovery arrive in later tickets. Do not claim readiness past this slice's supported state.
          const next = state.round.schedule[state.nextScheduledEvent];
          if (now >= state.round.closesAtMs || (next && now >= next.dueAtMs))
            return false;
        }
        return true;
      });
    } catch {
      this.available = false;
      return false;
    }
  }
  async close() {
    await this.tail;
    if (this.closed) return;
    this.closed = true;
    this.available = false;
    this.client.release(true);
  }
  private closed = false;
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
    const engine = room.current_round_id
      ? await readOpenedRound(client, room.current_round_id)
      : null;
    const human = engine?.trading.humans.find(
      (human) => human.playerId === playerId,
    );
    if (engine && !human) throw new LobbyError("FORBIDDEN");
    return lobbySnapshotSchema.parse({
      code,
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
              opensAt: engine.round.opensAtMs,
              closesAt: engine.round.closesAtMs,
              assets: engine.trading.market.assets.map((asset) => ({
                symbol: asset.symbol,
                referencePriceCents: asset.referencePriceCents,
                lastPriceCents: engine.trading.lastPrices[asset.symbol],
              })),
              quotes: engine.trading.quotes,
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
    command: { type: "Ready"; ready: boolean } | { type: "Start" },
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
    command: { type: "Ready"; ready: boolean } | { type: "Start" },
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

  processDue() {
    return this.run(async (client, now) => {
      await this.cancelDisconnectedCountdowns(client, now);
      const countdowns = await client.query(
        "SELECT code,initialization FROM room_countdowns c JOIN rooms r USING(code) WHERE r.status='COUNTDOWN'",
      );
      for (const { code, initialization } of countdowns.rows) {
        const input = roundInitializationSchema.parse(initialization);
        if (now < input.opensAtMs) continue;
        const state = await persistRoundOpening(client, input);
        await client.query(
          "UPDATE rooms SET status='OPEN',current_round_id=$2,sequence=sequence+1,host_transfer_at=NULL,expires_at=NULL WHERE code=$1",
          [code, state.round.roundId],
        );
        await client.query("DELETE FROM room_countdowns WHERE code=$1", [code]);
        await this.record(client, code, "RoundOpened", null, now);
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
    });
  }
}
