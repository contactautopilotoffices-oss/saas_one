'use client';

import React, { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Eye, EyeOff, GripVertical, MessageCircle, Plus, RotateCcw, Trash2 } from 'lucide-react';
import {
    oneLine, STAGE_COLUMN_MAX, STAGE_KIND_HINTS, STAGE_KIND_LABELS, STAGE_KINDS, STAGE_MESSAGE_MAX, STAGE_NAME_MAX, STAGE_TONES,
    type StageDef, type StageInput, type StageKind, type StageList,
} from '@/backend/lib/candidates/stage-list';
import { api, qs } from './api';
import { formatCount, formatDate } from './format';
import { setStageList, StageChip, TONE_DOT, TONE_LABELS } from './stage-ui';
import { Spinner, useUi } from './ui';
import { K_BTN, K_BTN_GHOST, K_BTN_GHOST_DANGER, K_BTN_PRIMARY, K_AREA, K_CARD, K_FIELD, K_ICON_BTN, K_LABEL, K_WELL, Loading } from './page-kit';

/*
 * Recruitment -> Configurations (owner 2026-11-19: "add a configurations tab … where you can configure the stages like
 * if u wanna add more stages or remove any"; one list for every position; everyone in HR may change it). The pipeline's
 * stages in order: the board shows one column per round in this order, each status as an area inside it. Nothing
 * changes until Save; a stage with people in it can be hidden but not deleted; every save is in the history below.
 */

type Row = Omit<StageDef, 'key'> & { uid: string; key: string | null };

let uidSeq = 0;
const uid = () => `row-${++uidSeq}`;
const toRows = (stages: StageDef[]): Row[] => stages.map(s => ({ ...s, uid: uid() }));
const sameRows = (a: Row[], b: Row[]) => JSON.stringify(a.map(({ uid: _u, ...r }) => { void _u; return r; })) === JSON.stringify(b.map(({ uid: _u, ...r }) => { void _u; return r; }));

type Group = 'flow' | 'out' | 'hidden';
const groupOf = (r: Row): Group => (r.hidden ? 'hidden' : r.kind === 'out' ? 'out' : 'flow');

export default function StagesSettings({ orgId }: { orgId: string }) {
    const { notify, reportError } = useUi();
    const [list, setList] = useState<StageList | null>(null);
    const [loadError, setLoadError] = useState('');
    const [saved, setSaved] = useState<Row[]>([]);
    const [rows, setRows] = useState<Row[]>([]);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [nonce, setNonce] = useState(0);
    const [dragUid, setDragUid] = useState<string | null>(null);
    // Owner 2026-11-20 ("this drag and drop is not working properly"): where the row would land, above or below a row.
    const [over, setOver] = useState<{ uid: string; after: boolean } | null>(null);

    useEffect(() => {
        const ctrl = new AbortController();
        void api<StageList>(`/api/candidates/stages${qs({ orgId, detail: '1' })}`, { signal: ctrl.signal }).then(res => {
            if (ctrl.signal.aborted) return;
            if (!res.ok) { if (res.noAccess) reportError(res); setLoadError(res.error); return; }
            setLoadError('');
            setList(res.data);
            const r = toRows(res.data.stages);
            setSaved(r);
            setRows(r);
            setError('');
        });
        return () => ctrl.abort();
    }, [orgId, nonce, reportError]);

    const legacy = list?.source === 'legacy';
    const dirty = !sameRows(rows, saved);
    const counts = list?.counts ?? {};
    const countOf = (r: Row) => (r.key ? counts[r.key] ?? 0 : 0);
    const columns = [...new Set(rows.filter(r => r.kind !== 'out' && !r.hidden).map(r => (r.column ?? '').trim()).filter(Boolean))];

    const patch = (id: string, change: Partial<Row>) => setRows(rs => rs.map(r => {
        if (r.uid !== id) return r;
        const next = { ...r, ...change };
        // Out of the flow has no column; back in the flow, it starts as its own column (its name) until HR picks one.
        if (change.kind && change.kind !== 'out' && !next.column?.trim()) next.column = columns[columns.length - 1] ?? next.name;
        if (change.kind === 'out') next.column = null;
        return next;
    }));
    const remove = (id: string) => setRows(rs => rs.filter(r => r.uid !== id));
    const add = () => {
        const id = uid();
        setRows(rs => {
            const lastFlow = rs.map(r => groupOf(r) === 'flow').lastIndexOf(true);
            const row: Row = { uid: id, key: null, name: 'New stage', column: columns[columns.length - 1] ?? 'New round', kind: 'progress', tone: 'amber', whatsapp: false, message: null, needsRemark: false, hidden: false };
            const next = [...rs];
            next.splice(lastFlow + 1, 0, row);
            return next;
        });
        setTimeout(() => { const el = document.getElementById(`stage-name-${id}`) as HTMLInputElement | null; el?.focus(); el?.select(); }, 0);
    };
    /** Moves a row just above or below another of the same group (drag), or one place up or down within its group (buttons). */
    const moveNextTo = (id: string, targetId: string, after: boolean) => setRows(rs => {
        const from = rs.findIndex(r => r.uid === id);
        const target = rs.find(r => r.uid === targetId);
        if (from < 0 || !target || id === targetId || groupOf(rs[from]) !== groupOf(target)) return rs;
        const next = [...rs];
        const [row] = next.splice(from, 1);
        next.splice(next.indexOf(target) + (after ? 1 : 0), 0, row);
        return next;
    });
    const draggedGroup = dragUid ? (() => { const d = rows.find(x => x.uid === dragUid); return d ? groupOf(d) : null; })() : null;
    const endDrag = () => { setDragUid(null); setOver(null); };
    const step = (id: string, by: -1 | 1) => setRows(rs => {
        const at = rs.findIndex(r => r.uid === id);
        const g = groupOf(rs[at]);
        let j = at + by;
        while (j >= 0 && j < rs.length && groupOf(rs[j]) !== g) j += by;
        if (j < 0 || j >= rs.length) return rs;
        const next = [...rs];
        [next[at], next[j]] = [next[j], next[at]];
        return next;
    });

    const save = async () => {
        if (!list || busy) return;
        setBusy(true);
        setError('');
        const stages: StageInput[] = rows.map(r => ({
            key: r.key, name: r.name, column: r.kind === 'out' ? null : r.column, kind: r.kind, tone: r.tone,
            whatsapp: r.whatsapp, message: r.message, needsRemark: r.needsRemark, hidden: r.hidden,
        }));
        const res = await api<StageList>('/api/candidates/stages', { method: 'PUT', json: { orgId, stages, version: list.version } });
        setBusy(false);
        if (!res.ok) { setError(res.error); if (res.noAccess) reportError(res); return; }
        setList(res.data);
        const r = toRows(res.data.stages);
        setSaved(r);
        setRows(r);
        setStageList(orgId, res.data);
        notify('Stages saved. Every position now uses this list.', 'success');
    };

    if (loadError) return <div className={`${K_CARD} px-5 py-5`}><p role="alert" className="text-sm text-error">{loadError}</p><button type="button" onClick={() => setNonce(n => n + 1)} className={`${K_BTN} mt-3`}>Try again</button></div>;
    if (!list) return <Loading>Loading the stages</Loading>;

    const group = (g: Group) => rows.filter(r => groupOf(r) === g);
    const renderRow = (r: Row, i: number, all: Row[]) => {
        const n = countOf(r);
        const canDelete = n === 0;
        const nameId = `stage-name-${r.uid}`;
        return (
            <li key={r.uid}
                onDragOver={e => {
                    // Only within the same group (in the flow, out of the flow, hidden): elsewhere the browser shows "not allowed".
                    if (!dragUid || draggedGroup !== groupOf(r)) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    const box = e.currentTarget.getBoundingClientRect();
                    const after = e.clientY > box.top + box.height / 2;
                    if (over?.uid !== r.uid || over.after !== after) setOver({ uid: r.uid, after });
                }}
                onDrop={e => { e.preventDefault(); if (dragUid && over) moveNextTo(dragUid, over.uid, over.after); endDrag(); }}
                className={`${K_CARD} relative px-3 py-3 ${r.hidden ? 'opacity-70' : ''} ${dragUid === r.uid ? 'opacity-40' : ''}`}>
                {over?.uid === r.uid && dragUid !== r.uid && (
                    <span aria-hidden className={`pointer-events-none absolute inset-x-3 h-1 rounded-full bg-primary ${over.after ? '-bottom-[5px]' : '-top-[5px]'}`} />
                )}
                <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
                    <span className="flex items-center gap-x-0.5">
                        <span draggable={!legacy && !busy}
                            onDragStart={e => {
                                setDragUid(r.uid);
                                e.dataTransfer.effectAllowed = 'move';
                                e.dataTransfer.setData('text/plain', r.uid);
                                // The whole row follows the pointer, not just the handle.
                                const row = e.currentTarget.closest('li');
                                if (row) e.dataTransfer.setDragImage(row, 24, 24);
                            }}
                            onDragEnd={endDrag}
                            className="flex h-9 w-7 cursor-grab items-center justify-center rounded-md text-text-tertiary hover:bg-surface-elevated hover:text-text-primary active:cursor-grabbing" title="Drag to reorder (or use the arrows)" aria-hidden><GripVertical className="h-5 w-5" /></span>
                        <button type="button" onClick={() => step(r.uid, -1)} disabled={legacy || i === 0} aria-label={`Move ${r.name} up`} className={K_ICON_BTN}><ArrowUp className="h-[18px] w-[18px]" /></button>
                        <button type="button" onClick={() => step(r.uid, 1)} disabled={legacy || i === all.length - 1} aria-label={`Move ${r.name} down`} className={K_ICON_BTN}><ArrowDown className="h-[18px] w-[18px]" /></button>
                    </span>
                    <label htmlFor={nameId} className="sr-only">Stage name</label>
                    <input id={nameId} value={r.name} onChange={e => patch(r.uid, { name: e.target.value })} maxLength={STAGE_NAME_MAX} disabled={legacy}
                        className={`${K_FIELD} min-w-[180px] flex-[2_1_200px] font-semibold`} />
                    <label htmlFor={`stage-col-${r.uid}`} className="sr-only">Board column (round)</label>
                    <input id={`stage-col-${r.uid}`} list={`stage-columns-${orgId}`} value={r.kind === 'out' ? '' : r.column ?? ''} onChange={e => patch(r.uid, { column: e.target.value })} maxLength={STAGE_COLUMN_MAX}
                        disabled={legacy || r.kind === 'out'} placeholder={r.kind === 'out' ? 'Under the board' : 'Round, e.g. L1 · Hiring Manager'} title="The board column (round) this status sits in"
                        className={`${K_FIELD} min-w-[150px] flex-[1.5_1_170px]`} />
                    <label htmlFor={`stage-kind-${r.uid}`} className="sr-only">Type</label>
                    <select id={`stage-kind-${r.uid}`} value={r.kind} onChange={e => patch(r.uid, { kind: e.target.value as StageKind })} disabled={legacy} title={STAGE_KIND_HINTS[r.kind]} aria-describedby={`stage-kind-hint-${r.uid}`} className={`${K_FIELD} w-[140px]`}>
                        {STAGE_KINDS.map(k => <option key={k} value={k}>{STAGE_KIND_LABELS[k]}</option>)}
                    </select>
                    <div role="radiogroup" aria-label={`Colour of ${r.name}`} className="flex items-center gap-x-1">
                        {STAGE_TONES.map(t => (
                            <button key={t} type="button" role="radio" aria-checked={r.tone === t} aria-label={TONE_LABELS[t]} title={TONE_LABELS[t]} disabled={legacy} onClick={() => patch(r.uid, { tone: t })}
                                className={`h-5 w-5 rounded-full ${TONE_DOT[t]} ${r.tone === t ? 'ring-2 ring-text-primary ring-offset-2 ring-offset-surface' : 'opacity-70 hover:opacity-100'}`} />
                        ))}
                    </div>
                    <span className="ml-auto flex items-center gap-x-1">
                        <span className={`min-w-[64px] text-right text-xs tabular-nums ${n ? 'font-semibold text-text-primary' : 'text-text-tertiary'}`} title="People in this stage, across every position">{formatCount(n)} {n === 1 ? 'person' : 'people'}</span>
                        {r.hidden
                            ? <button type="button" onClick={() => patch(r.uid, { hidden: false })} disabled={legacy} className={K_BTN_GHOST} title="Offer this stage again when moving people"><Eye className="h-3.5 w-3.5" />Show</button>
                            : <button type="button" onClick={() => patch(r.uid, { hidden: true })} disabled={legacy} className={K_BTN_GHOST} title="Keep its history, stop offering it when moving people"><EyeOff className="h-3.5 w-3.5" />Hide</button>}
                        <button type="button" onClick={() => remove(r.uid)} disabled={legacy || !canDelete} className={K_BTN_GHOST_DANGER}
                            title={canDelete ? 'Delete this stage' : `${n} ${n === 1 ? 'person is' : 'people are'} in this stage. Move them first, or hide it.`}><Trash2 className="h-3.5 w-3.5" />Delete</button>
                    </span>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 pl-[112px] max-sm:pl-0">
                    <label className="flex items-center gap-x-1.5 text-xs text-text-primary">
                        <input type="checkbox" checked={r.whatsapp} onChange={e => patch(r.uid, { whatsapp: e.target.checked })} disabled={legacy} className="h-4 w-4 accent-primary" />
                        <MessageCircle className="h-3.5 w-3.5 text-text-tertiary" aria-hidden />Offer a WhatsApp update when someone is moved here
                    </label>
                    <label className="flex items-center gap-x-1.5 text-xs text-text-primary">
                        <input type="checkbox" checked={r.needsRemark} onChange={e => patch(r.uid, { needsRemark: e.target.checked })} disabled={legacy} className="h-4 w-4 accent-primary" />
                        Remark needed
                    </label>
                    <span id={`stage-kind-hint-${r.uid}`} className="w-full text-xs text-text-tertiary">{STAGE_KIND_HINTS[r.kind]}</span>
                    {r.unlisted && <span className="text-xs text-text-tertiary">From the earlier list: people are still here. Move them, then delete it.</span>}
                    {r.hidden && <span className="text-xs text-text-tertiary">Hidden: not offered when moving people{n ? '; the people in it still show on the board' : ''}.</span>}
                </div>
                {r.whatsapp && (
                    <div className="mt-2 pl-[112px] max-sm:pl-0">
                        <label htmlFor={`stage-msg-${r.uid}`} className={K_LABEL}>Default WhatsApp text (HR can edit it before each send)</label>
                        <textarea id={`stage-msg-${r.uid}`} rows={2} value={r.message ?? ''} onChange={e => patch(r.uid, { message: e.target.value })} disabled={legacy}
                            placeholder="e.g. You have been shortlisted for the first interview round. Our recruiter will call you shortly."
                            className={`${K_AREA} mt-1`} />
                        <p className={`mt-0.5 text-right text-xs tabular-nums ${oneLine(r.message).length > STAGE_MESSAGE_MAX ? 'font-medium text-red-700 dark:text-red-400' : 'text-text-tertiary'}`}>{oneLine(r.message).length}/{STAGE_MESSAGE_MAX}</p>
                    </div>
                )}
            </li>
        );
    };
    const section = (g: Group, title: string, hint: string) => {
        const items = group(g);
        if (!items.length && g !== 'flow') return null;
        return (
            <section className="space-y-2" aria-label={title}>
                <p className={K_LABEL}>{title} <span className="font-normal text-text-tertiary">· {hint}</span></p>
                <ul className="space-y-2">{items.map((r, i, all) => renderRow(r, i, all))}</ul>
            </section>
        );
    };

    return (
        <div className="space-y-4">
            <section className={`${K_CARD} px-5 py-5`}>
                <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
                    <div className="min-w-0 flex-1">
                        <h2 className="text-base font-semibold text-text-primary">Pipeline stages</h2>
                        <p className="mt-1 max-w-[70ch] text-sm text-text-tertiary">One list for every position; anyone in HR can change it. The board shows one column per round in the order below, with each status as an area inside its column. New people start at the first stage.</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
                        {dirty ? <span className="inline-flex h-6 items-center gap-1.5 rounded-full bg-amber-50 px-2.5 text-xs font-semibold text-amber-800 ring-1 ring-inset ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/30"><span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden />Unsaved changes</span> : <span className="text-xs text-text-tertiary">{list.source === 'default' ? 'The built-in list (not changed yet)' : 'All changes saved'}</span>}
                        <button type="button" onClick={() => { setRows(saved); setError(''); }} disabled={!dirty || busy} className={K_BTN}><RotateCcw className="h-4 w-4" />Discard</button>
                        <button type="button" onClick={() => void save()} disabled={!dirty || busy || legacy} className={K_BTN_PRIMARY}>{busy && <Spinner />}Save changes</button>
                    </div>
                </div>
                {legacy && <p role="status" className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-inset ring-amber-200 dark:bg-amber-500/15 dark:text-amber-200 dark:ring-amber-500/30">Editing the stages needs a database update first: run <span className="font-mono text-xs">20261119000001_recruitment_stages.sql</span> in Supabase. Until then the pipeline keeps the earlier ten stages.</p>}
                {error && <p role="alert" className="mt-3 text-sm font-medium text-error">{error}</p>}
            </section>

            <datalist id={`stage-columns-${orgId}`}>{columns.map(c => <option key={c} value={c} />)}</datalist>

            {/* What the board will look like: the rounds in order */}
            <div className={`${K_WELL} flex flex-wrap items-center gap-x-1.5 gap-y-1.5 px-3 py-2.5`} aria-label="Board columns, in order">
                <span className="mr-1 text-xs font-semibold text-text-secondary">Board:</span>
                {columns.map((c, i) => <span key={c} className="text-xs font-semibold text-text-primary">{c}{i < columns.length - 1 ? <span className="px-1 font-normal text-text-tertiary">→</span> : null}</span>)}
            </div>

            {section('flow', 'In the flow', 'the board, left to right; a round with several statuses shows them in this order')}
            <div><button type="button" onClick={add} disabled={legacy || busy} className={K_BTN}><Plus className="h-4 w-4" />Add stage</button></div>
            {section('out', 'Out of the flow', 'the strip under the board')}
            {section('hidden', 'Hidden', 'kept for history, not offered when moving people')}

            <section className={`${K_CARD} px-5 py-5`} aria-label="Changes to the stages">
                <p className={K_LABEL}>Recent changes <span className="font-normal text-text-tertiary">· the stages, and the hiring request settings made in the Tech dashboard</span></p>
                {list.changes?.length ? (
                    <ul className="mt-2 space-y-1.5">
                        {list.changes.map((c, i) => <li key={i} className="text-sm text-text-primary"><span className="text-text-secondary">{formatDate(c.at)}{c.byName ? ` · ${c.byName}` : ''}:</span> {c.summary}</li>)}
                    </ul>
                ) : <p className="mt-1.5 text-sm text-text-tertiary">No changes yet.</p>}
                <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-tertiary">Colours: {STAGE_TONES.slice(0, 3).map(t => <StageChip key={t} stage={{ name: t === 'amber' ? 'Pending' : t === 'green' ? 'Select' : 'Reject', tone: t }} />)} are a guide; any stage can have any colour.</p>
            </section>
        </div>
    );
}
