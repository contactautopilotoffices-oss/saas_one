'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ChevronDown, RefreshCw, Search, Link2, CheckCircle2 } from 'lucide-react';
import { api, Pill, Modal, ErrorLine, Empty, inputCls, btnPrimary, btnGhost, btnDanger } from '@/frontend/components/invoices/invoiceUi';

interface Item { id: string; po_number: string; vendor_name: string | null; po_amount: number | null; project_name: string | null; po_date: string | null; raised_by: string | null; note_to_approver: string | null; delivery_date: string | null; approvers: string[]; waiting_days: number | null }
interface Queue {
    provisioned: boolean; env_ready: boolean;
    link: { connected: boolean; zoho_email: string | null; zoho_user_name: string | null; last_error: string | null };
    items: Item[]; pagination: { page: number; total: number; total_pages: number };
}
interface Detail { lines: { id: string; name: string | null; unit: string | null; quantity: number | null; rate: number | null; tax_percentage: number | null; item_total: number | null; previous: { rate: number; po_number: string } | null; change_pct: number | null }[]; terms: string | null; notes: string | null; note_to_approver: string | null }

const inr = (n: number | null | undefined) => (n == null ? '—' : `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`);

/** The founders' queue: every PO waiting for approval, judged and decided in one place. */
export default function PoApprovals({ orgId }: { orgId: string }) {
    const [q, setQ] = useState<Queue | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [search, setSearch] = useState('');
    const [page, setPage] = useState(1);
    const [loading, setLoading] = useState(true);
    const [openId, setOpenId] = useState<string | null>(null);
    const [flash, setFlash] = useState<string | null>(null);
    const sp = useSearchParams();
    const zoho = sp?.get('zoho');

    const load = useCallback(async () => {
        setLoading(true);
        try { setQ(await api<Queue>(`/api/po-approver/queue?${new URLSearchParams({ org_id: orgId, page: String(page), search })}`)); setError(null); }
        catch (e) { setQ(null); setError((e as Error).message); } finally { setLoading(false); }
    }, [orgId, page, search]);
    useEffect(() => { const t = setTimeout(load, search ? 300 : 0); return () => clearTimeout(t); }, [load, search]);
    useEffect(() => { setPage(1); }, [search]);

    const link = q?.link;
    return (
        <div className="space-y-4">
            <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                    <h2 className="text-xl font-bold text-text-primary">PO Approvals</h2>
                    <p className="text-sm text-text-secondary mt-0.5">{q ? `${q.pagination.total} waiting for you` : 'Purchase orders waiting for approval.'} Your decision is recorded in Zoho under your name.</p>
                </div>
                <button className={btnGhost} onClick={load} aria-label="Refresh"><RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /></button>
            </div>

            {zoho === 'connected' && <p className="text-sm text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4" /> Your Zoho account is linked.</p>}
            {zoho && zoho !== 'connected' && <ErrorLine message={zoho === 'denied' ? 'Zoho access was not granted, so approvals stay off.' : zoho === 'wrong_user' ? 'That Zoho link was started by someone else. Start it again from your own login.' : `The Zoho link did not complete${sp?.get('why') ? `: ${sp.get('why')}` : '.'}`} />}

            {q && !q.provisioned && <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-text-primary">Approvals are not switched on yet: the database step for them (<code>20261026000001_po_approver.sql</code>) has not been applied. You can read the queue; Approve and Reject stay off until it is.</div>}
            {q && q.provisioned && !link?.connected && (
                <div className="rounded-xl border border-border bg-surface-elevated px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
                    <p className="text-sm text-text-primary">Link your Zoho account once so Zoho records approvals as <b>you</b>.{link?.last_error ? <span className="block text-xs text-red-600 mt-0.5">{link.last_error}</span> : null}</p>
                    {q.env_ready
                        ? <a className={btnPrimary} href={`/api/po-approver/connect?org_id=${encodeURIComponent(orgId)}`}><Link2 className="w-4 h-4" /> Connect my Zoho</a>
                        : <span className="text-xs text-text-tertiary">The server needs its Zoho client settings first.</span>}
                </div>
            )}
            {link?.connected && <p className="text-xs text-text-tertiary">Zoho linked{link.zoho_email ? ` as ${link.zoho_email}` : ''}.</p>}

            <div className="relative max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-tertiary" />
                <input className={`${inputCls} pl-9`} placeholder="Search PO, vendor or site…" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>

            <ErrorLine message={error} />
            <div className="border border-border rounded-2xl overflow-hidden divide-y divide-border bg-surface">
                {loading && !q && <div className="px-4 py-10 text-center text-sm text-text-tertiary">Loading…</div>}
                {q && q.items.length === 0 && <Empty>Nothing is waiting for approval.</Empty>}
                {q?.items.map((p) => (
                    <div key={p.id}>
                        <button className="w-full text-left px-4 py-3 hover:bg-surface-elevated/60 flex items-center gap-3" onClick={() => setOpenId(openId === p.id ? null : p.id)} aria-expanded={openId === p.id}>
                            <div className="min-w-0 flex-1">
                                <div className="font-bold text-text-primary">{p.po_number}</div>
                                <div className="text-xs text-text-tertiary truncate">{p.vendor_name ?? '—'}{p.project_name ? ` · ${p.project_name}` : ''}</div>
                            </div>
                            <div className="text-right shrink-0">
                                <div className="font-bold text-text-primary tabular-nums">{inr(p.po_amount)}</div>
                                {p.waiting_days != null && <Pill tone={p.waiting_days >= 3 ? 'amber' : 'grey'}>{p.waiting_days === 0 ? 'Today' : `${p.waiting_days} day${p.waiting_days > 1 ? 's' : ''}`}</Pill>}
                            </div>
                            <ChevronDown className={`w-4 h-4 text-text-tertiary shrink-0 transition-transform ${openId === p.id ? 'rotate-180' : ''}`} />
                        </button>
                        {openId === p.id && <Review orgId={orgId} item={p} canAct={!!q.provisioned && !!link?.connected} onDone={(m) => { setFlash(m); setOpenId(null); load(); }} />}
                    </div>
                ))}
            </div>
            {flash && <p className="text-sm text-text-primary">{flash}</p>}

            {q && q.pagination.total_pages > 1 && (
                <div className="flex items-center justify-between text-xs text-text-secondary">
                    <span>Page {q.pagination.page} of {q.pagination.total_pages}</span>
                    <span className="flex gap-1"><button className={btnGhost} disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button><button className={btnGhost} disabled={page >= q.pagination.total_pages} onClick={() => setPage(page + 1)}>Next</button></span>
                </div>
            )}
        </div>
    );
}

function Review({ orgId, item, canAct, onDone }: { orgId: string; item: Item; canAct: boolean; onDone: (message: string) => void }) {
    const [d, setD] = useState<Detail | null>(null);
    const [err, setErr] = useState<string | null>(null);
    const [showTerms, setShowTerms] = useState(false);
    const [mode, setMode] = useState<null | 'reject' | 'question' | 'approve'>(null);
    const [text, setText] = useState('');
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        let alive = true;
        api<Detail>(`/api/po-approver/po/${item.id}?org_id=${encodeURIComponent(orgId)}`).then((x) => { if (alive) setD(x); }).catch((e: Error) => { if (alive) setErr(e.message); });
        return () => { alive = false; };
    }, [orgId, item.id]);

    const send = async (decision: 'approve' | 'reject' | 'question') => {
        setBusy(true); setErr(null);
        try {
            const r = await api<{ ok: boolean; message: string }>('/api/po-approver/decide', { method: 'POST', body: JSON.stringify({ org_id: orgId, po_id: item.id, decision, reason: text }) });
            onDone(`${item.po_number}: ${r.message}`);
        } catch (e) { setErr((e as Error).message); setMode(decision === 'approve' ? null : mode); } finally { setBusy(false); }
    };

    return (
        <div className="px-4 pb-4 pt-1 bg-surface-elevated/40 space-y-3">
            <p className="text-xs text-text-secondary">{[item.raised_by && `Raised by ${item.raised_by}`, item.po_date && `PO date ${item.po_date}`, item.delivery_date && `Delivery ${item.delivery_date}`, item.approvers.length ? `Approver: ${item.approvers.join(', ')}` : null].filter(Boolean).join(' · ')}</p>
            {(d?.note_to_approver || item.note_to_approver) && <p className="text-sm text-text-primary border-l-2 border-primary/40 pl-3">“{d?.note_to_approver || item.note_to_approver}”</p>}
            {!d && !err && <p className="text-sm text-text-tertiary">Loading the lines…</p>}
            {d && d.lines.length > 0 && (
                <div className="overflow-x-auto rounded-xl border border-border bg-surface">
                    <table className="w-full text-sm">
                        <thead><tr className="bg-surface-elevated text-left text-[11px] font-bold text-text-secondary uppercase tracking-wide"><th className="px-3 py-2">Item</th><th className="px-3 py-2 text-right">Qty</th><th className="px-3 py-2 text-right">Rate</th><th className="px-3 py-2 text-right">Last time</th><th className="px-3 py-2 text-right">Amount</th></tr></thead>
                        <tbody className="divide-y divide-border">
                            {d.lines.map((l) => (
                                <tr key={l.id}>
                                    <td className="px-3 py-2 min-w-[200px] text-text-primary">{l.name ?? '—'}</td>
                                    <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{l.quantity ?? '—'}{l.unit ? ` ${l.unit}` : ''}</td>
                                    <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{inr(l.rate)}</td>
                                    <td className="px-3 py-2 text-right whitespace-nowrap text-xs">
                                        {l.previous ? <><span className="tabular-nums text-text-secondary">{inr(l.previous.rate)}</span>{l.change_pct != null && l.change_pct !== 0 && <span className={`ml-1.5 font-bold ${l.change_pct > 0 ? 'text-red-600' : 'text-emerald-600'}`}>{l.change_pct > 0 ? '+' : ''}{l.change_pct}%</span>}</> : <span className="text-text-tertiary">first time</span>}
                                    </td>
                                    <td className="px-3 py-2 text-right tabular-nums font-bold whitespace-nowrap">{inr(l.item_total)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
            {d && (d.terms || d.notes) && <div><button className="text-xs font-bold text-primary hover:underline" onClick={() => setShowTerms(!showTerms)}>{showTerms ? 'Hide terms' : 'Show terms'}</button>{showTerms && <p className="mt-1 text-xs text-text-primary whitespace-pre-line leading-relaxed">{[d.terms, d.notes].filter(Boolean).join('\n\n')}</p>}</div>}
            <ErrorLine message={err} />

            {!mode && (
                <div className="flex flex-wrap gap-2">
                    <button className={btnPrimary} disabled={!canAct} onClick={() => { setMode('approve'); setText(''); }}>Approve</button>
                    <button className={btnDanger} disabled={!canAct} onClick={() => { setMode('reject'); setText(''); }}>Reject</button>
                    <button className={btnGhost} disabled={!canAct} onClick={() => { setMode('question'); setText(''); }}>Ask Purchase a question</button>
                    {!canAct && <span className="text-xs text-text-tertiary self-center">Link your Zoho (above) to act.</span>}
                </div>
            )}
            {(mode === 'reject' || mode === 'question') && (
                <div className="space-y-2">
                    <input className={inputCls} autoFocus placeholder={mode === 'reject' ? 'Why is it rejected? Purchase will see this.' : 'What do you want to ask Purchase?'} value={text} onChange={(e) => setText(e.target.value)} />
                    <div className="flex gap-2">
                        <button className={mode === 'reject' ? btnDanger : btnPrimary} disabled={busy || text.trim().length < (mode === 'reject' ? 5 : 3)} onClick={() => send(mode)}>{mode === 'reject' ? 'Reject this PO' : 'Send question'}</button>
                        <button className={btnGhost} onClick={() => setMode(null)}>Cancel</button>
                    </div>
                </div>
            )}
            {mode === 'approve' && (
                <Modal title="Approve this PO?" onClose={() => setMode(null)}>
                    <div className="space-y-4">
                        <p className="text-sm text-text-primary">Approve <b>{item.po_number}</b> for <b>{item.vendor_name ?? 'the vendor'}</b>, <b>{inr(item.po_amount)}</b>? Zoho will record this as your approval.</p>
                        <ErrorLine message={err} />
                        <div className="flex gap-2"><button className={btnPrimary} disabled={busy} onClick={() => send('approve')}>{busy ? 'Approving…' : 'Yes, approve'}</button><button className={btnGhost} onClick={() => setMode(null)}>Cancel</button></div>
                    </div>
                </Modal>
            )}
        </div>
    );
}
