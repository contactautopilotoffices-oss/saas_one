'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ExternalLink, RefreshCw, Pencil, Check, ChevronDown } from 'lucide-react';
import {
    api, ApiError, inr, shortDate, label, Pill, matchTone, reviewTone, Modal, Field, inputCls, btnPrimary, btnGhost, btnDanger, ErrorLine,
} from './invoiceUi';
import { RULE_LABELS } from '@/backend/lib/invoices/types';
import { STAGE_STEPS, reasonFor, type InvoiceStage } from '@/backend/lib/invoices/plainReasons';
import { CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react';

interface Rule {
    id: string; rule_code: string; severity: 'info' | 'warning' | 'blocking'; outcome: 'pass' | 'fail' | 'unknown'; invoice_line_no: number | null;
    expected_value: unknown; actual_value: unknown; difference_amount: number | null; explanation: string;
    original_outcome: string | null; resolution_note: string | null; resolved_at: string | null; created_at: string;
}
interface Line {
    id: string; line_no: number; description: string; item_code: string | null; hsn_or_sac: string | null; quantity: number | null; unit: string | null;
    unit_rate: number | null; taxable_amount: number | null; tax_rate: number | null; tax_amount: number | null; line_total: number | null; po_line_item_id: string | null;
}
interface InvoiceRow {
    invoice_number: string | null; invoice_date: string | null; vendor_gstin_read: string | null; taxable_amount: number | null; tax_amount: number | null;
    other_charges: number | null; discount_amount: number | null; invoice_total: number | null; extraction_status: string; extraction_error: string | null;
    match_status: string; review_status: string; review_note: string | null; corrected_at: string | null; submitted_at: string; submitted_via: string;
}
interface Detail {
    invoice: InvoiceRow;
    summary?: { stage: InvoiceStage; headline: string; reasons: string[]; next: string | null };
    documents: { id: string; original_filename: string; content_type: string; source_channel: string; signed_url: string | null; uploaded_at: string }[];
    lines: Line[]; po: { po_number: string; vendor_name: string | null; po_amount: number | null; status: string | null } | null;
    po_lines: { id: string; name: string | null; quantity: number | null; rate: number | null; unit: string | null; tax_percentage: number | null }[];
    rules: Rule[]; history: Rule[]; events: { id: string; event_type: string; actor_name: string | null; actor_role: string | null; created_at: string }[];
    caps: { can_resolve_soft: boolean; can_resolve_blocking: boolean; can_accept: boolean };
}

/** The order the checks are read in: the PO first, then who, then what, then the money. */
const FLOW: [string, string][] = [
    ['PO_ELIGIBLE', 'PO is approved and open'], ['EXTRACTION_CONFIDENCE', 'Invoice read clearly'], ['VENDOR_MATCH', 'Vendor is the PO vendor'],
    ['INVOICE_IDENTITY', 'Invoice number and date present'], ['DUPLICATE_CHECK', 'Not received before'], ['LINE_ITEM_MAPPING', 'Lines match PO lines'],
    ['QUANTITY_CHECK', 'Quantities within the PO'], ['UNIT_RATE_CHECK', 'Rates as on the PO'], ['TAX_CHECK', 'Tax adds up'],
    ['TOTAL_CHECK', 'Totals add up'], ['PO_BALANCE_CHECK', 'Within what is left on the PO'], ['EXTRA_CHARGES_CHECK', 'No unexpected charges'],
    ['DOCUMENT_TRUNCATED', 'Whole document read'],
];

const HEADER_FIELDS: [keyof InvoiceRow, string, 'text' | 'number' | 'date'][] = [
    ['invoice_number', 'Invoice number', 'text'], ['invoice_date', 'Invoice date', 'date'], ['vendor_gstin_read', 'Vendor GSTIN', 'text'],
    ['taxable_amount', 'Taxable amount', 'number'], ['tax_amount', 'Tax', 'number'], ['other_charges', 'Other charges', 'number'],
    ['discount_amount', 'Discount', 'number'], ['invoice_total', 'Invoice total', 'number'],
];
const LINE_FIELDS: [keyof Line, string, 'text' | 'number'][] = [
    ['description', 'Description', 'text'], ['quantity', 'Qty', 'number'], ['unit', 'Unit', 'text'], ['unit_rate', 'Rate', 'number'],
    ['taxable_amount', 'Taxable', 'number'], ['tax_rate', 'Tax %', 'number'], ['tax_amount', 'Tax', 'number'], ['line_total', 'Total', 'number'],
];

const fmt = (v: unknown) => v == null ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v);

export default function InvoiceReview({ orgId, invoiceId, onClose, onChanged }: { orgId: string; invoiceId: string; onClose: () => void; onChanged: () => void }) {
    const [d, setD] = useState<Detail | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [editing, setEditing] = useState(false);
    const [header, setHeader] = useState<Record<string, string | number>>({});
    const [lines, setLines] = useState<Partial<Line>[]>([]);
    const [reason, setReason] = useState('');
    const [resolving, setResolving] = useState<string | null>(null);
    const [note, setNote] = useState('');
    const [decisionReason, setReasonText] = useState('');
    const [decision, setDecision] = useState<null | 'reject' | 'request_resubmission' | 'accept'>(null);
    const [showAudit, setShowAudit] = useState(false);
    const [showValues, setShowValues] = useState(false);

    const load = useCallback(async () => {
        try {
            const x = await api<Detail>(`/api/invoices/${invoiceId}?org_id=${orgId}`);
            setD(x); setError(null);
        } catch (e) { setError((e as Error).message); }
    }, [invoiceId, orgId]);
    useEffect(() => { load(); }, [load]);

    // A fresh upload is read in the background: look again every couple of seconds until the verdict lands.
    const inFlight = !!d && (['pending', 'processing'].includes(d.invoice.extraction_status) || ['received', 'reading', 'checking'].includes(d.summary?.stage ?? ''));
    useEffect(() => {
        if (!inFlight) return;
        const t = setTimeout(load, 2500);
        return () => clearTimeout(t);
    }, [inFlight, d, load]);

    const run = async (fn: () => Promise<unknown>) => {
        setBusy(true); setError(null);
        try { await fn(); await load(); onChanged(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
    };
    const post = (path: string, body: Record<string, unknown> = {}) => api(`/api/invoices/${invoiceId}/${path}`, { method: 'POST', body: JSON.stringify({ org_id: orgId, ...body }) });

    const startEdit = () => {
        if (!d) return;
        setHeader(Object.fromEntries(HEADER_FIELDS.map(([k]) => [k, d.invoice[k] ?? ''])) as Record<string, string | number>);
        setLines(d.lines.map((l) => ({ ...l })));
        setReason(''); setEditing(true);
    };
    const saveEdit = () => run(async () => {
        await post('review', { action: 'correct', reason, header, lines });
        setEditing(false);
    });

    const poLineName = useMemo(() => new Map((d?.po_lines ?? []).map((p) => [p.id, p.name ?? 'PO line'])), [d]);
    // The flow a reviewer reads top to bottom. Each step folds its rows (one per line for rates and
    // quantities) into one state; a row a person resolved no longer counts against the step.
    const steps = useMemo(() => FLOW.map(([code, label]) => {
        const rows = (d?.rules ?? []).filter((r) => r.rule_code === code);
        const live = rows.filter((r) => r.outcome !== 'pass' && !r.resolved_at);
        const state: 'pass' | 'fail' | 'unknown' | 'none' = !rows.length ? 'none' : live.some((r) => r.outcome === 'fail') ? 'fail' : live.some((r) => r.outcome === 'unknown') ? 'unknown' : 'pass';
        return { code, label, state, rows: rows.filter((r) => r.outcome !== 'pass'), resolved: rows.filter((r) => r.resolved_at).length };
    }), [d]);

    if (!d) {
        return <Modal title="Invoice" onClose={onClose} wide>{error ? <ErrorLine message={error} /> : <p className="text-sm text-text-tertiary py-10 text-center">Loading…</p>}</Modal>;
    }
    const inv = d.invoice;
    const finished = ['accepted', 'rejected', 'resubmission_required'].includes(inv.review_status);
    const reading = ['pending', 'processing'].includes(inv.extraction_status);
    const doc = d.documents[0];

    return (
        <Modal title={`Invoice ${inv.invoice_number ?? '(no number)'} · PO ${d.po?.po_number ?? ''}`} onClose={onClose} wide>
            <div className="space-y-5">
                {/* status strip */}
                <div className="flex flex-wrap items-center gap-2">
                    <Pill tone={matchTone(inv.match_status)}>{reading ? 'Reading…' : label(inv.match_status)}</Pill>
                    <Pill tone={reviewTone(inv.review_status)}>{label(inv.review_status)}</Pill>
                    {inv.extraction_status === 'failed' && <Pill tone="red">Could not read</Pill>}
                    {inv.corrected_at && <Pill tone="blue">Corrected by a person</Pill>}
                    <span className="text-xs text-text-tertiary">{d.po?.vendor_name}</span>
                    {doc?.signed_url && <a className={`${btnGhost} ml-auto`} href={doc.signed_url} target="_blank" rel="noreferrer"><ExternalLink className="w-4 h-4" /> Open original</a>}
                </div>
                {inFlight && d.summary && <StepProgress stage={d.summary.stage} />}
                {!inFlight && d.summary && inv.match_status !== 'pending' && (
                    d.summary.reasons.length === 0
                        ? <p className="flex items-center gap-2 text-sm font-bold text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-3 py-2" role="status"><CheckCircle2 className="w-4 h-4" /> {d.summary.headline}</p>
                        : (
                            <div className="rounded-xl border-2 border-amber-400/60 bg-amber-50 dark:bg-amber-500/10 p-3" role="status">
                                <p className="flex items-center gap-2 text-sm font-bold text-amber-900 dark:text-amber-200"><AlertTriangle className="w-4 h-4 shrink-0" /> {d.summary.headline}</p>
                                <ul className="mt-1.5 space-y-1 text-sm text-amber-900 dark:text-amber-200">{d.summary.reasons.map((r) => <li key={r} className="leading-snug">· {r}</li>)}</ul>
                                {d.summary.next && <p className="mt-2 text-xs font-bold text-amber-900 dark:text-amber-200">{d.summary.next}</p>}
                            </div>
                        )
                )}
                {inv.extraction_error && <p className="text-xs text-red-600 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">Reading failed: {inv.extraction_error}. Enter the values yourself with Edit, or try Read again.</p>}
                {inv.review_note && <p className="text-xs text-text-secondary bg-surface-elevated rounded-xl px-3 py-2">Note: {inv.review_note}</p>}
                <ErrorLine message={error} />

                {/* checks: one ordered flow, read top to bottom */}
                <section>
                    <h3 className="text-sm font-bold text-text-primary mb-2">Checks against the PO</h3>
                    {!d.rules.length && <p className="text-sm text-text-tertiary">{reading ? 'Waiting for the invoice to be read…' : 'No checks have run yet.'}</p>}
                    {d.rules.length > 0 && (
                        <ol className="relative ml-3 border-l-2 border-border">
                            {steps.map((st, i) => {
                                const tone = st.state === 'pass' ? 'bg-emerald-500 text-white' : st.state === 'fail' ? 'bg-red-500 text-white' : st.state === 'unknown' ? 'bg-amber-500 text-white' : 'bg-surface border border-border text-text-tertiary';
                                return (
                                    <li key={st.code} className="relative pl-6 pb-3 last:pb-0">
                                        <span className={`absolute -left-[13px] top-0 w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold ${tone}`} aria-hidden>
                                            {st.state === 'pass' ? '✓' : st.state === 'fail' ? '✗' : st.state === 'unknown' ? '?' : i + 1}
                                        </span>
                                        <div className="flex flex-wrap items-baseline gap-x-2">
                                            <span className={`text-sm ${st.state === 'pass' || st.state === 'none' ? 'text-text-secondary' : 'font-bold text-text-primary'}`}>{st.label}</span>
                                            {st.state === 'pass' && <span className="text-[11px] text-emerald-700 dark:text-emerald-400">ok</span>}
                                            {st.state === 'none' && <span className="text-[11px] text-text-tertiary">not checked</span>}
                                            {st.resolved > 0 && <span className="text-[11px] text-blue-700 dark:text-blue-400">{st.resolved} resolved by a person</span>}
                                        </div>
                                        {st.state !== 'pass' && st.state !== 'none' && (
                                            <ul className="mt-1 space-y-1.5">
                                                {st.rows.map((r) => {
                                                    const canResolve = !finished && !r.resolved_at && (r.severity === 'blocking' || r.rule_code === 'DUPLICATE_CHECK' ? d.caps.can_resolve_blocking : d.caps.can_resolve_soft);
                                                    return (
                                                        <li key={r.id} className="text-sm text-text-primary leading-snug">
                                                            {reasonFor(r)}
                                                            {r.resolved_at && <span className="text-xs text-blue-700 dark:text-blue-400"> · resolved: {r.resolution_note}</span>}
                                                            {canResolve && (resolving === r.id ? (
                                                                <div className="mt-1.5 flex flex-col sm:flex-row gap-2">
                                                                    <input className={inputCls} placeholder="Why is this acceptable?" value={note} onChange={(e) => setNote(e.target.value)} />
                                                                    <button className={btnPrimary} disabled={busy || note.trim().length < 5} onClick={() => run(async () => { await post('review', { action: 'resolve', validation_id: r.id, note }); setResolving(null); setNote(''); })}>Resolve</button>
                                                                    <button className={btnGhost} onClick={() => setResolving(null)}>Cancel</button>
                                                                </div>
                                                            ) : <button className="ml-2 text-xs font-bold text-primary hover:underline" onClick={() => { setResolving(r.id); setNote(''); }}>Resolve with a reason</button>)}
                                                        </li>
                                                    );
                                                })}
                                            </ul>
                                        )}
                                    </li>
                                );
                            })}
                        </ol>
                    )}
                </section>

                {/* values */}
                <section>
                    <div className="flex items-center justify-between mb-2">
                        <button className="text-sm font-bold text-text-primary inline-flex items-center gap-1" onClick={() => setShowValues((v) => !v)} aria-expanded={showValues || editing}><ChevronDown className={`w-4 h-4 transition-transform ${showValues || editing ? 'rotate-180' : ''}`} /> What the invoice says</button>
                        {!editing && !finished && d.caps.can_resolve_soft && <button className={btnGhost} onClick={() => { setShowValues(true); startEdit(); }} disabled={reading}><Pencil className="w-4 h-4" /> Edit values</button>}
                    </div>
                    {(showValues || editing) && (!editing ? (
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2 text-sm">
                            {HEADER_FIELDS.map(([k, l, t]) => (
                                <div key={k}><div className="text-[11px] text-text-tertiary">{l}</div><div className="text-text-primary font-medium break-all">{t === 'number' ? inr(inv[k] as number | null) : t === 'date' ? shortDate(inv[k] as string | null) : (inv[k] as string | null) ?? '—'}</div></div>
                            ))}
                        </div>
                    ) : (
                        <div className="space-y-3">
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                {HEADER_FIELDS.map(([k, l, t]) => <Field key={k} label={l}><input className={inputCls} type={t} step={t === 'number' ? '0.01' : undefined} value={header[k] ?? ''} onChange={(e) => setHeader((h) => ({ ...h, [k]: e.target.value }))} /></Field>)}
                            </div>
                            <div className="text-xs font-bold text-text-secondary">Lines</div>
                            <div className="overflow-x-auto border border-border rounded-xl">
                                <table className="w-full text-xs">
                                    <thead className="bg-surface-elevated text-text-tertiary"><tr>{LINE_FIELDS.map(([, l]) => <th key={l} className="px-2 py-2 text-left font-bold">{l}</th>)}<th /></tr></thead>
                                    <tbody>
                                        {lines.map((l, i) => (
                                            <tr key={i} className="border-t border-border">
                                                {LINE_FIELDS.map(([k, , t]) => <td key={k} className="p-1"><input className={`${inputCls} !py-1 !px-2 text-xs ${k === 'description' ? 'min-w-[200px]' : 'w-20'}`} type={t} step={t === 'number' ? 'any' : undefined} value={String(l[k] ?? '')} onChange={(e) => setLines((ls) => ls.map((x, j) => j === i ? { ...x, [k]: e.target.value } : x))} /></td>)}
                                                <td className="p-1"><button className="text-red-600 text-xs" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} aria-label="Remove line">✕</button></td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                            <button className={btnGhost} onClick={() => setLines((ls) => [...ls, { description: '' }])}>Add line</button>
                            <Field label="What did you correct, and why?"><input className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. total misread, checked against the PDF" /></Field>
                            <div className="flex gap-2">
                                <button className={btnPrimary} disabled={busy || reason.trim().length < 5} onClick={saveEdit}>Save and re-check</button>
                                <button className={btnGhost} onClick={() => setEditing(false)}>Cancel</button>
                            </div>
                        </div>
                    ))}

                    {!editing && showValues && d.lines.length > 0 && (
                        <div className="overflow-x-auto border border-border rounded-xl mt-3">
                            <table className="w-full text-xs">
                                <thead className="bg-surface-elevated text-text-tertiary"><tr><th className="px-2 py-2 text-left">#</th><th className="px-2 py-2 text-left">Invoice line</th><th className="px-2 py-2 text-left">Matched PO line</th><th className="px-2 py-2 text-right">Qty</th><th className="px-2 py-2 text-right">Rate</th><th className="px-2 py-2 text-right">Total</th></tr></thead>
                                <tbody>
                                    {d.lines.map((l) => {
                                        const po = d.po_lines.find((p) => p.id === l.po_line_item_id);
                                        return (
                                            <tr key={l.id} className="border-t border-border">
                                                <td className="px-2 py-1.5">{l.line_no}</td>
                                                <td className="px-2 py-1.5 text-text-primary">{l.description}</td>
                                                <td className="px-2 py-1.5">{l.po_line_item_id ? <span className="text-text-secondary">{poLineName.get(l.po_line_item_id)} <span className="text-text-tertiary">({fmt(po?.quantity)} @ {fmt(po?.rate)})</span></span> : <Pill tone="amber">Not matched</Pill>}</td>
                                                <td className="px-2 py-1.5 text-right tabular-nums">{fmt(l.quantity)}</td>
                                                <td className="px-2 py-1.5 text-right tabular-nums">{fmt(l.unit_rate)}</td>
                                                <td className="px-2 py-1.5 text-right tabular-nums">{inr(l.line_total)}</td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </section>

                {/* history */}
                {(d.history.length > 0 || d.events.length > 0) && (
                    <section>
                        <button className="flex items-center gap-1 text-xs font-bold text-text-secondary" onClick={() => setShowAudit((v) => !v)}><ChevronDown className={`w-4 h-4 transition-transform ${showAudit ? 'rotate-180' : ''}`} /> History and audit trail</button>
                        {showAudit && (
                            <div className="mt-2 space-y-3">
                                {d.history.length > 0 && (
                                    <div>
                                        <div className="text-[11px] font-bold text-text-tertiary mb-1">Earlier checks that did not pass (kept on record)</div>
                                        <ul className="text-xs text-text-secondary space-y-1">{d.history.slice(0, 30).map((r) => <li key={r.id}>{shortDate(r.created_at)} · {RULE_LABELS[r.rule_code] ?? r.rule_code}: {r.explanation}</li>)}</ul>
                                    </div>
                                )}
                                <ul className="text-xs text-text-secondary space-y-1">
                                    {d.events.map((e) => <li key={e.id}>{new Date(e.created_at).toLocaleString('en-IN')} · <b>{label(e.event_type)}</b> · {e.actor_name ?? (e.event_type.startsWith('invoice_submitted') ? 'Vendor' : 'System')}{e.actor_role ? ` (${e.actor_role})` : ''}</li>)}
                                </ul>
                            </div>
                        )}
                    </section>
                )}

                {/* actions */}
                {!finished && !editing && (
                    <div className="border-t border-border pt-4 space-y-3">
                        {decision && decision !== 'accept' && (
                            <div className="space-y-2">
                                <input className={inputCls} placeholder="Reason" value={decisionReason} onChange={(e) => setReasonText(e.target.value)} />
                                <div className="flex gap-2">
                                    <button className={btnDanger} disabled={busy || decisionReason.trim().length < 5} onClick={() => run(async () => { await post('review', { action: decision, reason: decisionReason }); setDecision(null); setReasonText(''); })}>{decision === 'reject' ? 'Reject invoice' : 'Ask vendor to resubmit'}</button>
                                    <button className={btnGhost} onClick={() => setDecision(null)}>Cancel</button>
                                </div>
                            </div>
                        )}
                        {!decision && (
                            <div className="flex flex-wrap gap-2">
                                {d.caps.can_accept && <button className={btnPrimary} disabled={busy || inv.match_status !== 'matched'} title={inv.match_status !== 'matched' ? 'Resolve or correct the open checks first' : ''} onClick={() => run(() => post('review', { action: 'accept' }))}><Check className="w-4 h-4" /> Accept invoice</button>}
                                {d.caps.can_resolve_soft && <button className={btnGhost} disabled={busy || reading} onClick={() => run(() => post('revalidate'))}><RefreshCw className="w-4 h-4" /> Re-check</button>}
                                {d.caps.can_resolve_soft && <button className={btnGhost} disabled={busy || reading} onClick={() => run(async () => { try { await post('process'); } catch (e) { if ((e as ApiError).data?.needs_confirmation && confirm('This will overwrite the corrections made by a person. Continue?')) await post('process', { discard_corrections: true }); else throw e; } })}>Read again</button>}
                                {d.caps.can_resolve_soft && <button className={btnGhost} onClick={() => { setDecision('request_resubmission'); setReasonText(''); }}>Ask vendor to resubmit</button>}
                                {d.caps.can_resolve_soft && <button className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-red-500/30 text-sm font-bold text-red-600 hover:bg-red-500/10" onClick={() => { setDecision('reject'); setReasonText(''); }}>Reject</button>}
                            </div>
                        )}
                        {d.caps.can_accept && inv.match_status !== 'matched' && !reading && <p className="text-xs text-text-tertiary">Accept unlocks once every open check is resolved or corrected.</p>}
                    </div>
                )}
            </div>
        </Modal>
    );
}

/** Where the invoice is right now, in four plain steps. No detail on purpose. */
function StepProgress({ stage }: { stage: InvoiceStage }) {
    const at = Math.max(0, STAGE_STEPS.findIndex((x) => x.key === stage));
    return (
        <ol className="flex items-center gap-2 rounded-xl border border-border bg-surface-elevated px-3 py-3" aria-label="Progress" role="status">
            {STAGE_STEPS.map((step, i) => {
                const done = i < at, current = i === at;
                return (
                    <li key={step.key} className="flex items-center gap-2 min-w-0 flex-1 last:flex-none">
                        <span className={`shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold ${done ? 'bg-emerald-500 text-white' : current ? 'bg-primary text-white' : 'bg-surface border border-border text-text-tertiary'}`}>
                            {done ? '✓' : current ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : i + 1}
                        </span>
                        <span className={`text-xs truncate ${current ? 'font-bold text-text-primary' : done ? 'text-text-secondary' : 'text-text-tertiary'}`}>{step.label}</span>
                        {i < STAGE_STEPS.length - 1 && <span className={`h-px flex-1 min-w-[12px] ${done ? 'bg-emerald-500' : 'bg-border'}`} />}
                    </li>
                );
            })}
        </ol>
    );
}
