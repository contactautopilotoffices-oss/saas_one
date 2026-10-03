'use client';

/**
 * SATEJ — the vendor discovery console.
 *
 * Raise a requirement; Satej structures it, finds local vendors on the web,
 * has Meera (Bolna) phone them, scores every call with a fixed rulebook and
 * sends the ranked shortlist on WhatsApp.
 *
 * The page is built to be WATCHED, not refreshed:
 *   · a live board shows what Satej is doing this second — the queries it is
 *     running, the pages it is reading, every vendor it spots, each call's state;
 *   · the call list can be trimmed before anyone is dialled;
 *   · the request can be edited after submitting (re-plans before calls, starts
 *     a new round after);
 *   · Satej sits in a chat panel on the right, with a voice call one click away.
 *
 * Data shapes: backend/lib/satej/types.ts. Kept loose here so this client file
 * pulls in no server code.
 */

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
    Check, ChevronDown, ClipboardCopy, FileSpreadsheet, Globe, Loader2, MessageSquare, Pencil, PhoneCall,
    PhoneOff, Play, Plus, RefreshCw, Search, Trash2, Trophy, X,
} from 'lucide-react';
import AgentActivity from '@/frontend/components/agents/AgentActivity';
import SatejChat from './SatejChat';
import SatejVoiceScript from './SatejVoiceScript';
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
    const [error, setError] = useState('');
    const [view, setView] = useState<'requirements' | 'script' | 'runs'>('requirements');

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
                    <div className={s.avatarLg}>S<span className={`${s.presence} ${working ? s.presenceBusy : ''}`} /></div>
                    <div>
                        <h1>Satej · Vendor discovery</h1>
                        <p className={s.muted}>
                            {list === null ? 'Loading…' : `${working} in progress${needsYou ? ` · ${needsYou} waiting for you` : ''} · Meera makes the calls`}
                        </p>
                    </div>
                </div>
                <button className={s.primary} onClick={() => setShowForm(true)}><Plus size={15} /> New requirement</button>
            </header>

            <SetupPanel orgId={orgId} />

            <div className={s.tabs} role="tablist">
                <button role="tab" aria-selected={view === 'requirements'} className={`${s.tab} ${view === 'requirements' ? s.tabActive : ''}`} onClick={() => setView('requirements')}>Requirements</button>
                <button role="tab" aria-selected={view === 'script'} className={`${s.tab} ${view === 'script' ? s.tabActive : ''}`} onClick={() => setView('script')}>Caller script &amp; recordings</button>
                <button role="tab" aria-selected={view === 'runs'} className={`${s.tab} ${view === 'runs' ? s.tabActive : ''}`} onClick={() => setView('runs')}>Run log</button>
            </div>

            {view === 'runs' && <AgentActivity orgId={orgId} agentKey="satej" />}
            {view === 'script' && <SatejVoiceScript orgId={orgId} />}
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
                            ? <RequirementDetail key={selected} orgId={orgId} id={selected} onChange={load} />
                            : list?.length === 0 ? null : <p className={s.muted}>Pick a requirement on the left.</p>}
                    </main>
                </div>
            )}

            {showForm && (
                <RequirementForm
                    orgId={orgId}
                    onClose={() => setShowForm(false)}
                    onDone={(id) => {
                        setShowForm(false);
                        if (id) setSelected(id);
                        void load();
                    }}
                />
            )}
        </div>
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

    if (err) return <div className={s.errorBox}>Could not check Satej&apos;s setup: {err}</div>;
    if (!setup) return null;

    const v = setup.voice;
    const problems: string[] = [];
    if (!setup.database.ready) problems.push(`Satej's database tables are not ready: ${setup.database.error ?? 'unknown error'}`);
    if (setup.missing.length) problems.push(`Missing on this server: ${setup.missing.join(', ')}.`);
    if (setup.paused) problems.push('Satej is paused in the Agent Console, so nothing new will run.');
    if (v.error && !setup.mockMode) problems.push(`Could not reach the Bolna voice agent: ${v.error}`);
    if (v.checked && !v.found) problems.push('The Bolna voice agent in SATEJ_BOLNA_AGENT_ID does not exist on this Bolna account.');
    if (v.found && !v.webhookMapped) {
        problems.push(`Bolna call results are not wired to this server${v.webhookHost ? ` (they go to ${v.webhookHost})` : ''}. Run scripts/satej-sync-bolna.ts --apply.`);
    }
    if (v.unfilledVariables?.length) problems.push(`The voice prompt uses variables Satej does not send: ${v.unfilledVariables.join(', ')}.`);
    if (!setup.whatsappConfigured) problems.push('AiSensy is not configured, so WhatsApp updates will not go out. Everything still shows here.');

    if (!problems.length && !setup.mockMode) {
        return (
            <p className={s.ready}>
                <Check size={13} /> Ready · calls through {v.name ?? 'Bolna'} · {setup.autoStartCalls ? 'calls start automatically' : 'you approve each call list before anyone is phoned'}
            </p>
        );
    }
    return (
        <details className={s.noteBox}>
            <summary><b>{setup.mockMode ? 'Mock mode: no real searches, calls or messages.' : `Satej is not fully set up yet (${problems.length})`}</b></summary>
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
    requestedBy: '', notifyWhatsapp: '',
};

function RequirementForm({ orgId, existing, onClose, onDone }: {
    orgId: string;
    /** Present when editing. */
    existing?: any;
    onClose: () => void;
    onDone: (id?: string) => void;
}) {
    const editing = !!existing;
    const [f, setF] = useState(() => {
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
                const r = await api(API, { method: 'POST', body: JSON.stringify({ ...f, organizationId: orgId, vendorTarget: Number(f.vendorTarget) || undefined }) });
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
                    <h2>{editing ? `Edit ${existing.code}` : 'New requirement'}</h2>
                    <button type="button" className={s.iconBtn} onClick={onClose} aria-label="Close"><X size={16} /></button>
                </div>
                {editing && (
                    <div className={preCall ? s.infoBox : s.noteBox}>
                        {preCall
                            ? 'No vendor has been called yet. Saving makes Satej re-plan from the start with these details; vendors found for the old version are dropped.'
                            : `Calls have already been made. Saving starts round ${existing.round + 1}: Satej searches again with these details and skips every vendor already called. Results so far are kept.`}
                    </div>
                )}
                <div className={s.grid}>
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
                    <label>City<input required value={f.locationCity} onChange={set('locationCity')} placeholder="Mumbai" /></label>
                    <label>Area / locality<input value={f.locationArea} onChange={set('locationArea')} placeholder="Lower Parel" /></label>
                    <label>Site name<input value={f.siteName} onChange={set('siteName')} placeholder="Mafatlal Chambers" /></label>
                    <label>Timeline<input value={f.timeline} onChange={set('timeline')} placeholder="within 15 days" /></label>
                    <label>Budget hint (internal, never said on calls)<input value={f.budgetHint} onChange={set('budgetHint')} /></label>
                    <label>Vendors to call<input type="number" min={3} max={40} value={f.vendorTarget} onChange={set('vendorTarget')} /></label>
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

function RequirementDetail({ orgId, id, onChange }: { orgId: string; id: string; onChange: () => void }) {
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

    // Fast polling while Satej is working, so the board moves as it does.
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
                        <button className={s.ghost} onClick={() => setChatOpen((v) => !v)}><MessageSquare size={14} /> {chatOpen ? 'Hide Satej' : 'Talk to Satej'}</button>
                        <MoreActions r={r} busy={!!busy} act={act} orgId={orgId} />
                    </div>
                </div>

                <StageRail r={r} stage={stage} />

                {err && <div className={s.errorBox}>{err}</div>}
                {r.error && <div className={s.errorBox}>{r.error}</div>}

                {r.status === 'needs_clarification' && <Questions r={r} act={act} busy={!!busy} />}

                <LiveBoard d={d} act={act} busy={busy} orgId={orgId} />

                {d.summaryText && <SummaryCard text={d.summaryText} />}

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
            <h3>Satej needs a few answers before it searches</h3>
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

function LiveBoard({ d, act, busy, orgId }: { d: Detail; act: (a: string, x?: object) => void; busy: string; orgId: string }) {
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
                {spotted.length === 0 && <p className={s.muted}>Vendors appear here the moment Satej spots them on a page.</p>}
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
                        <p className={s.muted}>Remove anyone you don&apos;t want phoned. Meera calls between 10:00 and 18:30 IST, Monday to Saturday.</p>
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
                                <div className={s.vSells}>{v.sells}</div>
                                <div className={s.vFoot}>
                                    <span className={s.meter} title={`Relevance ${v.relevance}/10`}><span style={{ width: `${v.relevance * 10}%` }} /></span>
                                    {(v.sourceUrls ?? []).slice(0, 1).map((u: string) => <a key={u} href={u} target="_blank" rel="noreferrer" className={s.link}>source</a>)}
                                </div>
                            </motion.div>
                        ))}
                    </AnimatePresence>
                </div>
                {removed.length > 0 && <p className={s.muted} style={{ marginTop: 8 }}>Removed: {removed.map((v) => v.name).join(', ')}</p>}
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
                            <span className={s.rankName}><b>{v.vendorName}</b><span className={s.muted}>{v.area}</span></span>
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
