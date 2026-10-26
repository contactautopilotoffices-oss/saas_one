/**
 * Module-level caches (kept outside React, for the whole page load) register here so they can be emptied when the
 * signed-in user changes or logs out. DataCacheProvider calls clearSessionCaches() on every user change, so the next
 * person in the same browser tab never sees the previous user's data, even briefly.
 */
const clearers = new Set<() => void>();

export function registerSessionCache(clear: () => void): void {
    clearers.add(clear);
}

export function clearSessionCaches(): void {
    clearers.forEach(clear => {
        try { clear(); } catch { /* one cache failing to clear must not stop the others */ }
    });
}
