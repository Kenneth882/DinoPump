import {
  commentaryResultSchema,
  type CommentaryResult,
  type NarrationInput,
} from "@dinopump/contracts";
import type { Narrator } from "./worker.js";

type Copy = { headline: string; commentary: string };
export interface NarrationRequest {
  facts: string;
  context: Omit<NarrationInput["context"], "afterSequence" | "throughSequence">;
  options: Copy[];
}

/** External providers return untrusted JSON text, never provenance or commands. */
export interface NarrationProvider {
  provider: string;
  model: string;
  generate(request: NarrationRequest, signal: AbortSignal): Promise<string>;
}

const humor = ["", " The news desk keeps its claws on the facts."];
const copySchema = commentaryResultSchema.options[0].omit({
  status: true,
  provenance: true,
});
const money = (cents: number) =>
  `D$${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;

function approvedRequest(input: NarrationInput): NarrationRequest {
  // Explicit projection: never pass through additional runtime fields or identities.
  const context = {
    capturedAtMs: input.context.capturedAtMs,
    elapsedMs: input.context.elapsedMs,
    windowStartMs: input.context.windowStartMs,
    assets: input.context.assets.map((asset) => ({
      symbol: asset.symbol,
      name: asset.name,
      description: asset.description,
      beforeCents: asset.beforeCents,
      afterCents: asset.afterCents,
      changeBps: asset.changeBps,
      initialPriceCents: asset.initialPriceCents,
      lastExecutedPriceCents: asset.lastExecutedPriceCents,
      activity: {
        fillCount: asset.activity.fillCount,
        boughtUnits: asset.activity.boughtUnits,
        soldUnits: asset.activity.soldUnits,
        totalValueCents: asset.activity.totalValueCents,
      },
    })),
  };
  const options = context.assets.flatMap((asset) => {
    const { fillCount, boughtUnits, soldUnits, totalValueCents } =
      asset.activity;
    const reference = `${asset.symbol} reference: ${money(asset.beforeCents)} to ${money(asset.afterCents)} (${asset.changeBps >= 0 ? "+" : ""}${asset.changeBps} bps).`;
    const last =
      asset.lastExecutedPriceCents === null
        ? "No executed trades yet."
        : `Last executed price: ${money(asset.lastExecutedPriceCents)}.`;
    const activity =
      fillCount === 0
        ? "Before this event: no executed activity in this window."
        : `Before this event: ${fillCount} fills, ${boughtUnits} units bought, ${soldUnits} sold, ${money(totalValueCents)} executed.`;
    return humor
      .map((quip) => ({
        headline: `${asset.symbol}: the recorded context`,
        commentary: `${reference} ${last} ${activity}${quip}`,
      }))
      .filter(
        (copy) => copy.headline.length <= 100 && copy.commentary.length <= 400,
      );
  });
  return { facts: input.facts, context, options };
}

/** Exact contextual passage membership rejects invented or misleading claims. */
export class FactCheckedNarrator implements Narrator {
  readonly promptVersion = "context-passages-v1";
  get provider() {
    return this.adapter.provider;
  }
  get model() {
    return this.adapter.model;
  }
  constructor(private adapter: NarrationProvider) {}

  async narrate(
    input: NarrationInput,
    signal: AbortSignal,
  ): Promise<CommentaryResult> {
    const request = approvedRequest(input);
    const provenance = {
      provider: this.provider,
      model: this.model,
      promptVersion: this.promptVersion,
      durationMs: 0,
      validationStatus: "invalid" as const,
    };
    if (!request.options.length) return { status: "fallback", provenance };
    // Transport errors propagate to the worker's timeout/unavailable retry path.
    const raw = await this.adapter.generate(request, signal);
    try {
      const parsed = copySchema.safeParse(JSON.parse(raw));
      if (
        parsed.success &&
        request.options.some(
          (option) =>
            option.headline === parsed.data.headline &&
            option.commentary === parsed.data.commentary,
        )
      )
        return {
          status: "accepted",
          ...parsed.data,
          provenance: { ...provenance, validationStatus: "accepted" },
        };
    } catch {
      /* Malformed JSON retains the complete authored source. */
    }
    return { status: "fallback", provenance };
  }
}
