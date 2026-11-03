'use client';

import React, { useEffect, useState } from 'react';
import { CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react';

/**
 * A live, plain-English line for the invoice on a PO: "Reading the invoice…", then either "Matches
 * the PO" or what is wrong and what to do. Shown under the Tax invoice row on the PO's Documents
 * tab, so whoever just uploaded can watch it happen without opening anything.
 *
 * No technical detail on purpose: no rule names, no scores. The exact reasons come from the same
 * plain-language source the Align screen uses.
 */

interface Verdict { state: string; headline?: string; reasons?: string[]; next?: string | null; invoice_number?: string | null; invoice_id?: string | null }

interface ReadResult {
    invoice: Record<string, unknown> & { extracted?: Record<string, unknown> | null };
    lines: { line_no: number; description: string | null; hsn_or_sac: string | null; quantity: number | null; unit: string | null; unit_rate: number | null; taxable_amount: number | null; line_total: number | null; extraction_confidence?: number | null }[];
}

const inr = (n: unknown) => (n == null || n === '' ? '—' : `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`);
const show = (v: unknown) => (v == null || v === '' ? <span className="text-text-tertiary">not found</span> : String(v));

/** The reader's own confidence, 0-100. Colour is a hint, never a verdict: 90+ clear, 70-89 check it, under 70 doubtful, 0 not found. */
function Conf({ v }: { v: number | null | undefined }) {
    if (v == null) return null;
    const n = Math.round(v);
    const cls = n <= 0 ? 'bg-slate-500/10 text-text-tertiary' : n >= 90 ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' : n >= 70 ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400' : 'bg-red-500/10 text-red-700 dark:text-red-400';
    return <span className={`ml-1.5 px-1.5 py-px rounded-full text-[10px] font-bold tabular-nums ${cls}`} title="How sure the reader says it is">{n <= 0 ? 'not read' : `${n}%`}</span>;
}

/** What the reader found on the invoice, so a person can see at a glance it got the main fields right. */
function WhatWasRead({ orgId, invoiceId }: { orgId: string; invoiceId: string }) {
    const [open, setOpen] = useState(false);
    const [d, setD] = useState<ReadResult | null>(null);
    const [err, setErr] = useState<string | null>(null);
    useEffect(() => {
        if (!open || d) return;
        let alive = true;
        fetch(`/api/invoices/${invoiceId}?org_id=${encodeURIComponent(orgId)}`).then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`); return j as ReadResult; })
            .then((j) => { if (alive) setD(j); }).catch((e: Error) => { if (alive) setErr(e.message); });
        return () => { alive = false; };
    }, [open, d, invoiceId, orgId]);
    const i = d?.invoice; const x = (i?.extracted ?? {}) as Record<string, unknown>;
    const tax = [x.cgst_amount != null && `CGST ${inr(x.cgst_amount)}`, x.sgst_amount != null && `SGST ${inr(x.sgst_amount)}`, x.igst_amount != null && `IGST ${inr(x.igst_amount)}`].filter(Boolean).join(' · ');
    const fc = (x.field_confidence ?? {}) as Record<string, number>;
    const keyScores = ['invoice_number', 'invoice_date', 'taxable_amount', 'invoice_total', 'vendor'].map((k) => fc[k]).filter((v) => typeof v === 'number');
    const notRead = keyScores.filter((v) => v <= 0).length;
    const lowest = keyScores.filter((v) => v > 0).length ? Math.min(...keyScores.filter((v) => v > 0)) : null;
    // The two checks below are arithmetic, not opinion: they are exact.
    const nz = (v: unknown) => (v == null || v === '' ? null : Number(v));
    const taxable = nz(i?.taxable_amount), taxAmt = nz(i?.tax_amount), total = nz(i?.invoice_total), other = nz(i?.other_charges) ?? 0, disc = nz(i?.discount_amount) ?? 0;
    const headerOk = taxable != null && taxAmt != null && total != null ? Math.abs(taxable + taxAmt + other - disc - total) <= 2 : null;
    const lineAmts = (d?.lines ?? []).map((l) => l.taxable_amount ?? l.line_total).filter((v): v is number => v != null);
    const linesOk = taxable != null && lineAmts.length ? [taxable, taxable - other, taxable + disc, taxable - other + disc].some((t) => Math.abs(lineAmts.reduce((a, b) => a + b, 0) - t) <= Math.max(2, taxable * 0.001)) : null;
    const rows: [string, React.ReactNode][] = i ? [
        ['Vendor', <>{show(i.vendor_name_read)}<Conf v={fc.vendor} /></>], ['Vendor GSTIN', <>{show(i.vendor_gstin_read)}<Conf v={i.vendor_gstin_read ? fc.vendor : null} /></>], ['Billed to', show(x.buyer_name)], ['Billed-to GSTIN', show(x.buyer_gstin)],
        ['Invoice number', <>{show(i.invoice_number)}<Conf v={fc.invoice_number} /></>], ['Invoice date', <>{show(i.invoice_date)}<Conf v={fc.invoice_date} /></>], ['PO on invoice', show(x.po_reference)], ['Due date', show(x.due_date)],
        ['Taxable amount', <>{inr(i.taxable_amount)}<Conf v={fc.taxable_amount} /></>], ['Tax', `${inr(i.tax_amount)}${tax ? ` (${tax})` : ''}`], ['Round off', x.round_off == null ? '—' : inr(x.round_off)], ['Total', <><b key="t">{inr(i.invoice_total)}</b><Conf v={fc.invoice_total} /></>],
    ] : [];
    return (
        <div className="mt-1.5">
            <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="text-xs font-bold text-primary hover:underline">{open ? 'Hide what was read' : 'Show what was read from the invoice'}</button>
            {open && !d && !err && <p className="text-xs text-text-tertiary mt-1">Loading…</p>}
            {err && <p className="text-xs text-error mt-1">{err}</p>}
            {d && i && (
                <div className="mt-1.5 rounded-lg border border-border bg-surface-elevated/50 p-2.5 text-xs space-y-2">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pb-2 border-b border-border">
                        <span className="text-text-secondary">Reader confidence: {lowest == null ? <b className="text-text-primary">nothing read</b> : <><b className="text-text-primary">{Math.round(lowest)}%</b> on the least sure key field</>}{notRead > 0 ? `, ${notRead} key field${notRead > 1 ? 's' : ''} not read` : ''}</span>
                        {headerOk != null && <span className={headerOk ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'}>{headerOk ? '✓' : '✗'} Taxable + tax {headerOk ? 'equals' : 'does not equal'} the total</span>}
                        {linesOk != null && <span className={linesOk ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'}>{linesOk ? '✓' : '✗'} Line amounts {linesOk ? 'add up to' : 'do not add up to'} the taxable amount</span>}
                    </div>
                    <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
                        {rows.map(([k, v]) => <div key={k} className="flex gap-2"><dt className="w-28 shrink-0 text-text-tertiary">{k}</dt><dd className="text-text-primary break-words min-w-0">{v}</dd></div>)}
                    </dl>
                    <p className="text-[10px] text-text-tertiary">Percentages are the reader&apos;s own estimate of how sure it is, not a measured accuracy. The two ticks above are exact arithmetic on the figures read.</p>
                    {Array.isArray(x.repairs) && x.repairs.length > 0 && <p className="text-[11px] text-amber-700 dark:text-amber-400">{(x.repairs as string[]).map((r) => (r === 'taxable_amount' ? 'Taxable amount' : r === 'tax_amount' ? 'Tax total' : r)).join(' and ')} worked out from other figures printed on the invoice, because the first read did not add up.</p>}
                    {d.lines.length > 0 && (
                        <div className="overflow-x-auto">
                            <table className="w-full text-[11px]">
                                <thead><tr className="text-left text-text-tertiary"><th className="pr-2 py-1">Item</th><th className="pr-2">HSN/SAC</th><th className="pr-2 text-right">Qty</th><th className="pr-2 text-right">Rate</th><th className="pr-2 text-right">Amount</th><th className="text-right">Sure</th></tr></thead>
                                <tbody className="divide-y divide-border">{d.lines.map((l) => <tr key={l.line_no} className="align-top"><td className="pr-2 py-1 text-text-primary">{l.description ?? '—'}</td><td className="pr-2 whitespace-nowrap">{l.hsn_or_sac ?? '—'}</td><td className="pr-2 text-right whitespace-nowrap">{l.quantity ?? '—'}{l.unit ? ` ${l.unit}` : ''}</td><td className="pr-2 text-right whitespace-nowrap">{l.unit_rate == null ? '—' : inr(l.unit_rate)}</td><td className="pr-2 text-right whitespace-nowrap font-bold">{inr(l.taxable_amount ?? l.line_total)}</td><td className="text-right whitespace-nowrap"><Conf v={l.extraction_confidence == null ? null : Number(l.extraction_confidence) * 100} /></td></tr>)}</tbody>
                            </table>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

/** A document uploaded this recently is still on its way into Invoice Control, so "no invoice yet" means "starting". */
const STARTING_WINDOW_MS = 90_000;

export default function InvoiceLiveStatus({ orgId, poId, uploadedAt }: { orgId: string; poId: string; uploadedAt?: string | null }) {
    const [v, setV] = useState<Verdict | null>(null);
    const [tick, setTick] = useState(0);
    const [now, setNow] = useState(() => Date.now());

    useEffect(() => {
        let alive = true;
        fetch(`/api/invoices/verdict?${new URLSearchParams({ po_id: poId, org_id: orgId })}`)
            .then((r) => (r.ok ? r.json() : null))
            .then((d: Verdict | null) => { if (alive && d) { setV(d); setNow(Date.now()); } })
            .catch(() => undefined);
        return () => { alive = false; };
    }, [orgId, poId, tick]);

    const fresh = !!uploadedAt && now - new Date(uploadedAt).getTime() < STARTING_WINDOW_MS;
    const working = v?.state === 'reading' || (v?.state === 'none' && fresh);

    useEffect(() => {
        if (!working) return;
        const t = setTimeout(() => setTick((n) => n + 1), 2500);
        return () => clearTimeout(t);
    }, [working, tick]);

    if (!v || v.state === 'unavailable') return null;
    if (working) {
        return (
            <p className="flex items-center gap-1.5 text-xs text-text-secondary" role="status">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" /> {v.state === 'none' ? 'Starting the check…' : 'Reading the invoice and checking it against the PO…'}
            </p>
        );
    }
    if (v.state === 'matched') {
        return <div role="status"><p className="flex items-center gap-1.5 text-xs text-success font-bold"><CheckCircle2 className="w-3.5 h-3.5" /> Matches the PO{v.invoice_number ? ` · ${v.invoice_number}` : ''}</p>{v.invoice_id && <WhatWasRead key={v.invoice_id} orgId={orgId} invoiceId={v.invoice_id} />}</div>;
    }
    if (v.state === 'none') return null;
    return (
        <div className="text-xs rounded-lg border border-amber-400/50 bg-amber-50 dark:bg-amber-500/10 px-2.5 py-2" role="status">
            <p className="flex items-center gap-1.5 font-bold text-amber-900 dark:text-amber-200"><AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {v.headline || 'This invoice needs attention'}{v.invoice_number ? ` · ${v.invoice_number}` : ''}</p>
            {(v.reasons ?? []).length > 0 && (
                <ul className="mt-1 space-y-1 text-amber-900 dark:text-amber-200">{v.reasons!.map((r) => <li key={r} className="leading-snug">· {r}</li>)}</ul>
            )}
            {v.next && <p className="mt-1 font-bold text-amber-900 dark:text-amber-200">{v.next}</p>}
            {v.invoice_id && v.headline !== 'The invoice could not be read' && <WhatWasRead key={v.invoice_id} orgId={orgId} invoiceId={v.invoice_id} />}
        </div>
    );
}
