'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { registerSessionCache } from './sessionCaches';

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
// Bumped whenever the caches are emptied (user change / logout), so an answer that was still on its way for the
// previous user is dropped instead of landing in the next user's cache.
let generation = 0;

/** Default freshness. Long enough that a resize never refetches. */
const DEFAULT_TTL = 60_000;

// ── Saved copies (performance plan Phase 5A) ─────────────────────────────────────────────────────────────────────
// The last successful answer for each URL is also kept in localStorage, per signed-in user, so the next visit shows the
// cards at once and refreshes them in the background. Only successful answers are saved; errors and 401/403 never are.
// Saved copies are tied to the user, to the app version (a deploy starts fresh, so no card gets data in an old shape),
// and expire after 24 h. DataCacheProvider sets the owner and wipes them on logout or user change.
const SAVED_PREFIX = 'widget:v1:';
const APP_VERSION = process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA || 'local';
const SAVED_MAX_AGE = 24 * 60 * 60 * 1000;
const SAVED_MAX_CHARS = 300_000;
let owner: string | null = null;

const savedKey = (key: string) => `${SAVED_PREFIX}${owner}:${APP_VERSION}:${key}`;

function readSaved(key: string): Entry | null {
    if (!owner || typeof window === 'undefined') return null;
    try {
        const raw = localStorage.getItem(savedKey(key));
        if (!raw) return null;
        const saved = JSON.parse(raw) as { data?: unknown; at?: unknown };
        if (typeof saved?.at !== 'number' || Date.now() - saved.at > SAVED_MAX_AGE) {
            localStorage.removeItem(savedKey(key));
            return null;
        }
        return { data: saved.data, at: saved.at, error: null };
    } catch {
        return null;
    }
}

function writeSaved(key: string, entry: Entry) {
    if (!owner || typeof window === 'undefined') return;
    try {
        if (entry.error) { localStorage.removeItem(savedKey(key)); return; }
        const raw = JSON.stringify({ data: entry.data, at: entry.at });
        if (raw.length > SAVED_MAX_CHARS) { localStorage.removeItem(savedKey(key)); return; }
        localStorage.setItem(savedKey(key), raw);
    } catch { /* storage full or blocked: simply no saved copy */ }
}

function removeSaved(key: string) {
    if (!owner || typeof window === 'undefined') return;
    try { localStorage.removeItem(savedKey(key)); } catch { /* ignore */ }
}

/** Who is signed in (null = nobody). Saved copies are only read and written for a known user. */
export function setWidgetDataOwner(userId: string | null) {
    owner = userId;
}

/** Delete every saved copy, for every user. Called on logout and when a different user signs in. */
export function clearSavedWidgetData() {
    if (typeof window === 'undefined') return;
    try {
        Object.keys(localStorage)
            .filter(k => k.startsWith(SAVED_PREFIX))
            .forEach(k => { try { localStorage.removeItem(k); } catch { /* ignore */ } });
    } catch { /* ignore */ }
}

function notify(key: string) {
    subscribers.get(key)?.forEach(fn => fn());
}

async function load(key: string): Promise<Entry> {
    const existing = inflight.get(key);
    if (existing) return existing;
    const startedIn = generation;

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
    // The user changed while this was on its way: the answer belongs to the previous user, drop it.
    if (startedIn !== generation) return entry;
    cache.set(key, entry);
    writeSaved(key, entry);
    notify(key);
    return entry;
}

/**
 * Start loading these URLs now, before any card asks for them (performance plan Phase 5A: the Command Center's requests
 * begin during "Loading your dashboard…"). Cards that mount later share the same request or find the finished answer.
 * URLs already cached and still fresh are skipped.
 */
export function prefetchWidgetData(urls: string[], ttl = DEFAULT_TTL) {
    for (const url of urls) {
        const entry = cache.get(url);
        if (!entry || Date.now() - entry.at > ttl) void load(url);
    }
}

// Emptied when the signed-in user changes or logs out (the keys are URLs, not per user).
registerSessionCache(() => { cache.clear(); inflight.clear(); generation++; });

/** Drop cached entries so the next read refetches. Used by the grid's Refresh control. */
export function invalidateWidgetData(prefix?: string) {
    for (const key of [...cache.keys()]) {
        if (!prefix || key.startsWith(prefix)) {
            cache.delete(key);
            notify(key);
        }
    }
    // Also drop this user's saved copies under the same prefix, including cards not on screen right now (Phase 5A).
    if (owner && typeof window !== 'undefined') {
        const start = savedKey(prefix || '');
        try {
            Object.keys(localStorage).filter(k => k.startsWith(start))
                .forEach(k => { try { localStorage.removeItem(k); } catch { /* ignore */ } });
        } catch { /* ignore */ }
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

    // Nothing in memory yet: show the saved copy from an earlier visit straight away (Phase 5A). It carries its real
    // timestamp, so the effect above sees it as stale and fetches fresh data, and the card's "synced …" stamp shows its age.
    if (url && !cache.has(url)) {
        const saved = readSaved(url);
        if (saved) cache.set(url, saved);
    }
    const entry = url ? cache.get(url) : undefined;

    return {
        data: (entry?.data as T) ?? null,
        loading: !!url && !entry,
        error: entry?.error ?? null,
        fetchedAt: entry?.at ?? null,
        refresh: useCallback(() => {
            if (!url) return;
            cache.delete(url);
            removeSaved(url);
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
