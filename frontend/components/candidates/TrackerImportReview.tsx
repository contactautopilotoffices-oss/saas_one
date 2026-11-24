'use client';

import React, { useEffect, useState } from 'react';
import type { TrackerConnection, TrackerImportPreview, TrackerSyncSummary } from '@/backend/lib/candidates/types';
import { api } from './api';
import { BTN_GHOST, BTN_PRIMARY, BTN_SECONDARY, Dialog, Spinner, WELL } from './ui';

export default function TrackerImportReview({ orgId, tracker, onClose, onImported }: {
    orgId: string; tracker: TrackerConnection; onClose: () => void; onImported: () => void;
}) {
    const [preview, setPreview] = useState<TrackerImportPreview | null>(null);
    const [selected, setSelected] = useState<Set<number>>(new Set());
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(true);
    const [nonce, setNonce] = useState(0);
    const [page, setPage] = useState(0);
    const [result, setResult] = useState<TrackerSyncSummary | null>(null);
    const endpoint = `/api/candidates/trackers/${encodeURIComponent(tracker.id)}/sync`;

    useEffect(() => {
        const ctrl = new AbortController();
        void api<{ preview: TrackerImportPreview }>(endpoint, { json: { orgId, preview: true }, signal: ctrl.signal }).then(res => {
            if (ctrl.signal.aborted) return;
            setBusy(false);
            if (!res.ok) { setError(res.error); return; }
            setPreview(res.data.preview);
            setSelected(new Set(res.data.preview.rows.filter(r => r.selected).map(r => r.rowNumber)));
        });
        return () => ctrl.abort();
    }, [endpoint, orgId, nonce]);

    const reload = () => { setPreview(null); setError(''); setResult(null); setPage(0); setBusy(true); setNonce(n => n + 1); };
    const importSelected = async () => {
        if (!preview) return;
        setBusy(true); setError('');
        const res = await api<{ summary: TrackerSyncSummary }>(endpoint, { json: { orgId, reviewToken: preview.token, selectedRows: [...selected] } });
        setBusy(false);
        if (!res.ok) { setError(`${res.error} Preview again to check what remains before retrying.`); setPreview(null); onImported(); return; }
        setResult(res.data.summary); onImported();
    };
    const eligible = preview?.rows.filter(r => r.outcome === 'new' || r.outcome === 'existing') ?? [];
    const outcome = { new: 'New candidate', existing: 'Existing candidate', unchanged: 'Unchanged', duplicate: 'Duplicate — last row is used', invalid: 'Needs correction in the sheet' };
    const display = (v: string | number | null) => v === null || v === '' ? '(empty)' : String(v);

    return <Dialog open onClose={() => { if (!busy) onClose(); }} labelId="tracker-review-title" size="xl" title={`Preview: ${tracker.name}`}
        description="Review the actual people and changes before importing. The original sheet is never changed."
        footer={<>
            <button type="button" onClick={onClose} disabled={busy} className={BTN_GHOST}>{result ? 'Close' : 'Cancel'}</button>
            {!result && <button type="button" onClick={reload} disabled={busy} className={BTN_SECONDARY}>Preview again</button>}
            {!result && <button type="button" onClick={() => void importSelected()} disabled={busy || !preview} className={BTN_PRIMARY}>{busy && <Spinner />}{selected.size ? `Import selected (${selected.size})` : 'Save exclusions only'}</button>}
        </>}>
        <div className="space-y-4">
            {error && <p role="alert" className="text-sm text-error">{error}</p>}
            {busy && <p role="status" className="flex items-center gap-2 text-sm"><Spinner />{preview ? 'Importing selected rows…' : 'Reading the sheet and checking existing candidates…'}</p>}
            {result ? <div role="status" className={`${WELL} p-4 text-sm space-y-2`}>
                <p className="font-semibold">Import complete: {result.recordsAdded} records added, {result.recordsUpdated} updated, {result.rowsSkipped} skipped.</p>
                <p>{result.stageMoves} pipeline moves completed; {result.stagePending} pending.</p>
                {result.notes.map((n, i) => <p key={i}>{n}</p>)}
                {!!result.rolesWithoutPosition.length && <p>No matching open position for: {result.rolesWithoutPosition.join(', ')}.</p>}
                {result.stagePending > 0 && <button type="button" onClick={reload} className={BTN_SECONDARY}>Preview pending rows</button>}
                <p>Extra columns are saved with the record under Tracker values.</p>
            </div> : preview && <>
                <p className={`${WELL} p-3 text-sm`}>{preview.newCandidates} new candidates · {preview.existingCandidates} existing matches · {preview.changedRows} new or changed rows · {preview.duplicateRows} duplicate rows · {preview.invalidRows} invalid rows</p>
                <p className="text-xs text-text-secondary">Only selected rows will be imported. Unselected changed rows stay excluded from future syncs until selected here. Invalid rows need correction in the sheet; unchanged rows need no import. Cancel imports nothing and keeps the saved connection.</p>
                {tracker.active && tracker.syncEvery !== 'manual' && <p className="text-sm text-amber-800">Automatic sync is enabled. After this import, future new or changed rows will sync automatically; excluded people stay skipped.</p>}
                <div className="flex flex-wrap items-center gap-2">
                    <button type="button" disabled={busy} className={BTN_SECONDARY} onClick={() => setSelected(new Set(eligible.map(r => r.rowNumber)))}>Select all importable</button>
                    <button type="button" disabled={busy} className={BTN_GHOST} onClick={() => setSelected(new Set())}>Clear selection</button>
                    <span className="text-sm">{selected.size} selected</span>
                </div>
                <div className="max-w-full overflow-x-auto rounded-xl border border-border-subtle">
                    <table className="w-full text-left text-sm">
                        <thead className="bg-surface-elevated"><tr><th className="p-2">Import</th><th className="p-2">Candidate / changes</th>{preview.headers.map(h => <th key={h} className="p-2 whitespace-nowrap">{h}</th>)}</tr></thead>
                        <tbody className="divide-y divide-border-subtle">{preview.rows.slice(page * 50, (page + 1) * 50).map(r => <tr key={r.rowNumber}>
                            <td className="p-2 align-top"><input type="checkbox" aria-label={`Import row ${r.rowNumber}: ${r.name}`} checked={selected.has(r.rowNumber)} disabled={busy || !['new', 'existing'].includes(r.outcome)}
                                onChange={e => setSelected(old => { const next = new Set(old); if (e.target.checked) next.add(r.rowNumber); else next.delete(r.rowNumber); return next; })} /></td>
                            <td className="p-2 align-top min-w-64">
                                <p className="font-semibold">Row {r.rowNumber}: {r.name}</p><p>{r.role}</p><p className="text-xs">{outcome[r.outcome]}</p>
                                {!!r.issues.length && <ul className="mt-2 list-disc pl-4 text-xs text-amber-800">{r.issues.map((v, i) => <li key={i}>{v}</li>)}</ul>}
                                {!!r.changes.length && <details className="mt-2"><summary className="cursor-pointer text-xs">Proposed changes ({r.changes.length})</summary><ul className="mt-1 space-y-1 text-xs">{r.changes.map((c, i) => <li key={i}><strong>{c.field}:</strong> {display(c.before)} → {display(c.after)}</li>)}</ul></details>}
                                {r.stage && <p className="mt-2 text-xs">Pipeline target: {r.stage.replace(/_/g, ' ')} (requires an open position matching the role).</p>}
                            </td>
                            {preview.headers.map(h => <td key={h} className="p-2 align-top min-w-32 max-w-72 break-words">{r.raw[h] ?? '—'}</td>)}
                        </tr>)}</tbody>
                    </table>
                </div>
                <div className="flex items-center gap-2 text-sm">
                    <button type="button" className={BTN_GHOST} disabled={!page} onClick={() => setPage(p => p - 1)}>Previous</button>
                    <span>Page {page + 1} of {Math.max(1, Math.ceil(preview.rows.length / 50))}</span>
                    <button type="button" className={BTN_GHOST} disabled={(page + 1) * 50 >= preview.rows.length} onClick={() => setPage(p => p + 1)}>Next</button>
                </div>
            </>}
        </div>
    </Dialog>;
}
