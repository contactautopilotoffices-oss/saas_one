'use client';

import React, { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Sparkles, Trash2 } from 'lucide-react';
import type { ApplicationField } from '@/backend/lib/candidates/outreach-settings';
import type { PositionScreening } from '@/backend/lib/candidates/screening-questions';
import { api, qs } from './api';
import { BTN_GHOST, BTN_PRIMARY, BTN_SECONDARY, Dialog, INPUT, LABEL, Spinner, Tag, useUi, WELL } from './ui';

/*
 * A position's own screening questions (owner 2026-11-25). The AI drafts as many as HR asks for from the JD; "Suggest
 * more" adds new ones without repeating. HR edits, removes or adds, then saves: nothing reaches a candidate before
 * that. The standard questions (experience, city, notice, salary) are always asked first.
 */

const TYPES: { id: ApplicationField['type']; label: string }[] = [
    { id: 'text', label: 'Short answer' }, { id: 'textarea', label: 'Paragraph' }, { id: 'number', label: 'Number' }, { id: 'select', label: 'Choice' }, { id: 'date', label: 'Date' },
];
const newId = (taken: string[]) => { let n = taken.length + 1; while (taken.includes(`q_custom_${n}`)) n += 1; return `q_custom_${n}`; };

export default function ScreeningQuestionsDialog({ orgId, positionId, positionTitle, onClose }: { orgId: string; positionId: string; positionTitle: string; onClose: () => void }) {
    const { notify } = useUi();
    const [data, setData] = useState<PositionScreening | null>(null);
    const [own, setOwn] = useState<ApplicationField[]>([]);
    const [count, setCount] = useState(8);
    const [drafting, setDrafting] = useState(false);
    const [saving, setSaving] = useState(false);
    const [dirty, setDirty] = useState(false);
    useEffect(() => {
        const ctrl = new AbortController();
        void api<PositionScreening>(`/api/candidates/positions/${encodeURIComponent(positionId)}/screening-questions${qs({ orgId })}`, { signal: ctrl.signal }).then(res => {
            if (ctrl.signal.aborted) return;
            if (!res.ok) { notify(res.error, 'error'); return; }
            setData(res.data);
            setOwn(res.data.own);
        });
        return () => ctrl.abort();
    }, [orgId, positionId, notify]);

    const total = (data?.standard.length ?? 0) + own.length;
    const room = data ? data.max - total : 0;
    const change = (next: ApplicationField[]) => { setOwn(next); setDirty(true); };
    const setField = (i: number, patch: Partial<ApplicationField>) => change(own.map((f, j) => (j === i ? { ...f, ...patch } : f)));
    const move = (i: number, by: -1 | 1) => { const next = [...own]; const [f] = next.splice(i, 1); next.splice(i + by, 0, f); change(next); };

    const suggest = async () => {
        setDrafting(true);
        const res = await api<{ questions: ApplicationField[] }>(`/api/candidates/positions/${encodeURIComponent(positionId)}/screening-questions`, { json: { orgId, count, existing: own } });
        setDrafting(false);
        if (!res.ok) { notify(res.error, 'error'); return; }
        if (!res.data.questions.length) { notify('No new questions this time. Try again, or add your own.', 'info'); return; }
        change([...own, ...res.data.questions]);
        notify(`${res.data.questions.length} question${res.data.questions.length === 1 ? '' : 's'} added. Check them before saving.`, 'success');
    };
    const save = async () => {
        const blank = own.findIndex(f => !f.label.trim());
        if (blank >= 0) { notify(`Question ${blank + 1} has no text.`, 'error'); return; }
        setSaving(true);
        const res = await api<{ own: ApplicationField[] }>(`/api/candidates/positions/${encodeURIComponent(positionId)}/screening-questions`, { method: 'PUT', json: { orgId, fields: own } });
        setSaving(false);
        if (!res.ok) { notify(res.error, 'error'); return; }
        notify(res.data.own.length ? `Saved: candidates for ${positionTitle} get these questions` : 'Saved: this position uses the standard questions', 'success');
        setDirty(false);
        onClose();
    };

    return (
        <Dialog open onClose={onClose} title={`Screening questions: ${positionTitle}`} labelId={`screening-q-${positionId}`} size="xl"
            description="The AI drafts questions from this position's job description. Edit, remove or add your own, then save. Candidates see nothing until you save."
            footer={<>
                <span className={`mr-auto text-sm ${room < 0 ? 'text-error' : 'text-text-secondary'}`}>{data ? `${total} of ${data.max} questions` : ''}</span>
                <button type="button" onClick={onClose} className={BTN_GHOST}>Cancel</button>
                <button type="button" onClick={() => void save()} disabled={saving || !data || !dirty || room < 0} className={BTN_PRIMARY}>{saving && <Spinner />}Save</button>
            </>}>
            {!data ? <div className="flex justify-center py-8"><Spinner /></div> : (
                <div className="space-y-4">
                    <section>
                        <p className={LABEL}>Always asked first (Recruitment → Outreach → Screening &amp; interviews)</p>
                        <ol className="mt-1 flex flex-wrap gap-1.5">{data.standard.map(f => <li key={f.id}><Tag tone="neutral">{f.label}</Tag></li>)}</ol>
                        {!own.length && <p className="mt-2 text-xs text-text-tertiary">With no questions of its own, this position asks the standard list: {data.fallback.filter(f => !f.target).map(f => `"${f.label}"`).join(', ') || 'nothing more'}.</p>}
                    </section>

                    <section className={`${WELL} flex flex-wrap items-end gap-2 px-3 py-3`}>
                        <label className="block"><span className={LABEL}>How many to suggest</span>
                            <input type="number" min={1} max={Math.max(1, Math.min(20, room))} value={count} onChange={e => setCount(Math.max(1, Math.min(20, Number(e.target.value) || 1)))} className={`${INPUT} mt-1 h-9 w-24`} /></label>
                        <button type="button" onClick={() => void suggest()} disabled={drafting || !data.hasJd || room <= 0} className={`${BTN_SECONDARY} h-9`} title={!data.hasJd ? 'Add the job description to the position first' : room <= 0 ? 'The list is full' : undefined}>
                            {drafting ? <Spinner /> : <Sparkles className="h-4 w-4" />}{own.length ? 'Suggest more' : 'Suggest questions from the JD'}
                        </button>
                        <p className="text-xs text-text-tertiary">{!data.hasJd ? 'This position has no job description yet: add it on the position first.' : room <= 0 ? 'The list is at the most allowed. Remove some, or raise the limit in Outreach.' : `Room for ${room} more. New suggestions never repeat what is already here.`}</p>
                    </section>

                    <ol className="space-y-2">
                        {own.map((f, i) => (
                            <li key={f.id} className={`${WELL} grid gap-2 px-3 py-3 md:grid-cols-[minmax(0,3fr)_minmax(0,1fr)_auto] md:items-end`}>
                                <label className="block"><span className={LABEL}>Question {data.standard.length + i + 1}</span><input value={f.label} onChange={e => setField(i, { label: e.target.value })} maxLength={200} className={`${INPUT} mt-1 h-9`} /></label>
                                <label className="block"><span className={LABEL}>Answer type</span>
                                    <select value={f.type} onChange={e => setField(i, { type: e.target.value as ApplicationField['type'], ...(e.target.value === 'select' && !f.options?.length ? { options: ['Yes', 'No'] } : {}) })} className={`${INPUT} mt-1 h-9`}>
                                        {TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                                    </select></label>
                                <div className="flex items-center gap-1">
                                    <label className="mr-1 inline-flex items-center gap-1.5 text-xs font-semibold text-text-secondary"><input type="checkbox" checked={f.required} onChange={e => setField(i, { required: e.target.checked })} className="h-4 w-4" />Required</label>
                                    <button type="button" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)} className={`${BTN_GHOST} h-8 w-8 px-0`}><ArrowUp className="h-4 w-4" /></button>
                                    <button type="button" aria-label="Move down" disabled={i === own.length - 1} onClick={() => move(i, 1)} className={`${BTN_GHOST} h-8 w-8 px-0`}><ArrowDown className="h-4 w-4" /></button>
                                    <button type="button" aria-label={`Remove "${f.label}"`} onClick={() => change(own.filter((_, j) => j !== i))} className={`${BTN_GHOST} h-8 w-8 px-0 text-error`}><Trash2 className="h-4 w-4" /></button>
                                </div>
                                {f.type === 'select' && <label className="block md:col-span-2"><span className={LABEL}>Options, comma-separated</span><input value={(f.options ?? []).join(', ')} onChange={e => setField(i, { options: e.target.value.split(',').map(x => x.trim()).filter(Boolean) })} className={`${INPUT} mt-1 h-9`} /></label>}
                                <label className="block md:col-span-2"><span className={LABEL}>Hint (optional)</span><input value={f.help ?? ''} onChange={e => setField(i, { help: e.target.value || undefined })} maxLength={200} className={`${INPUT} mt-1 h-9`} /></label>
                            </li>
                        ))}
                    </ol>
                    <button type="button" disabled={room <= 0} onClick={() => change([...own, { id: newId([...data.standard.map(x => x.id), ...own.map(x => x.id)]), label: '', type: 'text', required: true, target: null }])} className={BTN_SECONDARY}><Plus className="h-4 w-4" />Add a question</button>
                </div>
            )}
        </Dialog>
    );
}
