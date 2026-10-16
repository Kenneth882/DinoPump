import { lobbyErrorMessages, tradingErrorMessages } from "@dinopump/contracts";

type Counter =
  | "database_failures"
  | "ownership_losses"
  | "integrity_aborts"
  | "orders_received"
  | "orders_rejected"
  | "orders_invalid"
  | "orders_rate_limited"
  | "narration_failures"
  | "narration_disabled"
  | "narration_accepted"
  | "narration_invalid"
  | "narration_timeout"
  | "narration_unavailable"
  | "narration_publication_failures"
  | "delivery_timeouts";
type Duration =
  | "order_ack_ms"
  | "commit_to_client_ms"
  | "snapshot_ms"
  | "scheduler_lag_ms"
  | "narration_ms";
type Gauge = "ready" | "ownership" | "connected_players" | "connected_sockets";
type Event =
  | "storage.unavailable"
  | "ownership.lost"
  | "round.aborted"
  | "service.ready"
  | "service.unready"
  | "order.completed"
  | "order.rejected"
  | "scheduler.applied"
  | "commentary.attempt"
  | "commentary.publication_failed";
interface Context {
  roomCode?: string;
  roundId?: string;
  requestId?: string;
  jobId?: string;
  sequence?: number;
  durationMs?: number;
  dueAtMs?: number;
  committedAtMs?: number;
  lagMs?: number;
  attempt?: number;
  outcome?: "accepted" | "disabled" | "invalid" | "timeout" | "unavailable";
  rejectionCode?: string;
}
const buckets = [1, 5, 10, 25, 50, 100, 200, 300, 500, 1000, 5000];
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

/** Process-local, bounded operational telemetry. No payloads, credentials or error strings. */
export class Operations {
  private counters: Partial<Record<Counter, number>> = {};
  private gauges: Record<Gauge, number> = {
    ready: 0,
    ownership: 0,
    connected_players: 0,
    connected_sockets: 0,
  };
  private durations: Partial<
    Record<
      Duration,
      { count: number; sum: number; max: number; buckets: number[] }
    >
  > = {};
  private logged = new Map<Event, number>();
  private commits: {
    roundId: string;
    start: number;
    end: number;
    at: number;
  }[] = [];
  constructor(
    private sink: (line: string) => void = (line) => console.info(line),
    readonly monotonic = () => performance.now(),
  ) {}
  count(name: Counter) {
    this.counters[name] = (this.counters[name] ?? 0) + 1;
  }
  gauge(name: Gauge, value: number) {
    this.gauges[name] = value;
  }
  observe(name: Duration, value: number) {
    if (!Number.isFinite(value) || value < 0) return;
    const metric = (this.durations[name] ??= {
      count: 0,
      sum: 0,
      max: 0,
      buckets: buckets.map(() => 0),
    });
    metric.count++;
    metric.sum += value;
    metric.max = Math.max(metric.max, value);
    buckets.forEach((bound, index) => {
      if (value <= bound) metric.buckets[index]!++;
    });
  }
  log(event: Event, context: Context = {}) {
    const now = this.monotonic();
    // Aggregate counters retain every attempt; each event emits at most once/30s.
    if (now - (this.logged.get(event) ?? -Infinity) < 30_000) return;
    this.logged.set(event, now);
    const safe: Record<string, string | number> = { event };
    if (
      context.rejectionCode &&
      (Object.hasOwn(lobbyErrorMessages, context.rejectionCode) ||
        Object.hasOwn(tradingErrorMessages, context.rejectionCode))
    )
      safe.rejectionCode = context.rejectionCode;
    if (
      context.outcome &&
      ["accepted", "disabled", "invalid", "timeout", "unavailable"].includes(
        context.outcome,
      )
    )
      safe.outcome = context.outcome;
    for (const key of ["roundId", "requestId", "jobId"] as const)
      if (context[key] && uuid.test(context[key])) safe[key] = context[key];
    if (context.roomCode && /^[A-Z0-9]{6}$/.test(context.roomCode))
      safe.roomCode = context.roomCode;
    for (const key of [
      "sequence",
      "durationMs",
      "attempt",
      "dueAtMs",
      "committedAtMs",
      "lagMs",
    ] as const)
      if (Number.isSafeInteger(context[key]) && context[key]! >= 0)
        safe[key] = context[key]!;
    // A broken optional log sink must never affect committed gameplay.
    try {
      this.sink(JSON.stringify(safe));
    } catch {
      /* telemetry is best effort */
    }
  }
  committed(
    roundId: string,
    start: number,
    end: number,
    at = this.monotonic(),
  ) {
    this.commits = this.commits
      .filter((commit) => at - commit.at < 60_000)
      .slice(-2047);
    this.commits.push({ roundId, start, end, at });
  }
  deliveryStart(roundId: string, sequence: number) {
    return this.commits.find(
      (commit) =>
        this.monotonic() - commit.at < 60_000 &&
        commit.roundId === roundId &&
        sequence >= commit.start &&
        sequence <= commit.end,
    )?.at;
  }
  snapshot() {
    return {
      counters: { ...this.counters },
      gauges: { ...this.gauges },
      histograms: Object.fromEntries(
        Object.entries(this.durations).map(([name, metric]) => [
          name,
          {
            count: metric.count,
            sum: metric.sum,
            max: metric.max,
            buckets: Object.fromEntries(
              buckets.map((bound, index) => [bound, metric.buckets[index]]),
            ),
          },
        ]),
      ),
    };
  }
}
