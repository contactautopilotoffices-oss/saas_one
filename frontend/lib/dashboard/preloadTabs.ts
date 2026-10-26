'use client';

import { useEffect } from 'react';

/**
 * Tabs are split into their own files so the dashboard opens faster (performance plan Phase 1). Once the dashboard is
 * on screen and the browser is idle, this downloads every tab's file in the background, so clicking a tab later shows
 * it straight away — no extra loading spinner. `loaders` must be a stable (module-level) array of `() => import(...)`.
 */
export function usePreloadTabs(loaders: ReadonlyArray<() => Promise<unknown>>): void {
    useEffect(() => {
        const run = () => loaders.forEach(load => { load().catch(() => { /* the tab will simply load when opened */ }); });
        const w = window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
        if (w.requestIdleCallback) {
            const id = w.requestIdleCallback(run, { timeout: 4000 });
            return () => w.cancelIdleCallback?.(id);
        }
        const id = window.setTimeout(run, 1500);
        return () => window.clearTimeout(id);
    }, [loaders]);
}
