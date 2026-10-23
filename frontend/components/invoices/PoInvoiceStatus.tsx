'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Search, Link2, Upload, Copy, Check, Ban, RefreshCw, MessageCircle, CalendarClock, ChevronDown } from 'lucide-react';
import {
    api, inr, shortDate, label, newKey, uploadToSlot, Pill, matchTone, Modal, Field, inputCls, btnPrimary, btnGhost,
    ErrorLine, Empty, Pager,
} from './invoiceUi';
import PoPaymentPlan from './PoPaymentPlan';
import SimulateApproval from './SimulateApproval';

interface PoRow {
    id: string; po_number: string; vendor_name: string | null; po_amount: number | null; project_name: string | null; po_date: string | null; status: string | null;
    invoices: { id: string; invoice_number: string | null; invoice_total: number | null; match_status: string; review_status: string; extraction_status: string; submitted_at: string }[];
    active_link: { id: string; expires_at: string } | null;
    simulated_approval: { simulated_at: string; invoice_due_at: string } | null;
    last_notification: { status: 'sent' | 'failed' | 'no_phone'; sent_at: string; error: string | null; sent_to_last4: string | null; mode: 'test' | 'live' | null } | null;
    case: { overrides: { tranche_no: number; requested_amount: number; percent_of_po: number | null; status: string; aligned_at: string | null; invoice_match_at_align: string | null; invoice_override_reason: string; aligned_by_name: string | null }[]; notes: { event_type: string; actor_name: string | null; actor_role: string | null; created_at: string; text: string | null; rule_code: string | null }[] };
    approval_watch: { state: 'pending' | 'sending' | 'notified' | 'no_phone' | 'failed' | 'skipped'; approved_detected_at: string | null; invoice_due_at: string | null; note: string | null } | null;
    fast_track: { id: string; status: string; documentation_state: string; doc_overdue: boolean; invoice_pending: boolean }[];
}

const FILTERS = [
    ['all', 'All POs'], ['attention', 'Needs attention'], ['has_invoice', 'Invoice received'], ['awaiting_invoice', 'Invoice pending (fast-track)'], ['fast_track', 'Any fast-track'],
] as const;

export default function PoInvoiceStatus({ orgId, canGenerate, canUploadInternal, canSimulate, canResend, onOpenInvoice, onOpenPo, onChanged, refreshKey = 0, linkExpiryHours = 72 }: {
    orgId: string; canGenerate: boolean; canUploadInternal: boolean; canSimulate: boolean; canResend: boolean; onOpenInvoice: (id: string) => void; onOpenPo?: (poId: string) => void; onChanged: () => void; refreshKey?: number; linkExpiryHours?: number;
}) {
    const [rows, setRows] = useState<PoRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [search, setSearch] = useState('');
    const [filter, setFilter] = useState<(typeof FILTERS)[number][0]>('all');
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [linkFor, setLinkFor] = useState<PoRow | null>(null);
    const [uploadFor, setUploadFor] = useState<PoRow | null>(null);
    const [planFor, setPlanFor] = useState<PoRow | null>(null);
    const [simFor, setSimFor] = useState<{ po: PoRow; resend: boolean } | null>(null);
    const [openRow, setOpenRow] = useState<string | null>(null);
    const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

    const load = useCallback(async () => {
        setLoading(true); setError(null);
        try {
            const p = new URLSearchParams({ org_id: orgId, page: String(page), page_size: '25', filter, search });
            const d = await api<{ pos: PoRow[]; pagination: { total_pages: number } }>(`/api/invoices/po-status?${p}`);
            setRows(d.pos); setTotalPages(d.pagination.total_pages || 1);
        } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
    }, [orgId, page, filter, search]);

    useEffect(() => { if (debounce.current) clearTimeout(debounce.current); debounce.current = setTimeout(load, search ? 300 : 0); return () => { if (debounce.current) clearTimeout(debounce.current); }; }, [load, search, refreshKey]); // refreshKey: something changed elsewhere in Invoice Control
    useEffect(() => { setPage(1); }, [filter, search]);

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
                <div className="relative flex-1 min-w-[220px]">
                    <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
                    <input className={`${inputCls} pl-9`} placeholder="Search PO number or vendor" value={search} onChange={(e) => setSearch(e.target.value)} />
                </div>
                <select className={`${inputCls} w-auto`} value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} aria-label="Filter POs">
                    {FILTERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
                <button className={btnGhost} onClick={load} aria-label="Refresh"><RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /></button>
            </div>
            <ErrorLine message={error} />

            <div className="border border-border rounded-2xl overflow-x-auto">
                <table className="w-full text-sm">
                    <thead className="bg-surface-elevated text-xs text-text-tertiary">
                        <tr>
                            <th className="text-left px-3 py-2.5 font-bold">PO</th>
                            <th className="text-left px-3 py-2.5 font-bold">Invoice</th>
                            <th className="text-left px-3 py-2.5 font-bold">Payment</th>
                            <th className="px-3 py-2.5" />
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                        {rows.map((po) => {
                            const latest = po.invoices[0];
                            const isOpen = openRow === po.id;
                            const ft = po.fast_track[0];
                            const approvalWord = po.simulated_approval ? 'Approved (simulated)' : po.status === 'pending_approval' ? 'Awaiting approval' : label(po.status);
                            return (
                                <React.Fragment key={po.id}>
                                    <tr className="hover:bg-surface-elevated/50 cursor-pointer" onClick={() => setOpenRow(isOpen ? null : po.id)} aria-expanded={isOpen}>
                                        <td className="px-3 py-3"><div>{onOpenPo ? <button className="font-bold text-text-primary hover:text-primary hover:underline" onClick={(e) => { e.stopPropagation(); onOpenPo(po.id); }} title="Open this PO">{po.po_number}</button> : <span className="font-bold text-text-primary">{po.po_number}</span>}</div><div className="text-[11px] text-text-tertiary truncate max-w-[260px]">{po.vendor_name ?? '—'} · {inr(po.po_amount)}</div></td>
                                        <td className="px-3 py-3">
                                            {latest ? (['rejected', 'resubmission_required'].includes(latest.review_status) ? <Pill tone={latest.review_status === 'rejected' ? 'red' : 'amber'}>{label(latest.review_status)}</Pill> : <Pill tone={matchTone(latest.match_status)}>{['pending', 'processing'].includes(latest.extraction_status) ? 'Reading…' : latest.review_status === 'accepted' ? 'Accepted' : label(latest.match_status)}</Pill>)
                                                : po.active_link ? <Pill tone="blue">Link sent</Pill> : <Pill>None</Pill>}
                                        </td>
                                        <td className="px-3 py-3">
                                            {ft ? <Pill tone={ft.doc_overdue ? 'red' : 'amber'}>{ft.doc_overdue ? 'Invoice overdue' : label(ft.status)}</Pill>
                                                : po.status === 'pending_approval' && !po.simulated_approval ? <Pill tone="amber">Awaiting approval</Pill> : <span className="text-text-tertiary text-xs">—</span>}
                                        </td>
                                        <td className="px-3 py-3 text-right text-text-tertiary"><ChevronDown className={`w-4 h-4 inline transition-transform ${isOpen ? 'rotate-180' : ''}`} /></td>
                                    </tr>
                                    {isOpen && (
                                        <tr className="bg-surface-elevated/40">
                                            <td colSpan={4} className="px-4 py-3">
                                                <div className="grid gap-4 md:grid-cols-[1fr_auto]">
                                                    <div className="space-y-2 text-xs text-text-secondary min-w-0">
                                                        <div>{shortDate(po.po_date)} · {po.project_name ?? 'no site'} · {approvalWord}{po.simulated_approval ? ` · invoice due by ${shortDate(po.simulated_approval.invoice_due_at)}` : ''}</div>
                                                        {po.last_notification && <div>{po.last_notification.status === 'sent' ? `Vendor WhatsApp sent (${po.last_notification.mode === 'live' ? 'vendor' : 'test number'})` : po.last_notification.status === 'no_phone' ? 'Vendor has no WhatsApp number. Add it in Zoho, then Send WhatsApp.' : `WhatsApp failed: ${(po.last_notification.error ?? '').slice(0, 100)}`}</div>}
                                                        {po.invoices.length > 0 && (
                                                            <ul className="space-y-0.5">
                                                                {po.invoices.slice(0, 4).map((i) => <li key={i.id}><button className="text-primary font-bold hover:underline" onClick={(e) => { e.stopPropagation(); onOpenInvoice(i.id); }}>{i.invoice_number ?? 'No number'}</button> · {inr(i.invoice_total)} · {label(i.match_status)}{i.review_status !== 'pending' ? ` · ${label(i.review_status).toLowerCase()}` : ''}</li>)}
                                                                {po.invoices.length > 4 && <li className="text-text-tertiary">+{po.invoices.length - 4} more</li>}
                                                            </ul>
                                                        )}
                                                        {po.active_link && !latest && <div>Upload link active until {shortDate(po.active_link.expires_at)}</div>}
                                                        {ft && <div>Urgent payment: {label(ft.status)} · invoice {label(ft.documentation_state).toLowerCase()}</div>}
                                                        {(po.case.overrides.length > 0 || po.case.notes.length > 0) && <CaseFlow c={po.case} />}
                                                    </div>
                                                    <div className="flex flex-wrap md:flex-col gap-1.5 items-start" onClick={(e) => e.stopPropagation()}>
                                                        {canSimulate && !po.simulated_approval && ['pending_approval', 'submitted'].includes(po.status ?? '') && <button className={btnGhost} onClick={() => setSimFor({ po, resend: false })}>Simulate approval</button>}
                                                        {canResend && (po.simulated_approval || (po.status !== 'pending_approval' && (po.last_notification || po.approval_watch))) && <button className={btnGhost} onClick={() => setSimFor({ po, resend: true })}>{po.last_notification?.status === 'no_phone' ? 'Send WhatsApp' : 'Resend WhatsApp'}</button>}
                                                        <button className={btnGhost} onClick={() => setPlanFor(po)}><CalendarClock className="w-4 h-4" /> Payment plan</button>
                                                        {canGenerate && takesInvoice(po) && <button className={btnGhost} onClick={() => setLinkFor(po)}><Link2 className="w-4 h-4" /> Vendor link</button>}
                                                        {canUploadInternal && takesInvoice(po) && <button className={btnGhost} onClick={() => setUploadFor(po)}><Upload className="w-4 h-4" /> Attach invoice</button>}
                                                    </div>
                                                </div>
                                            </td>
                                        </tr>
                                    )}
                                </React.Fragment>
                            );
                        })}
                    </tbody>
                </table>
                {!loading && !rows.length && <Empty>No POs match.</Empty>}
            </div>
            <Pager page={page} totalPages={totalPages} onPage={setPage} />

            {simFor && <SimulateApproval orgId={orgId} po={simFor.po} resend={simFor.resend} canConfigure={canSimulate} onClose={() => setSimFor(null)} onDone={() => { load(); onChanged(); }} />}
            {planFor && <PoPaymentPlan orgId={orgId} poId={planFor.id} poNumber={planFor.po_number} onClose={() => setPlanFor(null)} onChanged={onChanged} />}
            {linkFor && <LinkModal orgId={orgId} po={linkFor} defaultHours={linkExpiryHours} onClose={() => setLinkFor(null)} onChanged={() => { load(); onChanged(); }} />}
            {uploadFor && <InternalUploadModal orgId={orgId} po={uploadFor} onClose={() => setUploadFor(null)} onDone={(id) => { setUploadFor(null); load(); onChanged(); onOpenInvoice(id); }} />}
        </div>
    );
}


const EVENT_WORDS: Record<string, string> = {
    issue_resolved: 'resolved a check', invoice_corrected: 'corrected the invoice values', invoice_rejected: 'rejected the invoice', resubmission_requested: 'asked the vendor to resubmit',
    invoice_accepted: 'accepted the invoice', invoice_withdrawn: 'withdrew the invoice', fast_track_requested: 'asked for an urgent payment', fast_track_approved: 'approved the urgent payment',
    fast_track_rejected: 'rejected the urgent payment', fast_track_needs_information: 'asked for more information', documentation_waived: 'waived the invoice by policy',
};

/** What people said and did on this PO, as one short flow, newest first. The reasons are the point. */
function CaseFlow({ c }: { c: PoRow['case'] }) {
    return (
        <ol className="mt-2 ml-1 border-l-2 border-amber-400/60 space-y-2 max-w-[420px]">
            {c.overrides.map((o) => (
                <li key={`o${o.tranche_no}`} className="pl-3">
                    <div className="text-[12px] font-bold text-amber-800 dark:text-amber-300">{o.aligned_by_name ?? 'Purchase'} aligned {inr(o.requested_amount)}{o.percent_of_po != null ? ` (${o.percent_of_po}%)` : ''} although the invoice was {label(o.invoice_match_at_align ?? 'missing').toLowerCase()}</div>
                    <div className="text-[12px] text-text-primary">“{o.invoice_override_reason}”</div>
                </li>
            ))}
            {c.notes.map((n, i) => (
                <li key={i} className="pl-3">
                    <div className="text-[12px] text-text-secondary"><b className="text-text-primary">{n.actor_name ?? 'Someone'}</b> {EVENT_WORDS[n.event_type] ?? label(n.event_type).toLowerCase()}{n.rule_code ? ` (${label(n.rule_code).toLowerCase()})` : ''}</div>
                    {n.text && <div className="text-[12px] text-text-primary">“{n.text}”</div>}
                </li>
            ))}
        </ol>
    );
}

// --- link generation ----------------------------------------------------------

/** A PO awaiting approval cannot take an invoice (the server refuses), unless its approval is simulated. */
const takesInvoice = (po: PoRow) => !!po.simulated_approval || !['pending_approval', 'submitted', 'draft'].includes(po.status ?? '');

function LinkModal({ orgId, po, onClose, onChanged, defaultHours }: { orgId: string; po: PoRow; onClose: () => void; onChanged: () => void; defaultHours: number }) {
    const [hours, setHours] = useState(String(defaultHours));
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [made, setMade] = useState<{ upload_url: string; expires_at: string } | null>(null);
    const [copied, setCopied] = useState(false);
    const [history, setHistory] = useState<{ id: string; status: string; expires_at: string; created_at: string }[]>([]);

    const loadHistory = useCallback(async () => {
        try { const d = await api<{ links: typeof history }>(`/api/invoices/links?org_id=${orgId}&po_id=${po.id}`); setHistory(d.links); } catch { /* the list is a convenience */ }
    }, [orgId, po.id]);
    useEffect(() => { loadHistory(); }, [loadHistory]);

    const create = async () => {
        setBusy(true); setError(null);
        try {
            const d = await api<{ upload_url: string; expires_at: string }>('/api/invoices/links', { method: 'POST', body: JSON.stringify({ org_id: orgId, po_id: po.id, expires_in_hours: Number(hours) }) });
            setMade(d); onChanged(); loadHistory();
        } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
    };
    const revoke = async (id: string) => {
        try { await api(`/api/invoices/links/${id}`, { method: 'PATCH', body: JSON.stringify({ org_id: orgId, action: 'revoke' }) }); loadHistory(); onChanged(); } catch (e) { setError((e as Error).message); }
    };
    const copy = async () => { if (!made) return; await navigator.clipboard.writeText(made.upload_url).catch(() => undefined); setCopied(true); setTimeout(() => setCopied(false), 1800); };
    const whatsapp = made ? `https://wa.me/?text=${encodeURIComponent(`Please upload your invoice for PO ${po.po_number} here (one-time link, expires ${shortDate(made.expires_at)}): ${made.upload_url}`)}` : '#';

    return (
        <Modal title={`Invoice link · ${po.po_number}`} onClose={onClose}>
            <div className="space-y-4">
                <p className="text-sm text-text-secondary">One link, one invoice, for <b>{po.vendor_name}</b>. The vendor needs no account. Once they submit, the link stops working.</p>
                {!made ? (
                    <>
                        <Field label="Expires in (hours)" hint="Default comes from the policy. Maximum 720 (30 days).">
                            <input className={inputCls} type="number" min={1} max={720} value={hours} onChange={(e) => setHours(e.target.value)} />
                        </Field>
                        <ErrorLine message={error} />
                        <button className={btnPrimary} onClick={create} disabled={busy}>{busy ? 'Creating…' : 'Create link'}</button>
                    </>
                ) : (
                    <div className="space-y-3">
                        <p className="text-xs text-amber-700 dark:text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-xl px-3 py-2">Copy it now. For security the link is shown only once and cannot be recovered; if lost, revoke it and make a new one.</p>
                        <input readOnly className={`${inputCls} font-mono text-xs`} value={made.upload_url} onFocus={(e) => e.currentTarget.select()} />
                        <div className="flex flex-wrap gap-2">
                            <button className={btnPrimary} onClick={copy}>{copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />} {copied ? 'Copied' : 'Copy link'}</button>
                            <a className={btnGhost} href={whatsapp} target="_blank" rel="noreferrer"><MessageCircle className="w-4 h-4" /> Share on WhatsApp</a>
                        </div>
                        <p className="text-xs text-text-tertiary">Expires {shortDate(made.expires_at)}.</p>
                    </div>
                )}
                {history.length > 0 && (
                    <div>
                        <div className="text-xs font-bold text-text-secondary mb-1.5">Earlier links</div>
                        <ul className="divide-y divide-border border border-border rounded-xl">
                            {history.map((l) => (
                                <li key={l.id} className="flex items-center justify-between gap-2 px-3 py-2 text-xs">
                                    <span className="text-text-secondary">{shortDate(l.created_at)} → {shortDate(l.expires_at)}</span>
                                    <span className="flex items-center gap-2">
                                        <Pill tone={l.status === 'used' ? 'green' : l.status === 'active' ? 'blue' : 'grey'}>{label(l.status)}</Pill>
                                        {l.status === 'active' && <button className="text-red-600 hover:underline inline-flex items-center gap-1" onClick={() => revoke(l.id)}><Ban className="w-3 h-3" /> Revoke</button>}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
            </div>
        </Modal>
    );
}

// --- invoice received another way ---------------------------------------------

function InternalUploadModal({ orgId, po, onClose, onDone }: { orgId: string; po: PoRow; onClose: () => void; onDone: (invoiceId: string) => void }) {
    const [file, setFile] = useState<File | null>(null);
    const [number, setNumber] = useState('');
    const [date, setDate] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const key = useRef(newKey());

    const submit = async () => {
        if (!file) { setError('Choose the invoice file.'); return; }
        setBusy(true); setError(null);
        try {
            const slot = await api<{ upload_id: string; bucket: string; upload_path: string; upload_token: string }>('/api/invoices/upload', {
                method: 'POST', body: JSON.stringify({ org_id: orgId, kind: 'invoice', po_id: po.id, filename: file.name, content_type: file.type, file_size_bytes: file.size }),
            });
            await uploadToSlot(slot, file);
            const d = await api<{ invoice_id: string }>('/api/invoices/upload/submit', {
                method: 'POST', idempotencyKey: key.current,
                body: JSON.stringify({ org_id: orgId, po_id: po.id, upload_id: slot.upload_id, filename: file.name, invoice_number: number || undefined, invoice_date: date || undefined }),
            });
            onDone(d.invoice_id);
        } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
    };

    return (
        <Modal title={`Attach invoice · ${po.po_number}`} onClose={onClose}>
            <div className="space-y-4">
                <p className="text-sm text-text-secondary">For an invoice that reached you by mail or WhatsApp. It is stored and checked exactly like a vendor upload, and recorded as an internal upload by you.</p>
                <Field label="Invoice file (PDF, JPEG or PNG)"><input type="file" accept="application/pdf,image/jpeg,image/png" className={inputCls} onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></Field>
                <div className="grid grid-cols-2 gap-3">
                    <Field label="Invoice number (optional)"><input className={inputCls} value={number} onChange={(e) => setNumber(e.target.value)} /></Field>
                    <Field label="Invoice date (optional)"><input type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
                </div>
                <ErrorLine message={error} />
                <button className={btnPrimary} onClick={submit} disabled={busy}>{busy ? 'Uploading…' : 'Upload and check'}</button>
            </div>
        </Modal>
    );
}
