'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, Bell, ChevronLeft, ChevronRight } from 'lucide-react';
import { api, inputCls, btnGhost, btnPrimary, ErrorLine, Empty, Field } from '@/frontend/components/invoices/invoiceUi';

/**
 * The AOP Bounty inbox. Reads like a mail list on purpose: what is stuck, with whom, since when.
 * No totals. Each row carries last month and the month before for scale, and the owner.
 * Same component in every login that may see it; what a person can DO comes from the API.
 */

interface Bounty {
    id: string; kind: 'actual' | 'decision' | 'approval' | 'mapping' | 'phone'; title: string; detail: string | null; status: 'waiting' | 'open' | 'answered' | 'closed';
    site_id: string | null; line_item_id: string | null; site_name: string | null; line_name: string | null; owner_role: string; owner_name: string | null; owner_user_id: string | null;
    compare_line: string; urgency: 'late' | 'soon' | 'normal' | 'done'; overdue: boolean; group: 'Today' | 'Yesterday' | 'Last 7 days' | 'Earlier';
    due_at: string; expected_at: string | null; ping_count: number; last_pinged_at: string | null; answered_at: string | null; answer: { kind?: string; expected_day?: number; note?: string | null } | null;
    created_at: string; is_mine: boolean; source_type: string | null; source_id: string | null;
}
interface Data { month: string; items: Bounty[]; counts: { open: number; waiting: number; overdue: number; mine: number; answered: number; closed: number }; can_manage: boolean; roles: string[] }

const GROUPS: Bounty['group'][] = ['Today', 'Yesterday', 'Last 7 days', 'Earlier'];
const ROLE_LABEL: Record<string, string> = { purchase: 'Purchase', accounts: 'Accounts', operations: 'Operations', approver: 'Approver' };
const KIND_LABEL: Record<Bounty['kind'], string> = { actual: 'Figure', decision: 'Decision', approval: 'Approval', mapping: 'PO data', phone: 'Vendor number' };
const shortDay = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }).toUpperCase();
const monthName = (m: string) => new Date(`${m}T00:00:00Z`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const shiftMonth = (m: string, n: number) => { const [y, mm] = m.split('-').map(Number); const d = new Date(Date.UTC(y, mm - 1 + n, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`; };

/** invoicesHref: where Invoice Control lives in the dashboard this inbox is mounted in. */
export default function BountyInbox({ orgId, invoicesHref = '?tab=procurement&procurement_tab=invoices' }: { orgId: string; invoicesHref?: string }) {
    const [month, setMonth] = useState(() => { const d = new Date(Date.now() + 5.5 * 3_600_000); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`; });
    const [view, setView] = useState<'open' | 'mine' | 'all'>('open');
    const [d, setD] = useState<Data | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [openId, setOpenId] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    const load = useCallback(async (refresh = false) => {
        setLoading(true);
        try { setD(await api<Data>(`/api/aop/bounties?${new URLSearchParams({ org_id: orgId, month, view, ...(refresh ? { refresh: '1' } : {}) })}`)); setError(null); }
        catch (e) { setD(null); setError((e as Error).message); } finally { setLoading(false); }
    }, [orgId, month, view]);
    // Rebuilding the month is heavy: do it when a month is first opened, not on every Open/Mine/All click.
    const builtFor = useRef<string | null>(null);
    useEffect(() => { const fresh = builtFor.current !== month; builtFor.current = month; load(fresh); }, [load, month]);

    /** True when it worked, so a form closes only on success and keeps what was typed otherwise. */
    const act = async (body: Record<string, unknown>): Promise<boolean> => {
        setBusy(true); setError(null);
        try { await api('/api/aop/bounties', { method: 'POST', body: JSON.stringify({ org_id: orgId, ...body }) }); await load(false); return true; }
        catch (e) { setError((e as Error).message); return false; } finally { setBusy(false); }
    };

    const grouped = useMemo(() => {
        const m = new Map<Bounty['group'], Bounty[]>();
        for (const b of d?.items ?? []) m.set(b.group, [...(m.get(b.group) ?? []), b]);
        // Late first inside each group, then soonest due.
        for (const list of m.values()) list.sort((a, b) => Number(b.overdue) - Number(a.overdue) || a.due_at.localeCompare(b.due_at));
        return m;
    }, [d]);

    const c = d?.counts;
    const summary = c ? [`${c.open} open`, c.waiting ? `${c.waiting} waiting` : null, c.overdue ? `${c.overdue} overdue` : null, c.answered ? `${c.answered} answered` : null, c.closed ? `${c.closed} closed` : null].filter(Boolean).join(' · ') : '';

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-1 border border-border rounded-xl px-1">
                    <button className="p-1.5 text-text-tertiary hover:text-text-primary" aria-label="Previous month" onClick={() => setMonth((m) => shiftMonth(m, -1))}><ChevronLeft className="w-4 h-4" /></button>
                    <span className="text-sm font-bold text-text-primary px-1 min-w-[150px] text-center">{monthName(month)}</span>
                    <button className="p-1.5 text-text-tertiary hover:text-text-primary" aria-label="Next month" onClick={() => setMonth((m) => shiftMonth(m, 1))}><ChevronRight className="w-4 h-4" /></button>
                </div>
                <div className="flex items-center gap-1 border border-border rounded-xl p-1" role="tablist">
                    {(['open', 'mine', 'all'] as const).map((v) => (
                        <button key={v} role="tab" aria-selected={view === v} onClick={() => setView(v)} className={`px-3 py-1 rounded-lg text-xs font-bold ${view === v ? 'bg-primary text-white' : 'text-text-secondary hover:bg-surface-elevated'}`}>
                            {v === 'open' ? 'Open' : v === 'mine' ? `Mine${c?.mine ? ` · ${c.mine}` : ''}` : 'All'}
                        </button>
                    ))}
                </div>
                <span className="text-xs text-text-tertiary">{summary}</span>
                <button className={`${btnGhost} ml-auto`} onClick={() => load(true)} aria-label="Refresh"><RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /></button>
            </div>
            <ErrorLine message={error} />

            <div className="border border-border rounded-2xl overflow-hidden bg-surface">
                {GROUPS.filter((g) => grouped.has(g)).map((g) => (
                    <div key={g}>
                        <div className="px-4 py-2 text-xs font-bold text-text-tertiary bg-surface-elevated border-b border-border">{g}</div>
                        <ul className="divide-y divide-border">
                            {grouped.get(g)!.map((b) => (
                                <li key={b.id}>
                                    <button onClick={() => setOpenId(openId === b.id ? null : b.id)} className="w-full text-left grid grid-cols-[4px_1fr_auto] gap-x-3 px-3 py-2.5 hover:bg-surface-elevated/60" aria-expanded={openId === b.id}>
                                        <span className={`w-1 rounded-full self-stretch ${b.urgency === 'late' ? 'bg-red-500' : b.urgency === 'soon' ? 'bg-amber-500' : b.urgency === 'done' ? 'bg-emerald-500' : 'bg-border'}`} />
                                        <span className="min-w-0">
                                            <span className="flex flex-wrap items-center gap-2">
                                                <span className="text-sm font-bold text-text-primary truncate">{b.title}</span>
                                                <span className="text-[11px] font-bold text-primary bg-primary/10 px-2 py-0.5 rounded-full">{KIND_LABEL[b.kind]} · {b.owner_name ?? ROLE_LABEL[b.owner_role]}</span>
                                                {b.is_mine && <span className="text-[11px] font-bold text-amber-700 dark:text-amber-400">yours</span>}
                                                {b.status === 'answered' && <span className="text-[11px] text-emerald-700 dark:text-emerald-400 font-bold">{b.answer?.kind === 'no_spend' ? 'No spend this month' : 'Answered'}</span>}
                                                {b.status === 'closed' && <span className="text-[11px] text-emerald-700 dark:text-emerald-400 font-bold">Done</span>}
                                            </span>
                                            <span className="block text-[13px] text-text-secondary mt-0.5 line-clamp-2">{b.detail}</span>
                                            <span className="block text-[11px] text-text-tertiary mt-0.5 font-mono">
                                                {b.compare_line}{b.ping_count ? ` · asked ${b.ping_count}×` : ''}{b.overdue ? ' · overdue' : ` · due ${new Date(b.due_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`}{b.status === 'waiting' && b.expected_at ? ` · expected ${new Date(b.expected_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}` : ''}
                                            </span>
                                        </span>
                                        <span className="text-[11px] text-text-tertiary whitespace-nowrap pt-0.5">{shortDay(b.last_pinged_at ?? b.answered_at ?? b.created_at)}</span>
                                    </button>
                                    {openId === b.id && <BountyActions b={b} canManage={!!d?.can_manage} busy={busy} onAct={act} invoicesHref={invoicesHref} />}
                                </li>
                            ))}
                        </ul>
                    </div>
                ))}
                {!loading && !error && d && !d.items.length && <Empty>{view === 'mine' ? 'Nothing is waiting on you this month.' : 'Nothing open for this month.'}</Empty>}
            </div>
            <p className="text-[11px] text-text-tertiary">A bounty closes by itself when the figure, invoice, decision or PO data arrives. Owners are asked every two days once the expected date passes; anything still open at month end is escalated to Operations.</p>
        </div>
    );
}

function BountyActions({ b, canManage, busy, onAct, invoicesHref }: { b: Bounty; canManage: boolean; busy: boolean; onAct: (body: Record<string, unknown>) => Promise<boolean>; invoicesHref: string }) {
    const [mode, setMode] = useState<null | 'coming' | 'note' | 'expected' | 'assign'>(null);
    const [day, setDay] = useState('');
    const [note, setNote] = useState('');
    const [cad, setCad] = useState('1');
    const [vendor, setVendor] = useState('');
    const [role, setRole] = useState(b.owner_role);
    const openish = b.status === 'open' || b.status === 'waiting';
    const linkFor = b.source_type === 'invoice' || b.source_type === 'fast_track' ? invoicesHref : null;

    return (
        <div className="px-4 pb-3 pt-1 ml-4 border-l-2 border-primary/30 space-y-2">
            {!mode && (
                <div className="flex flex-wrap gap-2">
                    {openish && <button className={btnGhost} disabled={busy} onClick={() => onAct({ action: 'ping', bounty_id: b.id })}><Bell className="w-4 h-4" /> Ask {b.owner_name ?? ROLE_LABEL[b.owner_role]} now</button>}
                    {openish && b.kind === 'actual' && (b.is_mine || canManage) && <>
                        <button className={btnGhost} disabled={busy} onClick={() => onAct({ action: 'answer', bounty_id: b.id, answer: 'no_spend' })}>No spend this month</button>
                        <button className={btnGhost} onClick={() => setMode('coming')}>Will be in by…</button>
                        <button className={btnGhost} onClick={() => setMode('expected')}>Set vendor&apos;s billing pattern</button>
                    </>}
                    {openish && (b.is_mine || canManage) && <button className={btnGhost} onClick={() => setMode('note')}>Add a note</button>}
                    {canManage && openish && <button className={btnGhost} onClick={() => setMode('assign')}>Assign owner</button>}
                    {b.status === 'answered' && (b.is_mine || canManage) && <button className={btnGhost} disabled={busy} onClick={() => onAct({ action: 'reopen', bounty_id: b.id })}>Reopen</button>}
                    {linkFor && <a className={btnGhost} href={linkFor}>Open in Invoice Control</a>}
                </div>
            )}
            {mode === 'coming' && <div className="flex flex-wrap items-end gap-2">
                <Field label="In by day of month"><input className={`${inputCls} w-24`} type="number" min={1} max={31} value={day} onChange={(e) => setDay(e.target.value)} /></Field>
                <Field label="Note (optional)"><input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
                <button className={btnPrimary} disabled={busy || !day} onClick={() => onAct({ action: 'answer', bounty_id: b.id, answer: 'coming_on', expected_day: Number(day), note }).then((ok) => { if (ok) setMode(null); })}>Save</button>
                <button className={btnGhost} onClick={() => setMode(null)}>Cancel</button>
            </div>}
            {mode === 'note' && <div className="flex flex-wrap items-end gap-2">
                <Field label="Note"><input className={`${inputCls} min-w-[260px]`} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
                <button className={btnPrimary} disabled={busy || note.trim().length < 3} onClick={() => onAct({ action: 'answer', bounty_id: b.id, answer: 'note', note }).then((ok) => { if (ok) setMode(null); })}>Save</button>
                <button className={btnGhost} onClick={() => setMode(null)}>Cancel</button>
            </div>}
            {mode === 'expected' && <div className="flex flex-wrap items-end gap-2">
                <Field label="Usually in by day"><input className={`${inputCls} w-24`} type="number" min={1} max={31} value={day} onChange={(e) => setDay(e.target.value)} /></Field>
                <Field label="Bills every"><select className={`${inputCls} w-36`} value={cad} onChange={(e) => setCad(e.target.value)}><option value="1">month</option><option value="2">2 months</option><option value="3">quarter</option><option value="6">half year</option><option value="12">year</option><option value="0">not recurring</option></select></Field>
                <Field label="Vendor (optional)"><input className={inputCls} value={vendor} onChange={(e) => setVendor(e.target.value)} /></Field>
                <button className={btnPrimary} disabled={busy} onClick={() => onAct({ action: 'expected', bounty_id: b.id, expected_day: day ? Number(day) : null, cadence_months: Number(cad), cadence_anchor: Number(cad) > 1 ? b.due_at.slice(0, 8) + '01' : null, vendor_name: vendor }).then((ok) => { if (ok) setMode(null); })}>Remember</button>
                <button className={btnGhost} onClick={() => setMode(null)}>Cancel</button>
            </div>}
            {mode === 'assign' && <div className="flex flex-wrap items-end gap-2">
                <Field label="Role group"><select className={`${inputCls} w-40`} value={role} onChange={(e) => setRole(e.target.value)}>{Object.entries(ROLE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
                <button className={btnPrimary} disabled={busy} onClick={() => onAct({ action: 'assign', bounty_id: b.id, owner_role: role }).then((ok) => { if (ok) setMode(null); })}>Assign for this line</button>
                <button className={btnGhost} onClick={() => setMode(null)}>Cancel</button>
            </div>}
        </div>
    );
}
