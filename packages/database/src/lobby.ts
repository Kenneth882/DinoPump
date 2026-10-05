import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { loadBaseline } from "@dinopump/game-content";
import {
  guestRequestSchema,
  gameplayRulesSchema,
  type Baseline,
  playerSchema,
  lobbySnapshotSchema,
  roomCodeSchema,
  type GuestPlayer,
  type LobbyErrorCode,
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
  ) {
    client.on("error", () => {
      this.available = false;
    });
  }
  static async open(
    pool: Pool,
    clock: () => number = Date.now,
    roomRules: Baseline["rules"]["room"] = loadBaseline().rules.room,
  ) {
    const rules = gameplayRulesSchema.shape.room.parse(roomRules);
    const client = await pool.connect();
    try {
      const lock = await client.query<{ owned: boolean }>(
        "SELECT pg_try_advisory_lock(18474, hashtext(current_schema())) AS owned",
      );
      if (!lock.rows[0]?.owned) throw new LobbyError("SERVICE_UNAVAILABLE");
      const store = new LobbyStore(client, clock, rules);
      await store.run(async (db, now) => {
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
      await this.client.query("BEGIN");
      try {
        const value = await work(this.client, this.clock());
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
  private async visible(client: PoolClient, code: string, now: number) {
    const result = await client.query("SELECT * FROM rooms WHERE code=$1", [
      code,
    ]);
    const room = result.rows[0];
    if (!room || room.status === "EXPIRED")
      throw new LobbyError("ROOM_NOT_FOUND");
    const members = await client.query(
      "SELECT s.player_id,s.display_name,s.avatar,m.connected_at FROM room_members m JOIN guest_sessions s USING(player_id) WHERE m.code=$1 ORDER BY m.join_order",
      [code],
    );
    return lobbySnapshotSchema.parse({
      code,
      status: room.status,
      hostId: room.host_id,
      sequence: room.sequence,
      serverTime: now,
      hostTransferAt:
        room.host_transfer_at === null ? null : Number(room.host_transfer_at),
      expiresAt: room.expires_at === null ? null : Number(room.expires_at),
      players: members.rows.map((row) => ({
        playerId: row.player_id,
        displayName: row.display_name,
        avatar: row.avatar,
        connected: row.connected_at !== null,
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
      return this.visible(client, code, now);
    });
  }
  snapshot(secret: string, code: string) {
    return this.run(async (client, now) => {
      await this.member(client, secret, code, now);
      return this.visible(client, code, now);
    });
  }

  join(secret: string, code: string) {
    return this.run(async (client, now) => {
      const player = await this.authenticateAt(client, secret, now);
      if (!roomCodeSchema.safeParse(code).success)
        throw new LobbyError("INVALID_REQUEST");
      const room = await this.visible(client, code, now);
      if (room.players.some((member) => member.playerId === player.playerId))
        return room;
      if (room.status !== "LOBBY") throw new LobbyError("JOIN_LOCKED");
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
      return this.visible(client, code, now);
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
      return this.visible(client, code, now);
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
        "UPDATE rooms SET sequence=sequence+1, host_transfer_at=CASE WHEN host_id=$2 THEN $3 ELSE host_transfer_at END, expires_at=CASE WHEN NOT EXISTS(SELECT 1 FROM room_members WHERE code=$1 AND connected_at IS NOT NULL) THEN $4 ELSE expires_at END WHERE code=$1",
        [
          code,
          playerId,
          now + this.roomRules.hostDisconnectGraceMs,
          now + this.roomRules.emptyLobbyExpiryMs,
        ],
      );
    });
  }

  processDue() {
    return this.run(async (client, now) => {
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
