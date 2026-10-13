"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { io } from "socket.io-client";
import {
  guestRequestSchema,
  lobbyErrorMessages,
  lobbyErrorSchema,
  lobbyCommandErrorSchema,
  lobbySnapshotSchema,
  roomCommandOutcomeSchema,
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
  const [recovering, setRecovering] = useState(true);
  const [restoreAttempt, setRestoreAttempt] = useState(0);
  const [commandPending, setCommandPending] = useState(false);
  const command = useRef<{
    event: "room:ready" | "round:start";
    payload: { requestId: string; ready?: boolean };
    sending: boolean;
    retryAt: number;
  } | null>(null);
  const [serverClock, setServerClock] = useState<{
    at: number;
    received: number;
  } | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const clearLobby = useCallback(() => {
    localStorage.removeItem("dinopump-room");
    setActiveCode("");
    setSnapshot(null);
    command.current = null;
    setCommandPending(false);
  }, []);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let delay = 500;
    async function restore() {
      try {
        const restored = sessionResponseSchema.parse(
          await request("/api/session"),
        );
        if (!active) return;
        setPlayer(restored.player);
        const saved = localStorage.getItem("dinopump-room") ?? "";
        if (roomCodeSchema.safeParse(saved).success) setActiveCode(saved);
        setError("");
        setRecovering(false);
        setPending(false);
      } catch (error) {
        if (!active) return;
        if (error instanceof RequestError && error.code === "UNAUTHENTICATED") {
          clearLobby();
          setError("");
          setRecovering(false);
          setPending(false);
        } else {
          setError(lobbyErrorMessages.SERVICE_UNAVAILABLE);
          timer = setTimeout(() => {
            void restore();
          }, delay);
          delay = Math.min(delay * 2, 5000);
        }
      }
    }
    void restore();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [restoreAttempt, clearLobby]);
  useEffect(() => {
    if (!activeCode) return;
    const socket = io({
      transports: ["websocket"],
      auth: { code: activeCode },
      reconnectionDelay: 500,
      reconnectionDelayMax: 5000,
      randomizationFactor: 0.5,
    });
    let active = true;
    let synchronized = false;
    function report(data: unknown) {
      const parsed = lobbyCommandErrorSchema.safeParse(data);
      setError(
        parsed.success
          ? lobbyErrorMessages[parsed.data.error]
          : lobbyErrorMessages.SERVICE_UNAVAILABLE,
      );
      if (
        parsed.success &&
        (["UNAUTHENTICATED", "ROOM_NOT_FOUND"].includes(parsed.data.error) ||
          (parsed.data.error === "FORBIDDEN" && !parsed.data.requestId))
      ) {
        clearLobby();
        if (parsed.data.error === "UNAUTHENTICATED") setPlayer(null);
      }
    }
    socket.on("connect", () => setConnection("Synchronizing…"));
    socket.on("disconnect", () => {
      synchronized = false;
      setConnection("Reconnecting…");
    });
    socket.on("connect_error", (error: Error & { data?: unknown }) => {
      setConnection("Reconnecting…");
      if (error.data) report(error.data);
    });
    socket.on("command:error", report);
    function sendPending() {
      const current = command.current;
      if (
        !socket.connected ||
        !synchronized ||
        !current ||
        current.sending ||
        Date.now() < current.retryAt
      )
        return;
      current.sending = true;
      void socket
        .timeout(2500)
        .emitWithAck(current.event, current.payload)
        .then((raw: unknown) => {
          if (!active || command.current !== current) return;
          const success = roomCommandOutcomeSchema.safeParse(raw);
          const failure = lobbyCommandErrorSchema.safeParse(raw);
          const received = success.success
            ? success.data.requestId
            : failure.success
              ? failure.data.requestId
              : undefined;
          if (received !== current.payload.requestId)
            throw new Error("Invalid acknowledgement");
          command.current = null;
          setCommandPending(false);
          if (failure.success) report(failure.data);
          else setError("");
        })
        .catch(() => {
          if (!active || command.current !== current) return;
          current.sending = false;
          current.retryAt = Date.now() + 1000;
          setError("Waiting for command confirmation. Retrying…");
        });
    }
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
      setServerClock({
        at: parsed.data.serverTime,
        received: performance.now(),
      });
      setElapsed(0);
      synchronized = true;
      setConnection("Connected");
      setError("");
      sendPending();
    });
    // Server-side disconnects (for example database loss) also need backoff.
    const reconnect = setInterval(() => {
      if (!socket.connected && !socket.active) socket.connect();
    }, 5000);
    const retry = setInterval(sendPending, 500);
    return () => {
      active = false;
      clearInterval(reconnect);
      clearInterval(retry);
      if (command.current) command.current.sending = false;
      socket.disconnect();
    };
  }, [activeCode, clearLobby]);
  useEffect(() => {
    if (!serverClock) return;
    const timer = setInterval(
      () => setElapsed(performance.now() - serverClock.received),
      250,
    );
    return () => clearInterval(timer);
  }, [serverClock]);
  function submitCommand(event: "room:ready" | "round:start", ready?: boolean) {
    if (command.current || connection !== "Connected") return;
    command.current = {
      event,
      payload: {
        requestId: crypto.randomUUID(),
        ...(ready === undefined ? {} : { ready }),
      },
      sending: false,
      retryAt: 0,
    };
    setCommandPending(true);
    setError("");
  }
  async function perform(work: () => Promise<void>) {
    setPending(true);
    setError("");
    try {
      await work();
    } catch (error) {
      if (error instanceof RequestError && error.code === "UNAUTHENTICATED") {
        setPlayer(null);
        clearLobby();
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
  const own = snapshot?.players.find(
    (member) => member.playerId === player?.playerId,
  );
  const serverNow = (serverClock?.at ?? snapshot?.serverTime ?? 0) + elapsed;
  const secondsUntil = (deadline: number) =>
    Math.max(0, Math.ceil((deadline - serverNow) / 1000));
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
      {recovering ? (
        <div>
          <p aria-live="polite">Restoring your guest session…</p>
          {error && (
            <button onClick={() => setRestoreAttempt((attempt) => attempt + 1)}>
              Retry session
            </button>
          )}
        </div>
      ) : !player ? (
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
                    {member.ready ? " · Ready" : " · Not ready"}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {snapshot?.status === "LOBBY" && (
            <div className="round-actions">
              <button
                aria-pressed={own?.ready ?? false}
                disabled={commandPending || connection !== "Connected"}
                onClick={() => submitCommand("room:ready", !own?.ready)}
              >
                {own?.ready ? "Not ready" : "Ready for round"}
              </button>
              {player?.playerId === snapshot.hostId && (
                <button
                  disabled={
                    commandPending ||
                    connection !== "Connected" ||
                    snapshot.players.filter(
                      (member) => member.connected && member.ready,
                    ).length < 2
                  }
                  onClick={() => submitCommand("round:start")}
                >
                  Start round
                </button>
              )}
              <p>
                At least two connected guests must be ready. Starting includes
                everyone in this lobby.
              </p>
            </div>
          )}
          {commandPending && (
            <p role="status">Waiting for server confirmation…</p>
          )}
          {snapshot?.countdown && (
            <p data-testid="round-countdown" role="status">
              Round opens in {secondsUntil(snapshot.countdown.opensAt)} seconds.
              {secondsUntil(snapshot.countdown.opensAt) === 0 &&
                " Waiting for the server to open the round…"}
            </p>
          )}
          {snapshot?.round && (
            <section aria-labelledby="opening-heading">
              <h3 id="opening-heading">Opening resources</h3>
              <p data-testid="round-remaining">
                Round closes in {secondsUntil(snapshot.round.closesAt)} seconds.
              </p>
              <p>
                Your cash:{" "}
                <strong data-testid="own-cash">
                  D$
                  {(snapshot.round.portfolio.cashCents / 100).toLocaleString(
                    "en-US",
                    { minimumFractionDigits: 2, maximumFractionDigits: 2 },
                  )}
                </strong>
              </p>
              <p>
                Opening quotes are shown below. Trading and scheduled news
                arrive in the next game updates.
              </p>
              <ul
                className="opening-assets"
                aria-label="Opening quotes and your holdings"
              >
                {snapshot.round.assets.map((asset) => (
                  <li key={asset.symbol}>
                    <h4>{asset.symbol}</h4>
                    <p>
                      Your units:{" "}
                      {snapshot.round!.portfolio.holdings[asset.symbol]}
                    </p>
                    {(["bid", "ask"] as const).map((side) => (
                      <div key={side}>
                        <strong>{side === "bid" ? "Bids" : "Asks"}</strong>
                        <ul>
                          {snapshot
                            .round!.quotes.filter(
                              (quote) =>
                                quote.symbol === asset.symbol &&
                                quote.side === side,
                            )
                            .map((quote) => (
                              <li key={quote.id}>
                                D${(quote.priceCents / 100).toFixed(2)} ×{" "}
                                {quote.quantity} units
                              </li>
                            ))}
                        </ul>
                      </div>
                    ))}
                  </li>
                ))}
              </ul>
            </section>
          )}
          <p>
            Share this code with friends. Up to eight guests can gather here.
          </p>
        </div>
      )}
    </section>
  );
}
