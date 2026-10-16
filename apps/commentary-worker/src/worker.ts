import type { Pool } from "pg";
import {
  claimCommentary,
  finishCommentary,
  Operations,
} from "@dinopump/database";
import {
  commentaryResultSchema,
  type NarrationInput,
  type CommentaryResult,
} from "@dinopump/contracts";

/** Providers are wrapped in factual validation before reaching this seam. */
export interface Narrator {
  provider: string;
  model: string;
  promptVersion: string;
  narrate(
    input: NarrationInput,
    signal: AbortSignal,
  ): Promise<CommentaryResult>;
}
export class CommentaryWorker {
  constructor(
    private pool: Pool,
    private narrator?: Narrator,
    private clock = Date.now,
    readonly operations = new Operations(),
  ) {}
  async processOne() {
    try {
      const result = await this.processClaim();
      this.operations.gauge("ready", 1);
      return result;
    } catch (error) {
      this.operations.gauge("ready", 0);
      this.operations.count("database_failures");
      this.operations.log("storage.unavailable");
      throw error;
    }
  }
  private async processClaim() {
    const job = await claimCommentary(this.pool, this.clock());
    if (!job) return false;
    const start = performance.now();
    const provenance = {
      provider: this.narrator?.provider ?? "disabled",
      model: this.narrator?.model ?? "none",
      promptVersion: this.narrator?.promptVersion ?? "worker-v1",
      durationMs: 0,
      validationStatus: "disabled" as const,
    };
    let result: CommentaryResult = { status: "fallback", provenance };
    if (this.narrator && job.input.success) {
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const output = await Promise.race([
          this.narrator.narrate(job.input.data, controller.signal),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              controller.abort();
              reject(new Error("timeout"));
            }, 5000);
          }),
        ]);
        const parsed = commentaryResultSchema.safeParse(output);
        result = parsed.success
          ? parsed.data
          : {
              status: "fallback",
              provenance: { ...provenance, validationStatus: "invalid" },
            };
      } catch {
        result = {
          status: "fallback",
          provenance: {
            ...provenance,
            validationStatus: controller.signal.aborted
              ? "timeout"
              : "unavailable",
          },
        };
      } finally {
        clearTimeout(timer);
      }
    } else if (!job.input.success)
      result = {
        status: "fallback",
        provenance: { ...provenance, validationStatus: "invalid" },
      };
    result.provenance = {
      ...result.provenance,
      provider: provenance.provider,
      model: provenance.model,
      promptVersion: provenance.promptVersion,
      durationMs: Math.round(performance.now() - start),
    };
    await finishCommentary(this.pool, job, result, this.clock());
    this.operations.observe("narration_ms", result.provenance.durationMs);
    const outcome = result.provenance.validationStatus;
    if (outcome === "accepted") this.operations.count("narration_accepted");
    else if (outcome === "disabled")
      this.operations.count("narration_disabled");
    else {
      this.operations.count("narration_failures");
      this.operations.count(
        outcome === "invalid"
          ? "narration_invalid"
          : outcome === "timeout"
            ? "narration_timeout"
            : "narration_unavailable",
      );
    }
    this.operations.log("commentary.attempt", {
      jobId: job.sourceEventId,
      attempt: job.attempts,
      durationMs: result.provenance.durationMs,
      outcome,
      ...(job.input.success ? { roundId: job.input.data.roundId } : {}),
    });
    return true;
  }
}
