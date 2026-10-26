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
        .then(res => (res.ok ? res.json() : null))
        .then(data => ({
            itemSource: (data?.item_source === 'catalog' ? 'catalog' : 'legacy') as StockItemSource,
            oldItemCount: Number(data?.old_item_count) || 0,
        }))
        .catch(() => ({ itemSource: 'legacy' as StockItemSource, oldItemCount: 0 }));
    inflight.set(propertyId, { at: Date.now(), request });
    return request;
}

/**
 * Which stock list this property uses: its old list ('legacy') or its monthly
 * requisition items ('catalog'). Anything that fails reads as 'legacy', which is
 * how every property behaved before the switch existed.
 */
export function usePropertyStockSource(propertyId: string | undefined) {
    const [state, setState] = useState<StockSourceState | null>(null);

    useEffect(() => {
        if (!propertyId) return;
        let cancelled = false;
        load(propertyId).then(s => { if (!cancelled) setState(s); });
        return () => { cancelled = true; };
    }, [propertyId]);

    const reload = useCallback(async () => {
        if (!propertyId) return;
        setState(await load(propertyId, true));
    }, [propertyId]);

    return {
        itemSource: state?.itemSource ?? 'legacy',
        oldItemCount: state?.oldItemCount ?? 0,
        loading: !!propertyId && state === null,
        reload,
    };
}
