'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Shared fetch layer for dashboard widgets.
 *
 * WHY THIS EXISTS: two of the endpoints the grid depends on are expensive —
 * /api/accounts/summary scans all 5,265 purchase orders, and the tickets summary issues
 * roughly 80 queries. A grid of 14 independently-fetching cards would hit them once per
 * card, and again on every resize. So every request goes through one module-level cache
 * with in-flight de-duplication: N widgets asking for the same URL in the same tick share
 * a single network call, and a resize re-renders from cache instead of refetching.
 *
 * Deliberately not SWR/React Query — this is ~90 lines against a 40KB dependency, and the
 * project already ships enough client state libraries.
 */

interface Entry {
    data: unknown;
    at: number;
    error: string | null;
}

const cache = new Map<string, Entry>();
const inflight = new Map<string, Promise<Entry>>();
const subscribers = new Map<string, Set<() => void>>();

/** Default freshness. Long enough that a resize never refetches. */
const DEFAULT_TTL = 60_000;

function notify(key: string) {
    subscribers.get(key)?.forEach(fn => fn());
}

async function load(key: string): Promise<Entry> {
    const existing = inflight.get(key);
    if (existing) return existing;

    const p = (async (): Promise<Entry> => {
        try {
            const res = await fetch(key, { credentials: 'same-origin' });
            if (res.status === 401 || res.status === 403) {
                // Not an error worth retrying or showing — the widget renders nothing.
                return { data: null, at: Date.now(), error: 'forbidden' };
            }
            if (!res.ok) {
                return { data: null, at: Date.now(), error: `HTTP ${res.status}` };
            }
            return { data: await res.json(), at: Date.now(), error: null };
        } catch (e) {
            return { data: null, at: Date.now(), error: e instanceof Error ? e.message : 'Network error' };
        } finally {
            inflight.delete(key);
        }
    })();

    inflight.set(key, p);
    const entry = await p;
    cache.set(key, entry);
    notify(key);
    return entry;
}

/** Drop cached entries so the next read refetches. Used by the grid's Refresh control. */
export function invalidateWidgetData(prefix?: string) {
    for (const key of [...cache.keys()]) {
        if (!prefix || key.startsWith(prefix)) {
            cache.delete(key);
            notify(key);
        }
    }
}

export interface WidgetDataState<T> {
    data: T | null;
    loading: boolean;
    /** 'forbidden' means the caller may not see this widget — render nothing. */
    error: string | null;
    fetchedAt: number | null;
    refresh: () => void;
}

/**
 * @param url  Pass null to skip fetching entirely (e.g. orgId not resolved yet).
 * @param ttl  Milliseconds a cached response stays fresh.
 */
export function useWidgetData<T = unknown>(url: string | null, ttl = DEFAULT_TTL): WidgetDataState<T> {
    const [, force] = useState(0);
    const rerender = useCallback(() => force(n => n + 1), []);
    const mounted = useRef(true);

    useEffect(() => {
        mounted.current = true;
        return () => { mounted.current = false; };
    }, []);

    useEffect(() => {
        if (!url) return;

        let set = subscribers.get(url);
        if (!set) { set = new Set(); subscribers.set(url, set); }
        set.add(rerender);

        const entry = cache.get(url);
        if (!entry || Date.now() - entry.at > ttl) void load(url);

        return () => {
            set!.delete(rerender);
            if (set!.size === 0) subscribers.delete(url);
        };
    }, [url, ttl, rerender]);

    const entry = url ? cache.get(url) : undefined;

    return {
        data: (entry?.data as T) ?? null,
        loading: !!url && !entry,
        error: entry?.error ?? null,
        fetchedAt: entry?.at ?? null,
        refresh: useCallback(() => {
            if (!url) return;
            cache.delete(url);
            void load(url);
        }, [url]),
    };
}

/** "synced 4m ago" — the freshness stamp. */
export function relativeTime(ts: number | null): string {
    if (!ts) return '—';
    const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (s < 45) return 'just now';
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
}

/** Indian number formatting — this is an Indian business; 12,34,567 not 1,234,567. */
export function inr(value: number | null | undefined, opts: { compact?: boolean } = {}): string {
    const v = Number(value ?? 0) || 0;
    if (opts.compact) {
        const abs = Math.abs(v);
        if (abs >= 1e7) return `₹${(v / 1e7).toFixed(abs >= 1e8 ? 0 : 2)}cr`;
        if (abs >= 1e5) return `₹${(v / 1e5).toFixed(abs >= 1e6 ? 0 : 1)}L`;
        if (abs >= 1e3) return `₹${(v / 1e3).toFixed(0)}k`;
    }
    return `₹${Math.round(v).toLocaleString('en-IN')}`;
}

export function compactNumber(value: number | null | undefined): string {
    const v = Number(value ?? 0) || 0;
    const abs = Math.abs(v);
    if (abs >= 1e7) return `${(v / 1e7).toFixed(1)}cr`;
    if (abs >= 1e5) return `${(v / 1e5).toFixed(1)}L`;
    if (abs >= 1e3) return `${(v / 1e3).toFixed(1)}k`;
    return String(Math.round(v));
}
