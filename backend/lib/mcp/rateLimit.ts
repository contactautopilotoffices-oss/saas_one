/**
 * Per-user request limit for /api/mcp. Sliding one-minute window, held in memory.
 *
 * Limitation: on serverless hosting each instance keeps its own window, so the real ceiling
 * is (limit x running instances). It stops a runaway assistant loop, not a determined attacker.
 */
const windows = new Map<string, number[]>();
const WINDOW_MS = 60_000;

export function allowRequest(key: string, limit: number, now = Date.now()): boolean {
    const recent = (windows.get(key) || []).filter(t => now - t < WINDOW_MS);
    if (recent.length >= limit) {
        windows.set(key, recent);
        return false;
    }
    recent.push(now);
    windows.set(key, recent);
    if (windows.size > 10_000) {
        // Drop idle keys so the map cannot grow without bound.
        for (const [k, ts] of windows) if (!ts.some(t => now - t < WINDOW_MS)) windows.delete(k);
    }
    return true;
}

/** Test helper. */
export function resetRateLimits(): void {
    windows.clear();
}
