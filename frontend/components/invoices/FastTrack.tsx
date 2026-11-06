'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Plus, RefreshCw, Search, Paperclip } from 'lucide-react';
import {
    api, ApiError, inr, shortDate, label, newKey, uploadToSlot, Pill, ftTone, docTone, Modal, Field, inputCls, btnPrimary, btnGhost, btnDanger,
    ErrorLine, Empty, Pager,
} from './invoiceUi';

export type FastTrackView = 'all' | 'pending' | 'to_align' | 'invoice_pending' | 'mine';

interface Item {
    id: string; po_id: string; status: string; effective_status: string; requested_amount: number; approved_amount: number | null; urgency_reason: string;
    documentation_state: string; doc_overdue: boolean; doc_due_at: string; invoice_pending: boolean; created_at: string; is_mine: boolean; evidence_count: number;
    po: { po_number: string; vendor_name: string | null; po_amount: number | null; project_name: string | null } | null;
    requester: { full_name: string | null } | null;
    payment: { status: string; utr_no: string | null } | { status: string; utr_no: string | null }[] | null;
}

interface Caps { can_raise_fast_track: boolean; can_decide: boolean; can_decide_above_limit: boolean; can_align: boolean; can_accept: boolean }

const EMPTY: Record<FastTrackView, string> = {
    all: 'No fast-track requests yet.', pending: 'Nothing is waiting for a decision.', to_align: 'No approved requests are waiting for alignment.',
    invoice_pending: 'No payments are waiting on an invoice.', mine: 'You have not raised any fast-track requests.',
};

export default function FastTrack({ orgId, view, caps, approvalLimit, refreshKey, onChanged }: {
    orgId: string; view: FastTrackView; caps: Caps; approvalLimit: number; refreshKey: number; onChanged: () => void;
}) {
    const [items, setItems] = useState<Item[]>([]);
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [openId, setOpenId] = useState<string | null>(null);
    const [creating, setCreating] = useState(false);

    const load = useCallback(async () => {
        setLoading(true); setError(null);
        try {
            const d = await api<{ items: Item[]; pagination: { total_pages: number } }>(`/api/invoices/fast-track?${new URLSearchParams({ org_id: orgId, view, page: String(page), page_size: '25' })}`);
            setItems(d.items); setTotalPages(d.pagination.total_pages || 1);
        } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
    }, [orgId, view, page]);
    useEffect(() => { load(); }, [load, refreshKey]);
    useEffect(() => { setPage(1); }, [view]);

    const changed = () => { load(); onChanged(); };

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-text-tertiary max-w-2xl">A fast-track request lets a payment be lined up before the invoice arrives. Approval allows <b>alignment only</b>. It does not verify any invoice, and the invoice stays pending until one is received and accepted.</p>
                <div className="flex gap-2">
                    <button className={btnGhost} onClick={load} aria-label="Refresh"><RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /></button>
                    {caps.can_raise_fast_track && <button className={btnPrimary} onClick={() => setCreating(true)}><Plus className="w-4 h-4" /> New request</button>}
                </div>
            </div>
            <ErrorLine message={error} />
            <div className="border border-border rounded-2xl overflow-x-auto">
                <table className="w-full text-sm">
                    <thead className="bg-surface-elevated text-xs text-text-tertiary">
                        <tr><th className="text-left px-3 py-2.5 font-bold">PO</th><th className="text-right px-3 py-2.5 font-bold">Amount</th><th className="text-left px-3 py-2.5 font-bold">Payment exception</th><th className="text-left px-3 py-2.5 font-bold">Invoice</th><th className="text-left px-3 py-2.5 font-bold">Asked by</th></tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                        {items.map((r) => (
                            <tr key={r.id} className="hover:bg-surface-elevated/50 cursor-pointer align-top" onClick={() => setOpenId(r.id)}>
                                <td className="px-3 py-3"><div className="font-bold text-text-primary">{r.po?.po_number}</div><div className="text-[11px] text-text-tertiary truncate max-w-[200px]">{r.po?.vendor_name}</div></td>
                                <td className="px-3 py-3 text-right tabular-nums">{inr(r.approved_amount ?? r.requested_amount)}{r.approved_amount != null && r.approved_amount !== r.requested_amount && <div className="text-[11px] text-text-tertiary">asked {inr(r.requested_amount)}</div>}</td>
                                <td className="px-3 py-3"><Pill tone={ftTone(r.effective_status)}>{label(r.effective_status)}</Pill></td>
                                <td className="px-3 py-3">
                                    <Pill tone={docTone(r.documentation_state, r.doc_overdue)}>{r.doc_overdue ? 'Overdue' : label(r.documentation_state)}</Pill>
                                    {r.invoice_pending && <div className="text-[11px] text-text-tertiary mt-1">Due {shortDate(r.doc_due_at)}</div>}
                                </td>
                                <td className="px-3 py-3 text-xs text-text-secondary">{r.requester?.full_name ?? '—'}{r.is_mine && ' (you)'}<div className="text-text-tertiary">{shortDate(r.created_at)}</div></td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                {!loading && !items.length && <Empty>{EMPTY[view]}</Empty>}
            </div>
            <Pager page={page} totalPages={totalPages} onPage={setPage} />

            {creating && <CreateModal orgId={orgId} onClose={() => setCreating(false)} onDone={() => { setCreating(false); changed(); }} />}
            {openId && <DetailModal orgId={orgId} id={openId} caps={caps} approvalLimit={approvalLimit} onClose={() => setOpenId(null)} onChanged={changed} />}
        </div>
    );
}

// --- new request ---------------------------------------------------------------

function CreateModal({ orgId, onClose, onDone }: { orgId: string; onClose: () => void; onDone: () => void }) {
    const [q, setQ] = useState('');
    const [pos, setPos] = useState<{ id: string; po_number: string; vendor_name: string | null; po_amount: number | null }[]>([]);
    const [po, setPo] = useState<(typeof pos)[number] | null>(null);
    const [amount, setAmount] = useState('');
    const [reason, setReason] = useState('');
    const [files, setFiles] = useState<File[]>([]);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const key = useRef(newKey());

    useEffect(() => {
        if (po || q.trim().length < 2) { setPos([]); return; }
        const t = setTimeout(async () => {
            try { const d = await api<{ pos: typeof pos }>(`/api/invoices/po-status?${new URLSearchParams({ org_id: orgId, search: q, page_size: '8' })}`); setPos(d.pos); } catch { setPos([]); }
        }, 300);
        return () => clearTimeout(t);
    }, [q, po, orgId]);

    const submit = async () => {
        if (!po) { setError('Choose the PO.'); return; }
        setBusy(true); setError(null);
        try {
            const evidence: { upload_id: string; filename: string; purpose: string }[] = [];
            for (const f of files) {
                const slot = await api<{ upload_id: string; bucket: string; upload_path: string; upload_token: string }>('/api/invoices/upload', {
                    method: 'POST', body: JSON.stringify({ org_id: orgId, kind: 'evidence', filename: f.name, content_type: f.type, file_size_bytes: f.size }),
                });
                await uploadToSlot(slot, f);
                evidence.push({ upload_id: slot.upload_id, filename: f.name, purpose: 'supporting' });
            }
            await api('/api/invoices/fast-track', { method: 'POST', idempotencyKey: key.current, body: JSON.stringify({ org_id: orgId, po_id: po.id, requested_amount: Number(amount), urgency_reason: reason, evidence }) });
            onDone();
        } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
    };

    return (
        <Modal title="Fast-track payment request" onClose={onClose}>
            <div className="space-y-4">
                <p className="text-sm text-text-secondary">Use this when a vendor must be paid before the invoice reaches us. An approver other than you decides it, and the invoice stays on the chase list until it arrives.</p>
                {!po ? (
                    <Field label="PO"><div className="relative">
                        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
                        <input className={`${inputCls} pl-9`} placeholder="Search PO number or vendor" value={q} onChange={(e) => setQ(e.target.value)} />
                        {pos.length > 0 && <ul className="absolute z-10 mt-1 w-full bg-surface border border-border rounded-xl shadow-lg max-h-56 overflow-y-auto">{pos.map((p) => <li key={p.id}><button className="w-full text-left px-3 py-2 text-sm hover:bg-surface-elevated" onClick={() => { setPo(p); setAmount(p.po_amount ? String(p.po_amount) : ''); }}><b>{p.po_number}</b> · {p.vendor_name} · {inr(p.po_amount)}</button></li>)}</ul>}
                    </div></Field>
                ) : (
                    <div className="flex items-center justify-between gap-2 rounded-xl border border-border px-3 py-2 text-sm"><span><b>{po.po_number}</b> · {po.vendor_name} · PO {inr(po.po_amount)}</span><button className="text-xs text-primary font-bold" onClick={() => setPo(null)}>Change</button></div>
                )}
                <Field label="Amount to pay now (₹)"><input className={inputCls} type="number" min={1} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
                <Field label="Why can this not wait?" hint="At least 10 characters. Approvers read this."><textarea className={inputCls} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
                <Field label="Evidence (delivery proof, site message, photo)" hint="PDF, JPEG or PNG, up to 5 files.">
                    <input type="file" multiple accept="application/pdf,image/jpeg,image/png" className={inputCls} onChange={(e) => setFiles(Array.from(e.target.files ?? []).slice(0, 5))} />
                </Field>
                <ErrorLine message={error} />
                <button className={btnPrimary} onClick={submit} disabled={busy || !po || !amount || reason.trim().length < 10}>{busy ? 'Submitting…' : 'Submit for approval'}</button>
            </div>
        </Modal>
    );
}

// --- one request ---------------------------------------------------------------

interface DetailData {
    request: Item & { evidence: { filename: string; purpose: string; signed_url: string | null }[]; po_payment_id: string | null; doc_close_reason: string | null };
    decisions: { id: string; decision: string; approved_amount: number | null; reason: string; decided_at: string; approver: { full_name: string | null } | null }[];
    events: { id: string; event_type: string; actor_name: string | null; created_at: string }[];
    related: { id: string; status: string; requested_amount: number; approved_amount: number | null; created_at: string }[];
    policy: { approval_limit: number; needs_escalation: boolean };
}

function DetailModal({ orgId, id, caps, approvalLimit, onClose, onChanged }: { orgId: string; id: string; caps: Caps; approvalLimit: number; onClose: () => void; onChanged: () => void }) {
    const [d, setD] = useState<DetailData | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [reason, setReason] = useState('');
    const [amount, setAmount] = useState('');
    const [mode, setMode] = useState<null | 'approved' | 'rejected' | 'needs_information' | 'close' | 'waive' | 'cancel'>(null);

    const load = useCallback(async () => {
        try { const x = await api<DetailData>(`/api/invoices/fast-track/${id}?org_id=${orgId}`); setD(x); setAmount(String(x.request.requested_amount)); setError(null); } catch (e) { setError((e as Error).message); }
    }, [id, orgId]);
    useEffect(() => { load(); }, [load]);

    const act = async (fn: () => Promise<unknown>) => {
        setBusy(true); setError(null);
        try { await fn(); setMode(null); setReason(''); await load(); onChanged(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
    };
    const post = (path: string, body: Record<string, unknown>) => api(`/api/invoices/fast-track/${id}/${path}`, { method: 'POST', body: JSON.stringify({ org_id: orgId, ...body }) });

    if (!d) return <Modal title="Fast-track request" onClose={onClose}>{error ? <ErrorLine message={error} /> : <p className="text-sm text-text-tertiary text-center py-8">Loading…</p>}</Modal>;
    const r = d.request;
    const canDecideThis = caps.can_decide && !r.is_mine && r.status === 'pending_approval';
    const aboveLimit = Number(amount) > approvalLimit;
    const blockedByLimit = mode === 'approved' && aboveLimit && !caps.can_decide_above_limit;
    const docOpen = !['closed', 'waived_by_policy'].includes(r.documentation_state) && !['rejected', 'cancelled'].includes(r.status);

    return (
        <Modal title={`Fast-track · PO ${r.po?.po_number}`} onClose={onClose} wide>
            <div className="space-y-5">
                <div className="flex flex-wrap items-center gap-2">
                    <Pill tone={ftTone(r.effective_status)}>{label(r.effective_status)}</Pill>
                    <Pill tone={docTone(r.documentation_state, r.doc_overdue)}>{r.doc_overdue ? 'Invoice overdue' : `Invoice: ${label(r.documentation_state).toLowerCase()}`}</Pill>
                    {r.invoice_pending && <Pill tone="amber">Invoice still pending</Pill>}
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                    <Info l="Vendor" v={r.po?.vendor_name} /><Info l="PO value" v={inr(r.po?.po_amount)} /><Info l="Asked" v={inr(r.requested_amount)} />
                    <Info l="Approved" v={r.approved_amount != null ? inr(r.approved_amount) : '—'} /><Info l="Asked by" v={r.requester?.full_name} /><Info l="On" v={shortDate(r.created_at)} />
                    <Info l="Invoice due by" v={shortDate(r.doc_due_at)} /><Info l="Site" v={r.po?.project_name} />
                </div>
                <div><div className="text-xs font-bold text-text-secondary mb-1">Why it cannot wait</div><p className="text-sm text-text-primary whitespace-pre-wrap">{r.urgency_reason}</p></div>
                {r.evidence.length > 0 && <div><div className="text-xs font-bold text-text-secondary mb-1">Evidence</div><ul className="space-y-1">{r.evidence.map((e, i) => <li key={i}>{e.signed_url ? <a className="text-sm text-primary hover:underline inline-flex items-center gap-1" href={e.signed_url} target="_blank" rel="noreferrer"><Paperclip className="w-3 h-3" />{e.filename}</a> : <span className="text-sm text-text-tertiary">{e.filename} (unavailable)</span>}</li>)}</ul></div>}
                {d.related.length > 0 && <div><div className="text-xs font-bold text-text-secondary mb-1">Other requests on this PO</div><ul className="text-xs text-text-secondary space-y-0.5">{d.related.map((x) => <li key={x.id}>{shortDate(x.created_at)} · {inr(x.approved_amount ?? x.requested_amount)} · {label(x.status)}</li>)}</ul></div>}
                {d.decisions.length > 0 && <div><div className="text-xs font-bold text-text-secondary mb-1">Decisions</div><ul className="text-xs text-text-secondary space-y-1">{d.decisions.map((x) => <li key={x.id}><b>{label(x.decision)}</b> by {x.approver?.full_name ?? '—'} on {shortDate(x.decided_at)}{x.approved_amount != null ? ` · ${inr(x.approved_amount)}` : ''} — {x.reason}</li>)}</ul></div>}
                {r.doc_close_reason && <p className="text-xs text-text-secondary">Documentation closed: {r.doc_close_reason}</p>}
                <ErrorLine message={error} />

                {/* approver */}
                {canDecideThis && (
                    <div className="border-t border-border pt-4 space-y-3">
                        {!mode || !['approved', 'rejected', 'needs_information'].includes(mode) ? (
                            <div className="flex flex-wrap gap-2">
                                <button className={btnPrimary} onClick={() => setMode('approved')}>Approve</button>
                                <button className={btnGhost} onClick={() => setMode('needs_information')}>Ask for more information</button>
                                <button className={btnDanger} onClick={() => setMode('rejected')}>Reject</button>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {mode === 'approved' && <Field label="Approve up to (₹)" hint={`Your limit is ${inr(approvalLimit)}.${aboveLimit ? ' This is above it and needs a super admin.' : ''}`}><input className={inputCls} type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>}
                                <Field label="Reason (recorded with your decision)"><input className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
                                {blockedByLimit && <ErrorLine message="This amount is above your approval limit. Reduce it, or ask a super admin to decide." />}
                                <div className="flex gap-2">
                                    <button className={mode === 'rejected' ? btnDanger : btnPrimary} disabled={busy || reason.trim().length < 3 || blockedByLimit}
                                        onClick={() => act(() => post('decision', { decision: mode, approved_amount: mode === 'approved' ? Number(amount) : undefined, reason }))}>Confirm {mode === 'approved' ? 'approval' : mode === 'rejected' ? 'rejection' : ''}</button>
                                    <button className={btnGhost} onClick={() => setMode(null)}>Back</button>
                                </div>
                            </div>
                        )}
                    </div>
                )}
                {caps.can_decide && r.is_mine && r.status === 'pending_approval' && <p className="text-xs text-text-tertiary border-t border-border pt-3">You raised this request, so someone else must decide it.</p>}

                {/* the asker */}
                {r.is_mine && r.status === 'needs_information' && (
                    <div className="border-t border-border pt-4 space-y-2">
                        <Field label="Your answer to the approver (updates the reason)"><textarea className={inputCls} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
                        <button className={btnPrimary} disabled={busy || reason.trim().length < 10} onClick={() => act(() => api(`/api/invoices/fast-track/${id}`, { method: 'PATCH', body: JSON.stringify({ org_id: orgId, action: 'resubmit', urgency_reason: reason }) }))}>Send back for approval</button>
                    </div>
                )}

                {/* accounts */}
                {r.status === 'approved' && caps.can_align && (
                    <div className="border-t border-border pt-4 space-y-2">
                        <p className="text-sm text-text-secondary">Approved for <b>{inr(r.approved_amount)}</b>. Aligning creates the payment tranche in the Payment Tracker. It does not mark any invoice verified.</p>
                        <button className={btnPrimary} disabled={busy} onClick={() => act(async () => {
                            try { await post('align', {}); } catch (e) { if ((e as ApiError).data?.error === 'payment_exceeds_po' && confirm(`${(e as Error).message}\n\nAlign anyway?`)) await post('align', { acknowledge_over_commit: true }); else throw e; }
                        })}>Align payment</button>
                    </div>
                )}
                {r.status === 'aligned' && <p className="text-sm text-text-secondary border-t border-border pt-3">Aligned in the Payment Tracker{r.effective_status === 'payment_recorded' ? ', and payment is recorded there.' : '. Payment is recorded there once Accounts completes it with a UTR.'}</p>}

                {/* documentation */}
                {docOpen && (caps.can_accept || caps.can_decide_above_limit) && ['approved', 'alignment_in_progress', 'aligned'].includes(r.status) && (
                    <div className="border-t border-border pt-4 space-y-2">
                        {mode === 'close' || mode === 'waive' ? (
                            <>
                                <Field label={mode === 'waive' ? 'Why is the invoice being waived? (required)' : 'Note (optional)'}><input className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
                                <div className="flex gap-2"><button className={btnPrimary} disabled={busy || (mode === 'waive' && reason.trim().length < 10)} onClick={() => act(() => post('documentation', { mode, reason }))}>{mode === 'waive' ? 'Waive by policy' : 'Close documentation'}</button><button className={btnGhost} onClick={() => setMode(null)}>Back</button></div>
                            </>
                        ) : (
                            <div className="flex flex-wrap gap-2">
                                {caps.can_accept && r.documentation_state === 'reconciled' && <button className={btnPrimary} onClick={() => setMode('close')}>Close documentation</button>}
                                {caps.can_decide_above_limit && <button className={btnGhost} onClick={() => setMode('waive')}>Waive invoice by policy…</button>}
                            </div>
                        )}
                    </div>
                )}

                {['pending_approval', 'needs_information', 'approved'].includes(r.status) && (r.is_mine || caps.can_decide_above_limit) && (
                    <div className="border-t border-border pt-3">
                        {mode === 'cancel' ? (
                            <div className="flex gap-2 items-center"><input className={inputCls} placeholder="Reason" value={reason} onChange={(e) => setReason(e.target.value)} /><button className={btnDanger} disabled={busy} onClick={() => act(() => api(`/api/invoices/fast-track/${id}`, { method: 'PATCH', body: JSON.stringify({ org_id: orgId, action: 'cancel', reason }) }))}>Cancel request</button><button className={btnGhost} onClick={() => setMode(null)}>Back</button></div>
                        ) : <button className="text-xs text-red-600 font-bold hover:underline" onClick={() => setMode('cancel')}>Cancel this request</button>}
                    </div>
                )}
            </div>
        </Modal>
    );
}

const Info = ({ l, v }: { l: string; v: React.ReactNode }) => <div><div className="text-[11px] text-text-tertiary">{l}</div><div className="text-text-primary font-medium break-words">{v ?? '—'}</div></div>;
