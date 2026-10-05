import type {
  BuyCommand,
  BuyFill,
  BuyResult,
  BuyState,
  SellCommand,
  SellResult,
} from "@dinopump/contracts";
import { adjustReferencePrice } from "./reference-price.js";
import { rebuildBotQuotes } from "./bot-quotes.js";

type Rejection = Extract<BuyResult | SellResult, { ok: false }>;
type OrderRejection<Code extends Rejection["code"]> = Omit<
  Rejection,
  "code"
> & { code: Code };
export function reject<Code extends Rejection["code"]>(
  code: Code,
  path: (string | number)[],
  message: string,
): OrderRejection<Code> {
  return { ok: false, code, issues: [{ path, message }] };
}

export function invalid<Code extends Rejection["code"]>(
  code: Code,
  error: { issues: { path: PropertyKey[]; message: string }[] },
): OrderRejection<Code> {
  return {
    ok: false,
    code,
    issues: error.issues.map(({ path, message }) => ({
      path: path.map((part) =>
        typeof part === "number" ? part : String(part),
      ),
      message,
    })),
  };
}

/** Finish the private settlement copy; a failed rebuild exposes no partial state. */
export function completeOrder<
  Code extends "INVALID_BUY_STATE" | "INVALID_SELL_STATE",
>(
  state: BuyState,
  command: BuyCommand | SellCommand,
  fills: readonly Pick<
    BuyFill,
    "quantity" | "priceCents" | "totalValueCents"
  >[],
  invalidStateCode: Code,
):
  | Pick<Extract<BuyResult, { ok: true }>, "ok" | "state" | "outcome">
  | OrderRejection<Code | "QUOTE_GENERATION_EXHAUSTED"> {
  const { rules } = state.market;
  const filledQuantity = fills.reduce((sum, fill) => sum + fill.quantity, 0);
  const remainingQuantity = command.quantity - filledQuantity;
  const totalValueCents = fills.reduce(
    (sum, fill) => sum + fill.totalValueCents,
    0,
  );
  const latestFill = fills.at(-1);
  if (latestFill) {
    state.lastPrices[command.symbol] = latestFill.priceCents;
    const asset = state.market.assets.find(
      (entry) => entry.symbol === command.symbol,
    )!;
    asset.referencePriceCents = adjustReferencePrice(
      asset.referencePriceCents,
      (command.side === "buy" ? 1 : -1) *
        rules.bot.referenceImpactBpsPerFilledOrder,
      rules.prices,
    );
  }
  const replacement = rebuildBotQuotes(state.market);
  if (!replacement.ok)
    return {
      ok: false,
      code:
        replacement.code === "QUOTE_GENERATION_EXHAUSTED"
          ? replacement.code
          : invalidStateCode,
      issues: replacement.issues.map((issue) => ({
        ...issue,
        path: ["market", ...issue.path],
      })),
    };
  state.market = replacement.state;
  state.quotes = replacement.quotes;
  state.reservations = replacement.reservations;
  return {
    ok: true,
    state,
    outcome: {
      status:
        filledQuantity === 0
          ? "NO_LIQUIDITY_WITHIN_PROTECTION"
          : remainingQuantity === 0
            ? "FILLED"
            : "PARTIALLY_FILLED",
      filledQuantity,
      remainingQuantity,
      totalValueCents,
      averagePrice:
        filledQuantity === 0
          ? null
          : {
              numeratorCents: totalValueCents,
              denominatorUnits: filledQuantity,
            },
    },
  };
}
