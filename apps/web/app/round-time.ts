export function elapsedRoundTime(atMs: number, opensAtMs: number) {
  const seconds = Math.max(0, Math.floor((atMs - opensAtMs) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
