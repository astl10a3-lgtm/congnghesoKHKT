const cooldownUntilMap = new Map<string, number>();

const DEFAULT_COOLDOWN_MS = 4 * 60 * 1000; // 4 minutes

export function isModelInCooldown(model: string): boolean {
  const until = cooldownUntilMap.get(model);
  if (!until) return false;
  if (Date.now() >= until) {
    cooldownUntilMap.delete(model);
    return false;
  }
  return true;
}

export function clearModelCooldown(model: string): void {
  cooldownUntilMap.delete(model);
}

export function markModelCooldown(
  model: string,
  err: unknown,
  durationMs = DEFAULT_COOLDOWN_MS
): void {
  const msg = String((err as { message?: string } | null)?.message || '');
  const status = Number(
    (err as { status?: number; code?: number } | null)?.status ||
      (err as { status?: number; code?: number } | null)?.code ||
      0
  );

  // Never cooldown on client auth/schema bugs
  if (status === 400 || status === 401 || status === 403) {
    return;
  }

  const isTransientOverload =
    status === 429 ||
    status === 503 ||
    /UNAVAILABLE|RESOURCE_EXHAUSTED|high demand|overloaded|timeout|vượt quá/i.test(msg);

  if (isTransientOverload) {
    cooldownUntilMap.set(model, Date.now() + durationMs);
  }
}
