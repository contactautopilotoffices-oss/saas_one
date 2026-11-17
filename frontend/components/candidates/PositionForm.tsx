'use client';

import React, { useRef, useState } from 'react';
import { FileUp, Plus, Sparkles, X } from 'lucide-react';
import type { SearchFilters } from '@/backend/lib/candidates/filters';
import { draftFromPosition, emptyDraft, filtersFromDraft, preferFromDraft } from '@/backend/lib/candidates/position-draft';
import type { Preferences } from '@/backend/lib/candidates/query-spec';
import {
    EMPLOYMENT_TYPE_LABELS, EMPLOYMENT_TYPES, POSITION_PRIORITIES, PRIORITY_LABELS,
    type EmploymentType, type Position, type PositionDraft, type PositionPriority, type PositionReadResponse,
} from '@/backend/lib/candidates/types';
import { api } from './api';
import { BTN_GHOST, BTN_PRIMARY, BTN_SECONDARY, Dialog, INPUT, LABEL, Spinner, useUi, WELL } from './ui';

/*
 * Create / Edit position (owner 2026-11-16: "a job record, not only a saved search; no approvals for now"). The form
 * in four parts: the job description (paste or upload, then "Fill in from the JD"), the basics, the requirements,
 * and the summary. Everything the AI fills is editable; the search the position runs with is built from the
 * requirements on save (position-draft.ts), so Search, Rank with AI and the call reading all use the same must-haves.
 */

/** What Search hands over when it saves the current search as a position. */
export interface PositionSeed {
    title?: string;
    location?: string;
    jdText?: string;
    jdFileName?: string;
    filters?: SearchFilters;
    prefer?: Preferences;
}

const JD_FILE_TYPES = '.pdf,.docx,.txt,.md';
const SPLIT = /\s*\/\s*/;

/** The draft as the form edits it: lists as text, numbers as strings, so typing never fights the state. */
interface FormState {
    title: string; department: string; designation: string; location: string;
    employmentType: '' | EmploymentType; openings: string; hiringManager: string; priority: PositionPriority; targetDays: string;
    education: string; budgetMin: string; budgetMax: string; summary: string;
    expMin: string; expMax: string; noticeMax: string;
    /** One line per must-have: "MEP / HVAC / VRF". */
    mustHaves: string[];
    /** Comma-separated. */
    niceToHaves: string; tools: string;
    prefer: Preferences; jdText: string; jdFileName: string | null;
}

const str = (v: string | number | null | undefined) => (v === null || v === undefined ? '' : String(v));
const num = (s: string): number | null => { const t = s.trim(); if (!t) return null; const n = Number(t); return Number.isFinite(n) ? n : null; };
const list = (s: string): string[] => s.split(/[,\n]/).map(t => t.trim()).filter(Boolean);

function toForm(d: PositionDraft): FormState {
    return {
        title: d.title, department: str(d.department), designation: str(d.designation), location: str(d.location),
        employmentType: d.employmentType ?? '', openings: str(d.openings ?? 1), hiringManager: str(d.hiringManager), priority: d.priority, targetDays: str(d.targetDays ?? 21),
        education: str(d.education), budgetMin: str(d.budgetMinInhand), budgetMax: str(d.budgetMaxInhand), summary: str(d.summary),
        expMin: str(d.expMinYears), expMax: str(d.expMaxYears), noticeMax: str(d.noticeMaxDays),
        mustHaves: d.mustHaves.map(g => [g.text, ...g.alts].join(' / ')),
        niceToHaves: d.niceToHaves.join(', '), tools: d.tools.join(', '),
        prefer: d.prefer, jdText: d.jdText, jdFileName: d.jdFileName,
    };
}

function toDraft(f: FormState): PositionDraft {
    return {
        title: f.title.trim(), department: f.department.trim() || null, designation: f.designation.trim() || null, location: f.location.trim() || null,
        employmentType: f.employmentType || null, openings: num(f.openings), hiringManager: f.hiringManager.trim() || null, priority: f.priority, targetDays: num(f.targetDays),
        education: f.education.trim() || null, budgetMinInhand: num(f.budgetMin), budgetMaxInhand: num(f.budgetMax), summary: f.summary.trim() || null,
        expMinYears: num(f.expMin), expMaxYears: num(f.expMax), noticeMaxDays: num(f.noticeMax),
        mustHaves: f.mustHaves.map(line => line.split(SPLIT).map(t => t.trim()).filter(Boolean)).filter(g => g.length).map(([text, ...alts]) => ({ text, alts })),
        niceToHaves: list(f.niceToHaves), tools: list(f.tools),
        prefer: f.prefer, jdText: f.jdText, jdFileName: f.jdFileName,
    };
}

/** A seed from Search: the current search's filters read back as requirements. */
function fromSeed(seed: PositionSeed | undefined): FormState {
    const base = emptyDraft();
    if (!seed) return toForm(base);
    const keywords = seed.filters?.keywords ?? [];
    return toForm({
        ...base,
        title: seed.title ?? '',
        location: seed.location ?? seed.filters?.locations?.[0] ?? null,
        expMinYears: seed.filters?.expMin ?? null,
        expMaxYears: seed.filters?.expMax ?? null,
        budgetMaxInhand: seed.filters?.salaryUnit === 'month' && seed.filters.salaryMax ? seed.filters.salaryMax * 1000 : null,
        mustHaves: keywords.filter(k => k.required).map(k => ({ text: k.text, alts: k.alts ?? [] })),
        niceToHaves: keywords.filter(k => !k.required).map(k => k.text),
        prefer: seed.prefer ?? {},
        jdText: seed.jdText ?? '',
        jdFileName: seed.jdFileName ?? null,
    });
}

const field = (label: string, id: string, input: React.ReactNode, hint?: string) => (
    <div className="min-w-0">
        <label htmlFor={id} className={LABEL}>{label}{hint ? <span className="text-text-tertiary"> · {hint}</span> : null}</label>
        <div className="mt-1.5">{input}</div>
    </div>
);

export default function PositionForm({ open, orgId, seed, position, draft, onClose, onSaved }: {
    open: boolean; orgId: string;
    /** New position, from Search ("Save as a position"): the search as it stands. */
    seed?: PositionSeed;
    /** Edit this position (with its jdText). Wins over `seed` and `draft`. */
    position?: Position | null;
    /** New position from a JD already read by PositionsView: every field the readers filled. Wins over `seed`. */
    draft?: PositionDraft | null;
    onClose: () => void; onSaved: (position: Position) => void;
}) {
    const { notify, reportError } = useUi();
    const initial = () => (position ? toForm(draftFromPosition(position)) : draft ? toForm(draft) : fromSeed(seed));
    const [f, setF] = useState<FormState>(initial);
    const [busy, setBusy] = useState(false);
    const [reading, setReading] = useState(false);
    const [jdOpen, setJdOpen] = useState(false);
    const [notice, setNotice] = useState('');
    const fileRef = useRef<HTMLInputElement | null>(null);
    // A fresh form each time it opens (the render-time reset the other dialogs in this folder use).
    const [seenOpen, setSeenOpen] = useState(open);
    if (open !== seenOpen) {
        setSeenOpen(open);
        if (open) { setF(initial()); setNotice(draft ? 'Filled in from the JD. Check every field before saving.' : ''); setJdOpen(!position && !draft && !seed?.jdText); }
    }
    const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setF(s => ({ ...s, [key]: value }));
    const editing = !!position;

    /** The AI fills the form from the JD; a field it did not find keeps what is typed. */
    const fillFrom = async (job: string | File) => {
        setReading(true);
        let res;
        if (typeof job === 'string') res = await api<PositionReadResponse>('/api/candidates/positions/read', { json: { orgId, text: job } });
        else { const form = new FormData(); form.set('orgId', orgId); form.set('file', job, job.name); res = await api<PositionReadResponse>('/api/candidates/positions/read', { form }); }
        setReading(false);
        if (fileRef.current) fileRef.current.value = '';
        if (!res.ok) { notify(res.error, 'error'); if (res.noAccess) reportError(res); return; }
        const d = res.data.draft;
        const filled = toForm(d);
        setF(s => ({
            ...s,
            title: filled.title || s.title, department: filled.department || s.department, designation: filled.designation || s.designation, location: filled.location || s.location,
            employmentType: filled.employmentType || s.employmentType, openings: d.openings ? filled.openings : s.openings,
            education: filled.education || s.education, budgetMin: filled.budgetMin || s.budgetMin, budgetMax: filled.budgetMax || s.budgetMax, summary: filled.summary || s.summary,
            expMin: filled.expMin || s.expMin, expMax: filled.expMax || s.expMax, noticeMax: filled.noticeMax || s.noticeMax,
            mustHaves: filled.mustHaves.length ? filled.mustHaves : s.mustHaves, niceToHaves: filled.niceToHaves || s.niceToHaves, tools: filled.tools || s.tools,
            prefer: d.prefer, jdText: d.jdText, jdFileName: d.jdFileName ?? s.jdFileName,
        }));
        setNotice(res.data.notices[0] ?? (res.data.aiParsed ? 'Filled in from the JD. Check every field before saving.' : ''));
        setJdOpen(false);
        if (res.data.aiParsed) notify('Filled in from the JD. Check every field.', 'success');
    };

    const save = async () => {
        if (!f.title.trim() || busy) return;
        const d = toDraft(f);
        if (d.budgetMinInhand !== null && d.budgetMaxInhand !== null && d.budgetMinInhand > d.budgetMaxInhand) { notify("The budget's minimum is above its maximum.", 'error'); return; }
        if (d.expMinYears !== null && d.expMaxYears !== null && d.expMinYears > d.expMaxYears) { notify('The experience minimum is above its maximum.', 'error'); return; }
        setBusy(true);
        const body = {
            orgId, title: d.title, department: d.department, location: d.location, designation: d.designation, employmentType: d.employmentType,
            openings: d.openings ?? 1, hiringManager: d.hiringManager, priority: d.priority, targetDays: d.targetDays ?? 21,
            education: d.education, budgetMinInhand: d.budgetMinInhand, budgetMaxInhand: d.budgetMaxInhand, summary: d.summary,
            jdText: d.jdText || undefined, jdFileName: d.jdFileName, filters: filtersFromDraft(d), prefer: preferFromDraft(d),
        };
        const res = editing
            ? await api<{ position: Position }>(`/api/candidates/positions/${encodeURIComponent(position.id)}`, { method: 'PATCH', json: body })
            : await api<{ position: Position }>('/api/candidates/positions', { json: body });
        setBusy(false);
        if (!res.ok) { notify(res.error, 'error'); if (res.noAccess) reportError(res); return; }
        notify(editing ? `Position updated: ${res.data.position.title}` : `Position saved: ${res.data.position.title}`, 'success');
        onSaved(res.data.position);
    };

    const mustCount = f.mustHaves.filter(l => l.trim()).length;
    return (
        <Dialog
            open={open} onClose={() => { if (!busy) onClose(); }} labelId="cand-position-title" size="xl"
            title={editing ? `Edit position · ${position.title}` : 'New position'}
            description={editing ? 'Change what you need; the search this position runs with is rebuilt from the requirements.' : 'Paste or upload the JD and let the AI fill the form, or type it in. Candidates are added to a position from the search results.'}
            footer={<>
                <button type="button" onClick={onClose} disabled={busy} className={BTN_SECONDARY}>Cancel</button>
                <button type="button" onClick={() => void save()} disabled={busy || reading || !f.title.trim()} className={BTN_PRIMARY}>{busy && <Spinner />}{editing ? 'Save changes' : 'Save position'}</button>
            </>}
        >
            <div className="space-y-5">
                {/* 1. The job description */}
                <section className={`${WELL} px-4 py-3`} aria-label="Job description">
                    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                        <div>
                            <p className="text-sm font-semibold text-text-primary">Job description</p>
                            <p className="text-xs text-text-secondary">{f.jdText ? `${f.jdFileName ?? 'Pasted text'} · ${f.jdText.length.toLocaleString('en-IN')} characters` : 'None yet. Paste or upload it and the AI fills the form.'}</p>
                        </div>
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
                            <input ref={fileRef} type="file" accept={JD_FILE_TYPES} className="sr-only" aria-label="Upload a job description" onChange={e => { const file = e.target.files?.[0]; if (file) void fillFrom(file); }} />
                            <button type="button" onClick={() => fileRef.current?.click()} disabled={reading || busy} className={BTN_SECONDARY}>{reading ? <Spinner /> : <FileUp className="h-4 w-4" />}Upload a JD</button>
                            <button type="button" onClick={() => setJdOpen(o => !o)} disabled={reading || busy} className={BTN_GHOST}>{jdOpen ? 'Hide the text' : f.jdText ? 'Show the text' : 'Paste a JD'}</button>
                        </div>
                    </div>
                    {jdOpen && (
                        <div className="mt-3 space-y-2">
                            <textarea value={f.jdText} onChange={e => set('jdText', e.target.value)} rows={6} maxLength={20000} placeholder="Paste the job description here" aria-label="Job description text" className={`${INPUT} h-auto min-h-[120px] resize-y py-2.5 leading-relaxed`} disabled={reading} />
                            <button type="button" onClick={() => void fillFrom(f.jdText)} disabled={reading || busy || !f.jdText.trim()} className={BTN_PRIMARY}>{reading ? <Spinner /> : <Sparkles className="h-4 w-4" />}{reading ? 'Reading…' : 'Fill in from the JD'}</button>
                        </div>
                    )}
                    {notice && <p role="status" className="mt-2 text-xs text-text-secondary">{notice}</p>}
                </section>

                {/* 2. Basics */}
                <section aria-label="Basics" className="space-y-3">
                    <p className={LABEL}>Basics</p>
                    {field('Title', 'pos-title', <input id="pos-title" value={f.title} onChange={e => set('title', e.target.value)} placeholder="e.g. Assistant Manager – Business Development" className={INPUT} autoFocus={!f.title} />, 'required')}
                    <div className="grid gap-x-3 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
                        {field('Department', 'pos-department', <input id="pos-department" value={f.department} onChange={e => set('department', e.target.value)} placeholder="e.g. Business Development" className={INPUT} />)}
                        {field('Designation / grade', 'pos-designation', <input id="pos-designation" value={f.designation} onChange={e => set('designation', e.target.value)} placeholder="e.g. Manager, M2" className={INPUT} />)}
                        {field('Location', 'pos-location', <input id="pos-location" value={f.location} onChange={e => set('location', e.target.value)} placeholder="e.g. Noida" className={INPUT} />, 'the search filters on it')}
                        {field('Employment type', 'pos-type', (
                            <select id="pos-type" value={f.employmentType} onChange={e => set('employmentType', e.target.value as '' | EmploymentType)} className={INPUT}>
                                <option value="">Not said</option>
                                {EMPLOYMENT_TYPES.map(t => <option key={t} value={t}>{EMPLOYMENT_TYPE_LABELS[t]}</option>)}
                            </select>
                        ))}
                        {field('Openings', 'pos-openings', <input id="pos-openings" type="number" min={1} max={500} value={f.openings} onChange={e => set('openings', e.target.value)} className={INPUT} />)}
                        {field('Hiring manager', 'pos-hm', <input id="pos-hm" value={f.hiringManager} onChange={e => set('hiringManager', e.target.value)} placeholder="Who the hire reports to" className={INPUT} />)}
                        {field('Priority', 'pos-priority', (
                            <select id="pos-priority" value={f.priority} onChange={e => set('priority', e.target.value as PositionPriority)} className={INPUT}>
                                {POSITION_PRIORITIES.map(p => <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>)}
                            </select>
                        ))}
                        {field('Target to fill', 'pos-target', <input id="pos-target" type="number" min={1} max={365} value={f.targetDays} onChange={e => set('targetDays', e.target.value)} className={INPUT} />, 'days')}
                    </div>
                </section>

                {/* 3. Requirements */}
                <section aria-label="Requirements" className="space-y-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                        <p className={LABEL}>Requirements</p>
                        <p className="text-xs text-text-tertiary">These become the search: must-haves are starred, the rest are nice-to-haves.</p>
                    </div>
                    <div className="grid gap-x-3 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
                        {field('Experience from', 'pos-exp-min', <input id="pos-exp-min" type="number" min={0} max={50} step={0.5} value={f.expMin} onChange={e => set('expMin', e.target.value)} className={INPUT} />, 'years')}
                        {field('to', 'pos-exp-max', <input id="pos-exp-max" type="number" min={0} max={50} step={0.5} value={f.expMax} onChange={e => set('expMax', e.target.value)} className={INPUT} />, 'years')}
                        {field('Notice period up to', 'pos-notice', <input id="pos-notice" type="number" min={0} max={365} value={f.noticeMax} onChange={e => set('noticeMax', e.target.value)} className={INPUT} />, 'days')}
                        {field('Education', 'pos-education', <input id="pos-education" value={f.education} onChange={e => set('education', e.target.value)} placeholder="e.g. MBA preferred" className={INPUT} />)}
                        {field('Budget in hand from', 'pos-budget-min', <input id="pos-budget-min" type="number" min={0} step={1000} value={f.budgetMin} onChange={e => set('budgetMin', e.target.value)} placeholder="₹ / month" className={INPUT} />, '₹ per month')}
                        {field('to', 'pos-budget-max', <input id="pos-budget-max" type="number" min={0} step={1000} value={f.budgetMax} onChange={e => set('budgetMax', e.target.value)} placeholder="₹ / month" className={INPUT} />, '₹ per month · the search filters on it')}
                    </div>

                    <div>
                        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                            <p className={LABEL}>Must-have skills <span className="text-text-tertiary">· {mustCount} {mustCount === 1 ? 'group' : 'groups'}</span></p>
                            <p className="text-xs text-text-tertiary">One line per requirement; put the other spellings after a slash: <span className="font-medium text-text-secondary">MEP / HVAC / VRF</span></p>
                        </div>
                        <ul className="mt-1.5 space-y-1.5">
                            {f.mustHaves.map((line, i) => (
                                <li key={i} className="flex items-center gap-x-2">
                                    <input value={line} onChange={e => set('mustHaves', f.mustHaves.map((l, j) => (j === i ? e.target.value : l)))} aria-label={`Must-have ${i + 1}`} placeholder="Business development / B2B sales / Enterprise sales" className={INPUT} />
                                    <button type="button" onClick={() => set('mustHaves', f.mustHaves.filter((_, j) => j !== i))} className={`${BTN_GHOST} h-9 w-9 shrink-0 px-0`} aria-label={`Remove must-have ${i + 1}`}><X className="h-4 w-4" /></button>
                                </li>
                            ))}
                        </ul>
                        <button type="button" onClick={() => set('mustHaves', [...f.mustHaves, ''])} className={`${BTN_GHOST} mt-1.5 -ml-2.5 text-primary-dark`}><Plus className="h-4 w-4" />Add a must-have</button>
                    </div>
                    <div className="grid gap-x-3 gap-y-3 sm:grid-cols-2">
                        {field('Nice-to-have skills', 'pos-nice', <textarea id="pos-nice" rows={2} value={f.niceToHaves} onChange={e => set('niceToHaves', e.target.value)} placeholder="Comma-separated: negotiation, proposals, channel partners" className={`${INPUT} h-auto min-h-[60px] resize-y py-2`} />, 'comma-separated')}
                        {field('Tools & software', 'pos-tools', <textarea id="pos-tools" rows={2} value={f.tools} onChange={e => set('tools', e.target.value)} placeholder="Comma-separated: CRM, Excel, PowerPoint" className={`${INPUT} h-auto min-h-[60px] resize-y py-2`} />, 'comma-separated')}
                    </div>
                </section>

                {/* 4. Summary */}
                <section aria-label="Summary">
                    {field('Summary', 'pos-summary', <textarea id="pos-summary" rows={3} value={f.summary} onChange={e => set('summary', e.target.value)} maxLength={2000} placeholder="The role in two or three sentences, for the recruiter and the hiring manager" className={`${INPUT} h-auto min-h-[80px] resize-y py-2.5 leading-relaxed`} />, 'shown on the position')}
                </section>
            </div>
        </Dialog>
    );
}
