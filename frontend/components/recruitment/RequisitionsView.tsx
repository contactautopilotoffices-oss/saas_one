'use client';

import React, { useEffect, useState } from 'react';
import { AlertTriangle, Briefcase, Check, ClipboardList, Plus, Send, ThumbsUp, X } from 'lucide-react';
import {
    APPROVAL_LEVEL_LABELS, REQUISITION_STATUS_LABELS,
    type Requisition, type RequisitionApproval, type RequisitionAccess, type RequisitionDecision, type RequisitionListResponse, type RequisitionResponse, type RequisitionStatus,
} from '@/backend/lib/candidates/types';
import { api, qs } from '@/frontend/components/candidates/api';
import { formatDate } from '@/frontend/components/candidates/format';
import { Dialog, Drawer, Spinner, useUi } from '@/frontend/components/candidates/ui';
import {
    EmptyBlock, K_AREA, K_BTN, K_BTN_DANGER, K_BTN_GHOST, K_BTN_GHOST_DANGER, K_BTN_PRIMARY, K_CARD, K_CARD_BASE, K_FIELD, K_LABEL, K_TABLE, K_TABLE_WRAP, K_TD, K_TH, K_TH_R, K_TR, K_WELL,
    Loading, PageHeader, type PillTone, SearchBox, Segmented, SelectPill, StatusPill,
} from '@/frontend/components/candidates/page-kit';

/*
 * Hiring requests (owner 2026-11-17): Stages 1 and 2 of the Recruitment Module spec. One screen in two homes: the
 * manager's "Hiring requests" (their own requests and the ones waiting on them) and HR's "Requisitions" tracker inside
 * Recruitment (every request: status, age in days, who it waits on). The form is Stage 1; the drawer is Stage 2 for an
 * approver (approve with the in-plan tick, reject with reason, send back for change, put on hold) and the request's
 * history for everyone else. Nothing here decides anything by itself.
 * Owner 2026-11-20: "it is for the HR team to see who raised a requisition" / "it must be only for the logins": HR's
 * tab is the tracker only (no "Raise a request"); requests are raised from the "Hiring requests" page in the sidebar of
 * the people the Tech team picked (access.canRaise).
 * Owner 2026-11-21 ("go ahead with all"): the tracker filters by department, location and status and shows the
 * candidates in each approved role's pipeline; the form keeps what was typed through a page refresh (spec: "unsaved
 * form data survives a page refresh"); a department head sees their departments' requests here and may endorse them;
 * the raiser of a request on hold may confirm it is still needed (spec A24).
 */

const STATUS_TONE: Record<RequisitionStatus, PillTone> = { draft: 'grey', submitted: 'amber', on_hold: 'amber', sent_back: 'blue', approved: 'green', rejected: 'red', withdrawn: 'grey' };
const INPUT = `${K_FIELD} w-full`;
const lpa = (v: number | null) => (v === null ? '—' : `₹${(v / 100_000).toLocaleString('en-IN', { maximumFractionDigits: 1 })} LPA`);
/** The form keeps rupees per year as lakhs typed by the user ("6" = ₹6 LPA). */
const toLakhs = (v: number | null) => (v === null ? '' : String(v / 100_000));
const fromLakhs = (s: string): number | null => { const t = s.trim(); if (!t) return null; const n = Number(t); return Number.isFinite(n) ? Math.round(n * 100_000) : null; };
const num = (s: string): number | null => { const t = s.trim(); if (!t) return null; const n = Number(t); return Number.isFinite(n) ? n : null; };
/** Stage 2's SLA: 3 working days end to end. Over it, the row turns red. */
const SLA_DAYS = 3;
/** What the form had typed, kept in this browser until it is saved or cancelled. */
const draftKey = (orgId: string, id: string | null) => `hiring-request-form:${orgId}:${id ?? 'new'}`;
function readDraft(key: string): FormState | null {
    try {
        const raw = window.localStorage.getItem(key);
        const saved = raw ? (JSON.parse(raw) as { f?: Partial<FormState> }) : null;
        return saved?.f ? { ...EMPTY_FORM, ...saved.f } : null;
    } catch { return null; }
}
function writeDraft(key: string, f: FormState | null) {
    try {
        if (f) window.localStorage.setItem(key, JSON.stringify({ f, at: Date.now() }));
        else window.localStorage.removeItem(key);
    } catch { /* private window or storage blocked: the form still works, it just is not kept */ }
}

interface FormState {
    roleTitle: string; department: string; location: string; positions: string; requestType: 'new' | 'replacement'; replacingName: string;
    budgetMin: string; budgetMax: string; requiredSkills: string; minExperience: string; qualification: string; targetJoiningDate: string; justification: string; reportingManager: string;
    /** Owner 2026-11-24: the role was typed under "Others"; internal mobility yes / no; where the role sits in the structure. */
    roleIsNew: boolean; internalMobility: '' | 'yes' | 'no'; structureNote: string;
}
const EMPTY_FORM: FormState = { roleTitle: '', department: '', location: '', positions: '1', requestType: 'new', replacingName: '', budgetMin: '', budgetMax: '', requiredSkills: '', minExperience: '', qualification: '', targetJoiningDate: '', justification: '', reportingManager: '', roleIsNew: false, internalMobility: '', structureNote: '' };
const toForm = (r: Requisition): FormState => ({
    roleTitle: r.roleTitle, department: r.department ?? '', location: r.location ?? '', positions: String(r.positions), requestType: r.requestType, replacingName: r.replacingName ?? '',
    budgetMin: toLakhs(r.budgetMinCtc), budgetMax: toLakhs(r.budgetMaxCtc), requiredSkills: r.requiredSkills.join(', '), minExperience: r.minExperienceYears === null ? '' : String(r.minExperienceYears),
    qualification: r.qualification ?? '', targetJoiningDate: r.targetJoiningDate ?? '', justification: r.justification ?? '', reportingManager: r.reportingManager ?? '',
    roleIsNew: r.roleIsNew, internalMobility: r.internalMobility === true ? 'yes' : r.internalMobility === false ? 'no' : '', structureNote: r.structureNote ?? '',
});
const toBody = (f: FormState) => ({
    roleTitle: f.roleTitle.trim(), department: f.department.trim() || null, location: f.location.trim() || null, positions: num(f.positions) ?? 1, requestType: f.requestType,
    replacingName: f.replacingName.trim() || null, budgetMinCtc: fromLakhs(f.budgetMin), budgetMaxCtc: fromLakhs(f.budgetMax),
    requiredSkills: f.requiredSkills.split(/[,\n]/).map(s => s.trim()).filter(Boolean), minExperienceYears: num(f.minExperience), qualification: f.qualification.trim() || null,
    targetJoiningDate: f.targetJoiningDate || null, justification: f.justification.trim() || null, reportingManager: f.reportingManager.trim() || null,
    roleIsNew: f.roleIsNew, internalMobility: f.internalMobility === 'yes' ? true : f.internalMobility === 'no' ? false : null, structureNote: f.structureNote.trim() || null,
});
/** The select's value for a role typed under "Others". */
const OTHER_ROLE = '__other__';

export default function RequisitionsView({ orgId, mode }: { orgId: string; mode: 'hr' | 'manager' }) {
    const { notify, reportError } = useUi();
    const [state, setState] = useState<RequisitionListResponse | null>(null);
    const [nonce, setNonce] = useState(0);
    const [filter, setFilter] = useState<'open' | 'all' | 'mine'>('open');
    const [dept, setDept] = useState('');
    const [loc, setLoc] = useState('');
    const [status, setStatus] = useState<RequisitionStatus | ''>('');
    const [query, setQuery] = useState('');
    const [form, setForm] = useState<{ open: boolean; requisition: Requisition | null }>({ open: false, requisition: null });
    const [openId, setOpenId] = useState<string | null>(null);
    useEffect(() => {
        const ctrl = new AbortController();
        void api<RequisitionListResponse>(`/api/recruitment/requisitions${qs({ orgId })}`, { signal: ctrl.signal }).then(res => {
            if (ctrl.signal.aborted) return;
            if (!res.ok) { if (res.noAccess) reportError(res); else notify(res.error, 'error'); setState({ requisitions: [], access: { seesAll: false, approverLevels: [], configured: false } }); return; }
            setState(res.data);
        });
        return () => ctrl.abort();
    }, [orgId, nonce, notify, reportError]);
    const refresh = () => setNonce(n => n + 1);
    const access = state?.access;
    const all = state?.requisitions ?? [];
    // Owner 2026-11-24: a department head's requests are the ones waiting on them by name.
    const waitingOnMe = (r: Requisition) => (r.status === 'submitted' || r.status === 'on_hold') && !!access && r.currentLevel !== null
        && (r.currentLevel === 'hod' ? r.currentApproverId === access.userId : access.approverLevels.includes(r.currentLevel));
    const norm = (v: string | null) => (v ?? '').trim().toLowerCase();
    const shown = all
        .filter(r => filter === 'all' ? true : filter === 'mine' ? waitingOnMe(r) : ['draft', 'submitted', 'on_hold', 'sent_back'].includes(r.status))
        .filter(r => (!dept || norm(r.department) === dept) && (!loc || norm(r.location) === loc) && (!status || r.status === status))
        .filter(r => !query.trim() || [r.roleTitle, r.requisitionNo, r.raisedByName, r.department, r.location].some(v => norm(v).includes(query.trim().toLowerCase())));
    const forMe = all.filter(waitingOnMe).length;
    const openCount = all.filter(r => ['draft', 'submitted', 'on_hold', 'sent_back'].includes(r.status)).length;
    const approvedCount = all.filter(r => r.status === 'approved').length;
    // The spec's tracker filters: department, location, status (the values the requests hold).
    const choices = (pick: (r: Requisition) => string | null) => {
        const seen = new Map<string, string>();
        for (const r of all) { const v = pick(r)?.trim(); if (v && !seen.has(v.toLowerCase())) seen.set(v.toLowerCase(), v); }
        return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]));
    };
    const deptChoices = choices(r => r.department);
    const locChoices = choices(r => r.location);
    const statusChoices = [...new Set(all.map(r => r.status))];
    const headOf = access?.headOf ?? [];
    const formDepartments = [...new Set([...(state?.departments ?? []), ...deptChoices.map(([, v]) => v)])].sort((a, b) => a.localeCompare(b));

    return (
        <div className="space-y-5">
            <RequisitionForm orgId={orgId} open={form.open} requisition={form.requisition} departments={formDepartments} hierarchy={state?.hierarchy?.departments ?? []} onClose={() => setForm(f => ({ ...f, open: false }))}
                onSaved={r => { setForm({ open: false, requisition: null }); refresh(); if (r.status === 'draft') setOpenId(r.id); }} />
            <RequisitionDrawer orgId={orgId} id={openId} onClose={() => setOpenId(null)} onChanged={refresh}
                onEdit={r => { setOpenId(null); setForm({ open: true, requisition: r }); }} />

            <PageHeader title={mode === 'hr' ? 'Requisitions' : 'My requests'}
                sub={state ? `${all.length} ${all.length === 1 ? 'request' : 'requests'} · ${openCount} open · ${approvedCount} approved${forMe ? ` · ${forMe} waiting on you` : ''}` : 'Loading'}
                actions={mode === 'manager' && access?.canRaise ? <button type="button" onClick={() => setForm({ open: true, requisition: null })} className={K_BTN_PRIMARY}><Plus className="h-4 w-4" aria-hidden />Raise a request</button> : undefined} />

            <div className={`${K_CARD} flex gap-x-3 px-4 py-3`} aria-label="How hiring requests work">
                <Briefcase className="mt-0.5 hidden h-4 w-4 shrink-0 text-primary sm:block" aria-hidden />
                <div className="min-w-0 space-y-1 text-sm text-text-secondary">
                    <p>{mode === 'hr' ? 'Every request raised from the “Hiring requests” page in people’s sidebars: who raised it, where it stands and who it waits on. ' : ''}A request to hire goes to its department head, then the HR Head, and to the Director when the role is out of plan or above the CTC level. Approved, it becomes an open position. Nothing is approved by the system.</p>
                    {access && !access.configured && <p className="flex items-center gap-x-1.5 text-xs font-medium text-amber-800 dark:text-amber-300"><AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />The approvers are not set yet: ask the Tech team to set them in the Tech dashboard → HR Configs. Requests can be drafted but not submitted.</p>}
                    {mode === 'manager' && access && !access.canRaise && <p className="text-xs text-text-tertiary">{headOf.length ? 'You see the requests raised for the departments you head, and can endorse them. ' : 'You can follow your earlier requests here. '}Raising a new one is not switched on for your login: the Tech team decides who can.</p>}
                    {mode === 'manager' && access?.canRaise && headOf.length > 0 && <p className="text-xs text-text-tertiary">You also see the requests raised for the departments you head, and can endorse them.</p>}
                </div>
            </div>

            <div className="flex flex-wrap items-center gap-2" role="toolbar" aria-label="Filter the requests">
                <SearchBox value={query} onChange={setQuery} placeholder="Search role, number or person" label="Search the requests" className="w-full sm:w-64" maxLength={80} />
                <Segmented label="Which requests" value={filter} onChange={setFilter}
                    options={[{ value: 'open', label: 'Open' }, { value: 'mine', label: forMe ? `Waiting on me · ${forMe}` : 'Waiting on me' }, { value: 'all', label: 'All' }]} />
                {all.length > 0 && <>
                    <SelectPill label="Department" value={dept} onChange={setDept} className="min-w-[150px]">
                        <option value="">All departments</option>
                        {deptChoices.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </SelectPill>
                    <SelectPill label="Location" value={loc} onChange={setLoc} className="min-w-[140px]">
                        <option value="">All locations</option>
                        {locChoices.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </SelectPill>
                    <SelectPill label="Status" value={status} onChange={v => setStatus(v as RequisitionStatus | '')} className="min-w-[130px]">
                        <option value="">Any status</option>
                        {statusChoices.map(st => <option key={st} value={st}>{REQUISITION_STATUS_LABELS[st]}</option>)}
                    </SelectPill>
                </>}
                {(dept || loc || status || query) && <button type="button" onClick={() => { setDept(''); setLoc(''); setStatus(''); setQuery(''); }} className={K_BTN_GHOST}>Clear</button>}
            </div>

            <section className={`${K_CARD} overflow-hidden`} aria-label={mode === 'hr' ? 'Requisition tracker' : 'My requests'}>
                {!state ? (
                    <div className="px-4"><Loading /></div>
                ) : shown.length === 0 ? (
                    <EmptyBlock icon={ClipboardList} title={all.length ? 'Nothing here' : 'No hiring requests yet'}>{all.length ? 'Try another filter.' : mode === 'hr' ? 'Requests appear here when someone raises one from “Hiring requests” in their sidebar.' : 'Raise the first one: the role, the budget band and why it is needed.'}</EmptyBlock>
                ) : (
                    <div className={K_TABLE_WRAP}>
                        <table className={`${K_TABLE} min-w-[820px]`}>
                            <thead>
                                <tr>
                                    <th scope="col" className={K_TH}>Role</th>
                                    <th scope="col" className={K_TH}>Status</th>
                                    <th scope="col" className={K_TH}>Waiting on</th>
                                    <th scope="col" className={K_TH_R}>In pipeline</th>
                                    <th scope="col" className={K_TH_R}>Age</th>
                                    <th scope="col" className={K_TH}><span className="sr-only">Action</span></th>
                                </tr>
                            </thead>
                            <tbody>
                                {shown.map(r => {
                                    const late = r.status === 'submitted' && r.ageDays > SLA_DAYS;
                                    const mine = waitingOnMe(r);
                                    return (
                                        <tr key={r.id} className={K_TR}>
                                            <td className={`${K_TD} max-w-[360px]`}>
                                                <button type="button" onClick={() => setOpenId(r.id)} className="block max-w-full rounded text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
                                                    <span className="flex flex-wrap items-center gap-x-2">
                                                        <span className="font-semibold text-text-primary hover:underline">{r.roleTitle}</span>
                                                        {r.requisitionNo && <span className="text-xs tabular-nums text-text-tertiary">{r.requisitionNo}</span>}
                                                    </span>
                                                    <span className="mt-0.5 block truncate text-xs text-text-tertiary">
                                                        {[r.department, r.location, `${r.positions} ${r.positions === 1 ? 'position' : 'positions'}`, r.budgetMaxCtc !== null ? `${lpa(r.budgetMinCtc)} to ${lpa(r.budgetMaxCtc)}` : null, mode === 'hr' ? `by ${r.raisedByName ?? '—'}` : null].filter(Boolean).join(' · ')}
                                                    </span>
                                                </button>
                                            </td>
                                            <td className={K_TD}>
                                                <span className="flex flex-wrap items-center gap-1.5">
                                                    <StatusPill tone={STATUS_TONE[r.status]}>{REQUISITION_STATUS_LABELS[r.status]}</StatusPill>
                                                    {mine && <StatusPill tone="teal">Your decision</StatusPill>}
                                                    {(r.endorsedBy?.length ?? 0) > 0 && <StatusPill tone="green">Endorsed</StatusPill>}
                                                </span>
                                            </td>
                                            <td className={`${K_TD} max-w-[200px]`}>
                                                <p className="truncate font-medium text-text-primary">{r.currentLevel ? `${r.currentApproverName ?? APPROVAL_LEVEL_LABELS[r.currentLevel]}` : <span className="font-normal text-text-tertiary">—</span>}</p>
                                                {r.currentLevel && <p className="truncate text-xs text-text-tertiary" title={r.needsDirector ? 'Out of plan or above the CTC level' : undefined}>{APPROVAL_LEVEL_LABELS[r.currentLevel]}{r.needsDirector ? ' · out of plan or above the CTC level' : ''}</p>}
                                            </td>
                                            <td className={`${K_TD} text-right font-medium tabular-nums text-text-primary`} title={r.positionId ? 'Candidates in the position opened from this request' : 'Counted once the request is approved and its position opens'}>{r.pipelineCount ?? <span className="font-normal text-text-tertiary">—</span>}</td>
                                            <td className={`${K_TD} whitespace-nowrap text-right font-medium tabular-nums ${late ? 'text-red-700 dark:text-red-400' : 'text-text-primary'}`}>
                                                {r.submittedAt ? <>{r.ageDays} <span className="text-xs font-normal text-text-tertiary">{r.ageDays === 1 ? 'day' : 'days'}{r.status === 'submitted' || r.status === 'on_hold' ? '' : ' taken'}</span></> : <span className="font-normal text-text-tertiary">—</span>}
                                            </td>
                                            <td className={`${K_TD} text-right`}>
                                                <button type="button" onClick={() => setOpenId(r.id)} className={mine ? K_BTN_PRIMARY : K_BTN} aria-label={`${mine ? 'Decide on' : 'Open'} ${r.roleTitle}`}>{mine ? 'Decide' : 'Open'}</button>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </section>
        </div>
    );
}

/** Stage 1: the requisition form. Save as draft, or submit for approval. */
function RequisitionForm({ orgId, open, requisition, departments, hierarchy, onClose, onSaved }: { orgId: string; open: boolean; requisition: Requisition | null; departments: string[]; hierarchy: { department: string; designations: string[] }[]; onClose: () => void; onSaved: (r: Requisition) => void }) {
    const { notify, reportError } = useUi();
    const [f, setF] = useState<FormState>(EMPTY_FORM);
    const [busy, setBusy] = useState<'draft' | 'submit' | null>(null);
    const [restored, setRestored] = useState(false);
    const [seenOpen, setSeenOpen] = useState(open);
    const key = draftKey(orgId, requisition?.id ?? null);
    const base = requisition ? toForm(requisition) : EMPTY_FORM;
    if (open !== seenOpen) {
        setSeenOpen(open);
        if (open) {
            // Owner 2026-11-21 (spec): what was typed before a refresh, or before the form was closed without Cancel, comes back.
            const kept = readDraft(key);
            const differs = !!kept && JSON.stringify(kept) !== JSON.stringify(base);
            setF(differs && kept ? kept : base);
            setRestored(differs);
        }
    }
    useEffect(() => {
        if (!open) return;
        writeDraft(key, JSON.stringify(f) === JSON.stringify(base) ? null : f);
        // base is derived from requisition, which the key already names.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, f, key]);
    const discardTyped = () => { writeDraft(key, null); setRestored(false); setF(base); };
    const cancel = () => { if (busy) return; writeDraft(key, null); setRestored(false); onClose(); };
    const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF(s => ({ ...s, [k]: v }));
    const editing = !!requisition;
    // Owner 2026-11-24: department and role come from the company hierarchy; a new role goes under "Others".
    const listed = hierarchy.length > 0;
    const sameText = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
    const deptEntry = hierarchy.find(d => sameText(d.department, f.department)) ?? null;
    const designations = deptEntry?.designations ?? [];
    // A role saved before the list existed (or not in it) shows as "Others", with its title kept.
    const roleIsOther = f.roleIsNew || (!!f.roleTitle.trim() && designations.length > 0 && !designations.some(d => sameText(d, f.roleTitle)));
    const pickDepartment = (department: string) => setF(s => {
        const entry = hierarchy.find(d => sameText(d.department, department));
        const keepRole = s.roleIsNew || !!entry?.designations.some(d => sameText(d, s.roleTitle));
        return { ...s, department, roleTitle: keepRole ? s.roleTitle : '', roleIsNew: keepRole ? s.roleIsNew : false };
    });
    const pickRole = (value: string) => setF(s => (value === OTHER_ROLE ? { ...s, roleIsNew: true, roleTitle: s.roleIsNew ? s.roleTitle : '' } : { ...s, roleIsNew: false, roleTitle: value }));
    const fromList = !listed || (!!deptEntry && (designations.length === 0 || roleIsOther || designations.some(d => sameText(d, f.roleTitle))));
    const canSubmit = !!f.roleTitle.trim() && fromLakhs(f.budgetMax) !== null && !!f.justification.trim() && !!f.structureNote.trim() && f.internalMobility !== ''
        && (f.requestType !== 'replacement' || !!f.replacingName.trim()) && fromList;

    const save = async (submit: boolean) => {
        if (!f.roleTitle.trim() || busy) return;
        const body = { ...toBody(f), roleIsNew: roleIsOther };
        if (body.budgetMinCtc !== null && body.budgetMaxCtc !== null && body.budgetMinCtc > body.budgetMaxCtc) { notify("The budget band's minimum is above its maximum.", 'error'); return; }
        setBusy(submit ? 'submit' : 'draft');
        const res = editing
            ? await api<{ requisition: Requisition }>(`/api/recruitment/requisitions/${encodeURIComponent(requisition.id)}`, { method: 'PATCH', json: { orgId, ...body, submit } })
            : await api<{ requisition: Requisition }>('/api/recruitment/requisitions', { json: { orgId, ...body, submit } });
        setBusy(null);
        if (!res.ok) { notify(res.error, 'error'); if (res.noAccess) reportError(res); return; }
        writeDraft(key, null);
        setRestored(false);
        notify(submit ? `${res.data.requisition.requisitionNo} submitted to the ${res.data.requisition.currentLevel ? APPROVAL_LEVEL_LABELS[res.data.requisition.currentLevel] : 'approvers'}` : 'Saved as a draft', 'success');
        onSaved(res.data.requisition);
    };

    const field = (label: string, id: string, input: React.ReactNode, hint?: string) => (
        <div className="min-w-0">
            <label htmlFor={id} className={K_LABEL}>{label}{hint ? <span className="text-text-tertiary"> · {hint}</span> : null}</label>
            <div className="mt-1.5">{input}</div>
        </div>
    );
    return (
        <Dialog open={open} onClose={() => { if (!busy) onClose(); }} labelId="req-form-title" size="xl"
            title={editing ? `Edit request${requisition.requisitionNo ? ` · ${requisition.requisitionNo}` : ''}` : 'Raise a hiring request'}
            description="Stage 1 of the hiring flow. The department head reviews it first, then the HR Head; an out-of-plan role, or one above the CTC level, also goes to the Director."
            footer={<>
                <button type="button" onClick={cancel} disabled={!!busy} className={K_BTN_GHOST}>Cancel</button>
                <button type="button" onClick={() => void save(false)} disabled={!!busy || !f.roleTitle.trim()} className={K_BTN}>{busy === 'draft' && <Spinner />}Save as draft</button>
                <button type="button" onClick={() => void save(true)} disabled={!!busy || !canSubmit} className={K_BTN_PRIMARY} title={canSubmit ? undefined : 'Needs the department and role from the list, the budget band maximum, the justification, the place in the structure and the internal mobility answer'}>{busy === 'submit' ? <Spinner /> : <Send className="h-4 w-4" />}Submit for approval</button>
            </>}
        >
            <div className="space-y-5">
                {restored && (
                    <p role="status" className="flex flex-wrap items-center gap-x-2 rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-900 ring-1 ring-inset ring-blue-200 dark:bg-blue-500/15 dark:text-blue-200 dark:ring-blue-500/30">
                        Brought back what you typed before. Nothing is sent until you save or submit.
                        <button type="button" onClick={discardTyped} className="rounded font-semibold underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">Start over</button>
                    </p>
                )}
                <section className="grid gap-4 sm:grid-cols-2">
                    {listed ? (
                        <>
                            {field('Department', 'req-dept', (
                                <select id="req-dept" value={deptEntry?.department ?? ''} onChange={e => pickDepartment(e.target.value)} className={INPUT} autoFocus>
                                    <option value="">Pick the department…</option>
                                    {/* A request saved with a department no longer in the list keeps it visible until changed */}
                                    {f.department && !deptEntry && <option value={f.department} disabled>{f.department} (not in the list)</option>}
                                    {hierarchy.map(d => <option key={d.department} value={d.department}>{d.department}</option>)}
                                </select>
                            ))}
                            {field('Role title', 'req-role', designations.length ? (
                                <select id="req-role" value={roleIsOther ? OTHER_ROLE : (designations.find(d => sameText(d, f.roleTitle)) ?? '')} onChange={e => pickRole(e.target.value)} disabled={!deptEntry} className={INPUT}>
                                    <option value="">{deptEntry ? 'Pick the role…' : 'Pick the department first'}</option>
                                    {designations.map(d => <option key={d} value={d}>{d}</option>)}
                                    <option value={OTHER_ROLE}>Others (a new designation)…</option>
                                </select>
                            ) : (
                                <input id="req-role" value={f.roleTitle} onChange={e => setF(s => ({ ...s, roleTitle: e.target.value, roleIsNew: true }))} maxLength={120} disabled={!deptEntry} placeholder={deptEntry ? 'No designations listed: type the role' : 'Pick the department first'} className={INPUT} />
                            ), designations.length ? 'from the department’s designations' : undefined)}
                            {designations.length > 0 && roleIsOther && field('New designation', 'req-role-new', <input id="req-role-new" value={f.roleTitle} onChange={e => setF(s => ({ ...s, roleTitle: e.target.value, roleIsNew: true }))} maxLength={120} placeholder="e.g. Community Lead" className={INPUT} />, 'not in the list: HR reviews it')}
                        </>
                    ) : (
                        <>
                            {field('Role title', 'req-role', <input id="req-role" value={f.roleTitle} onChange={e => set('roleTitle', e.target.value)} maxLength={120} placeholder="e.g. Senior Technical Executive" className={INPUT} autoFocus />)}
                            {field('Department', 'req-dept', <><input id="req-dept" list="req-dept-list" value={f.department} onChange={e => set('department', e.target.value)} maxLength={80} className={INPUT} /><datalist id="req-dept-list">{departments.map(d => <option key={d} value={d} />)}</datalist></>, departments.length ? 'pick from the list so the department head sees it' : undefined)}
                        </>
                    )}
                    {field('Location', 'req-loc', <input id="req-loc" value={f.location} onChange={e => set('location', e.target.value)} maxLength={80} placeholder="City or site" className={INPUT} />)}
                    {field('Number of positions', 'req-n', <input id="req-n" type="number" min={1} max={500} value={f.positions} onChange={e => set('positions', e.target.value)} className={INPUT} />)}
                    {field('Replacement or new', 'req-type', (
                        <select id="req-type" value={f.requestType} onChange={e => set('requestType', e.target.value as 'new' | 'replacement')} className={INPUT}>
                            <option value="new">New position</option>
                            <option value="replacement">Replacement</option>
                        </select>
                    ))}
                    {f.requestType === 'replacement' && field('Employee being replaced', 'req-rep', <input id="req-rep" value={f.replacingName} onChange={e => set('replacingName', e.target.value)} maxLength={120} className={INPUT} />)}
                    {field('Reporting manager', 'req-rm', <input id="req-rm" value={f.reportingManager} onChange={e => set('reportingManager', e.target.value)} maxLength={120} className={INPUT} />)}
                </section>
                <section className={`${K_WELL} grid gap-4 px-4 py-4 sm:grid-cols-2`} aria-label="Requirements">
                    {field('Budget band, minimum', 'req-bmin', <input id="req-bmin" type="number" min={0} step={0.5} value={f.budgetMin} onChange={e => set('budgetMin', e.target.value)} placeholder="e.g. 4" className={INPUT} />, 'LPA, CTC')}
                    {field('Budget band, maximum', 'req-bmax', <input id="req-bmax" type="number" min={0} step={0.5} value={f.budgetMax} onChange={e => set('budgetMax', e.target.value)} placeholder="e.g. 6" className={INPUT} />, 'LPA, CTC · required')}
                    {field('Required skills', 'req-skills', <input id="req-skills" value={f.requiredSkills} onChange={e => set('requiredSkills', e.target.value)} placeholder="MEP, BMS, HVAC" className={INPUT} />, 'comma-separated')}
                    {field('Minimum experience', 'req-exp', <input id="req-exp" type="number" min={0} max={50} step={0.5} value={f.minExperience} onChange={e => set('minExperience', e.target.value)} className={INPUT} />, 'years')}
                    {field('Qualification', 'req-qual', <input id="req-qual" value={f.qualification} onChange={e => set('qualification', e.target.value)} maxLength={200} placeholder="e.g. B.E. Electrical" className={INPUT} />)}
                    {field('Target joining date', 'req-date', <input id="req-date" type="date" value={f.targetJoiningDate} onChange={e => set('targetJoiningDate', e.target.value)} className={INPUT} />)}
                </section>
                {field('Justification', 'req-why', <textarea id="req-why" rows={4} value={f.justification} onChange={e => set('justification', e.target.value)} maxLength={4000} placeholder="Why the role is needed now: the work, the site, what happens without it" className={`${K_AREA} min-h-[100px]`} />, 'required to submit')}
                {field('Where it sits in the current structure', 'req-structure', <textarea id="req-structure" rows={2} value={f.structureNote} onChange={e => set('structureNote', e.target.value)} maxLength={2000} placeholder="e.g. Reports to the Cluster Head, Thane; a new seat next to the two Community Managers" className={`${K_AREA} min-h-[64px]`} />, 'required to submit')}
                {field('Internal mobility', 'req-mobility', (
                    <select id="req-mobility" value={f.internalMobility} onChange={e => set('internalMobility', e.target.value as FormState['internalMobility'])} className={`${INPUT} sm:max-w-md`}>
                        <option value="">Could someone already in the company fill it?</option>
                        <option value="yes">Yes: someone internal may be eligible</option>
                        <option value="no">No: hire from outside</option>
                    </select>
                ), 'required to submit')}
            </div>
        </Dialog>
    );
}

/** One request: the details, the history, and (for its approver) the decision. */
function RequisitionDrawer({ orgId, id, onClose, onChanged, onEdit }: { orgId: string; id: string | null; onClose: () => void; onChanged: () => void; onEdit: (r: Requisition) => void }) {
    const { notify, reportError } = useUi();
    const [state, setState] = useState<RequisitionResponse | null>(null);
    const [nonce, setNonce] = useState(0);
    useEffect(() => {
        if (!id) return;
        const ctrl = new AbortController();
        void api<RequisitionResponse>(`/api/recruitment/requisitions/${encodeURIComponent(id)}${qs({ orgId })}`, { signal: ctrl.signal }).then(res => {
            if (ctrl.signal.aborted) return;
            if (!res.ok) { notify(res.error, 'error'); if (res.noAccess) reportError(res); return; }
            setState(res.data);
        });
        return () => ctrl.abort();
    }, [id, orgId, nonce, notify, reportError]);
    const s = state && state.requisition.id === id ? state : null;
    const r = s?.requisition ?? null;
    const [busy, setBusy] = useState(false);
    const [decision, setDecision] = useState<RequisitionDecision | null>(null);
    const [reason, setReason] = useState('');
    const [inPlan, setInPlan] = useState<boolean | null>(null);
    const [confirmWithdraw, setConfirmWithdraw] = useState(false);
    const [endorseNote, setEndorseNote] = useState('');
    const [seenId, setSeenId] = useState(id);
    if (seenId !== id) { setSeenId(id); setDecision(null); setReason(''); setInPlan(null); setConfirmWithdraw(false); setEndorseNote(''); }

    const act = async (path: string, json: Record<string, unknown>, done: string) => {
        if (!r) return;
        setBusy(true);
        const res = await api<{ requisition: Requisition }>(path, { method: path.endsWith('/decide') ? 'POST' : 'PATCH', json: { orgId, ...json } });
        setBusy(false);
        if (!res.ok) { notify(res.error, 'error'); if (res.noAccess) reportError(res); return; }
        notify(done, 'success');
        setDecision(null); setReason(''); setInPlan(null); setConfirmWithdraw(false); setEndorseNote('');
        setNonce(n => n + 1);
        onChanged();
    };
    // Takes the decision directly when given (Resume sends at once; reading it back from state in the same click would
    // still see the previous render's null and do nothing).
    // Owner 2026-11-24: the HR Head deciding at the department head's level (after 48 h) decides as the HR Head.
    const actingLevel = r?.currentLevel === 'hod' && s && r.currentApproverId !== s.access.userId ? 'hr_head' : r?.currentLevel ?? null;
    const decide = (chosen: RequisitionDecision | null = decision) => {
        if (!r || !chosen) return;
        const needsReason = chosen === 'reject' || chosen === 'send_back' || chosen === 'hold';
        if (needsReason && !reason.trim()) { notify(chosen === 'reject' ? 'Give the reason for rejecting.' : chosen === 'hold' ? 'Give the reason for putting it on hold.' : 'Say what needs to change.', 'error'); return; }
        if (chosen === 'approve' && actingLevel === 'hr_head' && inPlan === null) { notify('Tick whether the role is in the approved plan.', 'error'); return; }
        const label = { approve: 'Approved', reject: 'Rejected', send_back: 'Sent back for changes', hold: 'Put on hold', resume: 'Resumed' }[chosen];
        void act(`/api/recruitment/requisitions/${encodeURIComponent(r.id)}/decide`, { decision: chosen, reason: reason.trim() || undefined, ...(chosen === 'approve' && actingLevel === 'hr_head' ? { inPlan } : {}) }, label);
    };

    const rows: [string, React.ReactNode][] = r ? [
        ['Department', r.department], ['Location', r.location], ['Positions', `${r.positions} · ${r.requestType === 'replacement' ? `replacement for ${r.replacingName ?? '—'}` : 'new'}`],
        ['Budget band (CTC)', r.budgetMaxCtc !== null || r.budgetMinCtc !== null ? `${lpa(r.budgetMinCtc)} to ${lpa(r.budgetMaxCtc)}` : null],
        ['Required skills', r.requiredSkills.join(', ')], ['Minimum experience', r.minExperienceYears !== null ? `${r.minExperienceYears} years` : null],
        ['Qualification', r.qualification], ['Target joining', r.targetJoiningDate ? formatDate(r.targetJoiningDate) : null], ['Reporting manager', r.reportingManager],
        ['Raised by', `${r.raisedByName ?? '—'}${r.submittedAt ? `, ${formatDate(r.submittedAt)}` : ''}`],
        ['Internal mobility', r.internalMobility === true ? 'Yes: someone internal may be eligible' : r.internalMobility === false ? 'No: hire from outside' : null],
        ...(r.roleIsNew ? [['New designation', <StatusPill key="new" tone="amber">Raised under “Others”</StatusPill>] as [string, React.ReactNode]] : []),
        ['In the approved plan', r.inPlan === null ? <span className="text-text-tertiary">not reviewed yet</span> : r.inPlan ? 'Yes' : 'No: out of plan'],
        ...((r.endorsedBy?.length ?? 0) > 0 ? [['Endorsed by', r.endorsedBy!.join(', ')] as [string, React.ReactNode]] : []),
        ...(r.positionId ? [['Candidates in pipeline', String(r.pipelineCount ?? 0)] as [string, React.ReactNode]] : []),
    ] : [];

    return (
        <Drawer open={!!id} onClose={onClose} labelId="req-drawer-title" title={r ? `${r.roleTitle}${r.requisitionNo ? ` · ${r.requisitionNo}` : ''}` : 'Hiring request'}
            subtitle={r ? <span className="flex flex-wrap items-center gap-x-2"><StatusPill tone={STATUS_TONE[r.status]}>{REQUISITION_STATUS_LABELS[r.status]}</StatusPill>{r.currentLevel && <span className="text-xs text-text-secondary">waiting on {r.currentApproverName ?? APPROVAL_LEVEL_LABELS[r.currentLevel]} ({APPROVAL_LEVEL_LABELS[r.currentLevel]}) · {r.ageDays} {r.ageDays === 1 ? 'day' : 'days'}</span>}</span> : undefined}
            footer={r && s ? <>
                {s.canEdit && <button type="button" onClick={() => onEdit(r)} disabled={busy} className={K_BTN}>Edit</button>}
                {s.canEdit && r.status === 'draft' && <button type="button" onClick={() => void act(`/api/recruitment/requisitions/${encodeURIComponent(r.id)}`, { action: 'submit' }, 'Submitted for approval')} disabled={busy} className={K_BTN_PRIMARY}><Send className="h-4 w-4" />Submit for approval</button>}
                {s.canEdit && r.status === 'sent_back' && <button type="button" onClick={() => onEdit(r)} disabled={busy} className={K_BTN_PRIMARY}>Change and resubmit</button>}
                {/* Spec A24: the raiser tells the approver a request on hold is still needed */}
                {s.canConfirmNeeded && !confirmWithdraw && <button type="button" onClick={() => void act(`/api/recruitment/requisitions/${encodeURIComponent(r.id)}`, { action: 'still_needed' }, 'The approver is told the role is still needed')} disabled={busy} className={K_BTN_PRIMARY}><Check className="h-4 w-4" />Still needed</button>}
                {/* Owner 2026-11-20: only the person who raised it sees Withdraw (the server refuses anyone else) */}
                {s.canWithdraw && !s.canDecide && (
                    confirmWithdraw
                        ? <><span className="mr-auto text-sm text-text-secondary">Withdraw this request?</span><button type="button" onClick={() => setConfirmWithdraw(false)} className={K_BTN_GHOST}>Keep</button><button type="button" onClick={() => void act(`/api/recruitment/requisitions/${encodeURIComponent(r.id)}`, { action: 'withdraw', reason: reason.trim() || undefined }, 'Withdrawn')} disabled={busy} className={K_BTN_DANGER}>Withdraw</button></>
                        : <button type="button" onClick={() => setConfirmWithdraw(true)} disabled={busy} className={`${K_BTN_GHOST_DANGER} mr-auto`}>Withdraw</button>
                )}
            </> : undefined}
        >
            {!r || !s ? <Loading /> : (
                <div className="space-y-4">
                    {s.canDecide && (
                        <section className={`${K_CARD_BASE} border-primary/40 px-4 py-4`} aria-label="Your decision">
                            <p className="text-sm font-semibold text-text-primary">Your decision as {APPROVAL_LEVEL_LABELS[actingLevel!]}</p>
                            <p className="mt-0.5 text-xs text-text-secondary">
                                {r.currentLevel === 'hod' && actingLevel === 'hr_head' ? 'The department head has not decided in 48 hours, so you can decide in their place. ' : ''}
                                {r.status === 'on_hold' ? 'This request is on hold. Resume it to decide.' : actingLevel === 'hod' ? 'Your approval passes it to the HR Head.' : actingLevel === 'hr_head' ? 'In plan and within the CTC level, your approval opens the role and the Director is informed. Out of plan, or above the level, it goes to the Director.' : 'Your approval opens the role.'}
                            </p>
                            {r.status === 'on_hold' ? (
                                <div className="mt-3 flex justify-end"><button type="button" onClick={() => { setDecision('resume'); decide('resume'); }} disabled={busy} className={K_BTN_PRIMARY}>Resume</button></div>
                            ) : (
                                <>
                                    <div className="mt-3 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                                        {([['approve', 'Approve'], ['send_back', 'Send back'], ['hold', 'Put on hold'], ['reject', 'Reject']] as const).map(([d, label]) => (
                                            <button key={d} type="button" onClick={() => setDecision(d)} aria-pressed={decision === d}
                                                className={`h-10 rounded-lg px-3 text-sm font-semibold ring-1 ring-inset focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${decision === d ? (d === 'reject' ? 'bg-red-50 text-red-800 ring-red-600 dark:bg-red-500/15 dark:text-red-300' : 'bg-primary/10 text-primary-dark ring-primary dark:text-primary-light') : 'bg-surface text-text-primary ring-border hover:bg-surface-elevated'}`}>{label}</button>
                                        ))}
                                    </div>
                                    {decision === 'approve' && actingLevel === 'hr_head' && (
                                        <div className={`${K_WELL} mt-3 px-3 py-3`}>
                                            <p className="text-sm font-semibold text-text-primary">Is this role in the approved headcount plan?</p>
                                            <div className="mt-2 flex gap-x-2">
                                                <button type="button" onClick={() => setInPlan(true)} aria-pressed={inPlan === true} className={`${K_BTN} ${inPlan === true ? 'ring-[1.5px] ring-inset ring-primary' : ''}`}><Check className="h-4 w-4" />In plan</button>
                                                <button type="button" onClick={() => setInPlan(false)} aria-pressed={inPlan === false} className={`${K_BTN} ${inPlan === false ? 'ring-[1.5px] ring-inset ring-primary' : ''}`}><X className="h-4 w-4" />Out of plan</button>
                                            </div>
                                            <p className="mt-1.5 text-xs text-text-secondary">{inPlan === false ? 'Out of plan: the Director approves after you.' : inPlan === true ? 'In plan: approved by you (unless above the CTC level, when the Director approves too).' : ''}</p>
                                        </div>
                                    )}
                                    {decision && (
                                        <>
                                            <label htmlFor="req-reason" className="mt-3 block text-xs font-medium text-text-secondary">{decision === 'reject' || decision === 'hold' ? 'Reason' : decision === 'send_back' ? 'What needs to change' : 'Note'} {decision === 'reject' || decision === 'send_back' || decision === 'hold' ? <span className="text-error">*</span> : '(optional)'}</label>
                                            <textarea id="req-reason" rows={2} value={reason} onChange={e => setReason(e.target.value)} maxLength={2000} className={`${K_AREA} mt-1 min-h-[64px]`} />
                                            <div className="mt-3 flex justify-end gap-x-2">
                                                <button type="button" onClick={() => { setDecision(null); setReason(''); }} disabled={busy} className={K_BTN_GHOST}>Cancel</button>
                                                <button type="button" onClick={() => decide()} disabled={busy} className={decision === 'reject' ? K_BTN_DANGER : K_BTN_PRIMARY}>{busy && <Spinner />}{{ approve: 'Approve', reject: 'Reject', send_back: 'Send back', hold: 'Put on hold', resume: 'Resume' }[decision]}</button>
                                            </div>
                                        </>
                                    )}
                                </>
                            )}
                        </section>
                    )}
                    {s.canEndorse && (
                        <section className={`${K_CARD_BASE} border-emerald-300 px-4 py-4 dark:border-emerald-500/40`} aria-label="Endorse as department head">
                            <p className="text-sm font-semibold text-text-primary">Endorse as head of {r.department}</p>
                            <p className="mt-0.5 text-xs text-text-secondary">Tells the approvers you support this request. It does not approve it, and the HR Head and Director still decide.</p>
                            <label htmlFor="req-endorse-note" className="mt-3 block text-xs font-medium text-text-secondary">Note (optional)</label>
                            <textarea id="req-endorse-note" rows={2} value={endorseNote} onChange={e => setEndorseNote(e.target.value)} maxLength={1000} className={`${K_AREA} mt-1 min-h-[56px]`} />
                            <div className="mt-3 flex justify-end">
                                <button type="button" onClick={() => void act(`/api/recruitment/requisitions/${encodeURIComponent(r.id)}`, { action: 'endorse', note: endorseNote.trim() || undefined }, 'Endorsed')} disabled={busy} className={K_BTN_PRIMARY}>{busy ? <Spinner /> : <ThumbsUp className="h-4 w-4" />}Endorse</button>
                            </div>
                        </section>
                    )}
                    {r.status === 'sent_back' && r.decisionReason && <div role="status" className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-inset ring-amber-200 dark:bg-amber-500/15 dark:text-amber-100 dark:ring-amber-500/30"><span className="font-semibold">Sent back:</span> {r.decisionReason}</div>}
                    {r.status === 'rejected' && r.decisionReason && <div role="status" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-900 ring-1 ring-inset ring-red-200 dark:bg-red-500/15 dark:text-red-100 dark:ring-red-500/30"><span className="font-semibold">Rejected:</span> {r.decisionReason}</div>}
                    {r.status === 'on_hold' && <div role="status" className={`${K_WELL} px-4 py-3 text-sm text-text-primary`}><span className="font-semibold">On hold</span>{r.holdSince ? ` since ${formatDate(r.holdSince)}` : ''}{r.holdReason ? `: ${r.holdReason}` : ''}</div>}
                    {r.status === 'approved' && <div role="status" className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-900 ring-1 ring-inset ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-100 dark:ring-emerald-500/30"><span className="font-semibold">Approved</span>{r.decidedAt ? ` on ${formatDate(r.decidedAt)}` : ''}. {r.positionId ? 'The role is open under Recruitment → Positions.' : 'HR opens the position from here.'}</div>}
                    {r.previous && <p className="text-xs text-text-secondary">Last request for this role: <span className="font-semibold text-text-primary">{r.previous.requisitionNo ?? 'draft'}</span>, {REQUISITION_STATUS_LABELS[r.previous.status].toLowerCase()}, {formatDate(r.previous.createdAt)}.</p>}

                    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                        {rows.map(([k, v]) => <div key={k} className="min-w-0"><dt className={K_LABEL}>{k}</dt><dd className="mt-0.5 break-words font-medium text-text-primary">{v || <span className="font-normal text-text-tertiary">—</span>}</dd></div>)}
                    </dl>
                    <div>
                        <p className={K_LABEL}>Justification</p>
                        <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-text-primary">{r.justification || <span className="text-text-tertiary">—</span>}</p>
                    </div>
                    <div>
                        <p className={K_LABEL}>Where it sits in the current structure</p>
                        <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-text-primary">{r.structureNote || <span className="text-text-tertiary">—</span>}</p>
                    </div>
                    <section aria-label="History">
                        <p className={K_LABEL}>History <span className="font-normal text-text-tertiary">· nothing here is ever edited</span></p>
                        {s.approvals.length === 0 ? <p className="mt-1 text-sm text-text-tertiary">Not submitted yet.</p> : (
                            <ol className="mt-2 space-y-2 border-l-2 border-border pl-3.5">
                                {s.approvals.map(a => <li key={a.id} className="text-sm"><ApprovalLine a={a} /></li>)}
                            </ol>
                        )}
                    </section>
                </div>
            )}
        </Drawer>
    );
}

function ApprovalLine({ a }: { a: RequisitionApproval }) {
    const what = { submitted: 'Submitted', approved: 'Approved', rejected: 'Rejected', sent_back: 'Sent back for changes', on_hold: 'Put on hold', resumed: 'Resumed', withdrawn: 'Withdrawn', position_opened: 'Position opened', endorsed: 'Endorsed by the department head', still_needed: 'Confirmed still needed', escalated: 'Passed on (no decision in 48 hours)' }[a.action];
    return (
        <>
            <p className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-semibold text-text-primary">{what}{a.level && a.action !== 'submitted' ? ` · ${APPROVAL_LEVEL_LABELS[a.level]}` : ''}</span>
                <span className="text-xs text-text-tertiary">{formatDate(a.at)}{a.byName ? ` · ${a.byName}` : ''}{a.via === 'link' ? ' · from the link' : ''}</span>
            </p>
            {a.action === 'approved' && a.inPlan !== null && <p className="text-xs text-text-secondary">{a.inPlan ? 'In the approved plan' : 'Out of plan'}</p>}
            {a.reason && <p className="whitespace-pre-wrap break-words text-text-secondary">“{a.reason}”</p>}
        </>
    );
}

export type { RequisitionAccess };
