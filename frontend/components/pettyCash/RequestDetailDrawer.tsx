'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, Loader2, FileText, Upload, CheckCircle2, Clock } from 'lucide-react';
import { useAuth } from '@/frontend/context/AuthContext';
import {
    PettyCashRequest, PettyCashDocument, PettyCashActivity, PC_STATUS_META, PC_PAYMENT_MODES, inr,
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
    const [activity, setActivity] = useState<PettyCashActivity[]>([]);
    const [loading, setLoading] = useState(false);
    const [action, setAction] = useState<ActionKey | null>(null);
    const [form, setForm] = useState<Record<string, string>>({});
    const [settleDocs, setSettleDocs] = useState<{ url: string; file_name: string; file_type: string }[]>([]);
    const [uploading, setUploading] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const open = !!request;

    const load = useCallback(async () => {
        if (!request) return;
        setLoading(true);
        try {
            const res = await fetch(`/api/petty-cash/${request.id}`);
            if (res.ok) { const d = await res.json(); setDocs(d.documents || []); setActivity(d.activity || []); }
        } finally { setLoading(false); }
    }, [request]);

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

                    {/* Documents */}
                    {docs.length > 0 && (
                        <div>
                            <p className="text-xs font-bold text-text-secondary uppercase tracking-wide mb-2">Documents</p>
                            <div className="space-y-1.5">
                                {docs.map(d => (
                                    <a key={d.id} href={d.file_url} target="_blank" rel="noopener noreferrer"
                                        className="flex items-center gap-2 text-sm text-primary bg-surface-elevated rounded-lg px-3 py-2 hover:bg-muted">
                                        <FileText className="w-4 h-4" /> <span className="flex-1 truncate">{d.file_name || 'Document'}</span>
                                        <span className="text-[10px] uppercase text-text-tertiary">{d.stage}</span>
                                    </a>
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
                                        {settleDocs.length > 0 && <p className="text-xs text-text-tertiary">{settleDocs.length} file(s) attached</p>}
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
