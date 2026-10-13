/** Exact half-up adjustment of validated cents/basis points, then frozen bounds. */
export function adjustReferencePrice(
  referencePriceCents: number,
  changeBps: number,
  bounds: { minCents: number; maxCents: number },
): number {
  const rounded =
    (BigInt(referencePriceCents) * BigInt(10000 + changeBps) + 5000n) / 10000n;
  return rounded > BigInt(bounds.maxCents)
    ? bounds.maxCents
    : rounded < BigInt(bounds.minCents)
      ? bounds.minCents
      : Number(rounded);
}
