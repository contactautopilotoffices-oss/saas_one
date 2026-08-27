'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { WidgetDef, WidgetLayoutItem } from './types';

/**
 * Loads, merges and persists the user's widget board.
 *
 * THREE BEHAVIOURS WORTH KNOWING
 *
 * 1. IT WORKS WITHOUT THE MIGRATION. If `dashboard_widget_layouts` does not exist yet the
 *    API answers `provisioned: false` and everything falls back to localStorage. The board
 *    is fully usable on day one; applying the migration upgrades it to follow the user
 *    across devices. A dashboard that refuses to render until a DBA runs something is not
 *    a dashboard.
 *
 * 2. NEW WIDGETS APPEAR AUTOMATICALLY. A saved layout is merged against the live registry
 *    rather than replacing it, so shipping a new widget adds it to everyone's board at its
 *    default position instead of being invisible to every existing user.
 *
 * 3. AUTO-RANKING NEVER MOVES A CARD MID-SESSION. Usage ordering is applied once, at load,
 *    and only to cards the user has never touched. Anything dragged, resized or explicitly
 *    added is marked pinned and stays exactly where it was put. A board that rearranges
 *    itself while you are reading it is hostile, and it is the failure mode that kills
 *    every "smart" dashboard — so the ranking decides a starting position, nothing more.
 */

const LOCAL_KEY = (orgId: string, board: string) => `apo.dashboard.${board}.${orgId}`;

interface LayoutResponse {
    provisioned: boolean;
    items: WidgetLayoutItem[] | null;
    ranking: Array<{ widget_id: string; score: number }>;
}

function defaultLayout(widgets: WidgetDef[]): WidgetLayoutItem[] {
    return [...widgets]
        .sort((a, b) => a.defaultOrder - b.defaultOrder)
        .map((w, i) => ({
            widget_id: w.id,
            size: w.defaultSize,
            position: i,
            is_visible: w.defaultVisible !== false,
            is_pinned: false,
        }));
}

/**
 * Merge a saved board with the current registry.
 * Saved entries win for size/visibility/pin; unknown widgets are dropped; newly-registered
 * widgets are appended at their default position.
 */
function merge(saved: WidgetLayoutItem[], widgets: WidgetDef[]): WidgetLayoutItem[] {
    const known = new Set(widgets.map(w => w.id));
    const bySaved = new Map(saved.filter(s => known.has(s.widget_id)).map(s => [s.widget_id, s]));

    const maxPos = bySaved.size
        ? Math.max(...[...bySaved.values()].map(s => s.position))
        : -1;

    let appended = 0;
    const merged = widgets.map(w => {
        const s = bySaved.get(w.id);
        if (s) return s;
        appended += 1;
        return {
            widget_id: w.id,
            size: w.defaultSize,
            position: maxPos + appended,
            is_visible: w.defaultVisible !== false,
            is_pinned: false,
        };
    });

    return merged.sort((a, b) => a.position - b.position);
}

/** Apply usage ranking to unpinned cards only, preserving the slots pinned cards occupy. */
function applyRanking(
    layout: WidgetLayoutItem[],
    ranking: Array<{ widget_id: string; score: number }>,
): WidgetLayoutItem[] {
    if (!ranking.length) return layout;
    const score = new Map(ranking.map(r => [r.widget_id, r.score]));

    const ordered = [...layout].sort((a, b) => a.position - b.position);
    const freeSlots: number[] = [];
    ordered.forEach((item, index) => { if (!item.is_pinned) freeSlots.push(index); });
    if (freeSlots.length < 2) return layout;

    const movable = freeSlots.map(i => ordered[i])
        .sort((a, b) => (score.get(b.widget_id) ?? 0) - (score.get(a.widget_id) ?? 0));

    const next = [...ordered];
    freeSlots.forEach((slot, i) => { next[slot] = movable[i]; });

    return next.map((item, i) => ({ ...item, position: i }));
}

export function useWidgetLayout(orgId: string | null | undefined, widgets: WidgetDef[], board = 'ops') {
    const [layout, setLayout] = useState<WidgetLayoutItem[]>(() => defaultLayout(widgets));
    const [loaded, setLoaded] = useState(false);
    const remoteAvailable = useRef(false);
    const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Registry identity, so the effect below re-runs when a widget is added or removed but
    // not on every render.
    const registryKey = useMemo(() => widgets.map(w => w.id).join('|'), [widgets]);

    useEffect(() => {
        if (!orgId) return;
        let cancelled = false;

        (async () => {
            let saved: WidgetLayoutItem[] | null = null;
            let ranking: Array<{ widget_id: string; score: number }> = [];

            try {
                const res = await fetch(`/api/dashboard/layout?org_id=${orgId}&board=${board}`, {
                    credentials: 'same-origin',
                });
                if (res.ok) {
                    const json = (await res.json()) as LayoutResponse;
                    remoteAvailable.current = json.provisioned;
                    saved = json.items;
                    ranking = json.ranking || [];
                }
            } catch {
                remoteAvailable.current = false;
            }

            if (!saved) {
                try {
                    const raw = localStorage.getItem(LOCAL_KEY(orgId, board));
                    if (raw) saved = JSON.parse(raw) as WidgetLayoutItem[];
                } catch {
                    // Corrupt local state should never block the board — fall through to defaults.
                }
            }

            if (cancelled) return;

            const base = saved ? merge(saved, widgets) : defaultLayout(widgets);
            setLayout(saved ? base : applyRanking(base, ranking));
            setLoaded(true);
        })();

        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [orgId, board, registryKey]);

    const persist = useCallback((next: WidgetLayoutItem[]) => {
        if (!orgId) return;

        try {
            localStorage.setItem(LOCAL_KEY(orgId, board), JSON.stringify(next));
        } catch {
            // Private browsing / quota. Non-fatal: the board still works for this session.
        }

        if (!remoteAvailable.current) return;
        if (saveTimer.current) clearTimeout(saveTimer.current);
        // Debounced: a resize drag emits a size change per snap, and each one should not be
        // its own round trip.
        saveTimer.current = setTimeout(() => {
            void fetch('/api/dashboard/layout', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({ org_id: orgId, board, items: next }),
            }).catch(() => { /* best effort; localStorage already holds it */ });
        }, 600);
    }, [orgId, board]);

    const update = useCallback((next: WidgetLayoutItem[]) => {
        const normalised = [...next]
            .sort((a, b) => a.position - b.position)
            .map((item, i) => ({ ...item, position: i }));
        setLayout(normalised);
        persist(normalised);
    }, [persist]);

    const reset = useCallback(() => {
        const fresh = defaultLayout(widgets);
        setLayout(fresh);
        persist(fresh);
    }, [widgets, persist]);

    const recordUse = useCallback((widgetId: string) => {
        if (!orgId || !remoteAvailable.current) return;
        void fetch('/api/dashboard/layout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ org_id: orgId, widget_id: widgetId }),
        }).catch(() => { /* ranking is best-effort */ });
    }, [orgId]);

    useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current); }, []);

    return { layout, setLayout: update, reset, recordUse, loaded };
}
