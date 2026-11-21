'use client';

import React, { useEffect, useState } from 'react';
import { CircleAlert, CircleCheck, ExternalLink, Link2, Pause, Pencil, Play, Plus, RefreshCw, Unlink } from 'lucide-react';
import { stageGroups } from '@/backend/lib/candidates/stage-list';
import {
    TRACKER_FIELD_LABELS, TRACKER_FIELDS, TRACKER_SYNC_EVERY, TRACKER_SYNC_LABELS,
    type TrackerConnection, type TrackerField, type TrackerPreview, type TrackerSyncEvery, type TrackerSyncSummary,
} from '@/backend/lib/candidates/types';
import { api, qs } from './api';
import { formatDateTime } from './format';
import { StageOptions, useStages } from './stage-ui';
import { BTN_DANGER_GHOST, BTN_GHOST, BTN_PRIMARY, BTN_SECONDARY, CARD, Dialog, INPUT, LABEL, Spinner, Tag, useUi, WELL } from './ui';

/*
 * Connected trackers (owner 2026-11-21; HRMS meeting item 5, "standard tracker Excel sheet integration … it must be
 * fully configurable for the sheet/excel selection"). HR pastes a Google Sheet or Excel (OneDrive / SharePoint) share
 * link, picks the tab, matches the columns to the candidate fields and the status values to the pipeline stages, and
 * chooses how often it syncs. One way: the sheet into the app; nothing is written to the sheet. The sheet must be shared
 * "Anyone with the link can view". Rows land in a sheet of the same name below (Merge), so nothing is deleted.
 */

const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();

function summaryLine(s: TrackerSyncSummary | null): string {
    if (!s) return '';
    if (!s.rowsChanged) return `${s.rowsRead} rows read · nothing changed`;
    return [
        `${s.rowsChanged} of ${s.rowsRead} rows new or changed`,
        s.recordsAdded ? `${s.recordsAdded} added` : null,
        s.recordsUpdated ? `${s.recordsUpdated} updated` : null,
        s.stageMoves ? `${s.stageMoves} moved on the pipeline` : null,
        s.stagePending ? `${s.stagePending} moves wait for the next sync` : null,
        s.alreadyInDatabase ? `${s.alreadyInDatabase} already in the database (flagged)` : null,
    ].filter(Boolean).join(' · ');
}

export default function TrackerConnections({ orgId, onDataChanged }: { orgId: string; onDataChanged: () => void }) {
    const { notify, reportError } = useUi();
    const [trackers, setTrackers] = useState<TrackerConnection[] | null>(null);
    const [loadError, setLoadError] = useState('');
    const [nonce, setNonce] = useState(0);
    const [form, setForm] = useState<{ open: boolean; tracker: TrackerConnection | null }>({ open: false, tracker: null });
    const [busy, setBusy] = useState<string | null>(null);
    const [confirmDisconnect, setConfirmDisconnect] = useState<string | null>(null);

    useEffect(() => {
        const ctrl = new AbortController();
        void api<{ trackers: TrackerConnection[] }>(`/api/candidates/trackers${qs({ orgId })}`, { signal: ctrl.signal }).then(res => {
            if (ctrl.signal.aborted) return;
            if (!res.ok) { setLoadError(res.error); setTrackers([]); return; }
            setLoadError('');
            setTrackers(res.data.trackers);
        });
        return () => ctrl.abort();
    }, [orgId, nonce]);
    const refresh = () => setNonce(n => n + 1);

    const sync = async (t: TrackerConnection) => {
        setBusy(t.id);
        const res = await api<{ summary: TrackerSyncSummary }>(`/api/candidates/trackers/${encodeURIComponent(t.id)}/sync`, { json: { orgId } });
        setBusy(null);
        refresh();
        if (!res.ok) { notify(res.error, 'error'); if (res.noAccess) reportError(res); return; }
        notify(`${t.name}: ${summaryLine(res.data.summary)}`, 'success');
        if (res.data.summary.rowsChanged) onDataChanged();
    };
    const setActive = async (t: TrackerConnection, active: boolean) => {
        setBusy(t.id);
        const res = await api(`/api/candidates/trackers/${encodeURIComponent(t.id)}`, { method: 'PATCH', json: { orgId, active } });
        setBusy(null);
        if (!res.ok) { notify(res.error, 'error'); return; }
        refresh();
    };
    const disconnect = async (t: TrackerConnection) => {
        setBusy(t.id);
        const res = await api(`/api/candidates/trackers/${encodeURIComponent(t.id)}${qs({ orgId })}`, { method: 'DELETE' });
        setBusy(null);
        setConfirmDisconnect(null);
        if (!res.ok) { notify(res.error, 'error'); return; }
        notify(`${t.name} disconnected. Everything it brought in stays.`, 'success');
        refresh();
    };

    return (
        <section className="space-y-3" aria-labelledby="trackers-heading">
            <TrackerForm orgId={orgId} open={form.open} tracker={form.tracker} onClose={() => setForm(f => ({ ...f, open: false }))}
                onSaved={t => { setForm({ open: false, tracker: null }); refresh(); notify(`${t.name} saved. Press Sync now to bring the rows in, or wait for the next sync.`, 'success'); }} />
            <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-2">
                <div>
                    <h2 id="trackers-heading" className="font-display text-base font-semibold text-text-primary">Connected trackers</h2>
                    <p className="text-xs text-text-secondary">A Google Sheet or Excel tracker, synced into the app on a schedule. One way: nothing is written to your sheet.</p>
                </div>
                <button type="button" onClick={() => setForm({ open: true, tracker: null })} className={BTN_SECONDARY}><Plus className="h-4 w-4" />Connect a tracker</button>
            </div>
            {loadError && <p role="alert" className="text-sm text-error">{loadError}</p>}
            {trackers === null ? <p className="flex items-center gap-x-2 text-sm text-text-tertiary"><Spinner className="h-3.5 w-3.5" />Loading</p>
                : trackers.length === 0 ? !loadError && <p className={`${WELL} px-4 py-3 text-sm text-text-secondary`}>No tracker connected yet. Connect one to stop uploading the same sheet every day.</p>
                : (
                    <ul className="space-y-2">
                        {trackers.map(t => (
                            <li key={t.id} className={`${CARD} flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-5`}>
                                <span className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-elevated text-primary-dark sm:inline-flex" aria-hidden><Link2 className="h-4 w-4" /></span>
                                <div className="min-w-0 flex-1 basis-64">
                                    <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                        <span className="font-display text-[15px] font-semibold text-text-primary">{t.name}</span>
                                        <Tag tone={!t.active ? 'neutral' : t.lastOk === false ? 'warn' : 'info'}>{!t.active ? 'Paused' : TRACKER_SYNC_LABELS[t.syncEvery]}</Tag>
                                        <a href={t.sourceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-x-1 text-xs text-text-secondary underline-offset-2 hover:underline">
                                            {t.sourceKind === 'google_sheet' ? 'Google Sheet' : 'Excel'} · {t.tabName}<ExternalLink className="h-3 w-3" aria-hidden />
                                        </a>
                                    </p>
                                    {t.syncing ? <p className="mt-0.5 flex items-center gap-x-1.5 text-xs text-text-secondary"><Spinner className="h-3 w-3" />Syncing…</p>
                                        : t.lastOk === false ? <p className="mt-0.5 flex items-start gap-x-1.5 text-xs text-red-800"><CircleAlert className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />Last sync failed{t.lastSyncedAt ? ` (${formatDateTime(t.lastSyncedAt)})` : ''}: {t.lastError}</p>
                                        : t.lastSyncedAt ? <p className="mt-0.5 flex items-start gap-x-1.5 text-xs text-text-secondary"><CircleCheck className="mt-px h-3.5 w-3.5 shrink-0 text-emerald-700" aria-hidden />Synced {formatDateTime(t.lastSyncedAt)} · {summaryLine(t.lastSummary)}</p>
                                        : <p className="mt-0.5 text-xs text-text-tertiary">Not synced yet.</p>}
                                    {(t.lastSummary?.duplicateRows ?? 0) > 0 && (
                                        <details className="mt-0.5 text-xs text-amber-800">
                                            <summary className="cursor-pointer">{t.lastSummary!.duplicateRows} duplicate row{t.lastSummary!.duplicateRows === 1 ? '' : 's'} in the tracker (same person and role): the last row is used and flagged for review under Sheets</summary>
                                            <ul className="ml-4 list-disc">{(t.lastSummary!.duplicates ?? []).map((d, i) => <li key={i}>{d}</li>)}</ul>
                                        </details>
                                    )}
                                    {(t.lastSummary?.rolesWithoutPosition.length ?? 0) > 0 && <p className="mt-0.5 text-xs text-amber-800">No open position for: {t.lastSummary!.rolesWithoutPosition.join(', ')}. Their statuses move nobody until a position with that title is open.</p>}
                                    {(t.lastSummary?.notes.length ?? 0) > 0 && <details className="mt-0.5 text-xs text-text-secondary"><summary className="cursor-pointer">Notes from the last sync</summary><ul className="ml-4 list-disc">{t.lastSummary!.notes.map((n, i) => <li key={i}>{n}</li>)}</ul></details>}
                                </div>
                                <div className="flex shrink-0 flex-wrap items-center gap-1">
                                    {confirmDisconnect === t.id ? (
                                        <>
                                            <span className="text-xs text-text-secondary">Stop syncing? What it brought in stays.</span>
                                            <button type="button" onClick={() => setConfirmDisconnect(null)} className={BTN_GHOST}>Keep</button>
                                            <button type="button" onClick={() => void disconnect(t)} disabled={busy === t.id} className={BTN_DANGER_GHOST}>Disconnect</button>
                                        </>
                                    ) : (
                                        <>
                                            <button type="button" onClick={() => void sync(t)} disabled={busy === t.id || t.syncing} className={BTN_PRIMARY}>{busy === t.id ? <Spinner /> : <RefreshCw className="h-4 w-4" />}Sync now</button>
                                            <button type="button" onClick={() => setForm({ open: true, tracker: t })} disabled={busy === t.id} className={BTN_GHOST} title="Edit the connection"><Pencil className="h-4 w-4" />Edit</button>
                                            <button type="button" onClick={() => void setActive(t, !t.active)} disabled={busy === t.id} className={BTN_GHOST} title={t.active ? 'Stop the automatic sync' : 'Start the automatic sync again'}>{t.active ? <><Pause className="h-4 w-4" />Pause</> : <><Play className="h-4 w-4" />Resume</>}</button>
                                            <button type="button" onClick={() => setConfirmDisconnect(t.id)} disabled={busy === t.id} className={BTN_GHOST} title="Disconnect"><Unlink className="h-4 w-4" /></button>
                                        </>
                                    )}
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
        </section>
    );
}

/** Connect or edit: the link, the tab, the header row, the column matching, the status matching, how often, the name. */
function TrackerForm({ orgId, open, tracker, onClose, onSaved }: { orgId: string; open: boolean; tracker: TrackerConnection | null; onClose: () => void; onSaved: (t: TrackerConnection) => void }) {
    const { notify } = useUi();
    const stages = useStages(orgId)?.stages ?? [];
    const groups = stageGroups(stages.filter(s => !s.hidden));
    const [url, setUrl] = useState('');
    const [preview, setPreview] = useState<TrackerPreview | null>(null);
    const [reading, setReading] = useState(false);
    const [readError, setReadError] = useState('');
    const [name, setName] = useState('');
    const [columnMap, setColumnMap] = useState<Record<string, TrackerField | null>>({});
    const [statusColumn, setStatusColumn] = useState('');
    const [statusMap, setStatusMap] = useState<Record<string, string>>({});
    const [syncEvery, setSyncEvery] = useState<TrackerSyncEvery>('hourly');
    const [saving, setSaving] = useState(false);
    const [seenOpen, setSeenOpen] = useState(false);

    const read = async (link: string, tab?: string, headerRow?: number, keep?: TrackerConnection | null) => {
        setReading(true);
        setReadError('');
        const res = await api<{ preview: TrackerPreview }>('/api/candidates/trackers/preview', { json: { orgId, url: link, tab, headerRow } });
        setReading(false);
        if (!res.ok) { setReadError(res.error); return; }
        const p = res.data.preview;
        setPreview(p);
        // Editing: keep the saved matching where the columns still exist; else the app's guesses.
        const saved = keep && keep.tabName === p.tab ? keep : null;
        setColumnMap(Object.fromEntries(p.headers.map(h => [h, saved ? (saved.columnMap[h] ?? null) : p.guess[h] ?? null])));
        const col = saved ? saved.statusColumn ?? '' : p.statusColumnGuess ?? '';
        setStatusColumn(col);
        setStatusMap(saved ? { ...saved.statusMap } : guessStatuses(p.distinct[col] ?? []));
        setName(n => n || (keep ? keep.name : p.tab));
    };
    // A value matching a stage's name (ignoring case) is matched to it; the rest are left for HR.
    const guessStatuses = (values: string[]) => {
        const out: Record<string, string> = {};
        for (const v of values) {
            const stage = stages.find(s => !s.hidden && (norm(s.name) === norm(v) || s.key === norm(v).replace(/[^a-z0-9]+/g, '_')));
            if (stage) out[norm(v)] = stage.key;
        }
        return out;
    };

    if (open !== seenOpen) {
        setSeenOpen(open);
        if (open) {
            setPreview(null); setReadError(''); setSaving(false);
            setUrl(tracker?.sourceUrl ?? ''); setName(tracker?.name ?? ''); setSyncEvery(tracker?.syncEvery ?? 'hourly');
            setColumnMap(tracker?.columnMap ?? {}); setStatusColumn(tracker?.statusColumn ?? ''); setStatusMap(tracker?.statusMap ?? {});
            if (tracker) void read(tracker.sourceUrl, tracker.tabName, tracker.headerRow, tracker);
        }
    }

    const fields = Object.values(columnMap).filter(Boolean) as TrackerField[];
    const statusValues = statusColumn && preview ? preview.distinct[statusColumn] ?? [] : [];
    const canSave = !!preview && !!name.trim() && fields.includes('fullName') && !saving;

    const save = async () => {
        if (!preview || !canSave) return;
        setSaving(true);
        const body = { orgId, name: name.trim(), url, tab: preview.tab, headerRow: preview.headerRow, columnMap, statusColumn: statusColumn || null, statusMap, syncEvery };
        const res = tracker
            ? await api<{ tracker: TrackerConnection }>(`/api/candidates/trackers/${encodeURIComponent(tracker.id)}`, { method: 'PATCH', json: body })
            : await api<{ tracker: TrackerConnection }>('/api/candidates/trackers', { json: body });
        setSaving(false);
        if (!res.ok) { notify(res.error, 'error'); return; }
        onSaved(res.data.tracker);
    };

    return (
        <Dialog open={open} onClose={() => { if (!saving) onClose(); }} labelId="tracker-form-title" size="xl"
            title={tracker ? `Edit ${tracker.name}` : 'Connect a tracker'}
            description={<>Paste the share link of a Google Sheet or an Excel file (OneDrive or SharePoint). Share it as <span className="font-semibold">“Anyone with the link can view”</span> first. Nothing is ever written to your sheet.</>}
            footer={<>
                <button type="button" onClick={onClose} disabled={saving} className={BTN_GHOST}>Cancel</button>
                <button type="button" onClick={() => void save()} disabled={!canSave} className={BTN_PRIMARY} title={!fields.includes('fullName') ? 'Match a column to Candidate name' : undefined}>{saving && <Spinner />}{tracker ? 'Save' : 'Connect'}</button>
            </>}>
            <div className="space-y-5">
                <div>
                    <label htmlFor="tracker-url" className={LABEL}>Share link</label>
                    <div className="mt-1.5 flex flex-wrap gap-2">
                        <input id="tracker-url" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/…" className={`${INPUT} min-w-[240px] flex-1`} />
                        <button type="button" onClick={() => void read(url.trim(), undefined, undefined, null)} disabled={!url.trim() || reading} className={BTN_SECONDARY}>{reading ? <Spinner /> : <RefreshCw className="h-4 w-4" />}{preview ? 'Read again' : 'Read the sheet'}</button>
                    </div>
                    {readError && <p role="alert" className="mt-1.5 text-sm text-error">{readError}</p>}
                </div>

                {preview && (
                    <>
                        <section className="grid gap-4 sm:grid-cols-3">
                            <div>
                                <label htmlFor="tracker-tab" className={LABEL}>Tab</label>
                                <select id="tracker-tab" value={preview.tab} onChange={e => void read(url.trim(), e.target.value, undefined, tracker)} disabled={reading} className={`${INPUT} mt-1.5`}>
                                    {preview.tabs.map(t => <option key={t} value={t}>{t}</option>)}
                                </select>
                            </div>
                            <div>
                                <label htmlFor="tracker-header" className={LABEL}>Header row <span className="text-text-tertiary">· where the column names are</span></label>
                                <input id="tracker-header" type="number" min={1} max={50} defaultValue={preview.headerRow} key={`${preview.tab}-${preview.headerRow}`}
                                    onBlur={e => { const n = Number(e.target.value); if (Number.isInteger(n) && n >= 1 && n !== preview.headerRow) void read(url.trim(), preview.tab, n, tracker); }} className={`${INPUT} mt-1.5`} />
                            </div>
                            <div>
                                <label htmlFor="tracker-every" className={LABEL}>Sync</label>
                                <select id="tracker-every" value={syncEvery} onChange={e => setSyncEvery(e.target.value as TrackerSyncEvery)} className={`${INPUT} mt-1.5`}>
                                    {TRACKER_SYNC_EVERY.map(s => <option key={s} value={s}>{TRACKER_SYNC_LABELS[s]}</option>)}
                                </select>
                            </div>
                        </section>
                        <p className="text-xs text-text-secondary">{preview.rowCount.toLocaleString('en-IN')} rows in this tab.{preview.blocks > 1 ? ` The column names start again ${preview.blocks - 1} more time${preview.blocks > 2 ? 's' : ''} lower down; each part is read with its own columns, and every column name is listed below.` : ''}</p>

                        <section aria-label="Match the columns">
                            <p className="text-sm font-semibold text-text-primary">Match the columns</p>
                            <p className="text-xs text-text-secondary">The app guessed from the column names; correct anything wrong. Columns set to “Don’t import” are kept with the row for reference. Two names for one field (e.g. “Organization” and “Organisation” in different parts) are fine.</p>
                            <div className="mt-2 max-h-[340px] overflow-y-auto rounded-xl ring-1 ring-inset ring-border-subtle">
                                <table className="w-full text-sm">
                                    <thead className="sticky top-0 bg-surface-elevated text-left text-xs text-text-secondary">
                                        <tr><th className="px-3 py-2 font-medium">Column in the sheet</th><th className="px-3 py-2 font-medium">Example</th><th className="px-3 py-2 font-medium">Goes into</th></tr>
                                    </thead>
                                    <tbody className="divide-y divide-border-subtle">
                                        {preview.headers.map((h, c) => (
                                            <tr key={`${h}-${c}`}>
                                                <td className="px-3 py-1.5 font-medium text-text-primary">{h}</td>
                                                <td className="max-w-[220px] truncate px-3 py-1.5 text-text-secondary" title={preview.examples[h] ?? ''}>{preview.examples[h] ?? '—'}</td>
                                                <td className="px-3 py-1.5">
                                                    <label className="sr-only" htmlFor={`tracker-col-${c}`}>Field for {h}</label>
                                                    <select id={`tracker-col-${c}`} value={columnMap[h] ?? ''} onChange={e => setColumnMap(m => ({ ...m, [h]: (e.target.value || null) as TrackerField | null }))} className={`${INPUT} h-8 px-2 text-sm`}>
                                                        <option value="">Don’t import</option>
                                                        {TRACKER_FIELDS.map(f => <option key={f} value={f}>{TRACKER_FIELD_LABELS[f]}</option>)}
                                                    </select>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </section>

                        <section aria-label="Statuses onto the pipeline" className={`${WELL} px-4 py-4`}>
                            <p className="text-sm font-semibold text-text-primary">Statuses onto the pipeline <span className="font-normal text-text-tertiary">(optional)</span></p>
                            <p className="text-xs text-text-secondary">Pick the column with the candidate’s status, then which stage each status means. When a row’s status changes in the sheet, the person moves to that stage in the open position whose title matches the row’s role. Statuses left on “Don’t move” move nobody.</p>
                            <label htmlFor="tracker-status-col" className={`${LABEL} mt-3 block`}>Status column</label>
                            <select id="tracker-status-col" value={statusColumn} onChange={e => { setStatusColumn(e.target.value); setStatusMap(guessStatuses(preview.distinct[e.target.value] ?? [])); }} className={`${INPUT} mt-1.5 sm:max-w-sm`}>
                                <option value="">None: don’t move anyone</option>
                                {preview.headers.filter(h => preview.distinct[h]).map(h => <option key={h} value={h}>{h}</option>)}
                            </select>
                            {statusColumn && (statusValues.length === 0 ? <p className="mt-2 text-xs text-text-tertiary">This column has no values yet.</p> : (
                                <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                                    {statusValues.map(v => (
                                        <li key={v} className="flex items-center gap-x-2">
                                            <span className="min-w-0 flex-1 truncate text-sm text-text-primary" title={v}>{v}</span>
                                            <label className="sr-only" htmlFor={`tracker-st-${norm(v)}`}>Stage for {v}</label>
                                            <select id={`tracker-st-${norm(v)}`} value={statusMap[norm(v)] ?? ''} onChange={e => setStatusMap(m => { const next = { ...m }; if (e.target.value) next[norm(v)] = e.target.value; else delete next[norm(v)]; return next; })}
                                                className={`${INPUT} h-8 w-48 px-2 text-sm`}>
                                                <option value="">Don’t move</option>
                                                <StageOptions groups={groups} />
                                            </select>
                                        </li>
                                    ))}
                                </ul>
                            ))}
                        </section>

                        <div>
                            <label htmlFor="tracker-name" className={LABEL}>Name <span className="text-text-tertiary">· also the name of the sheet its rows go into, under Sheets</span></label>
                            <input id="tracker-name" value={name} onChange={e => setName(e.target.value)} maxLength={120} className={`${INPUT} mt-1.5 sm:max-w-md`} />
                        </div>
                    </>
                )}
            </div>
        </Dialog>
    );
}
