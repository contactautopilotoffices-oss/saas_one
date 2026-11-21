'use client';

import React, { useEffect, useState } from 'react';
import { Briefcase } from 'lucide-react';
import type { Position } from '@/backend/lib/candidates/types';
import { api, qs } from './api';
import { useUi } from './ui';

/*
 * "Search for a position" (owner 2026-11-16: "positions created from the Positions tab, not random positions"): one
 * dropdown under the keyword bar listing the open positions. Picking one loads its must-haves, filters, preferences
 * and JD text, so the search and Rank with AI run against that position.
 */

export default function SearchFor({ orgId, dataVersion = 0, onPosition }: {
    orgId: string;
    /** Bumped when a position is saved or closed, so the list refetches. */
    dataVersion?: number;
    onPosition: (position: Position) => void;
}) {
    const { notify, reportError } = useUi();
    const [positions, setPositions] = useState<Position[] | null>(null);
    const [value, setValue] = useState('');
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        const ctrl = new AbortController();
        void api<{ positions: Position[] }>(`/api/candidates/positions${qs({ orgId })}`, { signal: ctrl.signal }).then(res => { if (!ctrl.signal.aborted) setPositions(res.ok ? res.data.positions : []); });
        return () => ctrl.abort();
    }, [orgId, dataVersion]);

    const pick = async (id: string) => {
        setValue(id);
        if (!id) return;
        setBusy(true);
        // The list leaves the JD text out; the position itself carries it.
        const res = await api<{ position: Position }>(`/api/candidates/positions/${encodeURIComponent(id)}${qs({ orgId })}`);
        setBusy(false);
        if (!res.ok) { notify(res.error, 'error'); if (res.noAccess) reportError(res); return; }
        onPosition(res.data.position);
    };

    if (positions !== null && positions.length === 0) return null;
    return (
        <label className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-text-secondary">
            <Briefcase className="h-4 w-4 text-text-tertiary" aria-hidden />
            <span className="font-medium">Search for a position</span>
            <select
                value={value} onChange={e => void pick(e.target.value)} disabled={busy || positions === null}
                aria-label="Search for a saved position"
                className="h-9 max-w-full rounded-[10px] border border-border bg-surface px-2.5 text-sm font-medium text-text-primary outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:opacity-60"
            >
                <option value="">{positions === null ? 'Loading…' : 'pick an open position…'}</option>
                {(positions ?? []).map(p => <option key={p.id} value={p.id}>{p.title}{p.location ? ` · ${p.location}` : ''}{p.openings > 1 ? ` · ${p.openings} openings` : ''}</option>)}
            </select>
            {busy && <span className="text-xs text-text-tertiary">Loading the position…</span>}
        </label>
    );
}
