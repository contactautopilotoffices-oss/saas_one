'use client';

/**
 * SATEJ — the vendor discovery console.
 *
 * Raise a requirement; Meera structures it, finds local vendors on the web,
 * has Meera (Bolna) phone them, scores every call with a fixed rulebook and
 * sends the ranked shortlist on WhatsApp.
 *
 * The page is built to be WATCHED, not refreshed:
 *   · a live board shows what Meera is doing this second — the queries it is
 *     running, the pages it is reading, every vendor it spots, each call's state;
 *   · the call list can be trimmed before anyone is dialled;
 *   · the request can be edited after submitting (re-plans before calls, starts
 *     a new round after);
 *   · Meera sits in a chat panel on the right, with a voice call one click away.
 *
 * Data shapes: backend/lib/satej/types.ts. Kept loose here so this client file
 * pulls in no server code.
 */

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
    ArrowRight, BadgeCheck, Check, ChevronDown, ClipboardCopy, FileSpreadsheet, FileText, Globe, HelpCircle,
    Loader2, MessageSquare, Mic, Pencil, PhoneCall, PhoneIncoming, PhoneOff, Play, Plus, RefreshCw, Search,
    Sparkles, Trash2, TrendingDown, TrendingUp, Trophy, X,
} from 'lucide-react';
import AgentActivity from '@/frontend/components/agents/AgentActivity';
import SatejChat from './SatejChat';
import SatejFaq from './SatejFaq';
import { PriceHistoryCard, RateChecker, verdictChip } from './SatejRates';
import SatejVoiceScript from './SatejVoiceScript';
import { TestCall, VendorIntake } from './SatejVendorTools';
import s from './satej.module.css';

/* eslint-disable @typescript-eslint/no-explicit-any */

type Summary = {
    id: string; code: string; title: string; spendType: string; city: string; status: string;
    round: number; topVendor: string | null; createdAt: string;
};
type Detail = { requirement: any; vendors: any[]; calls: any[]; summaryText: string | null };
type Setup = {
    database: { ready: boolean; error?: string };
    missing: string[];
    mockMode: boolean;
    autoStartCalls: boolean;
    whatsappConfigured: boolean;
    paused: boolean;
    voice: { checked: boolean; found?: boolean; name?: string; webhookMapped?: boolean; webhookHost?: string | null; unfilledVariables?: string[]; error?: string };
};

type Metric = { total: number; thisWeek: number; prevWeek: number; deltaPct: number | null };
type Stats = {
    ready: boolean;
    callsMade: Metric; connected: Metric; quotesReceived: Metric;
    qualifiedVendors: { total: number };
    campaigns: { total: number; active: number; waiting: number; completed: number };
    today: { calls: number; connected: number; quotes: number; noAnswer: number; inProgress: number };
};

/** Friendly head-starts for the form. Free text underneath — these only pre-fill the title. */
const QUICK_STARTS = [
    'Office furniture', 'HVAC', 'Electrical', 'Civil & interiors',
    'IT hardware', 'Pantry & housekeeping', 'Security services', 'Signage',
];

const API = '/api/satej/requirements';

const STATUS_LABEL: Record<string, string> = {
    submitted: 'Reading the request',
    needs_clarification: 'Needs your answer',
    structured: 'Brief ready',
    discovering: 'Finding vendors',
    awaiting_call_approval: 'Approve call list',
    calling: 'Calling vendors',
    calls_done: 'Calls finished',
    analyzing: 'Analysing calls',
    ranked: 'Ranked',
    notified: 'Shortlist sent',
    failed: 'Failed',
    cancelled: 'Cancelled',
};
const NEEDS_YOU = ['needs_clarification', 'awaiting_call_approval'];
const WORKING = ['submitted', 'structured', 'discovering', 'calling', 'calls_done', 'analyzing', 'ranked'];

const STAGES = [
    { key: 'brief', label: 'Brief' },
    { key: 'vendors', label: 'Find vendors' },
    { key: 'calls', label: 'Calls' },
    { key: 'ranking', label: 'Ranking' },
    { key: 'sent', label: 'Shortlist' },
];
const STAGE_OF: Record<string, number> = {
    submitted: 0, needs_clarification: 0, structured: 1, discovering: 1, awaiting_call_approval: 1,
    calling: 2, calls_done: 3, analyzing: 3, ranked: 3, notified: 4, failed: -1, cancelled: -1,
};

function tone(status: string) {
    if (NEEDS_YOU.includes(status)) return s.warn;
    if (status === 'failed' || status === 'cancelled') return s.bad;
    if (status === 'notified') return s.good;
    return s.info;
}

function fmt(iso?: string) {
    if (!iso) return '-';
    return new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}
function ago(iso?: string) {
    if (!iso) return '';
    const sec = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
    return sec < 60 ? `${sec}s ago` : sec < 3600 ? `${Math.round(sec / 60)}m ago` : fmt(iso);
}

async function api(path: string, init?: RequestInit) {
    const res = await fetch(path, { cache: 'no-store', ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
}

/* ======================================================================== */

export default function SatejConsole({ orgId }: { orgId: string }) {
    const [list, setList] = useState<Summary[] | null>(null);
    const [selected, setSelected] = useState<string | null>(null);
    const [showForm, setShowForm] = useState(false);
    const [howOpen, setHowOpen] = useState(false);
    const [error, setError] = useState('');
    const [view, setView] = useState<'requirements' | 'rates' | 'faq' | 'script' | 'runs'>('requirements');
    /** A requirement form pre-filled from a purchase@ email. */
    const [draft, setDraft] = useState<Record<string, any> | null>(null);
    /** A test-call transcript handed to the Caller script tab as feedback evidence. */
    const [scriptSeed, setScriptSeed] = useState<string | null>(null);

    const load = useCallback(async () => {
        try {
            const data = await api(`${API}?organizationId=${orgId}`);
            setList(data.requirements);
            setError('');
        } catch (e: any) {
            setError(e.message);
        }
    }, [orgId]);

    useEffect(() => {
        void load();
        const t = setInterval(load, 8000);
        const q = new URLSearchParams(window.location.search).get('req');
        if (q) setSelected(q);
        return () => clearInterval(t);
    }, [load]);

    // Open the newest requirement by default so the page never starts empty.
    useEffect(() => {
        if (!selected && list?.length) setSelected(list[0].id);
    }, [list, selected]);

    const needsYou = (list ?? []).filter((r) => NEEDS_YOU.includes(r.status)).length;
    const working = (list ?? []).filter((r) => WORKING.includes(r.status)).length;

    return (
        <div className={s.page}>
            <header className={s.header}>
                <div className={s.headTitle}>
                    <div className={s.avatarLg}>M<span className={`${s.presence} ${working ? s.presenceBusy : ''}`} /></div>
                    <div>
                        <h1>Meera · Vendor Voice Agent</h1>
                        <p className={s.muted}>
                            {list === null ? 'Loading…' : (working || needsYou)
                                ? `${working} outreach${working === 1 ? '' : 's'} running${needsYou ? ` · ${needsYou} waiting for you` : ''} · Meera makes the calls`
                                : 'Automated vendor outreach. Meera calls, asks for quotes and ranks them, so you don’t have to.'}
                        </p>
                    </div>
                </div>
                <div className={s.actions}>
                    <button className={s.ghost} onClick={() => setHowOpen((v) => !v)}><HelpCircle size={15} /> How Meera works</button>
                    <button className={s.primary} onClick={() => setShowForm(true)}><Plus size={15} /> Start new outreach</button>
                </div>
            </header>

            {howOpen && <HowItWorks onClose={() => setHowOpen(false)} />}
            <SetupPanel orgId={orgId} />
            <Overview orgId={orgId} working={working} needsYou={needsYou} onNew={() => setShowForm(true)} onQuickStart={(cat) => { setDraft({ title: cat }); setShowForm(true); }} />

            <div className={s.tabs} role="tablist">
                <button role="tab" aria-selected={view === 'requirements'} className={`${s.tab} ${view === 'requirements' ? s.tabActive : ''}`} onClick={() => setView('requirements')}>Requirements</button>
                <button role="tab" aria-selected={view === 'rates'} className={`${s.tab} ${view === 'rates' ? s.tabActive : ''}`} onClick={() => setView('rates')}>Rate checker</button>
                <button role="tab" aria-selected={view === 'faq'} className={`${s.tab} ${view === 'faq' ? s.tabActive : ''}`} onClick={() => setView('faq')}>FAQ</button>
                <button role="tab" aria-selected={view === 'script'} className={`${s.tab} ${view === 'script' ? s.tabActive : ''}`} onClick={() => setView('script')}>Caller script &amp; recordings</button>
                <button role="tab" aria-selected={view === 'runs'} className={`${s.tab} ${view === 'runs' ? s.tabActive : ''}`} onClick={() => setView('runs')}>Run log</button>
            </div>

            {view === 'runs' && <AgentActivity orgId={orgId} agentKey="satej" />}
            {view === 'rates' && <RateChecker orgId={orgId} />}
            {view === 'faq' && <SatejFaq orgId={orgId} />}
            {view === 'script' && <SatejVoiceScript orgId={orgId} seedTranscript={scriptSeed} />}
            {view === 'requirements' && <InboxAsks orgId={orgId} onDraft={(d) => { setDraft(d); setShowForm(true); }} onOpen={(code) => { const hit = (list ?? []).find((r) => r.code === code); if (hit) setSelected(hit.id); }} />}
            {view === 'requirements' && error && <div className={s.errorBox}>{error}</div>}

            {view === 'requirements' && (
                <div className={s.layout}>
                    <aside className={s.list}>
                        {list === null && !error && <p className={s.muted}>Loading…</p>}
                        {list !== null && list.length === 0 && (
                            <div className={s.emptyList}>
                                <p>No requirements yet.</p>
                                <button className={s.ghost} onClick={() => setShowForm(true)}><Plus size={14} /> Raise the first one</button>
                            </div>
                        )}
                        {(list ?? []).map((r) => {
                            const active = selected === r.id || selected === r.code;
                            const stage = STAGE_OF[r.status] ?? 0;
                            return (
                                <button key={r.id} className={`${s.item} ${active ? s.itemActive : ''}`} onClick={() => setSelected(r.id)}>
                                    <div className={s.itemTop}>
                                        <span className={s.code}>{r.code}</span>
                                        <span className={`${s.chip} ${tone(r.status)}`}>
                                            {WORKING.includes(r.status) && <span className={s.pulseDot} />}
                                            {STATUS_LABEL[r.status] ?? r.status}
                                        </span>
                                    </div>
                                    <div className={s.itemTitle}>{r.title}</div>
                                    <div className={s.miniSteps}>
                                        {STAGES.map((st, i) => <span key={st.key} className={i < stage || r.status === 'notified' ? s.miniDone : i === stage ? s.miniNow : ''} />)}
                                    </div>
                                    <div className={s.muted}>
                                        {r.spendType.toUpperCase()} · {r.city || '-'} · {fmt(r.createdAt)}
                                        {r.topVendor ? ` · Top: ${r.topVendor}` : ''}
                                    </div>
                                </button>
                            );
                        })}
                    </aside>
                    <main style={{ minWidth: 0 }}>
                        {selected
                            ? <RequirementDetail key={selected} orgId={orgId} id={selected} onChange={load} onImproveScript={(t) => { setScriptSeed(t); setView('script'); window.scrollTo({ top: 0, behavior: 'smooth' }); }} />
                            : list?.length === 0 ? null : <p className={s.muted}>Pick a requirement on the left.</p>}
                    </main>
                </div>
            )}

            {showForm && (
                <RequirementForm
                    orgId={orgId}
                    draft={draft}
                    onClose={() => { setShowForm(false); setDraft(null); }}
                    onDone={(id) => {
                        setShowForm(false);
                        setDraft(null);
                        if (id) setSelected(id);
                        void load();
                    }}
                />
            )}
        </div>
    );
}

/* ======================================================================== */
/* overview: friendly hero numbers + the voice-agent status                  */

const FLOW = [
    { n: 1, title: 'Tell Meera what you need', hint: 'A short form: item, quantity, city.' },
    { n: 2, title: 'She finds local vendors', hint: 'Meera searches the web for you.' },
    { n: 3, title: 'You approve the list', hint: 'Keep only the ones you want called.' },
    { n: 4, title: 'Meera makes the calls', hint: 'She asks your questions and notes the answers.' },
    { n: 5, title: 'You get a ranked shortlist', hint: 'Best vendors first, on WhatsApp.' },
];

function HowItWorks({ onClose }: { onClose: () => void }) {
    return (
        <section className={`${s.card} ${s.howCard}`}>
            <div className={s.boardHead}>
                <h3><HelpCircle size={15} /> How Meera works</h3>
                <button className={s.iconBtn} onClick={onClose} aria-label="Close"><X size={16} /></button>
            </div>
            <p className={s.muted} style={{ marginBottom: 12 }}>
                Meera is your vendor calling agent. You tell her what to buy; she finds vendors, phones each one in Hindi or English,
                asks for rates and details, and hands you a ranked shortlist. No scripts to write, no numbers to dial.
            </p>
            <ol className={s.stepsBig}>
                {FLOW.map((f) => (
                    <li key={f.n}><span className={s.stepNo}>{f.n}</span><div><b>{f.title}</b><span>{f.hint}</span></div></li>
                ))}
            </ol>
        </section>
    );
}

function fmtDelta(m?: Metric) {
    if (!m || m.deltaPct == null) return null;
    return m.deltaPct;
}

function StatCard({ icon, tint, label, value, metric, sub }: {
    icon: React.ReactNode; tint: string; label: string; value?: number; metric?: Metric; sub: string;
}) {
    const delta = fmtDelta(metric);
    return (
        <div className={s.kpiCard}>
            <div className={`${s.kpiIcon} ${s[`kpi_${tint}`] ?? ''}`}>{icon}</div>
            <div className={s.kpiBody}>
                <div className={s.kpiValue}>{value == null ? <span className={s.kpiDash} aria-label="loading" /> : value.toLocaleString('en-IN')}</div>
                <div className={s.kpiLabel}>{label}</div>
            </div>
            {delta != null
                ? <span className={`${s.kpiDelta} ${delta >= 0 ? s.good : s.bad}`}>{delta >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}{delta >= 0 ? '+' : ''}{delta}%<em>vs last week</em></span>
                : <span className={s.kpiSub}>{metric && metric.thisWeek > 0 ? `${metric.thisWeek} this week` : sub}</span>}
        </div>
    );
}

function voiceState(setup: Setup | null): { label: string; cls: string; ready: boolean } {
    if (!setup) return { label: 'Checking…', cls: s.info, ready: false };
    if (setup.mockMode) return { label: 'Demo mode', cls: s.info, ready: false };
    if (setup.paused) return { label: 'Paused', cls: s.warn, ready: false };
    const v = setup.voice;
    const broken = !setup.database.ready || setup.missing.length > 0
        || (!!v.error) || (v.checked && !v.found) || (v.found && !v.webhookMapped) || (v.unfilledVariables?.length ?? 0) > 0;
    if (broken) return { label: 'Setup needed', cls: s.warn, ready: false };
    return { label: 'Active', cls: s.good, ready: true };
}

function VoiceAgentPanel({ setup, today }: { setup: Setup | null; today?: Stats['today'] }) {
    const st = voiceState(setup);
    const big = st.ready ? 'Ready to make calls'
        : setup?.paused ? 'Paused. Resume in the Agent Console'
        : setup?.mockMode ? 'Demo mode. No real calls go out'
        : !setup ? 'Checking the voice line…'
        : 'Finish setup to start calling';
    const DOES = [
        'Introduces Autopilot Offices',
        'Asks your product or service specifics',
        'Collects price, availability, MOQ & delivery',
        'Logs every response automatically',
        'Schedules a follow-up when needed',
    ];
    return (
        <section className={`${s.card} ${s.vaCard}`}>
            <div className={s.vaHead}>
                <span className={s.vaTitle}><Mic size={16} /> AI Voice Agent</span>
                <span className={`${s.chip} ${st.cls}`}>{st.ready && <span className={s.pulseDot} />}{st.label}</span>
            </div>
            <div className={`${s.wave} ${st.ready ? s.waveOn : ''}`} aria-hidden>
                {Array.from({ length: 36 }).map((_, i) => <span key={i} style={{ animationDelay: `${(i % 12) * 0.08}s` }} />)}
            </div>
            <div className={s.vaBig}>{big}</div>
            <p className={s.muted}>Meera introduces herself, asks your questions and notes every answer, in Hindi or English.</p>
            <ul className={s.vaList}>
                {DOES.map((d) => <li key={d}><Check size={14} />{d}</li>)}
            </ul>
            {st.ready && today && today.calls > 0 && (
                <div className={s.vaToday}>
                    <b>Today</b> · {today.calls} called · {today.connected} connected{today.quotes ? ` · ${today.quotes} quoted` : ''}{today.inProgress ? ` · ${today.inProgress} live` : ''}
                </div>
            )}
            <div className={s.vaFoot}>
                Calls through {setup?.voice?.name ?? 'the voice line'} · {setup?.autoStartCalls ? 'calls start automatically' : 'you approve each list first'}
            </div>
        </section>
    );
}

function Overview({ orgId, working, needsYou, onNew, onQuickStart }: {
    orgId: string; working: number; needsYou: number; onNew: () => void; onQuickStart: (category: string) => void;
}) {
    const [stats, setStats] = useState<Stats | null>(null);
    const [setup, setSetup] = useState<Setup | null>(null);

    useEffect(() => {
        let live = true;
        const loadStats = () => api(`/api/satej/stats?organizationId=${orgId}`).then((d) => { if (live) setStats(d); }).catch(() => {});
        void loadStats();
        api(`/api/satej/setup?organizationId=${orgId}`).then((d) => { if (live) setSetup(d); }).catch(() => {});
        const t = setInterval(loadStats, 15000);
        return () => { live = false; clearInterval(t); };
    }, [orgId]);

    const c = stats?.campaigns;
    const qualSub = c && c.total > 0 ? `across ${c.total} outreach${c.total === 1 ? '' : 'es'}` : 'ready to shortlist';

    return (
        <>
            <div className={s.kpiRow}>
                <StatCard icon={<PhoneCall size={18} />} tint="info" label="Calls made" value={stats?.callsMade.total} metric={stats?.callsMade} sub="vendor calls so far" />
                <StatCard icon={<PhoneIncoming size={18} />} tint="good" label="Connected" value={stats?.connected.total} metric={stats?.connected} sub="vendors picked up" />
                <StatCard icon={<FileText size={18} />} tint="accent" label="Quotes received" value={stats?.quotesReceived.total} metric={stats?.quotesReceived} sub="rates captured on call" />
                <StatCard icon={<BadgeCheck size={18} />} tint="warn" label="Qualified vendors" value={stats?.qualifiedVendors.total} sub={qualSub} />
            </div>

            <div className={s.band}>
                <section className={`${s.card} ${s.startCard}`}>
                    <h3><Sparkles size={15} /> Start a vendor outreach</h3>
                    <p className={s.muted} style={{ marginBottom: 12 }}>
                        {working || needsYou
                            ? `You have ${working} outreach${working === 1 ? '' : 'es'} running${needsYou ? ` and ${needsYou} waiting for your go-ahead` : ''}. Start another whenever you need quotes.`
                            : 'Tell Meera what you want to buy. She does the finding, the calling and the ranking.'}
                    </p>
                    <ol className={s.stepsBig}>
                        {FLOW.map((f) => (
                            <li key={f.n}><span className={s.stepNo}>{f.n}</span><div><b>{f.title}</b><span>{f.hint}</span></div></li>
                        ))}
                    </ol>
                    <div className={s.quickRow}>
                        <span className={s.quickLabel}>Quick start</span>
                        {QUICK_STARTS.map((cat) => (
                            <button key={cat} type="button" className={s.catChip} onClick={() => onQuickStart(cat)}>{cat}</button>
                        ))}
                    </div>
                    <button className={s.primary} onClick={onNew}><Plus size={15} /> New requirement <ArrowRight size={14} /></button>
                </section>

                <VoiceAgentPanel setup={setup} today={stats?.today} />
            </div>
        </>
    );
}

/* ======================================================================== */
/* quote requests that came to purchase@ by email                            */

function InboxAsks({ orgId, onDraft, onOpen }: { orgId: string; onDraft: (d: Record<string, any>) => void; onOpen: (code: string) => void }) {
    const [asks, setAsks] = useState<any[] | null>(null);
    const [busy, setBusy] = useState('');
    const [err, setErr] = useState('');
    useEffect(() => {
        let live = true;
        api(`/api/satej/inbox?organizationId=${orgId}`).then((j) => { if (live) setAsks(j.asks); }).catch((e) => { if (live) setErr(e.message); });
        return () => { live = false; };
    }, [orgId]);
    const open = (asks ?? []).filter((a) => !a.startedAs);
    if (err) return <div className={s.errorBox}>Purchase inbox: {err}</div>;
    if (!asks?.length) return null;
    return (
        <details className={s.card} open={open.length > 0}>
            <summary className={s.detailsSummary}>From the purchase inbox · {open.length} quote request{open.length === 1 ? '' : 's'} not yet with Meera</summary>
            <p className={s.muted}>Colleagues&apos; emails to purchase@ asking for vendor quotes, last 30 days. Meera drafts the form from the email; you check it and submit.</p>
            <ul className={s.inboxList}>
                {asks.map((a) => (
                    <li key={a.threadId}>
                        <div style={{ minWidth: 0 }}>
                            <b>{a.subject}</b>
                            <div className={s.muted}>{a.from} · {fmt(a.at)}{a.hasAttachment ? ' · has attachment' : ''}</div>
                            {a.snippet && <div className={s.vSells}>{a.snippet}</div>}
                        </div>
                        {a.startedAs
                            ? <button className={s.link} onClick={() => onOpen(a.startedAs)}>{a.startedAs}</button>
                            : (
                                <button className={s.ghost} disabled={!!busy} onClick={async () => {
                                    setBusy(a.threadId); setErr('');
                                    try { onDraft((await api('/api/satej/inbox', { method: 'POST', body: JSON.stringify({ organizationId: orgId, action: 'draft', threadId: a.threadId }) })).draft); }
                                    catch (e: any) { setErr(e.message); }
                                    finally { setBusy(''); }
                                }}>
                                    {busy === a.threadId ? <Loader2 size={14} className={s.spin} /> : <Plus size={14} />} Start with Meera
                                </button>
                            )}
                    </li>
                ))}
            </ul>
        </details>
    );
}

/* ======================================================================== */
/* setup check                                                               */

function SetupPanel({ orgId }: { orgId: string }) {
    const [setup, setSetup] = useState<Setup | null>(null);
    const [err, setErr] = useState('');

    useEffect(() => {
        api(`/api/satej/setup?organizationId=${orgId}`).then(setSetup).catch((e) => setErr(e.message));
    }, [orgId]);

    if (err) return <div className={s.errorBox}>Could not check Meera&apos;s setup: {err}</div>;
    if (!setup) return null;

    const v = setup.voice;
    const problems: string[] = [];
    if (!setup.database.ready) problems.push(`Meera's database tables are not ready: ${setup.database.error ?? 'unknown error'}`);
    if (setup.missing.length) problems.push(`Missing on this server: ${setup.missing.join(', ')}.`);
    if (setup.paused) problems.push('Meera is paused in the Agent Console, so nothing new will run.');
    if (v.error && !setup.mockMode) problems.push(`Could not reach the Bolna voice agent: ${v.error}`);
    if (v.checked && !v.found) problems.push('The Bolna voice agent in SATEJ_BOLNA_AGENT_ID does not exist on this Bolna account.');
    if (v.found && !v.webhookMapped) {
        problems.push(`Bolna call results are not wired to this server${v.webhookHost ? ` (they go to ${v.webhookHost})` : ''}. Run scripts/satej-sync-bolna.ts --apply.`);
    }
    if (v.unfilledVariables?.length) problems.push(`The voice prompt uses variables Meera does not send: ${v.unfilledVariables.join(', ')}.`);
    if (!setup.whatsappConfigured) problems.push('AiSensy is not configured, so WhatsApp updates will not go out. Everything still shows here.');

    // Readiness is shown in the AI Voice Agent panel below; only surface problems here.
    if (!problems.length && !setup.mockMode) return null;
    return (
        <details className={s.noteBox}>
            <summary><b>{setup.mockMode ? 'Mock mode: no real searches, calls or messages.' : `Meera is not fully set up yet (${problems.length})`}</b></summary>
            {problems.length > 0 && <ul className={s.setupList} style={{ marginTop: 6 }}>{problems.map((p) => <li key={p}>{p}</li>)}</ul>}
        </details>
    );
}

/* ======================================================================== */
/* new / edit form                                                           */

const SCOPES = ['Supply only', 'Supply and installation', 'Service', 'AMC', 'Complete works contract'];
const EMPTY_FORM = {
    title: '', spendType: 'capex', itemDescription: '', quantity: '', unit: '', scope: 'Supply and installation',
    locationCity: '', locationArea: '', siteName: '', timeline: '', budgetHint: '', notes: '', vendorTarget: '12',
    requestedBy: '', notifyWhatsapp: '', vendorSource: 'discover',
};
const SOURCES = [
    { key: 'discover', label: 'Find vendors for me', hint: 'Meera searches the web' },
    { key: 'own', label: 'Use my list', hint: 'Only the vendors you add or import' },
    { key: 'both', label: 'Both', hint: 'Your list plus Meera\'s search' },
];

function RequirementForm({ orgId, existing, draft, onClose, onDone }: {
    orgId: string;
    /** Present when editing. */
    existing?: any;
    /** A form pre-filled from a purchase@ email (inbox.ts). */
    draft?: Record<string, any> | null;
    onClose: () => void;
    onDone: (id?: string) => void;
}) {
    const editing = !!existing;
    const [f, setF] = useState(() => {
        if (!existing && draft) {
            return { ...EMPTY_FORM, ...Object.fromEntries(Object.keys(EMPTY_FORM).map((k) => [k, draft[k] ? String(draft[k]) : (EMPTY_FORM as any)[k]])) } as typeof EMPTY_FORM;
        }
        if (!existing) return EMPTY_FORM;
        const i = existing.input;
        return {
            ...EMPTY_FORM,
            ...Object.fromEntries(Object.keys(EMPTY_FORM).map((k) => [k, i[k] == null ? '' : String(i[k])])),
        } as typeof EMPTY_FORM;
    });
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState('');
    const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
        setF({ ...f, [k]: e.target.value });

    const preCall = !existing || ['submitted', 'needs_clarification', 'structured', 'discovering', 'awaiting_call_approval', 'failed'].includes(existing.status);

    async function submit(e: React.FormEvent) {
        e.preventDefault();
        setBusy(true);
        setErr('');
        try {
            if (editing) {
                const changes: Record<string, unknown> = {};
                for (const k of Object.keys(EMPTY_FORM) as (keyof typeof EMPTY_FORM)[]) {
                    if (k === 'requestedBy') continue;
                    const before = existing.input[k] == null ? '' : String(existing.input[k]);
                    if (f[k] !== before) changes[k] = k === 'vendorTarget' ? Number(f[k]) : f[k];
                }
                if (!Object.keys(changes).length) { onClose(); return; }
                await api(`${API}/${existing.id}`, { method: 'POST', body: JSON.stringify({ organizationId: orgId, action: 'edit', changes }) });
                onDone();
            } else {
                const r = await api(API, { method: 'POST', body: JSON.stringify({ ...f, organizationId: orgId, vendorTarget: Number(f.vendorTarget) || undefined, sourceThreadId: draft?.sourceThreadId }) });
                onDone(r.id);
            }
        } catch (e: any) {
            setErr(e.message);
        } finally {
            setBusy(false);
        }
    }

    return (
        <div className={s.modalBack} onClick={onClose}>
            <motion.form
                className={s.modal}
                onClick={(e) => e.stopPropagation()}
                onSubmit={submit}
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
            >
                <div className={s.modalHead}>
                    <h2>{editing ? `Edit ${existing.code}` : 'Start a vendor outreach'}</h2>
                    <button type="button" className={s.iconBtn} onClick={onClose} aria-label="Close"><X size={16} /></button>
                </div>
                {!editing && (
                    <div className={s.modalIntro}>
                        <div className={s.avatar}>M</div>
                        <p><b>Meera takes it from here.</b> Fill this in like a quick note to a colleague, and she writes the brief, finds vendors and calls them for you.</p>
                    </div>
                )}
                {editing && (
                    <div className={preCall ? s.infoBox : s.noteBox}>
                        {preCall
                            ? 'No vendor has been called yet. Saving makes Meera re-plan from the start with these details; vendors found for the old version are dropped.'
                            : `Calls have already been made. Saving starts round ${existing.round + 1}: Meera searches again with these details and skips every vendor already called. Results so far are kept.`}
                    </div>
                )}
                <div className={s.grid}>
                    <div className={s.formSection}><div className={s.formSectionTitle}>Who should Meera call?</div></div>
                    <div className={s.full}>
                        <div className={s.fieldLabel}>Which vendors should Meera call?</div>
                        <div className={s.sourcePick}>
                            {SOURCES.map((o) => (
                                <button type="button" key={o.key} className={f.vendorSource === o.key ? s.sourceOn : ''} onClick={() => setF({ ...f, vendorSource: o.key })}>
                                    <b>{o.label}</b><span>{o.hint}</span>
                                </button>
                            ))}
                        </div>
                        {!editing && f.vendorSource !== 'discover' && <p className={s.muted} style={{ marginTop: 6 }}>You add or import your vendors on the next screen, once Meera has written the brief.</p>}
                    </div>
                    <div className={s.formSection}><div className={s.formSectionTitle}>What do you need?</div></div>
                    <label className={s.full}>Title<input required value={f.title} onChange={set('title')} placeholder="Gypsum false ceiling, Lower Parel office" /></label>
                    <label>Type
                        <select value={f.spendType} onChange={set('spendType')}>
                            <option value="capex">CapEx (one-time project)</option>
                            <option value="opex">OpEx (recurring)</option>
                        </select>
                    </label>
                    <label>Scope<select value={f.scope} onChange={set('scope')}>{SCOPES.map((x) => <option key={x}>{x}</option>)}</select></label>
                    <label className={s.full}>What exactly is needed
                        <textarea required rows={3} value={f.itemDescription} onChange={set('itemDescription')} placeholder="Item, specification, brand if fixed, any drawing or BOQ reference" />
                    </label>
                    <label>Quantity<input value={f.quantity} onChange={set('quantity')} placeholder="1200" /></label>
                    <label>Unit<input value={f.unit} onChange={set('unit')} placeholder="sqft / nos / rmt / month" /></label>
                    <div className={s.formSection}><div className={s.formSectionTitle}>Where &amp; when</div></div>
                    <label>City<input required value={f.locationCity} onChange={set('locationCity')} placeholder="Mumbai" /></label>
                    <label>Area / locality<input value={f.locationArea} onChange={set('locationArea')} placeholder="Lower Parel" /></label>
                    <label>Site name<input value={f.siteName} onChange={set('siteName')} placeholder="Mafatlal Chambers" /></label>
                    <label>Timeline<input value={f.timeline} onChange={set('timeline')} placeholder="within 15 days" /></label>
                    <div className={s.formSection}><div className={s.formSectionTitle}>How many &amp; budget</div></div>
                    <label>Budget hint (internal, never said on calls)<input value={f.budgetHint} onChange={set('budgetHint')} /></label>
                    <label>{f.vendorSource === 'own' ? 'Vendors to call (from your list)' : 'Vendors to call'}<input type="number" min={3} max={40} value={f.vendorTarget} onChange={set('vendorTarget')} /></label>
                    <div className={s.formSection}><div className={s.formSectionTitle}>Stay in the loop</div></div>
                    {!editing && <label>Requested by<input value={f.requestedBy} onChange={set('requestedBy')} placeholder="Defaults to you" /></label>}
                    <label>Send updates to WhatsApp<input value={f.notifyWhatsapp} onChange={set('notifyWhatsapp')} placeholder="+91 98xxxxxxxx" /></label>
                    <label className={s.full}>Notes<textarea rows={2} value={f.notes} onChange={set('notes')} /></label>
                </div>
                {err && <div className={s.errorBox}>{err}</div>}
                <div className={s.actions}>
                    <button type="button" className={s.ghost} onClick={onClose}>Cancel</button>
                    <button className={s.primary} disabled={busy}>
                        {busy && <Loader2 size={14} className={s.spin} />}
                        {editing ? (preCall ? 'Save and re-plan' : `Save and start round ${existing.round + 1}`) : 'Submit and start'}
                    </button>
                </div>
            </motion.form>
        </div>
    );
}

/* ======================================================================== */
/* one requirement                                                           */

function RequirementDetail({ orgId, id, onChange, onImproveScript }: { orgId: string; id: string; onChange: () => void; onImproveScript: (transcript: string) => void }) {
    const [d, setD] = useState<Detail | null>(null);
    const [err, setErr] = useState('');
    const [busy, setBusy] = useState('');
    const [editing, setEditing] = useState(false);
    const [chatOpen, setChatOpen] = useState(true);

    const load = useCallback(async () => {
        try {
            setD(await api(`${API}/${encodeURIComponent(id)}?organizationId=${orgId}`));
            setErr('');
        } catch (e: any) {
            setErr(e.message);
        }
    }, [id, orgId]);

    // Fast polling while Meera is working, so the board moves as it does.
    const status = d?.requirement.status;
    useEffect(() => {
        void load();
        const fast = status && WORKING.includes(status);
        const t = setInterval(load, fast ? 2500 : 12000);
        return () => clearInterval(t);
    }, [load, status]);

    const act = async (action: string, extra: object = {}) => {
        setErr('');
        setBusy(action + JSON.stringify(extra));
        try {
            await api(`${API}/${d!.requirement.id}`, { method: 'POST', body: JSON.stringify({ organizationId: orgId, action, ...extra }) });
            await load();
            onChange();
        } catch (e: any) {
            setErr(e.message);
        } finally {
            setBusy('');
        }
    };

    if (!d) return err ? <div className={s.errorBox}>{err}</div> : <div className={s.skeleton} />;
    const r = d.requirement;
    const stage = STAGE_OF[r.status] ?? 0;

    return (
        <div className={`${s.detailWrap} ${chatOpen ? s.withChat : ''}`}>
            <div style={{ minWidth: 0 }}>
                <div className={s.hero}>
                    <div style={{ minWidth: 0 }}>
                        <div className={s.heroMeta}>
                            <span className={s.code}>{r.code}</span>
                            <span className={`${s.chip} ${tone(r.status)}`}>
                                {WORKING.includes(r.status) && <span className={s.pulseDot} />}
                                {STATUS_LABEL[r.status] ?? r.status}
                            </span>
                            {r.round > 1 && <span className={s.chip}>Round {r.round}</span>}
                            <span className={s.muted}>updated {ago(r.updatedAt)}</span>
                        </div>
                        <h2>{r.input.title}</h2>
                        <p className={s.muted}>{r.brief?.itemSummary ?? r.input.itemDescription}</p>
                    </div>
                    <div className={s.actions}>
                        {r.status !== 'cancelled' && <button className={s.ghost} onClick={() => setEditing(true)}><Pencil size={14} /> Edit</button>}
                        <button className={s.ghost} onClick={() => setChatOpen((v) => !v)}><MessageSquare size={14} /> {chatOpen ? 'Hide Meera' : 'Talk to Meera'}</button>
                        <MoreActions r={r} busy={!!busy} act={act} orgId={orgId} />
                    </div>
                </div>

                <StageRail r={r} stage={stage} />

                {err && <div className={s.errorBox}>{err}</div>}
                {r.error && <div className={s.errorBox}>{r.error}</div>}

                {r.status === 'needs_clarification' && <Questions r={r} act={act} busy={!!busy} />}

                <LiveBoard d={d} act={act} busy={busy} orgId={orgId} reload={() => { void load(); onChange(); }} />

                {r.status === 'failed' && r.brief && (
                    <section className={s.card}>
                        <h3>Call vendors you already know</h3>
                        <p className={s.muted}>Meera found nobody callable on the web. Add or import your own vendors and the call list opens for approval.</p>
                        <VendorIntake orgId={orgId} requirement={r} defaultOpen onAdded={() => { void load(); onChange(); }} />
                    </section>
                )}

                {r.brief && r.status !== 'cancelled' && (
                    <TestCall orgId={orgId} requirement={r} vendors={d.vendors} calls={d.calls} graphAgent={(d as any).graphAgent} onChanged={() => void load()} onImproveScript={onImproveScript} />
                )}

                {d.summaryText && <SummaryCard text={d.summaryText} />}

                <PriceHistoryCard r={r} />

                <div className={s.twoCol}>
                    {r.brief && <BriefCard r={r} />}
                    <section className={s.card}>
                        <h3>Activity</h3>
                        <ul className={s.timeline}>
                            {[...r.events].reverse().slice(0, 40).map((e: any, i: number) => (
                                <li key={i}><span className={s.tlDot} /><div><div>{e.msg}</div><div className={s.muted}>{fmt(e.at)}</div></div></li>
                            ))}
                        </ul>
                    </section>
                </div>

                <AllVendors vendors={d.vendors} />
            </div>

            {chatOpen && <SatejChat orgId={orgId} requirement={r} onChanged={() => { void load(); onChange(); }} />}

            {editing && (
                <RequirementForm
                    orgId={orgId}
                    existing={r}
                    onClose={() => setEditing(false)}
                    onDone={() => { setEditing(false); void load(); onChange(); }}
                />
            )}
        </div>
    );
}

function MoreActions({ r, busy, act, orgId }: { r: any; busy: boolean; act: (a: string, x?: object) => void; orgId: string }) {
    const [open, setOpen] = useState(false);
    const items: { label: string; icon: React.ReactNode; run: () => void; show: boolean; danger?: boolean }[] = [
        { label: 'Retry', icon: <RefreshCw size={14} />, run: () => act('retry'), show: r.status === 'failed' },
        { label: 'Find more vendors', icon: <Search size={14} />, run: () => act('again'), show: ['notified', 'ranked', 'failed'].includes(r.status) && !!r.brief },
        { label: 'Resend WhatsApp', icon: <RefreshCw size={14} />, run: () => act('resend_whatsapp'), show: !!r.ranking },
        { label: 'Re-analyse calls', icon: <RefreshCw size={14} />, run: () => act('reanalyze'), show: ['ranked', 'notified'].includes(r.status) },
        { label: 'Download call CSV', icon: <FileSpreadsheet size={14} />, run: () => { window.location.href = `${API}/${r.id}?organizationId=${orgId}&format=csv`; }, show: !!r.brief },
        { label: 'Cancel requirement', icon: <Trash2 size={14} />, run: () => { if (confirm('Cancel this requirement?')) act('cancel'); }, show: !['notified', 'cancelled'].includes(r.status), danger: true },
    ];
    const shown = items.filter((i) => i.show);
    if (!shown.length) return null;
    return (
        <div className={s.menuWrap}>
            <button className={s.ghost} disabled={busy} onClick={() => setOpen((v) => !v)}>More <ChevronDown size={14} /></button>
            {open && (
                <div className={s.menu} onMouseLeave={() => setOpen(false)}>
                    {shown.map((i) => (
                        <button key={i.label} className={i.danger ? s.menuDanger : ''} onClick={() => { setOpen(false); i.run(); }}>{i.icon}{i.label}</button>
                    ))}
                </div>
            )}
        </div>
    );
}

function StageRail({ r, stage }: { r: any; stage: number }) {
    return (
        <ol className={s.rail}>
            {STAGES.map((st, i) => {
                const done = i < stage || r.status === 'notified';
                const now = i === stage && r.status !== 'notified';
                return (
                    <li key={st.key} className={done ? s.railDone : now ? s.railNow : ''}>
                        <span className={s.railDot}>{done ? <Check size={12} /> : i + 1}</span>
                        <span>{st.label}</span>
                        {now && WORKING.includes(r.status) && <span className={s.railPulse} />}
                    </li>
                );
            })}
        </ol>
    );
}

function Questions({ r, act, busy }: { r: any; act: (a: string, x?: object) => void; busy: boolean }) {
    const [answers, setAnswers] = useState<string[]>([]);
    return (
        <section className={`${s.card} ${s.cardAttention}`}>
            <h3>Meera needs a few answers before it searches</h3>
            {(r.brief?.questions ?? []).map((q: string, i: number) => (
                <label key={i} className={s.full}>
                    {q}
                    <input value={answers[i] ?? ''} onChange={(e) => { const a = [...answers]; a[i] = e.target.value; setAnswers(a); }} />
                </label>
            ))}
            <button className={s.primary} disabled={busy} onClick={() => act('answer', { answers })}>Send answers and continue</button>
        </section>
    );
}

/* ---- the live board ------------------------------------------------------ */

function LiveBoard({ d, act, busy, orgId, reload }: { d: Detail; act: (a: string, x?: object) => void; busy: string; orgId: string; reload: () => void }) {
    const r = d.requirement;
    const live = r.live;

    if (['submitted', 'structured'].includes(r.status) || (live && ['structuring'].includes(live.stage))) {
        return (
            <section className={`${s.card} ${s.liveCard}`}>
                <div className={s.liveHead}><span className={s.liveTag}><span className={s.pulseDot} /> Live</span> {live?.detail ?? 'Reading your requirement and writing the brief'}</div>
                <div className={s.shimmer} /><div className={s.shimmer} style={{ width: '70%' }} />
            </section>
        );
    }

    if (r.status === 'discovering') {
        const queries = live?.queries ?? [];
        const spotted = [...(live?.spotted ?? [])].reverse();
        const pct = live?.pagesTotal ? Math.round(((live.pagesRead ?? 0) / live.pagesTotal) * 100) : 0;
        return (
            <section className={`${s.card} ${s.liveCard}`}>
                <div className={s.liveHead}><span className={s.liveTag}><span className={s.pulseDot} /> Live</span> {live?.detail ?? 'Searching the web for vendors'}</div>
                {queries.length > 0 && (
                    <div className={s.queryChips}>
                        {queries.map((q: any) => (
                            <span key={q.text} className={`${s.queryChip} ${q.done ? s.queryDone : ''}`}>
                                {q.done ? <Check size={12} /> : <Loader2 size={12} className={s.spin} />}
                                {q.text}{q.done ? ` · ${q.pages} pages` : ''}
                            </span>
                        ))}
                    </div>
                )}
                {(live?.pagesTotal ?? 0) > 0 && (
                    <div className={s.progress}><div style={{ width: `${pct}%` }} /><span>{live.pagesRead} / {live.pagesTotal} pages read</span></div>
                )}
                <h4 className={s.subhead}>Picked up so far · {spotted.length}</h4>
                {spotted.length === 0 && <p className={s.muted}>Vendors appear here the moment Meera spots them on a page.</p>}
                <ul className={s.feed}>
                    <AnimatePresence initial={false}>
                        {spotted.slice(0, 30).map((v: any, i: number) => (
                            <motion.li key={`${v.name}-${v.source}-${spotted.length - i}`} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}>
                                <Globe size={13} />
                                <b>{v.name}</b>
                                <span className={s.muted}>{v.area || '—'} · on {v.source}</span>
                                <span className={s.meter} title={`Relevance ${v.relevance}/10`}><span style={{ width: `${v.relevance * 10}%` }} /></span>
                            </motion.li>
                        ))}
                    </AnimatePresence>
                </ul>
            </section>
        );
    }

    if (r.status === 'awaiting_call_approval') {
        const toCall = d.vendors.filter((v) => v.status === 'found');
        const removed = d.vendors.filter((v) => v.status === 'excluded' && String(v.excludeReason ?? '').startsWith('Removed by'));
        return (
            <section className={`${s.card} ${s.cardAttention}`}>
                <div className={s.boardHead}>
                    <div>
                        <h3>Approve the call list · {toCall.length} vendors</h3>
                        <p className={s.muted}>
                            {toCall.length === 0
                                ? 'No vendors yet. Add or import the vendors you want Meera to call.'
                                : "Remove anyone you don't want phoned, or add your own. Meera calls between 10:00 and 18:30 IST, Monday to Saturday."}
                        </p>
                    </div>
                    <button className={s.primary} disabled={!!busy || !toCall.length} onClick={() => act('approve_calls')}>
                        {busy.startsWith('approve_calls') ? <Loader2 size={14} className={s.spin} /> : <Play size={14} />} Start {toCall.length} calls
                    </button>
                </div>
                <div className={s.vendorGrid}>
                    <AnimatePresence initial={false}>
                        {toCall.map((v) => (
                            <motion.div key={v.id} layout initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className={s.vCard}>
                                <div className={s.vTop}>
                                    <b>{v.name}</b>
                                    <button className={s.iconBtn} title="Remove from the call list" disabled={!!busy} onClick={() => act('exclude_vendor', { vendorId: v.id })}><X size={14} /></button>
                                </div>
                                <div className={s.muted}>{[v.area, v.city].filter(Boolean).join(', ') || '—'} · {v.phone}</div>
                                <div className={s.vSells}>{v.source === 'manual' ? <span className={`${s.chip} ${s.info}`}>Your vendor</span> : v.sells}</div>
                                <div className={s.vFoot}>
                                    <span className={s.meter} title={`Relevance ${v.relevance}/10`}><span style={{ width: `${v.relevance * 10}%` }} /></span>
                                    {(v.sourceUrls ?? []).slice(0, 1).map((u: string) => <a key={u} href={u} target="_blank" rel="noreferrer" className={s.link}>source</a>)}
                                </div>
                            </motion.div>
                        ))}
                    </AnimatePresence>
                </div>
                {removed.length > 0 && <p className={s.muted} style={{ marginTop: 8 }}>Removed: {removed.map((v) => v.name).join(', ')}</p>}
                <div style={{ marginTop: 12 }}>
                    <VendorIntake orgId={orgId} requirement={r} defaultOpen={toCall.length === 0} onAdded={reload} />
                </div>
            </section>
        );
    }

    if (['calling', 'calls_done', 'analyzing'].includes(r.status)) {
        const inBatch = d.vendors.filter((v) => ['queued', 'called', 'not_reached'].includes(v.status));
        const callOf = (vid: string) => d.calls.filter((c) => c.vendorId === vid).at(-1);
        const spoke = inBatch.filter((v) => v.status === 'called').length;
        return (
            <section className={`${s.card} ${s.liveCard}`}>
                <div className={s.liveHead}>
                    <span className={s.liveTag}><span className={s.pulseDot} /> Live</span>
                    {r.status === 'analyzing' ? (live?.detail ?? 'Analysing the calls') : r.callsScheduledAt && new Date(r.callsScheduledAt) > new Date()
                        ? `Calls start ${fmt(r.callsScheduledAt)}`
                        : `Meera is calling · ${spoke} of ${inBatch.length} spoke so far`}
                </div>
                <div className={s.vendorGrid}>
                    {inBatch.map((v) => {
                        const c = callOf(v.id);
                        const st = callState(v, c);
                        return (
                            <div key={v.id} className={`${s.vCard} ${s[`call_${st.tone}`] ?? ''}`}>
                                <div className={s.vTop}><b>{v.name}</b><span className={`${s.chip} ${st.chip}`}>{st.icon}{st.label}</span></div>
                                <div className={s.muted}>{v.phone}{c?.durationSec ? ` · ${Math.round(c.durationSec)}s` : ''}{c?.retried ? ` · retry ${c.retried}` : ''}</div>
                                {c?.transcript && <div className={s.vSells}>“{c.transcript.split('\n').filter((l: string) => l.startsWith('user')).slice(-1)[0]?.replace(/^user:\s*/, '') ?? ''}”</div>}
                            </div>
                        );
                    })}
                </div>
            </section>
        );
    }

    if (r.ranking) return <Leaderboard d={d} orgId={orgId} />;
    return null;
}

function callState(v: any, c: any): { label: string; tone: string; chip: string; icon: React.ReactNode } {
    const status = c?.status ?? (v.status === 'queued' ? 'queued' : '');
    if (v.status === 'called') return { label: 'Spoke', tone: 'good', chip: s.good, icon: <Check size={11} /> };
    if (['ringing', 'initiated'].includes(status)) return { label: 'Ringing', tone: 'live', chip: s.info, icon: <PhoneCall size={11} /> };
    if (status === 'in-progress') return { label: 'On the call', tone: 'live', chip: s.info, icon: <span className={s.pulseDot} /> };
    if (v.status === 'not_reached' || ['no-answer', 'busy', 'failed', 'canceled', 'call-disconnected', 'error'].includes(status)) {
        return { label: status === 'busy' ? 'Busy' : 'No answer', tone: 'bad', chip: s.bad, icon: <PhoneOff size={11} /> };
    }
    return { label: 'In queue', tone: 'idle', chip: '', icon: null };
}

function Leaderboard({ d, orgId }: { d: Detail; orgId: string }) {
    const [open, setOpen] = useState<string | null>(null);
    const r = d.requirement;
    const callsByVendor = useMemo(() => {
        const m: Record<string, any[]> = {};
        for (const c of d.calls) (m[c.vendorId ?? 'none'] ||= []).push(c);
        return m;
    }, [d.calls]);
    return (
        <section className={s.card}>
            <h3><Trophy size={15} /> Ranked vendors</h3>
            <div className={s.board}>
                {r.ranking.map((v: any) => (
                    <Fragment key={v.vendorId}>
                        <button className={`${s.rankRow} ${open === v.vendorId ? s.rankOpen : ''}`} onClick={() => setOpen(open === v.vendorId ? null : v.vendorId)}>
                            <span className={s.rankNo}>{v.rank}</span>
                            <span className={s.rankName}><b>{v.vendorName}</b><span className={s.muted}>{v.priceText ? v.priceText.split(' — ')[0] : v.area}</span></span>
                            <span className={s.scoreBar}><span style={{ width: `${v.score.total}%` }} /><b>{v.score.total}</b></span>
                            <span className={`${s.chip} ${v.score.qualification === 'qualified' ? s.good : v.score.qualification === 'verify_gst' ? s.warn : s.bad}`}>{v.score.qualification.replace('_', ' ')}</span>
                            <ChevronDown size={15} className={open === v.vendorId ? s.rotated : ''} />
                        </button>
                        {open === v.vendorId && <VendorCalls v={v} calls={callsByVendor[v.vendorId] ?? []} orgId={orgId} />}
                    </Fragment>
                ))}
            </div>
        </section>
    );
}

function VendorCalls({ v, calls, orgId }: { v: any; calls: any[]; orgId: string }) {
    return (
        <div className={s.callBox}>
            <p>{v.summary}</p>
            {v.priceText && <p className={s.priceLine}><b>Rate:</b> {v.priceText} {verdictChip(v.priceVerdict)}</p>}
            {v.score.parts.length > 0 && (
                <div className={s.parts}>
                    {v.score.parts.map((p: any) => (
                        <div key={p.label}>
                            <div className={s.partHead}><b>{p.label}</b><span>{p.points}/{p.max}</span></div>
                            <div className={s.partBar}><span style={{ width: `${(p.points / p.max) * 100}%` }} /></div>
                            <div className={s.muted}>{p.why}</div>
                        </div>
                    ))}
                </div>
            )}
            <p className={s.muted}>{v.phone} · {v.yearsExperience ?? '—'} yrs · delivery {v.turnaroundText || '—'}{v.clients.length ? ` · clients: ${v.clients.slice(0, 4).join(', ')}` : ''}</p>
            {v.usps.length > 0 && <p><b>USPs:</b> {v.usps.join('; ')}</p>}
            {v.redFlags.length > 0 && <p className={s.badText}><b>Watch out:</b> {v.redFlags.join('; ')}</p>}
            {calls.map((c) => (
                <details key={c.id}>
                    <summary>Call {fmt(c.createdAt)} · {c.status} · {c.durationSec ? `${Math.round(c.durationSec)}s` : '-'}{c.retried ? ` · retry ${c.retried}` : ''}</summary>
                    {c.recordingUrl && <audio controls preload="none" src={`/api/satej/voice/recording?organizationId=${orgId}&executionId=${c.executionId}`} className={s.audio} />}
                    {c.analysis?.evidence?.length > 0 && (
                        <ul>{c.analysis.evidence.map((e: any, i: number) => <li key={i}><b>{e.field}:</b> &quot;{e.quote}&quot;</li>)}</ul>
                    )}
                    <pre className={s.transcript}>{c.transcript || 'No transcript'}</pre>
                </details>
            ))}
        </div>
    );
}

function SummaryCard({ text }: { text: string }) {
    const [copied, setCopied] = useState(false);
    const [open, setOpen] = useState(false);
    return (
        <section className={s.card}>
            <div className={s.boardHead}>
                <h3>Summary for WhatsApp</h3>
                <div className={s.actions}>
                    <button className={s.ghost} onClick={() => setOpen((v) => !v)}>{open ? 'Hide' : 'Show'}</button>
                    <button className={s.ghost} onClick={() => navigator.clipboard?.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); })}>
                        <ClipboardCopy size={14} /> {copied ? 'Copied' : 'Copy'}
                    </button>
                </div>
            </div>
            {open && <pre className={s.summary}>{text}</pre>}
        </section>
    );
}

function BriefCard({ r }: { r: any }) {
    const b = r.brief;
    return (
        <section className={s.card}>
            <h3>Brief</h3>
            <div className={s.kv}>
                <span>Need</span><b>{b.itemSummary}</b>
                <span>Quantity</span><b>{b.quantityText}</b>
                <span>Location</span><b>{b.locationText}</b>
                <span>Timeline</span><b>{b.timelineText || '-'}</b>
                <span>Type</span><b>{r.input.spendType.toUpperCase()} · {String(b.scopeType).replace(/_/g, ' ')}</b>
                <span>Looks for</span><b>{(b.vendorTypes ?? []).join(', ')}</b>
                <span>Calls</span><b>{r.callsScheduledAt ? `Scheduled ${fmt(r.callsScheduledAt)}` : '-'}{r.callsCompletedAt ? `, finished ${fmt(r.callsCompletedAt)}` : ''}</b>
            </div>
        </section>
    );
}

function AllVendors({ vendors }: { vendors: any[] }) {
    if (!vendors.length) return null;
    return (
        <details className={s.card}>
            <summary className={s.detailsSummary}>All vendors found ({vendors.length})</summary>
            <div className={s.tableWrap}>
                <table className={s.table}>
                    <thead><tr><th>Vendor</th><th>Phone</th><th>Area</th><th>Sells</th><th>Relevance</th><th>Status</th><th>Source</th></tr></thead>
                    <tbody>
                        {vendors.map((v) => (
                            <tr key={v.id}>
                                <td>{v.name}{v.website && <div className={s.muted}>{v.website}</div>}</td>
                                <td>{v.phone}</td>
                                <td>{[v.area, v.city].filter(Boolean).join(', ')}</td>
                                <td>{v.sells}</td>
                                <td>{v.relevance}/10</td>
                                <td>{v.status.replace('_', ' ')}{v.excludeReason && <div className={s.muted}>{v.excludeReason}</div>}</td>
                                <td>{(v.sourceUrls ?? []).slice(0, 2).map((u: string, i: number) => <a key={u} className={s.link} href={u} target="_blank" rel="noreferrer">source {i + 1} </a>)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </details>
    );
}
