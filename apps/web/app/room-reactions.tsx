import type { Socket } from "socket.io-client";
import {
  reactionAcceptedSchema,
  reactionCommandErrorSchema,
  reactionPublishedSchema,
  reactionLabels,
  reactionIdSchema,
  type ReactionId,
  type LobbySnapshot,
  type PublishedReaction,
} from "@dinopump/contracts";

export type ReactionView = {
  items: (PublishedReaction & { displayName: string; receivedAt: number })[];
  pending: boolean;
  coolingDown: boolean;
  message: string;
};
export const emptyReactionView: ReactionView = {
  items: [],
  pending: false,
  coolingDown: false,
  message: "",
};

/** A bounded transient channel; it cannot change market state or freshness. */
export function attachRoomReactions(
  socket: Socket,
  context: () => LobbySnapshot | null,
  update: (view: ReactionView) => void,
) {
  let view = emptyReactionView;
  let epoch = 0;
  let active = true;
  let cooldownUntil = 0;
  const seen = new Map<string, number>();
  const roundId = (snapshot: LobbySnapshot) =>
    snapshot.round?.roundId ?? snapshot.terminal?.roundId ?? null;
  function change(patch: Partial<ReactionView>) {
    view = { ...view, ...patch };
    update(view);
  }
  function receive(raw: unknown) {
    const snapshot = context();
    const parsed = reactionPublishedSchema.safeParse(raw);
    if (!active || !socket.connected || !snapshot || !parsed.success) return;
    const event = parsed.data;
    const player = snapshot.players.find((p) => p.playerId === event.playerId);
    if (
      !player ||
      event.code !== snapshot.code ||
      event.roundId !== roundId(snapshot) ||
      seen.has(event.id)
    )
      return;
    const now = performance.now();
    seen.set(event.id, now);
    if (seen.size > 128) seen.delete(seen.keys().next().value!);
    change({
      items: [
        ...view.items,
        { ...event, displayName: player.displayName, receivedAt: now },
      ].slice(-20),
    });
  }
  socket.on("reaction:published", receive);
  const timer = setInterval(() => {
    const now = performance.now();
    for (const [id, at] of seen) if (now - at >= 10000) seen.delete(id);
    const items = view.items.filter((item) => now - item.receivedAt < 10000);
    const coolingDown = now < cooldownUntil;
    if (items.length !== view.items.length || coolingDown !== view.coolingDown)
      change({ items, coolingDown });
  }, 250);
  return {
    send(reactionId: ReactionId) {
      const snapshot = context();
      if (
        !active ||
        !socket.connected ||
        !snapshot ||
        view.pending ||
        performance.now() < cooldownUntil
      )
        return;
      const requestId = crypto.randomUUID();
      const sentEpoch = epoch;
      const sentRound = roundId(snapshot);
      change({ pending: true, message: "Sending reaction…" });
      const current = () =>
        active &&
        sentEpoch === epoch &&
        socket.connected &&
        context()?.code === snapshot.code &&
        roundId(context()!) === sentRound;
      // Volatile emission plus the connected check prevents Socket.IO offline buffering.
      void socket.volatile
        .timeout(2500)
        .emitWithAck("reaction:send", { requestId, reactionId })
        .then((raw: unknown) => {
          if (!current()) return;
          const accepted = reactionAcceptedSchema.safeParse(raw);
          const error = reactionCommandErrorSchema.safeParse(raw);
          if (accepted.success && accepted.data.requestId === requestId) {
            cooldownUntil = performance.now() + 1000;
            change({
              pending: false,
              coolingDown: true,
              message: "Reaction sent. Wait one second before another.",
            });
          } else if (error.success && error.data.requestId === requestId) {
            if (error.data.error === "RATE_LIMITED")
              cooldownUntil = performance.now() + 1000;
            change({
              pending: false,
              coolingDown: performance.now() < cooldownUntil,
              message: error.data.message,
            });
          } else {
            change({
              pending: false,
              message:
                "Reaction confirmation unavailable. It may have been sent.",
            });
          }
        })
        .catch(() => {
          if (current())
            change({
              pending: false,
              message:
                "Reaction confirmation unavailable. It may have been sent.",
            });
        });
    },
    reset() {
      if (!active) return;
      epoch++;
      seen.clear();
      change({ items: [], pending: false, message: "" });
    },
    close() {
      active = false;
      clearInterval(timer);
      socket.off("reaction:published", receive);
    },
  };
}

export function RoomReactions({
  view,
  enabled,
  onSend,
}: {
  view: ReactionView;
  enabled: boolean;
  onSend: (id: ReactionId) => void;
}) {
  return (
    <section
      className="terminal-panel room-reactions"
      aria-labelledby="reactions-heading"
    >
      <h3 id="reactions-heading">Herd reactions</h3>
      <p>Choose a dinosaur reaction. One per second.</p>
      <div className="reaction-controls">
        {reactionIdSchema.options.map((id) => (
          <button
            key={id}
            disabled={!enabled || view.pending || view.coolingDown}
            onClick={() => onSend(id)}
          >
            {reactionLabels[id]}
          </button>
        ))}
      </div>
      <p role="status">
        {!enabled
          ? "Reconnect and synchronize to send reactions."
          : view.message}
      </p>
      {view.items.length ? (
        <ul aria-label="Recent reactions" className="reaction-list">
          {view.items.map((item) => (
            <li key={item.id}>
              {item.displayName} · {reactionLabels[item.reactionId]}
            </li>
          ))}
        </ul>
      ) : (
        <p>No recent reactions.</p>
      )}
    </section>
  );
}
