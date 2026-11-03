'use client';

import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Loader2, AlertTriangle } from 'lucide-react';
import { PurchaseOrder, PAYMENT_TERMS, inr } from '@/frontend/lib/accounts/roles';
import { TRANCHE_PRESETS } from '@/frontend/lib/accounts/trackerTypes';

interface Props { po: PurchaseOrder; onClose: () => void; onDone: () => void; orgId?: string; }

interface InvoiceWarning {
    state: 'reading' | 'matched' | 'mismatched' | 'needs_review' | 'duplicate_suspected' | 'none' | 'unavailable';
    message: string;
    invoice_number: string | null;
    failed_rules: string[];
    /** The findings in plain words with the real figures. Preferred over failed_rules. */
    reasons?: string[];
    headline?: string;
    next?: string | null;
    reason_required: boolean;
    min_reason_length: number;
}

interface DuplicateWarning {
    po_number: string;
    po_amount: number;
    already_committed: number;
    fully_covered: boolean;
    other_po_rows: boolean;
    settled_count: number;
    payments: {
        tranche_no: number;
        status: string;
        requested_amount: number;
        paid_amount: number | null;
        utr_no: string | null;
        on: string | null;
    }[];
}

const shortDate = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

/** Round to paise, not rupees: 16% of POs carry paise, and a whole-rupee tranche leaves ₹0.xx pending forever. */
const paise = (n: number) => Math.round(n * 100) / 100;

export default function AlignPaymentModal({ po, onClose, onDone, orgId: orgIdProp }: Props) {
    const poOrg = orgIdProp ?? (po as { organization_id?: string }).organization_id;
    const pending = po.pending_amount ?? po.po_amount;
    const [amount, setAmount] = useState(String(paise(pending)));
    // The agreed share of the PO this tranche represents — some vendors take 30% upfront,
    // some 25%. `percent` and `amount` are kept in lockstep here so the two can never drift:
    // whichever field the user last touched is authoritative and recomputes the other from
    // po.po_amount. The backend rejects a mismatch, so this is the only place it can happen.
    const [percent, setPercent] = useState<number | null>(
        po.po_amount > 0 ? Math.round((pending / po.po_amount) * 10000) / 100 : null,
    );
    const [term, setTerm] = useState('');
    const [gstHold, setGstHold] = useState('');
    const [tds, setTds] = useState('');
    const [remarks, setRemarks] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    // Set when the API answers 409 duplicate_payment_suspected — the modal then shows what
    // is already on record against this PO number and asks for an explicit go-ahead.
    const [duplicate, setDuplicate] = useState<DuplicateWarning | null>(null);
    // Set when the API answers 409 invoice_not_verified — the invoice for this PO does not
    // agree with it, or has not arrived. A soft warning: aligning is still allowed, with a
    // written reason that is stored on the tranche.
    const [invoiceWarn, setInvoiceWarn] = useState<InvoiceWarning | null>(null);
    const [invoiceReason, setInvoiceReason] = useState('');
    const [invoiceLoading, setInvoiceLoading] = useState(true);
    // The PO's own payment plan (confirmed, or the reader's proposal when nothing is confirmed yet).
    // Picking a milestone sets the amount, the share of PO and the term in one go, so the tranche
    // matches what the PO actually says instead of a generic label.
    const [milestones, setMilestones] = useState<{ id: string; label: string; percent: number; amount: number; basis: string; state?: string }[]>([]);
    const [planConfirmed, setPlanConfirmed] = useState(false);
    useEffect(() => {
        let alive = true;
        const orgId = poOrg;
        const qs = new URLSearchParams({ po_id: po.id, ...(orgId ? { org_id: orgId } : {}) });
        fetch(`/api/po-schedule?${qs.toString()}`)
            .then(r => (r.ok ? r.json() : null))
            .then((d: { schedule?: { status?: string } | null; milestones?: unknown[]; proposal?: { milestones?: unknown[] } | null } | null) => {
                if (!alive || !d) return;
                const rows = ((d.schedule ? d.milestones : d.proposal?.milestones) ?? []) as { id?: string; seq?: number; label: string; percent: number; amount: number; basis: string; state?: string }[];
                setMilestones(rows.filter(m => m.basis !== 'gst').map((m, i) => ({ id: m.id ?? `p${i}`, label: m.label, percent: Number(m.percent), amount: Number(m.amount), basis: m.basis, state: m.state })));
                setPlanConfirmed(d.schedule?.status === 'confirmed');
            })
            .catch(() => undefined);
        return () => { alive = false; };
    }, [po, poOrg]);

    useEffect(() => {
        let alive = true;
        const orgId = poOrg;
        const qs = new URLSearchParams({ po_id: po.id, ...(orgId ? { org_id: orgId } : {}) });
        fetch(`/api/invoices/verdict?${qs.toString()}`)
            .then(r => r.ok ? r.json() : null)
            .then((d: (InvoiceWarning & { state: InvoiceWarning['state'] | 'matched' | 'unavailable' }) | null) => {
                if (!alive || !d) return;
                // 'matched' and 'unavailable' are shown but never demand a reason.
                setInvoiceWarn(d as InvoiceWarning);
            })
            .catch(() => undefined)
            .finally(() => { if (alive) setInvoiceLoading(false); });
        return () => { alive = false; };
    }, [po, poOrg]);

    // An invoice that has just been uploaded is still being read: look again every few seconds until the
    // verdict lands, so the reasons appear on their own.
    const stillReading = invoiceWarn?.state === 'reading';
    const [readingTooLong, setReadingTooLong] = useState(false);
    const waitForRead = stillReading && !readingTooLong;
    useEffect(() => {
        if (!stillReading) return;
        const orgId = poOrg;
        const qs = new URLSearchParams({ po_id: po.id, ...(orgId ? { org_id: orgId } : {}) });
        const t = setInterval(() => {
            fetch(`/api/invoices/verdict?${qs.toString()}`).then(r => (r.ok ? r.json() : null)).then(d => { if (d) setInvoiceWarn(d as InvoiceWarning); }).catch(() => undefined);
        }, 3000);
        // After 45 s, stop waiting: the person can align with a reason, as for any unchecked invoice.
        const give = setTimeout(() => setReadingTooLong(true), 45_000);
        return () => { clearInterval(t); clearTimeout(give); };
    }, [stillReading, po, poOrg]);

    const setFromPercent = (p: number) => {
        setPercent(p);
        if (po.po_amount > 0) setAmount(String(paise((po.po_amount * p) / 100)));
        const generic = PAYMENT_TERMS.find(t => t === `${p}% Advance`);
        // No standard term for this share: clear the old one rather than record a wrong term.
        setTerm(generic ?? '');
    };
    const pickMilestone = (id: string) => {
        const m = milestones.find(x => x.id === id);
        if (!m) return;
        // A basic-value milestone (before GST) is a smaller share of the tax-inclusive PO total;
        // setting the amount and letting the share follow keeps the two honest.
        setFromAmount(String(paise(m.amount)));
        setTerm(`${m.percent}% · ${m.label}`.slice(0, 120));
    };
    const setFromAmount = (v: string) => {
        setAmount(v);
        const n = Number(v);
        setPercent(po.po_amount > 0 && n > 0 ? Math.round((n / po.po_amount) * 10000) / 100 : null);
    };

    const submit = async (acknowledgeDuplicate = false) => {
        if (!amount || Number(amount) <= 0) { setError('Enter an amount to align'); return; }
        setSaving(true); setError(null);
        try {
            const res = await fetch('/api/accounts/payments', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    organization_id: poOrg,
                    po_id: po.id, requested_amount: Number(amount), payment_term: term || null,
                    gst_hold: gstHold ? Number(gstHold) : 0, tds: tds ? Number(tds) : 0, remarks: remarks || null,
                    percent_of_po: percent && percent > 0 ? percent : null,
                    ...(acknowledgeDuplicate ? { acknowledge_duplicate: true } : {}),
                    ...(invoiceReason.trim() ? { invoice_override_reason: invoiceReason.trim() } : {}),
                }),
            });
            if (res.status === 409) {
                const e = await res.json().catch(() => ({}));
                if (e?.error === 'duplicate_payment_suspected' && e.duplicate) { setDuplicate(e.duplicate); return; }
                if (e?.error === 'invoice_not_verified' && e.invoice) { setInvoiceWarn(e.invoice); return; }
            }
            if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || 'Failed to align'); }
            onDone();
        } catch (e) { setError(e instanceof Error ? e.message : 'Failed to align'); }
        finally { setSaving(false); }
    };

    if (typeof document === 'undefined') return null;
    const field = 'w-full px-3 py-2 border border-border rounded-lg text-sm bg-surface text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/20';
    const label = 'block text-xs font-bold text-text-secondary uppercase tracking-wide mb-1.5';

    return createPortal(
        <div data-esc-guard className="fixed inset-0 bg-black/50 z-[80] flex items-center justify-center p-4" onClick={onClose}>
            <div onClick={e => e.stopPropagation()} className="bg-surface rounded-2xl shadow-2xl w-full max-w-md max-h-[88vh] overflow-hidden flex flex-col">
                <div className="flex items-center justify-between px-6 py-4 border-b border-border">
                    <h3 className="text-base font-bold text-text-primary">Align payment · {po.po_number}</h3>
                    <button onClick={onClose} className="p-2 hover:bg-muted rounded-xl"><X className="w-5 h-5 text-text-secondary" /></button>
                </div>

                <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
                    {invoiceLoading && (
                        <div className="rounded-xl border border-border bg-surface-elevated p-3 text-xs text-text-tertiary">
                            Checking the invoice for this PO…
                        </div>
                    )}
                    {invoiceWarn?.state === 'matched' && (
                        <div className="rounded-xl border border-success/40 bg-success/10 p-3">
                            <p className="text-sm font-bold text-success">Invoice verified against this PO</p>
                            {invoiceWarn.invoice_number && (
                                <p className="text-xs text-text-secondary mt-0.5">Invoice {invoiceWarn.invoice_number}</p>
                            )}
                        </div>
                    )}
                    {invoiceWarn?.state === 'reading' && (
                        <div className="rounded-xl border border-border bg-surface-elevated p-3 flex items-center gap-2.5">
                            <Loader2 className="w-4 h-4 animate-spin text-primary shrink-0" />
                            <p className="text-sm text-text-primary">{readingTooLong ? 'The invoice is still being read. You can wait, or align now with a reason below.' : 'The invoice is being read and checked. The result will appear here in a few seconds.'}</p>
                        </div>
                    )}
                    {invoiceWarn && invoiceWarn.reason_required && !waitForRead && (
                        <div className="rounded-xl border-2 border-amber-400/60 bg-amber-50 dark:bg-amber-500/10 p-4">
                            <div className="flex items-start gap-2.5">
                                <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                                <div className="min-w-0 w-full">
                                    <p className="text-sm font-bold text-amber-900 dark:text-amber-200">{invoiceWarn.headline || invoiceWarn.message}</p>
                                    {invoiceWarn.invoice_number && (
                                        <p className="text-xs text-amber-800 dark:text-amber-300 mt-0.5">Invoice {invoiceWarn.invoice_number}</p>
                                    )}
                                    {(invoiceWarn.reasons?.length ?? 0) > 0 ? (
                                        <ul className="mt-2 space-y-1.5">
                                            {invoiceWarn.reasons!.map(r => (
                                                <li key={r} className="text-xs text-amber-900 dark:text-amber-200 leading-snug">· {r}</li>
                                            ))}
                                        </ul>
                                    ) : invoiceWarn.failed_rules.length > 0 && (
                                        <ul className="mt-2 space-y-0.5">
                                            {invoiceWarn.failed_rules.map(r => (
                                                <li key={r} className="text-xs text-amber-800 dark:text-amber-300">· {r.replace(/_/g, ' ').toLowerCase()}</li>
                                            ))}
                                        </ul>
                                    )}
                                    {invoiceWarn.next && <p className="text-xs font-bold text-amber-900 dark:text-amber-200 mt-2">{invoiceWarn.next}</p>}
                                    <p className="text-xs text-amber-800 dark:text-amber-300 mt-2">
                                        You can still align this payment. Say why, and the reason is kept on the tranche for whoever pays it.
                                    </p>
                                    <textarea
                                        value={invoiceReason}
                                        onChange={e => setInvoiceReason(e.target.value)}
                                        rows={2}
                                        placeholder="e.g. advance against PO, invoice to follow from the vendor"
                                        className="mt-2 w-full px-3 py-2 border border-amber-400/60 rounded-lg text-sm bg-surface text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-amber-500/30"
                                    />
                                    {invoiceReason.trim().length > 0 && invoiceReason.trim().length < invoiceWarn.min_reason_length && (
                                        <p className="text-[11px] text-amber-800 dark:text-amber-300 mt-1">
                                            A little more detail, please — at least {invoiceWarn.min_reason_length} characters.
                                        </p>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}
                    {duplicate && (
                        <div className="rounded-xl border-2 border-amber-400/60 bg-amber-50 dark:bg-amber-500/10 p-4">
                            <div className="flex items-start gap-2.5">
                                <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                                <div className="min-w-0">
                                    <p className="text-sm font-bold text-amber-900 dark:text-amber-200">
                                        {duplicate.fully_covered
                                            ? 'This PO already appears fully paid.'
                                            : 'This PO already has a payment on record.'}
                                    </p>
                                    <p className="text-xs text-amber-800/90 dark:text-amber-200/80 mt-1">
                                        {duplicate.settled_count > 0
                                            ? `${duplicate.settled_count} payment${duplicate.settled_count > 1 ? 's have' : ' has'} already been aligned or completed against ${duplicate.po_number}.`
                                            : `A payment is already registered against ${duplicate.po_number}.`}
                                        {duplicate.other_po_rows && ' Some of it sits on a different PO record carrying the same number.'}
                                    </p>
                                </div>
                            </div>

                            <div className="mt-3 rounded-lg bg-white/70 dark:bg-black/20 divide-y divide-amber-200/60 text-xs">
                                {duplicate.payments.map(p => (
                                    <div key={`${p.tranche_no}-${p.on}`} className="flex items-center justify-between gap-3 px-3 py-2">
                                        <span className="font-semibold text-text-primary">
                                            #{p.tranche_no} · {p.status}
                                        </span>
                                        <span className="text-text-secondary tabular-nums">
                                            {inr(p.paid_amount ?? p.requested_amount)} · {shortDate(p.on)}
                                            {p.utr_no ? ` · UTR ${p.utr_no}` : ''}
                                        </span>
                                    </div>
                                ))}
                            </div>

                            <p className="mt-3 text-xs font-semibold text-amber-900 dark:text-amber-200">
                                Already committed {inr(duplicate.already_committed)} of {inr(duplicate.po_amount)}.
                                Do you still want to raise this payment?
                            </p>
                        </div>
                    )}

                    <div className="bg-surface-elevated rounded-xl p-3 text-sm">
                        <div className="flex justify-between"><span className="text-text-tertiary">Vendor</span><span className="text-text-primary font-medium">{po.vendor_name || '—'}</span></div>
                        <div className="flex justify-between mt-1"><span className="text-text-tertiary">PO amount</span><span className="text-text-primary font-medium">{inr(po.po_amount)}</span></div>
                        <div className="flex justify-between mt-1"><span className="text-text-tertiary">Already aligned/paid</span><span className="text-text-primary font-medium">{inr((po.aligned_total || 0) + (po.completed_total || 0))}</span></div>
                        <div className="flex justify-between mt-1"><span className="text-text-tertiary">Pending</span><span className="text-amber-600 font-bold">{inr(pending)}</span></div>
                    </div>

                    {/* Tranche % — some vendors take 30% upfront, some 25%. Presets + a slider drive
                        the amount from po.po_amount; typing the amount directly recomputes the
                        percent from the same formula, so the two figures can never disagree. */}
                    <div>
                        <div className="flex items-center justify-between mb-1.5">
                            <label className={label + ' mb-0'}>Tranche of PO value</label>
                            <span className="text-xs font-bold text-primary tabular-nums">{percent != null ? `${percent}%` : '—'}</span>
                        </div>
                        <input type="range" min={1} max={100} step={1} value={percent ?? 0}
                            onChange={e => setFromPercent(Number(e.target.value))}
                            className="w-full accent-primary" />
                        <div className="flex items-center gap-1.5 mt-1.5">
                            {TRANCHE_PRESETS.map(p => (
                                <button key={p} type="button" onClick={() => setFromPercent(p)}
                                    className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition-colors ${
                                        percent === p ? 'bg-primary text-white border-primary' : 'border-border text-text-secondary hover:bg-surface-elevated'}`}>
                                    {p}%
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div><label className={label}>Request amount (₹)</label><input type="number" value={amount} onChange={e => setFromAmount(e.target.value)} className={field} /></div>
                        <div><label className={label}>Payment term</label>
                            <select value={term} onChange={e => { const v = e.target.value; if (v.startsWith('ms:')) pickMilestone(v.slice(3)); else setTerm(v); }} className={field}>
                                <option value="">—</option>
                                {milestones.length > 0 && (
                                    <optgroup label={planConfirmed ? "This PO's payment plan" : "Read from this PO's terms (not confirmed yet)"}>
                                        {milestones.map(m => <option key={m.id} value={`ms:${m.id}`}>{m.percent}% · {m.label}{m.state === 'due' ? ' · due' : ''}</option>)}
                                    </optgroup>
                                )}
                                {term && term.includes(' · ') && !PAYMENT_TERMS.includes(term) && <option value={term}>{term}</option>}
                                <optgroup label="Generic">
                                    {PAYMENT_TERMS.map(t => <option key={t} value={t}>{t}</option>)}
                                </optgroup>
                            </select>
                        </div>
                        <div><label className={label}>GST hold (₹)</label><input type="number" value={gstHold} onChange={e => setGstHold(e.target.value)} placeholder="0" className={field} /></div>
                        <div><label className={label}>TDS (₹)</label><input type="number" value={tds} onChange={e => setTds(e.target.value)} placeholder="0" className={field} /></div>
                    </div>
                    <div><label className={label}>Remarks</label><input value={remarks} onChange={e => setRemarks(e.target.value)} placeholder="e.g. balance against tax invoice" className={field} /></div>
                    {Number(amount) > pending + 0.5 && <p className="text-xs font-bold text-amber-700 dark:text-amber-400">This is {inr(Number(amount) - pending)} more than is left to align on this PO ({inr(pending)}).</p>}
                    <p className="text-[11px] text-text-tertiary">Aligning less than the pending amount creates a split tranche; the rest stays in “To Align”.</p>
                    {error && <p className="text-sm text-red-600">{error}</p>}
                </div>

                <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border bg-surface-elevated">
                    <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-text-secondary hover:bg-muted rounded-xl">Cancel</button>
                    {waitForRead && !duplicate ? (
                        <button disabled className="inline-flex items-center gap-1.5 px-5 py-2 bg-primary text-white rounded-xl text-sm font-bold opacity-50"><Loader2 className="w-4 h-4 animate-spin" /> Checking invoice…</button>
                    ) : invoiceWarn?.reason_required && !duplicate ? (
                        <button onClick={() => submit()} disabled={saving || invoiceReason.trim().length < invoiceWarn.min_reason_length}
                            className="inline-flex items-center gap-1.5 px-5 py-2 bg-amber-600 text-white rounded-xl text-sm font-bold hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed">
                            {saving && <Loader2 className="w-4 h-4 animate-spin" />} Align with reason
                        </button>
                    ) : duplicate ? (
                        <button onClick={() => submit(true)} disabled={saving || (!!invoiceWarn?.reason_required && invoiceReason.trim().length < invoiceWarn.min_reason_length)} className="inline-flex items-center gap-1.5 px-5 py-2 bg-amber-600 text-white rounded-xl text-sm font-bold hover:bg-amber-700 disabled:opacity-50">
                            {saving && <Loader2 className="w-4 h-4 animate-spin" />} Align anyway
                        </button>
                    ) : (
                        <button onClick={() => submit()} disabled={saving} className="inline-flex items-center gap-1.5 px-5 py-2 bg-primary text-white rounded-xl text-sm font-bold hover:bg-primary/90 disabled:opacity-50">
                            {saving && <Loader2 className="w-4 h-4 animate-spin" />} Send to Accounts
                        </button>
                    )}
                </div>
            </div>
        </div>,
        document.body,
    );
}
