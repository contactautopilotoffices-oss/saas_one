'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, Loader2, FileText, Upload, CheckCircle2, Clock } from 'lucide-react';
import { useAuth } from '@/frontend/context/AuthContext';
import {
    PettyCashRequest, PettyCashDocument, PettyCashActivity, PettyCashReconciliation,
    PC_STATUS_META, PC_PAYMENT_MODES, inr,
} from '@/frontend/lib/pettyCash/roles';
import type { PettyCashCaps } from '@/frontend/lib/pettyCash/roles';

interface Props {
    request: PettyCashRequest | null;
    caps: PettyCashCaps;
    onClose: () => void;
    onChanged: (updated: PettyCashRequest) => void;
}

type ActionKey = 'approve' | 'reject' | 'send_back' | 'resubmit' | 'pay' | 'settle' | 'close' | 'cancel';

const ACTION_LABEL: Record<ActionKey, string> = {
    approve: 'Approve', reject: 'Reject', send_back: 'Send back', resubmit: 'Resubmit',
    pay: 'Mark paid', settle: 'Submit settlement', close: 'Validate & close', cancel: 'Cancel request',
};

export default function RequestDetailDrawer({ request, caps, onClose, onChanged }: Props) {
    const { user } = useAuth();
    const [docs, setDocs] = useState<PettyCashDocument[]>([]);
    const [recon, setRecon] = useState<PettyCashReconciliation | null>(null);
    const [activity, setActivity] = useState<PettyCashActivity[]>([]);
    const [loading, setLoading] = useState(false);
    const [action, setAction] = useState<ActionKey | null>(null);
    const [form, setForm] = useState<Record<string, string>>({});
    const [settleDocs, setSettleDocs] = useState<{ url: string; file_name: string; file_type: string; amount?: string; bill_date?: string; vendor?: string }[]>([]);
    const [uploading, setUploading] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const open = !!request;

    const load = useCallback(async () => {
        if (!request) return;
        setLoading(true);
        try {
            const res = await fetch(`/api/petty-cash/${request.id}`);
            if (res.ok) { const d = await res.json(); setDocs(d.documents || []); setActivity(d.activity || []); setRecon(d.reconciliation || null); }
        } finally { setLoading(false); }
    }, [request]);

    // Finance accepting/rejecting one bill. The API hands back the recomputed
    // reconciliation, so the accounted % moves with the decision.
    const reviewBill = async (docId: string, reviewStatus: 'accepted' | 'rejected') => {
        let remarks: string | null = null;
        if (reviewStatus === 'rejected') {
            remarks = window.prompt('Why is this bill being rejected?')?.trim() || null;
            if (!remarks) return;
        }
        setBusy(true); setError(null);
        try {
            const res = await fetch(`/api/petty-cash/documents/${docId}`, {
                method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ review_status: reviewStatus, review_remarks: remarks }),
            });
            if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || 'Could not review the bill'); }
            const d = await res.json();
            setDocs(prev => prev.map(x => (x.id === docId ? { ...x, ...d.document } : x)));
            if (d.reconciliation) setRecon(d.reconciliation);
        } catch (e) { setError(e instanceof Error ? e.message : 'Could not review the bill'); }
        finally { setBusy(false); }
    };

    useEffect(() => { if (open) { setAction(null); setForm({}); setSettleDocs([]); setError(null); load(); } }, [open, load]);

    if (!open || !request || typeof document === 'undefined') return null;

    const s = request.status;
    const isOwner = request.requester_id === user?.id;
    const isApprover = caps.canApprove && (caps.isAdmin || caps.properties.some(p => p.id === request.property_id));

    const actions: ActionKey[] = [];
    if (s === 'submitted' && isApprover) actions.push('approve', 'send_back', 'reject');
    if (s === 'sent_back' && isOwner) actions.push('resubmit');
    if (s === 'approved' && caps.canDisburse) actions.push('pay');
    if (s === 'paid' && isOwner) actions.push('settle');
    if (s === 'settlement_submitted' && caps.canDisburse) actions.push('close');
    if (!['closed', 'cancelled', 'rejected'].includes(s) && (isOwner || caps.isAdmin)) actions.push('cancel');

    const uploadFiles = async (files: FileList | null) => {
        if (!files?.length) return;
        setUploading(true);
        try {
            for (const file of Array.from(files)) {
                const fd = new FormData(); fd.append('file', file);
                const res = await fetch('/api/petty-cash/upload', { method: 'POST', body: fd });
                if (res.ok) { const doc = await res.json(); setSettleDocs(prev => [...prev, doc]); }
            }
        } finally { setUploading(false); }
    };

    const submit = async () => {
        if (!action) return;
        if (action === 'reject' && !form.remark?.trim()) { setError('A reason is required'); return; }
        setBusy(true); setError(null);
        try {
            const payload: Record<string, unknown> = { action, remark: form.remark };
            if (action === 'approve' && form.approved_amount) payload.approved_amount = Number(form.approved_amount);
            if (action === 'pay') {
                payload.paid_amount = form.paid_amount ? Number(form.paid_amount) : undefined;
                payload.paid_mode = form.paid_mode; payload.payment_ref = form.payment_ref; payload.paid_at = form.paid_at || undefined;
            }
            if (action === 'settle') {
                payload.actual_spent = form.actual_spent ? Number(form.actual_spent) : undefined;
                payload.amount_returned = form.amount_returned ? Number(form.amount_returned) : undefined;
                payload.extra_claimed = form.extra_claimed ? Number(form.extra_claimed) : undefined;
                payload.documents = settleDocs;
            }
            const res = await fetch(`/api/petty-cash/${request.id}`, {
                method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
            });
            if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || 'Action failed'); }
            const d = await res.json();
            onChanged(d.request);
            setAction(null); setForm({}); setSettleDocs([]);
            load();
        } catch (e) { setError(e instanceof Error ? e.message : 'Action failed'); }
        finally { setBusy(false); }
    };

    const meta = PC_STATUS_META[s] || { label: s, color: '#6B7280' };
    const field = 'w-full px-3 py-2 border border-border rounded-lg text-sm bg-surface text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/20';
    const fmt = (d?: string | null) => d ? new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

    const Row = ({ k, v }: { k: string; v: React.ReactNode }) => (
        <div className="flex justify-between gap-4 py-1.5 text-sm"><span className="text-text-tertiary">{k}</span><span className="text-text-primary font-medium text-right">{v}</span></div>
    );

    return createPortal(
        <>
            <div className="fixed inset-0 bg-black/50 z-[70]" onClick={onClose} />
            <div className="fixed right-0 top-0 bottom-0 w-full max-w-xl bg-surface shadow-2xl z-[70] flex flex-col">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-border">
                    <div>
                        <h2 className="text-lg font-bold text-text-primary">{request.request_no}</h2>
                        <span className="inline-flex items-center gap-1 mt-1 px-2.5 py-0.5 rounded-full text-xs font-bold"
                            style={{ backgroundColor: `${meta.color}1A`, color: meta.color }}>{meta.label}</span>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-muted rounded-xl"><X className="w-5 h-5 text-text-secondary" /></button>
                </div>

                <div className="flex-1 overflow-y-auto p-6 space-y-5">
                    {/* Amounts */}
                    <div className="grid grid-cols-2 gap-3">
                        <div className="bg-surface-elevated rounded-xl p-3">
                            <p className="text-xs text-text-tertiary">Requested</p>
                            <p className="text-xl font-bold text-text-primary">{inr(request.amount_requested)}</p>
                        </div>
                        <div className="bg-surface-elevated rounded-xl p-3">
                            <p className="text-xs text-text-tertiary">{request.paid_amount != null ? 'Paid' : 'Approved'}</p>
                            <p className="text-xl font-bold text-text-primary">{inr(request.paid_amount ?? request.approved_amount)}</p>
                        </div>
                    </div>

                    {/* Details */}
                    <div className="bg-surface-elevated rounded-xl p-4">
                        <Row k="Requester" v={request.requester?.full_name || '—'} />
                        <Row k="Cash handed to" v={
                            request.recipient_name
                                ? <span>{request.recipient_name}{request.recipient_phone ? <span className="text-text-tertiary"> · {request.recipient_phone}</span> : null}</span>
                                : <span className="text-text-tertiary">Requester</span>
                        } />
                        <Row k="Property" v={request.property?.name || '—'} />
                        <Row k="Type" v={request.request_type} />
                        <Row k="Department" v={request.department || '—'} />
                        <Row k="Category" v={request.category || '—'} />
                        <Row k="Payment mode" v={request.payment_mode || '—'} />
                        {request.vendor_name && <Row k="Vendor" v={request.vendor_name} />}
                        {request.expected_date && <Row k="Expected" v={new Date(request.expected_date).toLocaleDateString('en-IN')} />}
                        <div className="pt-2 mt-2 border-t border-border">
                            <p className="text-xs text-text-tertiary mb-1">Purpose</p>
                            <p className="text-sm text-text-primary whitespace-pre-wrap">{request.purpose}</p>
                        </div>
                        {request.settlement_remarks && (
                            <div className="pt-2 mt-2 border-t border-border">
                                <p className="text-xs text-text-tertiary mb-1">Settlement</p>
                                <p className="text-sm text-text-primary">Spent {inr(request.actual_spent)} · Returned {inr(request.amount_returned)} · Extra {inr(request.extra_claimed)}</p>
                                <p className="text-sm text-text-secondary mt-1">{request.settlement_remarks}</p>
                            </div>
                        )}
                    </div>

                    {/* Reconciliation — is this float closed out. Only meaningful once cash
                        has actually gone out, so it stays hidden before disbursement. */}
                    {recon && recon.disbursed > 0 && request.paid_at && (
                        <div className="rounded-xl border border-border p-4">
                            <div className="flex items-center justify-between mb-2">
                                <p className="text-xs font-bold text-text-secondary uppercase tracking-wide">Accounted for</p>
                                <span className={`text-sm font-black tabular-nums ${recon.unaccounted > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
                                    {recon.accounted_pct == null ? '—' : `${recon.accounted_pct}%`}
                                </span>
                            </div>
                            <div className="h-2 rounded-full bg-muted overflow-hidden">
                                <div className={recon.unaccounted > 0 ? 'h-full bg-amber-500' : 'h-full bg-emerald-500'}
                                    style={{ width: `${Math.min(100, Math.max(0, recon.accounted_pct ?? 0))}%` }} />
                            </div>
                            <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-3 text-xs">
                                <span className="text-text-tertiary">Disbursed</span><span className="text-right tabular-nums text-text-primary">{inr(recon.disbursed)}</span>
                                <span className="text-text-tertiary">Bills ({recon.bills_count})</span><span className="text-right tabular-nums text-text-primary">{inr(recon.bills_total)}</span>
                                <span className="text-text-tertiary">Cash returned</span><span className="text-right tabular-nums text-text-primary">{inr(recon.amount_returned)}</span>
                                {recon.unaccounted > 0 && (
                                    <>
                                        <span className="font-bold text-amber-700">Unaccounted</span>
                                        <span className="text-right tabular-nums font-bold text-amber-700">{inr(recon.unaccounted)}</span>
                                    </>
                                )}
                            </div>
                            {recon.bills_pending_review > 0 && (
                                <p className="text-[11px] text-text-tertiary mt-2">{recon.bills_pending_review} bill(s) awaiting finance review.</p>
                            )}
                            {recon.bills_rejected > 0 && (
                                <p className="text-[11px] text-red-600 mt-1">{recon.bills_rejected} bill(s) rejected — excluded from the total above.</p>
                            )}
                        </div>
                    )}

                    {/* Documents. Settlement bills render as ledger lines with their value,
                        and finance can accept/reject each one — a rejected bill stops
                        counting as accounted for. */}
                    {docs.length > 0 && (
                        <div>
                            <p className="text-xs font-bold text-text-secondary uppercase tracking-wide mb-2">Documents</p>
                            <div className="space-y-1.5">
                                {docs.map(d => (
                                    <div key={d.id} className="bg-surface-elevated rounded-lg px-3 py-2">
                                        <div className="flex items-center gap-2 text-sm">
                                            <FileText className="w-4 h-4 text-primary shrink-0" />
                                            <a href={d.file_url} target="_blank" rel="noopener noreferrer" className="flex-1 truncate text-primary hover:underline">
                                                {d.file_name || 'Document'}
                                            </a>
                                            {d.amount != null && <span className="tabular-nums font-bold text-text-primary">{inr(d.amount)}</span>}
                                            <span className="text-[10px] uppercase text-text-tertiary">{d.stage}</span>
                                        </div>
                                        {(d.vendor || d.bill_date || d.review_status === 'rejected') && (
                                            <p className="text-[11px] text-text-tertiary mt-0.5 pl-6">
                                                {[d.vendor, d.bill_date ? new Date(d.bill_date).toLocaleDateString('en-IN') : null]
                                                    .filter(Boolean).join(' · ')}
                                                {d.review_status === 'rejected' && <span className="text-red-600 font-semibold"> · Rejected{d.review_remarks ? `: ${d.review_remarks}` : ''}</span>}
                                                {d.review_status === 'accepted' && <span className="text-emerald-600 font-semibold"> · Accepted</span>}
                                            </p>
                                        )}
                                        {caps.canDisburse && d.stage === 'settlement' && d.amount != null && (
                                            <div className="flex items-center gap-2 mt-1.5 pl-6">
                                                <button onClick={() => reviewBill(d.id, 'accepted')} disabled={busy || d.review_status === 'accepted'}
                                                    className="text-[11px] font-bold px-2 py-0.5 rounded-md border border-emerald-500/40 text-emerald-700 hover:bg-emerald-500/10 disabled:opacity-40">
                                                    Accept
                                                </button>
                                                <button onClick={() => reviewBill(d.id, 'rejected')} disabled={busy || d.review_status === 'rejected'}
                                                    className="text-[11px] font-bold px-2 py-0.5 rounded-md border border-red-500/40 text-red-700 hover:bg-red-500/10 disabled:opacity-40">
                                                    Reject
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Activity */}
                    <div>
                        <p className="text-xs font-bold text-text-secondary uppercase tracking-wide mb-2">Activity</p>
                        {loading ? <Loader2 className="w-4 h-4 animate-spin text-text-tertiary" /> : (
                            <div className="space-y-2.5">
                                {activity.map(a => (
                                    <div key={a.id} className="flex gap-2.5 text-sm">
                                        <CheckCircle2 className="w-4 h-4 text-text-tertiary shrink-0 mt-0.5" />
                                        <div className="flex-1">
                                            <p className="text-text-primary"><span className="font-medium capitalize">{a.action.replace(/_/g, ' ')}</span>{a.actor?.full_name ? ` · ${a.actor.full_name}` : ''}</p>
                                            {a.remark && <p className="text-text-secondary text-xs mt-0.5">{a.remark}</p>}
                                            <p className="text-text-tertiary text-[11px] mt-0.5 flex items-center gap-1"><Clock className="w-3 h-3" />{fmt(a.created_at)}</p>
                                        </div>
                                    </div>
                                ))}
                                {activity.length === 0 && <p className="text-sm text-text-tertiary">No activity yet.</p>}
                            </div>
                        )}
                    </div>
                </div>

                {/* Action bar */}
                {actions.length > 0 && (
                    <div className="border-t border-border p-4 bg-surface-elevated space-y-3">
                        {!action ? (
                            <div className="flex flex-wrap gap-2">
                                {actions.map(a => (
                                    <button key={a} onClick={() => { setAction(a); setError(null); }}
                                        className={`px-3.5 py-2 rounded-lg text-sm font-bold transition-colors ${
                                            a === 'approve' || a === 'pay' || a === 'close' ? 'bg-primary text-white hover:bg-primary/90'
                                            : a === 'reject' || a === 'cancel' ? 'text-red-600 border border-red-200 hover:bg-red-50 dark:hover:bg-red-950/30'
                                            : 'border border-border text-text-secondary hover:bg-surface'}`}>
                                        {ACTION_LABEL[a]}
                                    </button>
                                ))}
                            </div>
                        ) : (
                            <div className="space-y-2.5">
                                <p className="text-sm font-bold text-text-primary">{ACTION_LABEL[action]}</p>
                                {action === 'approve' && (
                                    <input type="number" placeholder={`Approved amount (default ${inr(request.amount_requested)})`}
                                        value={form.approved_amount || ''} onChange={e => setForm(f => ({ ...f, approved_amount: e.target.value }))} className={field} />
                                )}
                                {action === 'pay' && (
                                    <div className="grid grid-cols-2 gap-2">
                                        <input type="number" placeholder={`Paid amount`} value={form.paid_amount || ''} onChange={e => setForm(f => ({ ...f, paid_amount: e.target.value }))} className={field} />
                                        <select value={form.paid_mode || request.payment_mode || 'Cash'} onChange={e => setForm(f => ({ ...f, paid_mode: e.target.value }))} className={field}>
                                            {PC_PAYMENT_MODES.map(m => <option key={m} value={m}>{m}</option>)}
                                        </select>
                                        <input placeholder="Reference / UTR" value={form.payment_ref || ''} onChange={e => setForm(f => ({ ...f, payment_ref: e.target.value }))} className={field} />
                                        <input type="date" value={form.paid_at || ''} onChange={e => setForm(f => ({ ...f, paid_at: e.target.value }))} className={field} />
                                    </div>
                                )}
                                {action === 'settle' && (
                                    <>
                                        <div className="grid grid-cols-3 gap-2">
                                            <input type="number" placeholder="Actual spent" value={form.actual_spent || ''} onChange={e => setForm(f => ({ ...f, actual_spent: e.target.value }))} className={field} />
                                            <input type="number" placeholder="Returned" value={form.amount_returned || ''} onChange={e => setForm(f => ({ ...f, amount_returned: e.target.value }))} className={field} />
                                            <input type="number" placeholder="Extra claimed" value={form.extra_claimed || ''} onChange={e => setForm(f => ({ ...f, extra_claimed: e.target.value }))} className={field} />
                                        </div>
                                        <label className="flex items-center gap-2 px-3 py-2 border border-dashed border-border rounded-lg text-sm text-text-secondary cursor-pointer hover:border-primary/40">
                                            {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />} Upload bills
                                            <input type="file" multiple className="hidden" onChange={e => uploadFiles(e.target.files)} accept="application/pdf,image/*,.csv,.xls,.xlsx" />
                                        </label>
                                        {/* Each bill carries its own value — that is what makes the float
                                            reconcilable instead of one self-declared "actual spent". */}
                                        {settleDocs.length > 0 && (
                                            <div className="space-y-1.5">
                                                {settleDocs.map((d, i) => (
                                                    <div key={i} className="bg-surface-elevated rounded-lg p-2 space-y-1.5">
                                                        <div className="flex items-center gap-2 text-xs text-text-secondary">
                                                            <FileText className="w-3.5 h-3.5 shrink-0" />
                                                            <span className="flex-1 truncate">{d.file_name}</span>
                                                        </div>
                                                        <div className="grid grid-cols-3 gap-1.5">
                                                            <input type="number" placeholder="Amount ₹" value={d.amount ?? ''}
                                                                onChange={e => setSettleDocs(prev => prev.map((x, j) => j === i ? { ...x, amount: e.target.value } : x))}
                                                                className={`${field} py-1.5 text-xs`} />
                                                            <input type="date" value={d.bill_date ?? ''}
                                                                onChange={e => setSettleDocs(prev => prev.map((x, j) => j === i ? { ...x, bill_date: e.target.value } : x))}
                                                                className={`${field} py-1.5 text-xs`} />
                                                            <input placeholder="Vendor" value={d.vendor ?? ''}
                                                                onChange={e => setSettleDocs(prev => prev.map((x, j) => j === i ? { ...x, vendor: e.target.value } : x))}
                                                                className={`${field} py-1.5 text-xs`} />
                                                        </div>
                                                    </div>
                                                ))}
                                                <p className="text-[11px] text-text-tertiary">
                                                    Bills total {inr(settleDocs.reduce((s, d) => s + Number(d.amount || 0), 0))}
                                                    {' '}of {inr(request.paid_amount ?? request.approved_amount ?? request.amount_requested)} disbursed.
                                                </p>
                                            </div>
                                        )}
                                    </>
                                )}
                                {(action === 'reject' || action === 'send_back' || action === 'close' || action === 'cancel' || action === 'approve' || action === 'settle') && (
                                    <textarea placeholder={action === 'reject' ? 'Reason (required)' : 'Remark (optional)'} rows={2}
                                        value={form.remark || ''} onChange={e => setForm(f => ({ ...f, remark: e.target.value }))} className={`${field} resize-none`} />
                                )}
                                {error && <p className="text-sm text-red-600">{error}</p>}
                                <div className="flex items-center gap-2 justify-end">
                                    <button onClick={() => { setAction(null); setError(null); }} className="px-3 py-2 text-sm font-medium text-text-secondary hover:bg-muted rounded-lg">Back</button>
                                    <button onClick={submit} disabled={busy || uploading}
                                        className="inline-flex items-center gap-1.5 px-4 py-2 bg-primary text-white rounded-lg text-sm font-bold hover:bg-primary/90 disabled:opacity-50">
                                        {busy && <Loader2 className="w-4 h-4 animate-spin" />} Confirm
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </>,
        document.body,
    );
}
