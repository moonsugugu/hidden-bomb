export function countdownRatio(
  endsAt: number, serverTime: number, receivedAt: number, now: number, durationMs?: number,
) {
  const remaining = Math.max(0, endsAt - serverTime);
  const elapsed = Math.max(0, now - receivedAt);
  return Math.max(0, Math.min(1, (remaining - elapsed) / Math.max(1, durationMs ?? remaining)));
}

export function nextReconnect(attempt: number, connectedMs: number, receivedState: boolean) {
  const retry = receivedState && connectedMs >= 10_000 ? 0 : attempt;
  return { delay: Math.min(15_000, 800 * 2 ** Math.min(retry, 5)), attempt: retry + 1 };
}
