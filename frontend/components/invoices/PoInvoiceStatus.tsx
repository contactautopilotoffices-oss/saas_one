'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Search, Link2, Upload, Copy, Check, Ban, RefreshCw, MessageCircle, CalendarClock } from 'lucide-react';
import {
    api, inr, shortDate, label, newKey, uploadToSlot, Pill, matchTone, reviewTone, docTone, Modal, Field, inputCls, btnPrimary, btnGhost,
    ErrorLine, Empty, Pager,
} from './invoiceUi';
import PoPaymentPlan from './PoPaymentPlan';

interface PoRow {
    id: string; po_number: string; vendor_name: string | null; po_amount: number | null; project_name: string | null; po_date: string | null; status: string | null;
    invoices: { id: string; invoice_number: string | null; invoice_total: number | null; match_status: string; review_status: string; extraction_status: string; submitted_at: string }[];
    active_link: { id: string; expires_at: string } | null;
    fast_track: { id: string; status: string; documentation_state: string; doc_overdue: boolean; invoice_pending: boolean }[];
}

const FILTERS = [
    ['all', 'All POs'], ['attention', 'Needs attention'], ['has_invoice', 'Invoice received'], ['awaiting_invoice', 'Invoice pending (fast-track)'], ['fast_track', 'Any fast-track'],
] as const;

export default function PoInvoiceStatus({ orgId, canGenerate, canUploadInternal, onOpenInvoice, onChanged }: {
    orgId: string; canGenerate: boolean; canUploadInternal: boolean; onOpenInvoice: (id: string) => void; onChanged: () => void;
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
    const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

    const load = useCallback(async () => {
        setLoading(true); setError(null);
        try {
            const p = new URLSearchParams({ org_id: orgId, page: String(page), page_size: '25', filter, search });
            const d = await api<{ pos: PoRow[]; pagination: { total_pages: number } }>(`/api/invoices/po-status?${p}`);
            setRows(d.pos); setTotalPages(d.pagination.total_pages || 1);
        } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
    }, [orgId, page, filter, search]);

    useEffect(() => { if (debounce.current) clearTimeout(debounce.current); debounce.current = setTimeout(load, search ? 300 : 0); return () => { if (debounce.current) clearTimeout(debounce.current); }; }, [load, search]);
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
                            <th className="text-left px-3 py-2.5 font-bold">Vendor</th>
                            <th className="text-right px-3 py-2.5 font-bold">PO value</th>
                            <th className="text-left px-3 py-2.5 font-bold">Invoice</th>
                            <th className="text-left px-3 py-2.5 font-bold">Fast-track</th>
                            <th className="px-3 py-2.5" />
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                        {rows.map((po) => {
                            const latest = po.invoices[0];
                            return (
                                <tr key={po.id} className="align-top hover:bg-surface-elevated/50">
                                    <td className="px-3 py-3"><div className="font-bold text-text-primary">{po.po_number}</div><div className="text-[11px] text-text-tertiary">{shortDate(po.po_date)} · {po.project_name ?? '—'}</div></td>
                                    <td className="px-3 py-3 text-text-secondary max-w-[220px] truncate" title={po.vendor_name ?? ''}>{po.vendor_name ?? '—'}</td>
                                    <td className="px-3 py-3 text-right tabular-nums text-text-primary">{inr(po.po_amount)}</td>
                                    <td className="px-3 py-3">
                                        {latest ? (
                                            <button onClick={() => onOpenInvoice(latest.id)} className="text-left group">
                                                <div className="flex flex-wrap items-center gap-1.5">
                                                    <Pill tone={matchTone(latest.match_status)}>{latest.extraction_status === 'processing' || latest.extraction_status === 'pending' ? 'Reading…' : label(latest.match_status)}</Pill>
                                                    {latest.review_status !== 'pending' && <Pill tone={reviewTone(latest.review_status)}>{label(latest.review_status)}</Pill>}
                                                </div>
                                                <div className="text-[11px] text-text-tertiary mt-1 group-hover:underline">{latest.invoice_number ?? 'No number'} · {inr(latest.invoice_total)}{po.invoices.length > 1 ? ` · +${po.invoices.length - 1} more` : ''}</div>
                                            </button>
                                        ) : po.active_link ? (
                                            <div><Pill tone="blue">Link sent</Pill><div className="text-[11px] text-text-tertiary mt-1">Expires {shortDate(po.active_link.expires_at)}</div></div>
                                        ) : <Pill>No invoice</Pill>}
                                    </td>
                                    <td className="px-3 py-3">
                                        {po.fast_track.length ? po.fast_track.map((f) => (
                                            <div key={f.id} className="flex flex-wrap items-center gap-1.5 mb-1">
                                                <Pill tone="amber">{label(f.status)}</Pill>
                                                <Pill tone={docTone(f.documentation_state, f.doc_overdue)}>{f.doc_overdue ? 'Invoice overdue' : `Invoice: ${label(f.documentation_state).toLowerCase()}`}</Pill>
                                            </div>
                                        )) : <span className="text-text-tertiary text-xs">—</span>}
                                    </td>
                                    <td className="px-3 py-3 text-right whitespace-nowrap">
                                        <button className={`${btnGhost} mr-1.5`} onClick={() => setPlanFor(po)} title="Payment terms as milestones"><CalendarClock className="w-4 h-4" /> Plan</button>
                                        {canGenerate && <button className={btnGhost} onClick={() => setLinkFor(po)} title="Create a vendor upload link"><Link2 className="w-4 h-4" /> Link</button>}
                                        {canUploadInternal && <button className={`${btnGhost} ml-1.5`} onClick={() => setUploadFor(po)} title="Attach an invoice received by mail or WhatsApp"><Upload className="w-4 h-4" /></button>}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
                {!loading && !rows.length && <Empty>No POs match.</Empty>}
            </div>
            <Pager page={page} totalPages={totalPages} onPage={setPage} />

            {planFor && <PoPaymentPlan orgId={orgId} poId={planFor.id} poNumber={planFor.po_number} onClose={() => setPlanFor(null)} onChanged={onChanged} />}
            {linkFor && <LinkModal orgId={orgId} po={linkFor} onClose={() => setLinkFor(null)} onChanged={() => { load(); onChanged(); }} />}
            {uploadFor && <InternalUploadModal orgId={orgId} po={uploadFor} onClose={() => setUploadFor(null)} onDone={(id) => { setUploadFor(null); load(); onChanged(); onOpenInvoice(id); }} />}
        </div>
    );
}

// --- link generation ----------------------------------------------------------

function LinkModal({ orgId, po, onClose, onChanged }: { orgId: string; po: PoRow; onClose: () => void; onChanged: () => void }) {
    const [hours, setHours] = useState('72');
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
