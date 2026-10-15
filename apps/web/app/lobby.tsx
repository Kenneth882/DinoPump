"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { RoundResults } from "./round-results";
import { MarketTerminal } from "./market-terminal";
import {
  attachRoomReactions,
  RoomReactions,
  emptyReactionView,
} from "./room-reactions";
import { io } from "socket.io-client";
import {
  guestRequestSchema,
  roundEndedSchema,
  orderResultSchema,
  tradingCommandErrorSchema,
  roomHeartbeatSchema,
  roomResyncOutcomeSchema,
  type OrderSubmit,
  type OrderResult,
  lobbyErrorMessages,
  lobbyErrorSchema,
  lobbyCommandErrorSchema,
  lobbySnapshotSchema,
  marketBatchSchema,
  newsItemSchema,
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
  const [tradePending, setTradePending] = useState(false);
  const [tradeResult, setTradeResult] = useState<OrderResult | null>(null);
  const [tradeMessage, setTradeMessage] = useState("");
  const [reactionView, setReactionView] = useState(emptyReactionView);
  const reactions = useRef<ReturnType<typeof attachRoomReactions> | null>(null);
  const trade = useRef<{
    payload: OrderSubmit;
    sending: boolean;
    retryAt: number;
  } | null>(null);
  const command = useRef<{
    event: "room:ready" | "round:start" | "room:return-to-lobby";
    payload: { requestId: string; ready?: boolean; roundId?: string };
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
    trade.current = null;
    setTradePending(false);
    setTradeResult(null);
    setTradeMessage("");
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
    let visible: LobbySnapshot | null = null;
    let resyncRequestId: string | null = null;
    let connectionEpoch = 0;
    let observedSequence = 0;
    let transitionRoundId: string | null | undefined;
    let transitionSequence = 0;
    let requireResyncAck = false;
    let deferredOrder: OrderResult | null = null;
    let reconnectDelay = 500;
    let reconnectAt = 0;
    let freshAt = performance.now();
    const reactionChannel = attachRoomReactions(
      socket,
      () => (synchronized ? visible : null),
      setReactionView,
    );
    reactions.current = reactionChannel;
    function requestSnapshot() {
      reactionChannel.reset();
      synchronized = false;
      setConnection(socket.connected ? "Synchronizing…" : "Reconnecting…");
      if (resyncRequestId || !socket.connected) return;
      const requestId = crypto.randomUUID();
      const epoch = connectionEpoch;
      resyncRequestId = requestId;
      void socket
        .timeout(2500)
        .emitWithAck("room:resync", {
          roundId:
            visible?.round?.roundId ??
            visible?.countdown?.roundId ??
            visible?.terminal?.roundId ??
            null,
          lastSequence: visible?.round?.sequence ?? 0,
          requestId,
        })
        .then((raw: unknown) => {
          if (
            !active ||
            epoch !== connectionEpoch ||
            resyncRequestId !== requestId
          )
            return;
          const outcome = roomResyncOutcomeSchema.safeParse(raw);
          if (outcome.success && outcome.data.requestId === requestId)
            receiveSnapshot(outcome.data.snapshot, true);
          else {
            const failure = lobbyCommandErrorSchema.safeParse(raw);
            if (failure.success && failure.data.requestId === requestId) {
              report(failure.data);
              if (
                ["FORBIDDEN", "UNAUTHENTICATED", "ROOM_NOT_FOUND"].includes(
                  failure.data.error,
                )
              )
                clearLobby();
            }
          }
        })
        .catch(() => {
          /* The retry timer requests another authoritative snapshot. */
        })
        .finally(() => {
          if (resyncRequestId === requestId) resyncRequestId = null;
        });
    }
    function requestAfterTransition(roundId: string | null, sequence = 0) {
      if (transitionRoundId !== roundId) {
        // An in-flight capture predates this lifecycle evidence. Only a newly
        // correlated read can prove which round (or lobby) is current now.
        transitionRoundId = roundId;
        transitionSequence = sequence;
        resyncRequestId = null;
        requireResyncAck = true;
      } else transitionSequence = Math.max(transitionSequence, sequence);
      requestSnapshot();
    }
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
    socket.on("connect", requestSnapshot);
    socket.on("disconnect", () => {
      reactionChannel.reset();
      connectionEpoch++;
      resyncRequestId = null;
      synchronized = false;
      reconnectAt = performance.now() + reconnectDelay;
      setConnection("Reconnecting…");
    });
    socket.on("connect_error", (error: Error & { data?: unknown }) => {
      reconnectAt = performance.now() + reconnectDelay;
      setConnection("Reconnecting…");
      if (error.data) report(error.data);
    });
    socket.on("command:error", (data: unknown) => {
      const error = tradingCommandErrorSchema.safeParse(data);
      if (
        error.success &&
        error.data.requestId === trade.current?.payload.requestId
      ) {
        receiveTradeError(error.data);
      } else report(data);
    });
    function receiveTradeError(error: {
      error: string;
      message: string;
      requestId?: string | undefined;
    }) {
      if (error.requestId !== trade.current?.payload.requestId) return;
      if (["RATE_LIMITED", "SERVICE_UNAVAILABLE"].includes(error.error)) {
        trade.current!.sending = false;
        trade.current!.retryAt = Date.now() + 1000;
        setTradeMessage(error.message);
        if (error.error === "SERVICE_UNAVAILABLE") requestSnapshot();
      } else {
        trade.current = null;
        setTradePending(false);
        setTradeMessage(error.message);
        if (error.error === "UNAUTHENTICATED") {
          setPlayer(null);
          clearLobby();
        }
      }
    }
    function receiveOrder(raw: unknown) {
      const parsed = orderResultSchema.safeParse(raw);
      if (!parsed.success) {
        requestSnapshot();
        return;
      }
      const result = parsed.data,
        current = trade.current;
      const matchesPending =
        current && result.requestId === current.payload.requestId;
      if (result.roundId !== visible?.round?.roundId && !matchesPending) return;
      if (result.roundId === visible?.round?.roundId)
        observedSequence = Math.max(observedSequence, result.sequence);
      if (current && result.requestId === current.payload.requestId) {
        const request = current.payload;
        if (
          result.quantity !== request.quantity ||
          result.side !== request.side ||
          result.symbol !== request.symbol ||
          result.protectionPriceCents !== request.protectionPriceCents ||
          result.roundId !== request.roundId
        ) {
          requestSnapshot();
          return;
        }
      }
      // Keep a validated pending receipt until recovery completes, including
      // old-round receipts absent from the current snapshot's recent window.
      if (
        !synchronized ||
        (result.roundId === visible?.round?.roundId &&
          result.sequence > visible.round.sequence)
      ) {
        if (matchesPending) deferredOrder = result;
        requestSnapshot();
        return;
      }
      if (matchesPending) {
        trade.current = null;
        setTradePending(false);
        setTradeMessage("");
        if (result.roundId === visible?.round?.roundId) setTradeResult(result);
      } else if (!current) {
        setTradeResult((previous) =>
          !previous ||
          previous.roundId !== result.roundId ||
          result.sequence >= previous.sequence
            ? result
            : previous,
        );
      }
      // A retried original receipt is evidence of that order, never a newer ledger.
      if (result.roundId !== visible?.round?.roundId || !visible?.round) return;
      if (result.sequence > visible.round.portfolioSequence) {
        visible = {
          ...visible,
          round: {
            ...visible.round,
            portfolio: result.portfolio,
            portfolioSequence: result.sequence,
          },
        };
        setSnapshot(visible);
      }
      if (result.sequence > (visible.round?.sequence ?? 0)) requestSnapshot();
    }
    socket.on("order:result", receiveOrder);
    socket.on("round:ended", (raw: unknown) => {
      const parsed = roundEndedSchema.safeParse(raw);
      if (!parsed.success) {
        requestSnapshot();
        return;
      }
      const result = parsed.data;
      if (result.roundId !== visible?.round?.roundId) return;
      if (result.status === "FINISHED")
        observedSequence = Math.max(
          observedSequence,
          result.settlementSequence,
        );
      // Settlement batches precede terminal delivery; otherwise resynchronize.
      if (
        result.status === "FINISHED" &&
        result.settlementSequence > visible.round.sequence
      ) {
        requestAfterTransition(result.roundId, result.settlementSequence);
        return;
      }
      visible = {
        ...visible,
        status: result.status,
        terminal: result,
        round:
          result.status === "ABORTED"
            ? null
            : {
                ...visible.round,
                portfolio: result.portfolio,
                portfolioSequence: Math.max(
                  visible.round.portfolioSequence,
                  result.settlementSequence,
                ),
              },
      };
      setSnapshot(visible);
      requestAfterTransition(
        result.roundId,
        result.status === "FINISHED" ? result.settlementSequence : 0,
      );
    });
    function sendTrade() {
      const current = trade.current;
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
        .emitWithAck("order:submit", current.payload)
        .then((raw: unknown) => {
          if (!active || trade.current !== current) return;
          const success = orderResultSchema.safeParse(raw),
            failure = tradingCommandErrorSchema.safeParse(raw);
          if (
            success.success &&
            success.data.requestId === current.payload.requestId
          )
            receiveOrder(success.data);
          else if (
            failure.success &&
            failure.data.requestId === current.payload.requestId
          )
            receiveTradeError(failure.data);
          else throw new Error("Invalid order acknowledgement");
        })
        .catch(() => {
          if (!active || trade.current !== current) return;
          current.sending = false;
          current.retryAt = Date.now() + 1000;
          requestSnapshot();
        });
    }
    socket.on("room:heartbeat", (raw: unknown) => {
      const parsed = roomHeartbeatSchema.safeParse(raw);
      if (!parsed.success) return;
      if (parsed.data.roundId === visible?.round?.roundId)
        observedSequence = Math.max(observedSequence, parsed.data.sequence);
      freshAt = performance.now();
      if (parsed.data.roundId !== (visible?.round?.roundId ?? null)) {
        requestAfterTransition(parsed.data.roundId, parsed.data.sequence);
        return;
      }
      if (parsed.data.sequence > (visible?.round?.sequence ?? 0)) {
        requestSnapshot();
        return;
      }
      setServerClock({
        at: parsed.data.serverTime,
        received: performance.now(),
      });
      setElapsed(0);
    });
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
    function receiveSnapshot(data: unknown, fromResync = false) {
      if (!active || !socket.connected) return;
      if (requireResyncAck && !fromResync) return;
      const parsed = lobbySnapshotSchema.safeParse(data);
      if (!parsed.success || parsed.data.code !== activeCode) {
        requestSnapshot();
        return;
      }
      if (
        parsed.data.round?.roundId === transitionRoundId &&
        parsed.data.round &&
        parsed.data.round.sequence < transitionSequence
      ) {
        requestSnapshot();
        return;
      }
      // Facts arriving while a snapshot is in flight bound how fresh its
      // replacement must be. Never enable an older captured market view.
      if (
        visible?.round &&
        parsed.data.round?.roundId === visible.round.roundId &&
        parsed.data.round.sequence < observedSequence
      ) {
        requestSnapshot();
        return;
      }
      if (
        visible &&
        (visible.sequence > parsed.data.sequence ||
          (visible.round?.roundId === parsed.data.round?.roundId &&
            (visible.round?.sequence ?? 0) >
              (parsed.data.round?.sequence ?? 0)))
      )
        return;
      const portfolio =
        visible?.round?.roundId === parsed.data.round?.roundId &&
        visible?.round &&
        parsed.data.round &&
        visible.round.portfolioSequence > parsed.data.round.portfolioSequence
          ? {
              portfolio: visible.round.portfolio,
              portfolioSequence: visible.round.portfolioSequence,
            }
          : null;
      if (
        visible &&
        (visible.round?.roundId ?? null) !==
          (parsed.data.round?.roundId ?? null)
      ) {
        // Keep an unresolved original identity through resets; its readback
        // can confirm the old trade, but cannot change the new round's ledger.
        setTradeResult(null);
        setTradeMessage("");
        if (command.current?.event === "room:return-to-lobby") {
          command.current = null;
          setCommandPending(false);
        }
      }
      if (
        !visible ||
        (visible.round?.roundId ?? visible.terminal?.roundId ?? null) !==
          (parsed.data.round?.roundId ?? parsed.data.terminal?.roundId ?? null)
      )
        reactionChannel.reset();
      visible = parsed.data;
      observedSequence = visible.round?.sequence ?? 0;
      if (portfolio && visible.round)
        visible = { ...visible, round: { ...visible.round, ...portfolio } };
      freshAt = performance.now();
      setSnapshot(visible);
      setServerClock({
        at: parsed.data.serverTime,
        received: performance.now(),
      });
      setElapsed(0);
      synchronized = true;
      requireResyncAck = false;
      transitionRoundId = undefined;
      transitionSequence = 0;
      reconnectDelay = 500;
      setConnection("Connected");
      setError("");
      const recovered =
        visible.round?.recentOrders.find(
          (result) => result.requestId === trade.current?.payload.requestId,
        ) ??
        (deferredOrder?.requestId === trade.current?.payload.requestId
          ? deferredOrder
          : null);
      deferredOrder = null;
      if (recovered) receiveOrder(recovered);
      sendPending();
      sendTrade();
    }
    socket.on("room:snapshot", receiveSnapshot);
    socket.on("market:batch", (data: unknown) => {
      const parsed = marketBatchSchema.safeParse(data);
      if (!parsed.success) {
        requestSnapshot();
        return;
      }
      if (!visible?.round || parsed.data.roundId !== visible.round.roundId) {
        requestAfterTransition(parsed.data.roundId, parsed.data.endSequence);
        return;
      }
      const batch = parsed.data;
      observedSequence = Math.max(observedSequence, batch.endSequence);
      if (batch.endSequence <= visible.round.sequence) return;
      if (!synchronized || batch.startSequence !== visible.round.sequence + 1) {
        requestSnapshot();
        return;
      }
      const news = new Map(
        visible.round.news.map((item) => [item.sourceEventId, item]),
      );
      for (const item of batch.news) news.set(item.sourceEventId, item);
      visible = {
        ...visible,
        serverTime: batch.serverTime,
        round: {
          ...visible.round,
          sequence: batch.endSequence,
          assets: batch.assets,
          quotes: batch.quotes,
          quoteUpdatedAtMs: batch.quoteUpdatedAtMs,
          totals: batch.totals,
          trades: [...visible.round.trades, ...batch.trades].slice(-30),
          priceHistory: [...visible.round.priceHistory, ...batch.priceHistory],
          news: [...news.values()].sort((a, b) => a.sequence - b.sequence),
        },
      };
      freshAt = performance.now();
      setSnapshot(visible);
      setServerClock({ at: batch.serverTime, received: performance.now() });
      setElapsed(0);
    });
    // Initial template facts are applied with their market batch, never as half a batch.
    socket.on("news:update", (data: unknown) => {
      const parsed = newsItemSchema.safeParse(data);
      if (
        !parsed.success ||
        !visible?.round?.news.some(
          (item) => item.sourceEventId === parsed.data.sourceEventId,
        )
      )
        requestSnapshot();
    });
    const retry = setInterval(() => {
      // Socket.IO backs off transport failures. Explicit server disconnects
      // also need bounded backoff because Socket.IO leaves them inactive.
      if (
        !socket.connected &&
        !socket.active &&
        performance.now() >= reconnectAt
      ) {
        socket.connect();
        reconnectDelay = Math.min(reconnectDelay * 2, 5000);
        reconnectAt = performance.now() + reconnectDelay;
      }
      if (socket.connected && performance.now() - freshAt >= 3000)
        requestSnapshot();
      if (socket.connected && !synchronized) requestSnapshot();
      sendPending();
      sendTrade();
    }, 500);
    return () => {
      active = false;
      reactionChannel.close();
      if (reactions.current === reactionChannel) reactions.current = null;
      clearInterval(retry);
      if (command.current) command.current.sending = false;
      if (trade.current) trade.current.sending = false;
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
  function submitCommand(
    event: "room:ready" | "round:start" | "room:return-to-lobby",
    ready?: boolean,
  ) {
    if (
      command.current ||
      connection !== "Connected" ||
      (event === "room:return-to-lobby" && !snapshot?.terminal)
    )
      return;
    command.current = {
      event,
      payload: {
        requestId: crypto.randomUUID(),
        ...(ready === undefined ? {} : { ready }),
        ...(event === "room:return-to-lobby"
          ? { roundId: snapshot!.terminal!.roundId }
          : {}),
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
          {snapshot?.terminal && (
            <RoundResults
              result={snapshot.terminal}
              host={player?.playerId === snapshot.hostId}
              disabled={commandPending || connection !== "Connected"}
              onReturn={() => submitCommand("room:return-to-lobby")}
            />
          )}
          {snapshot?.round && !snapshot.terminal && (
            <MarketTerminal
              key={snapshot.round.roundId}
              round={snapshot.round}
              players={snapshot.players}
              playerId={player.playerId}
              roomCode={activeCode}
              connection={connection}
              secondsRemaining={secondsUntil(snapshot.round.closesAt)}
              serverNow={serverNow}
              enabled={
                snapshot.status === "OPEN" &&
                connection === "Connected" &&
                serverNow >= snapshot.round.opensAt &&
                serverNow < snapshot.round.closesAt
              }
              pending={tradePending}
              result={tradeResult}
              message={tradeMessage}
              onSubmit={(payload) => {
                if (
                  snapshot.status !== "OPEN" ||
                  trade.current ||
                  connection !== "Connected" ||
                  serverNow >= snapshot.round!.closesAt
                )
                  return;
                trade.current = {
                  payload: Object.freeze({ ...payload }),
                  sending: false,
                  retryAt: 0,
                };
                setTradePending(true);
                setTradeMessage("");
              }}
            />
          )}
          {snapshot && (
            <RoomReactions
              view={reactionView}
              enabled={connection === "Connected"}
              onSend={(id) => reactions.current?.send(id)}
            />
          )}
          <p>
            Share this code with friends. Up to eight guests can gather here.
          </p>
        </div>
      )}
    </section>
  );
}
