"use client";

import { useEffect, useState, type FormEvent } from "react";
import { io } from "socket.io-client";
import {
  guestRequestSchema,
  lobbyErrorMessages,
  lobbyErrorSchema,
  lobbyCommandErrorSchema,
  lobbySnapshotSchema,
  roomCodeSchema,
  sessionResponseSchema,
  type LobbyErrorCode,
  type GuestPlayer,
  type LobbySnapshot,
} from "@dinopump/contracts";

const dinosaurs = {
  trex: "🦖 T. rex",
  triceratops: "🦕 Triceratops",
  stegosaurus: "🦕 Stegosaurus",
  brachiosaurus: "🦕 Brachiosaurus",
};
class RequestError extends Error {
  constructor(readonly code: LobbyErrorCode) {
    super(lobbyErrorMessages[code]);
  }
}
async function request(path: string, body?: unknown): Promise<unknown> {
  const response = await fetch(path, {
    ...(body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
    cache: "no-store",
    signal: AbortSignal.timeout(6000),
  });
  const data: unknown = await response.json();
  if (!response.ok) {
    const parsed = lobbyErrorSchema.safeParse(data);
    throw new RequestError(
      parsed.success ? parsed.data.error : "SERVICE_UNAVAILABLE",
    );
  }
  return data;
}
export function Lobby() {
  const [player, setPlayer] = useState<GuestPlayer | null>(null);
  const [name, setName] = useState("");
  const [avatar, setAvatar] = useState("trex");
  const [code, setCode] = useState("");
  const [activeCode, setActiveCode] = useState("");
  const [snapshot, setSnapshot] = useState<LobbySnapshot | null>(null);
  const [connection, setConnection] = useState("Connecting…");
  const [pending, setPending] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void request("/api/session")
      .then((data) => {
        if (!active) return;
        setPlayer(sessionResponseSchema.parse(data).player);
        const saved = localStorage.getItem("dinopump-room") ?? "";
        if (roomCodeSchema.safeParse(saved).success) setActiveCode(saved);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setPending(false);
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (!activeCode) return;
    const socket = io({
      transports: ["websocket"],
      auth: { code: activeCode },
      reconnectionDelay: 500,
      reconnectionDelayMax: 5000,
      randomizationFactor: 0.5,
    });
    function report(data: unknown) {
      const parsed = lobbyCommandErrorSchema.safeParse(data);
      setError(
        parsed.success
          ? lobbyErrorMessages[parsed.data.error]
          : lobbyErrorMessages.SERVICE_UNAVAILABLE,
      );
      if (
        parsed.success &&
        ["UNAUTHENTICATED", "ROOM_NOT_FOUND", "FORBIDDEN"].includes(
          parsed.data.error,
        )
      ) {
        localStorage.removeItem("dinopump-room");
        setActiveCode("");
        setSnapshot(null);
        if (parsed.data.error === "UNAUTHENTICATED") setPlayer(null);
      }
    }
    socket.on("connect", () => setConnection("Synchronizing…"));
    socket.on("disconnect", () => setConnection("Reconnecting…"));
    socket.on("connect_error", (error: Error & { data?: unknown }) => {
      setConnection("Reconnecting…");
      if (error.data) report(error.data);
    });
    socket.on("command:error", report);
    socket.on("room:snapshot", (data: unknown) => {
      const parsed = lobbySnapshotSchema.safeParse(data);
      if (!parsed.success || parsed.data.code !== activeCode) {
        setConnection("Synchronizing…");
        return;
      }
      setSnapshot((previous) =>
        previous?.code === activeCode &&
        previous.sequence > parsed.data.sequence
          ? previous
          : parsed.data,
      );
      setConnection("Connected");
      setError("");
    });
    // Server-side disconnects (for example database loss) also need backoff.
    const reconnect = setInterval(() => {
      if (!socket.connected && !socket.active) socket.connect();
    }, 5000);
    return () => {
      clearInterval(reconnect);
      socket.disconnect();
    };
  }, [activeCode]);
  async function perform(work: () => Promise<void>) {
    setPending(true);
    setError("");
    try {
      await work();
    } catch (error) {
      if (error instanceof RequestError && error.code === "UNAUTHENTICATED") {
        setPlayer(null);
        setActiveCode("");
        setSnapshot(null);
        localStorage.removeItem("dinopump-room");
      }
      setError(
        error instanceof Error
          ? error.message
          : lobbyErrorMessages.SERVICE_UNAVAILABLE,
      );
    } finally {
      setPending(false);
    }
  }
  function save(event: FormEvent) {
    event.preventDefault();
    const parsed = guestRequestSchema.safeParse({ displayName: name, avatar });
    if (!parsed.success) {
      setError("Use a display name of 2–20 characters.");
      return;
    }
    void perform(async () =>
      setPlayer(
        sessionResponseSchema.parse(await request("/api/session", parsed.data))
          .player,
      ),
    );
  }
  function enter(create: boolean) {
    const roomCode = code.trim().toUpperCase();
    if (!create && !roomCodeSchema.safeParse(roomCode).success) {
      setError(lobbyErrorMessages.INVALID_REQUEST);
      return;
    }
    void perform(async () => {
      const room = lobbySnapshotSchema.parse(
        await request(
          create ? "/api/rooms" : `/api/rooms/${roomCode}/join`,
          {},
        ),
      );
      localStorage.setItem("dinopump-room", room.code);
      setSnapshot(room);
      setConnection("Connecting…");
      setActiveCode(room.code);
    });
  }
  return (
    <section className="lobby" aria-labelledby="lobby-heading">
      <div className="section-heading">
        <h2 id="lobby-heading">Gather your herd</h2>
        {player && <span>Playing as {player.displayName}</span>}
      </div>
      <p>
        Buy fictional assets with Dino Dollars. Sell units you own. The highest
        virtual portfolio value at the end of the round wins. Trades execute
        against a game liquidity bot.
      </p>
      <p className="availability">
        Fictional market game. Virtual currency only.
      </p>
      {error && <p role="alert">{error}</p>}
      {!player ? (
        <form onSubmit={save} className="guest-form">
          <label htmlFor="display-name">
            Display name
            <input
              id="display-name"
              autoComplete="nickname"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={40}
              required
            />
          </label>
          <label htmlFor="dinosaur">
            Dinosaur
            <select
              id="dinosaur"
              value={avatar}
              onChange={(event) => setAvatar(event.target.value)}
            >
              {Object.entries(dinosaurs).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <button disabled={pending}>Save guest</button>
        </form>
      ) : !activeCode ? (
        <div className="room-actions">
          <button disabled={pending} onClick={() => setPlayer(null)}>
            Change guest
          </button>
          <button disabled={pending} onClick={() => enter(true)}>
            Create lobby
          </button>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              enter(false);
            }}
          >
            <label htmlFor="room-code">
              Room code
              <input
                id="room-code"
                autoCapitalize="characters"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                maxLength={6}
                required
              />
            </label>
            <button disabled={pending}>Join lobby</button>
          </form>
        </div>
      ) : (
        <div>
          <div className="section-heading">
            <h3>
              Room{" "}
              <span className="room-code" data-testid="room-code">
                {activeCode}
              </span>
            </h3>
            <p role="status">{connection}</p>
          </div>
          {snapshot && (
            <ul className="players" aria-label="Lobby players">
              {snapshot.players.map((member) => (
                <li key={member.playerId}>
                  <span
                    className="dinosaur-avatar"
                    aria-label={dinosaurs[member.avatar]}
                  >
                    {dinosaurs[member.avatar]}
                  </span>
                  <strong>{member.displayName}</strong>
                  <span>
                    {member.playerId === snapshot.hostId ? "Host · " : ""}
                    {member.connected ? "Online" : "Offline"}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p>
            Share this code with friends. Up to eight guests can gather here.
          </p>
        </div>
      )}
    </section>
  );
}
