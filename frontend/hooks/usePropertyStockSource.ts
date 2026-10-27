'use client';

import { useCallback, useEffect, useState } from 'react';
import type { StockItemSource } from '@/frontend/lib/stock/itemSource';

interface StockSourceState {
    itemSource: StockItemSource;
    oldItemCount: number;
}

// One request per property, shared by every stock component on screen, and
// refreshed after a minute so a switch made elsewhere shows up without a reload.
const CACHE_MS = 60_000;
const inflight = new Map<string, { at: number; request: Promise<StockSourceState> }>();

function load(propertyId: string, force = false): Promise<StockSourceState> {
    const cached = inflight.get(propertyId);
    if (!force && cached && Date.now() - cached.at < CACHE_MS) return cached.request;
    const request = fetch(`/api/properties/${propertyId}/stock/settings`)
        .then(async res => {
            const data = await res.json().catch(() => null);
            if (!res.ok) throw new Error(data?.error || 'Could not check which stock list this property uses');
            return {
                itemSource: (data?.item_source === 'catalog' ? 'catalog' : 'legacy') as StockItemSource,
                oldItemCount: Number(data?.old_item_count) || 0,
            };
        });
    // A failure must not be remembered as an answer: drop it so the next call asks again.
    request.catch(() => { if (inflight.get(propertyId)?.request === request) inflight.delete(propertyId); });
    inflight.set(propertyId, { at: Date.now(), request });
    return request;
}

/**
 * Which stock list this property uses: its old list ('legacy') or its monthly
 * requisition items ('catalog'). A failed lookup comes back as `error`, never as
 * a guessed 'legacy', so a switched property is not shown its frozen old list.
 */
export function usePropertyStockSource(propertyId: string | undefined) {
    const [result, setResult] = useState<{ propertyId: string; value?: StockSourceState; error?: string } | null>(null);

    useEffect(() => {
        if (!propertyId) return;
        let cancelled = false;
        load(propertyId)
            .then(value => { if (!cancelled) setResult({ propertyId, value }); })
            .catch(err => { if (!cancelled) setResult({ propertyId, error: err instanceof Error ? err.message : String(err) }); });
        return () => { cancelled = true; };
    }, [propertyId]);

    const reload = useCallback(async () => {
        if (!propertyId) return;
        setResult(null);
        try {
            setResult({ propertyId, value: await load(propertyId, true) });
        } catch (err) {
            setResult({ propertyId, error: err instanceof Error ? err.message : String(err) });
        }
    }, [propertyId]);

    const current = result?.propertyId === propertyId ? result : null;
    return {
        itemSource: current?.value?.itemSource ?? 'legacy',
        oldItemCount: current?.value?.oldItemCount ?? 0,
        loading: !!propertyId && !current,
        error: current?.error ?? null,
        reload,
    };
}
