'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ExternalLink, RefreshCw, Pencil, Check, ShieldAlert, ChevronDown } from 'lucide-react';
import {
    api, ApiError, inr, shortDate, label, Pill, matchTone, reviewTone, Modal, Field, inputCls, btnPrimary, btnGhost, btnDanger, ErrorLine,
} from './invoiceUi';
import { RULE_LABELS } from '@/backend/lib/invoices/types';

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
    documents: { id: string; original_filename: string; content_type: string; source_channel: string; signed_url: string | null; uploaded_at: string }[];
    lines: Line[]; po: { po_number: string; vendor_name: string | null; po_amount: number | null; status: string | null } | null;
    po_lines: { id: string; name: string | null; quantity: number | null; rate: number | null; unit: string | null; tax_percentage: number | null }[];
    rules: Rule[]; history: Rule[]; events: { id: string; event_type: string; actor_name: string | null; actor_role: string | null; created_at: string }[];
    caps: { can_resolve_soft: boolean; can_resolve_blocking: boolean; can_accept: boolean };
}

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
    const [decision, setDecision] = useState<null | 'reject' | 'request_resubmission' | 'accept'>(null);
    const [showAudit, setShowAudit] = useState(false);

    const load = useCallback(async () => {
        try {
            const x = await api<Detail>(`/api/invoices/${invoiceId}?org_id=${orgId}`);
            setD(x); setError(null);
        } catch (e) { setError((e as Error).message); }
    }, [invoiceId, orgId]);
    useEffect(() => { load(); }, [load]);

    // A fresh upload is read in the background: poll while it is not done.
    useEffect(() => {
        if (!d || !['pending', 'processing'].includes(d.invoice.extraction_status)) return;
        const t = setTimeout(load, 4000);
        return () => clearTimeout(t);
    }, [d, load]);

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
    const open = useMemo(() => (d?.rules ?? []).filter((r) => r.outcome !== 'pass'), [d]);
    const passed = useMemo(() => (d?.rules ?? []).filter((r) => r.outcome === 'pass'), [d]);

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
                    <span className="text-xs text-text-tertiary">{d.po?.vendor_name} · PO {inr(d.po?.po_amount)} · received {shortDate(inv.submitted_at)} ({inv.submitted_via === 'vendor_link' ? 'vendor link' : 'internal upload'})</span>
                    {doc?.signed_url && <a className={`${btnGhost} ml-auto`} href={doc.signed_url} target="_blank" rel="noreferrer"><ExternalLink className="w-4 h-4" /> Open original</a>}
                </div>
                {inv.extraction_error && <p className="text-xs text-red-600 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">Reading failed: {inv.extraction_error}. Enter the values yourself with Edit, or try Read again.</p>}
                {inv.review_note && <p className="text-xs text-text-secondary bg-surface-elevated rounded-xl px-3 py-2">Note: {inv.review_note}</p>}
                <ErrorLine message={error} />

                {/* checks */}
                <section>
                    <h3 className="text-sm font-bold text-text-primary mb-2">Checks against the PO</h3>
                    {!d.rules.length && <p className="text-sm text-text-tertiary">{reading ? 'Waiting for the invoice to be read…' : 'No checks have run yet.'}</p>}
                    <ul className="space-y-2">
                        {open.map((r) => {
                            const resolved = !!r.resolved_at;
                            const canResolve = !finished && !resolved && (r.severity === 'blocking' || r.rule_code === 'DUPLICATE_CHECK' ? d.caps.can_resolve_blocking : d.caps.can_resolve_soft);
                            return (
                                <li key={r.id} className={`rounded-xl border px-3 py-2.5 ${resolved ? 'border-border bg-surface-elevated/50' : r.outcome === 'fail' ? 'border-red-500/30 bg-red-500/5' : 'border-amber-500/30 bg-amber-500/5'}`}>
                                    <div className="flex flex-wrap items-center gap-2">
                                        <Pill tone={resolved ? 'blue' : r.outcome === 'fail' ? 'red' : 'amber'}>{resolved ? `Resolved (was ${r.original_outcome})` : r.outcome === 'fail' ? 'Does not match' : 'Cannot tell'}</Pill>
                                        <span className="text-sm font-bold text-text-primary">{RULE_LABELS[r.rule_code] ?? r.rule_code}</span>
                                        {r.severity === 'blocking' && !resolved && <span className="inline-flex items-center gap-1 text-[11px] font-bold text-red-600"><ShieldAlert className="w-3 h-3" /> blocking</span>}
                                        {r.invoice_line_no && <span className="text-[11px] text-text-tertiary">line {r.invoice_line_no}</span>}
                                    </div>
                                    <p className="text-sm text-text-secondary mt-1">{r.explanation}</p>
                                    {(r.expected_value != null || r.actual_value != null) && (
                                        <p className="text-xs text-text-tertiary mt-1">Expected <b>{fmt(r.expected_value)}</b> · Found <b>{fmt(r.actual_value)}</b>{r.difference_amount != null ? ` · Difference ${inr(r.difference_amount)}` : ''}</p>
                                    )}
                                    {resolved && <p className="text-xs text-text-secondary mt-1">Resolution: {r.resolution_note}</p>}
                                    {canResolve && (resolving === r.id ? (
                                        <div className="mt-2 flex flex-col sm:flex-row gap-2">
                                            <input className={inputCls} placeholder="Why is this acceptable?" value={note} onChange={(e) => setNote(e.target.value)} />
                                            <button className={btnPrimary} disabled={busy || note.trim().length < 5} onClick={() => run(async () => { await post('review', { action: 'resolve', validation_id: r.id, note }); setResolving(null); setNote(''); })}>Resolve</button>
                                            <button className={btnGhost} onClick={() => setResolving(null)}>Cancel</button>
                                        </div>
                                    ) : <button className="mt-2 text-xs font-bold text-primary hover:underline" onClick={() => { setResolving(r.id); setNote(''); }}>Resolve with a reason</button>)}
                                </li>
                            );
                        })}
                    </ul>
                    {passed.length > 0 && <p className="text-xs text-text-tertiary mt-2"><Check className="w-3 h-3 inline text-emerald-600" /> {passed.length} check{passed.length > 1 ? 's' : ''} passed: {[...new Set(passed.map((p) => RULE_LABELS[p.rule_code] ?? p.rule_code))].join(', ')}.</p>}
                </section>

                {/* values */}
                <section>
                    <div className="flex items-center justify-between mb-2">
                        <h3 className="text-sm font-bold text-text-primary">What the invoice says</h3>
                        {!editing && !finished && d.caps.can_resolve_soft && <button className={btnGhost} onClick={startEdit} disabled={reading}><Pencil className="w-4 h-4" /> Edit values</button>}
                    </div>
                    {!editing ? (
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
                    )}

                    {!editing && d.lines.length > 0 && (
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
                                <input className={inputCls} placeholder="Reason" value={note} onChange={(e) => setNote(e.target.value)} />
                                <div className="flex gap-2">
                                    <button className={btnDanger} disabled={busy || note.trim().length < 5} onClick={() => run(async () => { await post('review', { action: decision, reason: note }); setDecision(null); setNote(''); })}>{decision === 'reject' ? 'Reject invoice' : 'Ask vendor to resubmit'}</button>
                                    <button className={btnGhost} onClick={() => setDecision(null)}>Cancel</button>
                                </div>
                            </div>
                        )}
                        {!decision && (
                            <div className="flex flex-wrap gap-2">
                                {d.caps.can_accept && <button className={btnPrimary} disabled={busy || inv.match_status !== 'matched'} title={inv.match_status !== 'matched' ? 'Resolve or correct the open checks first' : ''} onClick={() => run(() => post('review', { action: 'accept' }))}><Check className="w-4 h-4" /> Accept invoice</button>}
                                {d.caps.can_resolve_soft && <button className={btnGhost} disabled={busy || reading} onClick={() => run(() => post('revalidate'))}><RefreshCw className="w-4 h-4" /> Re-check</button>}
                                {d.caps.can_resolve_soft && <button className={btnGhost} disabled={busy || reading} onClick={() => run(async () => { try { await post('process'); } catch (e) { if ((e as ApiError).data?.needs_confirmation && confirm('This will overwrite the corrections made by a person. Continue?')) await post('process', { discard_corrections: true }); else throw e; } })}>Read again</button>}
                                {d.caps.can_resolve_soft && <button className={btnGhost} onClick={() => { setDecision('request_resubmission'); setNote(''); }}>Ask vendor to resubmit</button>}
                                {d.caps.can_resolve_soft && <button className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-red-500/30 text-sm font-bold text-red-600 hover:bg-red-500/10" onClick={() => { setDecision('reject'); setNote(''); }}>Reject</button>}
                            </div>
                        )}
                        {d.caps.can_accept && inv.match_status !== 'matched' && !reading && <p className="text-xs text-text-tertiary">Accept unlocks once every open check is resolved or corrected.</p>}
                    </div>
                )}
            </div>
        </Modal>
    );
}
