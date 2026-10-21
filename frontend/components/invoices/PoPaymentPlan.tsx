'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Circle, Clock, AlertTriangle, Plus, Trash2, Pencil } from 'lucide-react';
import {
    api, ApiError, inr, shortDate, Pill, Modal, Field, inputCls, btnPrimary, btnGhost, ErrorLine, Empty,
} from './invoiceUi';
import { TRIGGER_LABEL, type MilestoneTrigger } from '@/backend/lib/accounts/paymentSchedule';

/**
 * A PO's payment plan: its payment terms as milestones, each one clickable.
 *
 *   draft  the reader's proposal (or a saved draft). Purchase checks it and confirms.
 *   confirmed  Purchase has vouched for it. A milestone can now be clicked when it falls due.
 *
 * Clicking a milestone marks it DUE and tells Accounts. It creates no payment: Accounts
 * still raises and aligns the tranche in the Payment Tracker. When the PO's terms say nothing,
 * Purchase picks a preset or builds the plan here.
 */

interface Reached { date: string | null; auto: boolean }
interface Ms {
    id?: string; seq?: number; label: string; basis: 'basic' | 'gst' | 'total'; percent: number; amount: number; trigger: MilestoneTrigger;
    progress_pct: number | null; due_within_days: number | null; state?: 'pending' | 'due'; due_note?: string | null; due_early?: boolean; reached?: Reached;
    amount_stated?: boolean; source_line?: string;
}
interface Data {
    po: { id: string; po_number: string; vendor_name: string | null; po_amount: number | null; status: string | null; project_name: string | null };
    basic_value: number | null;
    schedule: { status: 'draft' | 'confirmed'; source: 'parsed' | 'manual'; parse_status: 'ok' | 'check' | 'none' | null; warnings: string[]; notes: string[]; confirmed_at: string | null } | null;
    milestones: Ms[];
    proposal: { status: 'ok' | 'check' | 'none'; milestones: Ms[]; warnings: string[]; notes: string[] } | null;
    presets: { key: string; label: string; milestones: { label: string; percent: number; trigger: MilestoneTrigger; progress_pct?: number }[] }[];
    progress: { id: string; kind: 'progress' | 'delivery'; progress_pct: number | null; recorded_on: string; note: string | null }[];
    terms_text: string;
    can_edit: boolean;
}

const TRIGGERS = Object.keys(TRIGGER_LABEL) as MilestoneTrigger[];
const today = () => new Date().toISOString().slice(0, 10);

export default function PoPaymentPlan({ orgId, poId, poNumber, onClose, onChanged }: { orgId: string; poId: string; poNumber: string; onClose: () => void; onChanged?: () => void }) {
    const [d, setD] = useState<Data | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [editing, setEditing] = useState<Ms[] | null>(null);
    const [picked, setPicked] = useState<Ms | null>(null);
    const [note, setNote] = useState('');
    const [log, setLog] = useState<{ kind: 'progress' | 'delivery'; pct: string; on: string; note: string }>({ kind: 'progress', pct: '', on: today(), note: '' });
    const [showTerms, setShowTerms] = useState(false);

    const load = useCallback(async () => {
        try { setD(await api<Data>(`/api/po-schedule?org_id=${orgId}&po_id=${poId}`)); setError(null); } catch (e) { setError((e as Error).message); }
    }, [orgId, poId]);
    useEffect(() => { load(); }, [load]);

    const shown: Ms[] = useMemo(() => (d ? (d.schedule ? d.milestones : d.proposal?.milestones ?? []) : []), [d]);
    const confirmed = d?.schedule?.status === 'confirmed';
    const warnings = d?.schedule ? d.schedule.warnings : d?.proposal?.warnings ?? [];
    const notes = d?.schedule ? d.schedule.notes : d?.proposal?.notes ?? [];
    const noTerms = !!d && !d.schedule && (d.proposal?.status === 'none' || !d.proposal?.milestones.length);

    const run = async (fn: () => Promise<unknown>) => {
        setBusy(true); setError(null);
        try { await fn(); await load(); onChanged?.(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
    };

    const save = (rows: Ms[], confirm: boolean, source: 'parsed' | 'manual') => run(async () => {
        await api('/api/po-schedule', { method: 'PUT', body: JSON.stringify({ org_id: orgId, po_id: poId, confirm, source, milestones: rows }) });
        setEditing(null);
    });

    const markDue = (m: Ms, override = false) => run(async () => {
        try {
            await api(`/api/po-schedule/milestones/${m.id}`, { method: 'POST', body: JSON.stringify({ org_id: orgId, action: 'mark_due', note, override }) });
            setPicked(null); setNote('');
        } catch (e) {
            if (e instanceof ApiError && e.data?.error === 'not_reached') { setPicked({ ...m, due_early: true }); throw new Error(e.message); }
            throw e;
        }
    });

    const recordLog = () => run(async () => {
        await api('/api/po-schedule/progress', { method: 'POST', body: JSON.stringify({ org_id: orgId, po_id: poId, kind: log.kind, progress_pct: log.kind === 'progress' ? Number(log.pct) : undefined, recorded_on: log.on, note: log.note }) });
        setLog({ ...log, pct: '', note: '' });
    });

    if (!d) return <Modal title={`Payment plan · ${poNumber}`} onClose={onClose} wide>{error ? <ErrorLine message={error} /> : <p className="py-10 text-center text-sm text-text-tertiary">Loading…</p>}</Modal>;

    const basicTotal = d.basic_value;
    const startEdit = (rows: Ms[]) => setEditing(rows.map((m) => ({ label: m.label, basis: m.basis, percent: m.percent, amount: m.amount, trigger: m.trigger, progress_pct: m.progress_pct, due_within_days: m.due_within_days })));
    const fromPreset = (key: string) => {
        const p = d.presets.find((x) => x.key === key);
        if (!p) return;
        const base = d.basic_value ?? d.po.po_amount ?? 0;
        const rows: Ms[] = p.milestones.map((m) => ({ label: m.label, basis: d.basic_value ? 'basic' : 'total', percent: m.percent, amount: Math.round(base * m.percent) / 100, trigger: m.trigger, progress_pct: m.progress_pct ?? null, due_within_days: null }));
        if (d.basic_value && d.po.po_amount && d.po.po_amount - d.basic_value > 1) rows.push({ label: 'GST against invoice', basis: 'gst', percent: 100, amount: Math.round((d.po.po_amount - d.basic_value) * 100) / 100, trigger: 'on_invoice', progress_pct: null, due_within_days: null });
        setEditing(rows);
    };

    return (
        <Modal title={`Payment plan · ${d.po.po_number}`} onClose={onClose} wide>
            <div className="space-y-5">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="text-text-secondary">{d.po.vendor_name} · {d.po.project_name ?? '—'} · PO {inr(d.po.po_amount)}{basicTotal ? ` (basic ${inr(basicTotal)})` : ''}</span>
                    {d.schedule ? <Pill tone={confirmed ? 'green' : 'amber'}>{confirmed ? 'Confirmed' : 'Draft, not confirmed'}</Pill> : <Pill tone={noTerms ? 'grey' : 'amber'}>{noTerms ? 'No terms found' : 'Proposed from the PO terms'}</Pill>}
                    {d.schedule?.source === 'manual' && <Pill tone="blue">Set by Purchase</Pill>}
                </div>
                <ErrorLine message={error} />

                {!!warnings.length && (
                    <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-3 py-2.5">
                        <div className="flex items-center gap-1.5 text-xs font-bold text-amber-700 dark:text-amber-400"><AlertTriangle className="w-3.5 h-3.5" /> Check before confirming</div>
                        <ul className="mt-1 text-xs text-text-secondary space-y-0.5 list-disc pl-4">{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
                    </div>
                )}
                {!!notes.length && <ul className="text-xs text-text-tertiary space-y-0.5">{notes.map((w, i) => <li key={i}>{w}</li>)}</ul>}

                {/* the timeline */}
                {!editing && !noTerms && (
                    <section>
                        <h3 className="text-sm font-bold text-text-primary mb-3">Milestones</h3>
                        <ol className="space-y-2">
                            {shown.map((m, i) => {
                                const reached = !!m.reached?.date;
                                const isDue = m.state === 'due';
                                const clickable = confirmed && !isDue && d.can_edit && !!m.id;
                                return (
                                    <li key={m.id ?? i}>
                                        <button disabled={!clickable} onClick={() => { setPicked(m); setNote(''); }}
                                            className={`w-full text-left rounded-xl border px-3 py-2.5 flex items-start gap-3 transition-colors ${isDue ? 'border-emerald-500/40 bg-emerald-500/5' : reached ? 'border-primary/40 bg-primary/5' : 'border-border'} ${clickable ? 'hover:bg-surface-elevated cursor-pointer' : 'cursor-default'}`}>
                                            <span className="mt-0.5">{isDue ? <CheckCircle2 className="w-5 h-5 text-emerald-600" /> : reached ? <Clock className="w-5 h-5 text-primary" /> : <Circle className="w-5 h-5 text-text-tertiary" />}</span>
                                            <span className="flex-1 min-w-0">
                                                <span className="flex flex-wrap items-center gap-2">
                                                    <span className="text-sm font-bold text-text-primary">{m.percent}% · {inr(m.amount)}</span>
                                                    <Pill tone="grey">{TRIGGER_LABEL[m.trigger]}{m.trigger === 'on_progress' ? ` ${m.progress_pct}%` : ''}</Pill>
                                                    {m.basis === 'gst' && <Pill tone="blue">GST</Pill>}
                                                    {m.due_within_days != null && <span className="text-[11px] text-text-tertiary">within {m.due_within_days} days</span>}
                                                </span>
                                                <span className="block text-xs text-text-secondary mt-0.5 break-words">{m.label}</span>
                                                <span className="block text-[11px] mt-1 text-text-tertiary">
                                                    {isDue ? <b className="text-emerald-700 dark:text-emerald-400">Marked due{m.due_early ? ' early' : ''}. Accounts has been told.</b>
                                                        : reached ? <>Reached {shortDate(m.reached!.date)}{clickable ? ' · click to mark it due' : ''}</>
                                                            : m.reached?.auto === false ? 'Not tracked automatically' : 'Waiting for this to be recorded'}
                                                </span>
                                            </span>
                                        </button>
                                    </li>
                                );
                            })}
                        </ol>
                        {!confirmed && d.can_edit && (
                            <div className="flex flex-wrap gap-2 mt-3">
                                <button className={btnPrimary} disabled={busy} onClick={() => save(shown, true, d.schedule?.source ?? 'parsed')}>{warnings.length ? 'Confirm anyway' : 'Confirm schedule'}</button>
                                <button className={btnGhost} onClick={() => startEdit(shown)}><Pencil className="w-4 h-4" /> Edit</button>
                                {!d.schedule && <button className={btnGhost} disabled={busy} onClick={() => save(shown, false, 'parsed')}>Save as draft</button>}
                            </div>
                        )}
                        {confirmed && d.can_edit && <button className="mt-3 text-xs font-bold text-primary hover:underline" onClick={() => startEdit(shown)}>Change the schedule</button>}
                        {!d.can_edit && !confirmed && <p className="text-xs text-text-tertiary mt-2">Only Purchase can confirm or change this.</p>}
                    </section>
                )}

                {noTerms && !editing && (
                    <section className="space-y-3">
                        <p className="text-sm text-text-secondary">The PO text has no payment percentages. {d.can_edit ? 'Pick a standard plan to start from, then adjust it.' : 'Purchase needs to set one.'}</p>
                        {d.can_edit && (
                            <div className="flex flex-wrap gap-2">
                                {d.presets.map((p) => <button key={p.key} className={btnGhost} onClick={() => fromPreset(p.key)}>{p.label}</button>)}
                                <button className={btnGhost} onClick={() => setEditing([{ label: '', basis: 'basic', percent: 100, amount: basicTotal ?? d.po.po_amount ?? 0, trigger: 'on_po', progress_pct: null, due_within_days: null }])}><Plus className="w-4 h-4" /> Build my own</button>
                            </div>
                        )}
                    </section>
                )}

                {/* editor */}
                {editing && (
                    <section className="space-y-3">
                        <h3 className="text-sm font-bold text-text-primary">Edit the schedule</h3>
                        <div className="flex flex-wrap gap-2 items-center">
                            <span className="text-xs text-text-tertiary">Start from:</span>
                            {d.presets.map((p) => <button key={p.key} className="text-xs font-bold text-primary hover:underline" onClick={() => fromPreset(p.key)}>{p.label}</button>)}
                        </div>
                        <div className="overflow-x-auto border border-border rounded-xl">
                            <table className="w-full text-xs">
                                <thead className="bg-surface-elevated text-text-tertiary"><tr><th className="px-2 py-2 text-left">What it pays for</th><th className="px-2 py-2 text-left">Of</th><th className="px-2 py-2 text-left">%</th><th className="px-2 py-2 text-left">Amount</th><th className="px-2 py-2 text-left">Payable when</th><th className="px-2 py-2 text-left">At % done</th><th /></tr></thead>
                                <tbody>
                                    {editing.map((m, i) => {
                                        const set = (patch: Partial<Ms>) => setEditing((rows) => rows!.map((x, j) => (j === i ? { ...x, ...patch } : x)));
                                        const ref = m.basis === 'gst' ? (basicTotal ? basicTotal * 0.18 : null) : m.basis === 'basic' ? basicTotal : d.po.po_amount;
                                        return (
                                            <tr key={i} className="border-t border-border">
                                                <td className="p-1"><input className={`${inputCls} !py-1 !px-2 text-xs min-w-[180px]`} value={m.label} onChange={(e) => set({ label: e.target.value })} /></td>
                                                <td className="p-1"><select className={`${inputCls} !py-1 !px-2 text-xs w-24`} value={m.basis} onChange={(e) => set({ basis: e.target.value as Ms['basis'] })}><option value="basic">Basic</option><option value="gst">GST</option><option value="total">Whole PO</option></select></td>
                                                <td className="p-1"><input className={`${inputCls} !py-1 !px-2 text-xs w-16`} type="number" step="0.01" value={m.percent} onChange={(e) => { const p = Number(e.target.value); set({ percent: p, ...(ref != null ? { amount: Math.round(ref * p) / 100 } : {}) }); }} /></td>
                                                <td className="p-1"><input className={`${inputCls} !py-1 !px-2 text-xs w-24`} type="number" step="0.01" value={m.amount} onChange={(e) => set({ amount: Number(e.target.value) })} /></td>
                                                <td className="p-1"><select className={`${inputCls} !py-1 !px-2 text-xs w-36`} value={m.trigger} onChange={(e) => set({ trigger: e.target.value as MilestoneTrigger })}>{TRIGGERS.map((t) => <option key={t} value={t}>{TRIGGER_LABEL[t]}</option>)}</select></td>
                                                <td className="p-1"><input className={`${inputCls} !py-1 !px-2 text-xs w-16`} type="number" disabled={m.trigger !== 'on_progress'} value={m.progress_pct ?? ''} onChange={(e) => set({ progress_pct: e.target.value ? Number(e.target.value) : null })} /></td>
                                                <td className="p-1"><button className="text-red-600" aria-label="Remove" onClick={() => setEditing((rows) => rows!.filter((_, j) => j !== i))}><Trash2 className="w-4 h-4" /></button></td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                        <p className={`text-xs ${Math.abs(editing.filter((m) => m.basis !== 'gst').reduce((s, m) => s + Number(m.percent || 0), 0) - 100) < 0.01 ? 'text-text-tertiary' : 'text-red-600 font-bold'}`}>
                            Payment percentages add to {Math.round(editing.filter((m) => m.basis !== 'gst').reduce((s, m) => s + Number(m.percent || 0), 0) * 100) / 100}% (GST rows are not counted). They must add to 100%.
                        </p>
                        <div className="flex flex-wrap gap-2">
                            <button className={btnGhost} onClick={() => setEditing((rows) => [...rows!, { label: '', basis: 'basic', percent: 0, amount: 0, trigger: 'other', progress_pct: null, due_within_days: null }])}><Plus className="w-4 h-4" /> Add milestone</button>
                            <button className={btnPrimary} disabled={busy} onClick={() => save(editing, true, 'manual')}>Save and confirm</button>
                            <button className={btnGhost} disabled={busy} onClick={() => save(editing, false, 'manual')}>Save as draft</button>
                            <button className={btnGhost} onClick={() => setEditing(null)}>Cancel</button>
                        </div>
                    </section>
                )}

                {/* progress timeline */}
                {(confirmed || !!d.schedule || !noTerms) && (
                    <section>
                        <h3 className="text-sm font-bold text-text-primary mb-2">Work on site</h3>
                        {d.progress.length === 0 ? <p className="text-xs text-text-tertiary mb-2">Nothing recorded yet. Record each stage as it is reached: that date is what each milestone above waits for.</p> : (
                            <ol className="border-l-2 border-border ml-2 space-y-2 mb-3">
                                {d.progress.map((p) => (
                                    <li key={p.id} className="pl-4 relative">
                                        <span className="absolute -left-[5px] top-1.5 w-2 h-2 rounded-full bg-primary" />
                                        <span className="text-sm text-text-primary font-bold">{p.kind === 'delivery' ? 'Material delivered' : `${p.progress_pct}% complete`}</span>
                                        <span className="text-xs text-text-tertiary"> · {shortDate(p.recorded_on)}</span>
                                        {p.note && <div className="text-xs text-text-secondary">{p.note}</div>}
                                    </li>
                                ))}
                            </ol>
                        )}
                        {d.can_edit && (
                            <div className="flex flex-wrap items-end gap-2">
                                <Field label="What happened"><select className={`${inputCls} w-40`} value={log.kind} onChange={(e) => setLog({ ...log, kind: e.target.value as 'progress' | 'delivery' })}><option value="progress">Work % complete</option><option value="delivery">Material delivered</option></select></Field>
                                {log.kind === 'progress' && <Field label="% complete"><input className={`${inputCls} w-24`} type="number" min={0} max={100} value={log.pct} onChange={(e) => setLog({ ...log, pct: e.target.value })} placeholder="25" /></Field>}
                                <Field label="On"><input className={inputCls} type="date" max={today()} value={log.on} onChange={(e) => setLog({ ...log, on: e.target.value })} /></Field>
                                <Field label="Note (optional)"><input className={`${inputCls} w-52`} value={log.note} onChange={(e) => setLog({ ...log, note: e.target.value })} /></Field>
                                <button className={btnPrimary} disabled={busy || !log.on || (log.kind === 'progress' && log.pct === '')} onClick={recordLog}>Record</button>
                            </div>
                        )}
                    </section>
                )}

                {d.terms_text && (
                    <section>
                        <button className="text-xs font-bold text-text-secondary hover:underline" onClick={() => setShowTerms((v) => !v)}>{showTerms ? 'Hide' : 'Show'} the terms text on the PO</button>
                        {showTerms && <pre className="mt-2 text-xs text-text-secondary whitespace-pre-wrap bg-surface-elevated rounded-xl p-3 max-h-56 overflow-y-auto font-sans">{d.terms_text}</pre>}
                    </section>
                )}
                {!shown.length && !editing && !noTerms && <Empty>No milestones.</Empty>}
            </div>

            {picked && (
                <Modal title="Mark this payment due" onClose={() => setPicked(null)}>
                    <div className="space-y-3">
                        <p className="text-sm text-text-primary"><b>{picked.percent}% · {inr(picked.amount)}</b> — {picked.label}</p>
                        <p className="text-xs text-text-secondary">This tells Accounts the payment is due. It does not create or approve a payment; Accounts raises and aligns it in the Payment Tracker.</p>
                        {picked.due_early && <p className="text-xs text-amber-700 dark:text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-xl px-3 py-2">This stage is not recorded as reached yet, so it will be flagged as marked early. A reason is required.</p>}
                        <Field label={picked.due_early ? 'Reason (required)' : 'Note for Accounts (optional)'}><input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
                        <ErrorLine message={error} />
                        <div className="flex gap-2">
                            <button className={btnPrimary} disabled={busy || (!!picked.due_early && note.trim().length < 5)} onClick={() => markDue(picked, !!picked.due_early)}>Mark due and tell Accounts</button>
                            <button className={btnGhost} onClick={() => setPicked(null)}>Cancel</button>
                        </div>
                    </div>
                </Modal>
            )}
        </Modal>
    );
}
