'use client';

/**
 * SATEJ — the vendor discovery console.
 *
 * Raise a requirement; Satej structures it, finds local vendors on the web,
 * has Meera (Bolna) phone them, scores every call with a fixed rulebook and
 * sends the ranked summary on WhatsApp. This page is the record of all of it:
 * the brief, the vendors and where each was found, every call's recording and
 * transcript, and why each vendor scored what it did.
 *
 * Ported from the procurement-agent package console; the data shapes are
 * backend/lib/satej/types.ts. Types are kept loose here so this client file
 * pulls in no server code.
 */

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import AgentActivity from '@/frontend/components/agents/AgentActivity';
import s from './satej.module.css';

/* eslint-disable @typescript-eslint/no-explicit-any */

type Summary = {
    id: string;
    code: string;
    title: string;
    spendType: string;
    city: string;
    status: string;
    round: number;
    topVendor: string | null;
    createdAt: string;
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
    submitted: 'Submitted',
    needs_clarification: 'Needs your answer',
    structured: 'Brief ready',
    discovering: 'Finding vendors',
    awaiting_call_approval: 'Approve call list',
    calling: 'Calling vendors',
    calls_done: 'Calls finished',
    analyzing: 'Analysing calls',
    ranked: 'Ranked',
    notified: 'Sent to team',
    failed: 'Failed',
    cancelled: 'Cancelled',
};

const STEP_OF: Record<string, number> = {
    submitted: 0, needs_clarification: 0, structured: 1, discovering: 1, awaiting_call_approval: 1,
    calling: 2, calls_done: 3, analyzing: 3, ranked: 3, notified: 4,
};

function tone(status: string) {
    if (status === 'needs_clarification' || status === 'awaiting_call_approval') return s.warn;
    if (status === 'failed' || status === 'cancelled') return s.bad;
    if (status === 'notified') return s.good;
    return s.info;
}

function fmt(iso?: string) {
    if (!iso) return '-';
    return new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

async function api(path: string, init?: RequestInit) {
    const res = await fetch(path, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
}

export default function SatejConsole({ orgId }: { orgId: string }) {
    const [list, setList] = useState<Summary[] | null>(null);
    const [selected, setSelected] = useState<string | null>(null);
    const [showForm, setShowForm] = useState(false);
    const [error, setError] = useState('');
    /** Requirements, or Satej's run log — every traced step, its duration, cost and any error. */
    const [view, setView] = useState<'requirements' | 'runs'>('requirements');

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
        load();
        const t = setInterval(load, 15000);
        const q = new URLSearchParams(window.location.search).get('req');
        if (q) setSelected(q);
        return () => clearInterval(t);
    }, [load]);

    return (
        <div className={s.page}>
            <header className={s.header}>
                <div>
                    <h1>Satej · Vendor discovery</h1>
                    <p className={s.muted}>
                        Raise a requirement. Satej finds local vendors, Meera calls them, and you get a ranked shortlist on WhatsApp.
                    </p>
                </div>
                <button className={s.primary} onClick={() => setShowForm(true)}>New requirement</button>
            </header>

            <SetupPanel orgId={orgId} />

            <div className={s.tabs} role="tablist">
                <button role="tab" aria-selected={view === 'requirements'} className={`${s.tab} ${view === 'requirements' ? s.tabActive : ''}`} onClick={() => setView('requirements')}>
                    Requirements
                </button>
                <button role="tab" aria-selected={view === 'runs'} className={`${s.tab} ${view === 'runs' ? s.tabActive : ''}`} onClick={() => setView('runs')}>
                    Run log
                </button>
            </div>

            {/* The same run log the Agent Console shows, scoped to Satej. Each row opens the
                step-by-step trace: what it searched, read, called and sent, and what failed. */}
            {view === 'runs' && <AgentActivity orgId={orgId} agentKey="satej" />}

            {view === 'requirements' && error && <div className={s.errorBox}>{error}</div>}

            {view === 'requirements' && <div className={s.layout}>
                <aside className={s.list}>
                    {list === null && !error && <p className={s.muted}>Loading…</p>}
                    {list !== null && list.length === 0 && <p className={s.muted}>No requirements yet.</p>}
                    {(list ?? []).map((r) => (
                        <button
                            key={r.id}
                            className={`${s.item} ${selected === r.id || selected === r.code ? s.itemActive : ''}`}
                            onClick={() => setSelected(r.id)}
                        >
                            <div className={s.itemTop}>
                                <span className={s.code}>{r.code}</span>
                                <span className={`${s.chip} ${tone(r.status)}`}>{STATUS_LABEL[r.status] ?? r.status}</span>
                            </div>
                            <div className={s.itemTitle}>{r.title}</div>
                            <div className={s.muted}>
                                {r.spendType.toUpperCase()} · {r.city || '-'} · {fmt(r.createdAt)}
                                {r.topVendor ? ` · Top: ${r.topVendor}` : ''}
                            </div>
                        </button>
                    ))}
                </aside>
                <main style={{ minWidth: 0 }}>
                    {selected ? <RequirementDetail orgId={orgId} id={selected} onChange={load} /> : <p className={s.muted}>Pick a requirement on the left.</p>}
                </main>
            </div>}

            {showForm && (
                <NewRequirementForm
                    orgId={orgId}
                    onClose={() => setShowForm(false)}
                    onCreated={(id) => {
                        setShowForm(false);
                        setSelected(id);
                        load();
                    }}
                />
            )}
        </div>
    );
}

// ---------------------------------------------------------------- setup check

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
    if (v.unfilledVariables?.length) {
        problems.push(`The voice prompt uses variables Satej does not send: ${v.unfilledVariables.join(', ')}. Those words would be blank on calls.`);
    }
    if (!setup.whatsappConfigured) problems.push('AiSensy is not configured, so WhatsApp updates will not go out. Everything still shows here.');

    if (!problems.length && !setup.mockMode) {
        return (
            <p className={s.muted} style={{ marginBottom: 12 }}>
                Ready · calls through {v.name ?? 'Bolna'} · {setup.autoStartCalls ? 'calls start automatically' : 'you approve each call list before calls start'}
            </p>
        );
    }
    return (
        <div className={s.noteBox}>
            <b>{setup.mockMode ? 'Mock mode: no real searches, calls or messages.' : 'Satej is not fully set up yet'}</b>
            {problems.length > 0 && (
                <ul className={s.setupList} style={{ marginTop: 6 }}>
                    {problems.map((p) => <li key={p}>{p}</li>)}
                </ul>
            )}
        </div>
    );
}

// ---------------------------------------------------------------- form

const SCOPES = ['Supply only', 'Supply and installation', 'Service', 'AMC', 'Complete works contract'];

function NewRequirementForm({ orgId, onClose, onCreated }: { orgId: string; onClose: () => void; onCreated: (id: string) => void }) {
    const [f, setF] = useState({
        title: '',
        spendType: 'capex',
        itemDescription: '',
        quantity: '',
        unit: '',
        scope: 'Supply and installation',
        locationCity: '',
        locationArea: '',
        siteName: '',
        timeline: '',
        budgetHint: '',
        notes: '',
        vendorTarget: '12',
        requestedBy: '',
        notifyWhatsapp: '',
    });
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState('');
    const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
        setF({ ...f, [k]: e.target.value });

    async function submit(e: React.FormEvent) {
        e.preventDefault();
        setBusy(true);
        setErr('');
        try {
            const r = await api(API, {
                method: 'POST',
                body: JSON.stringify({ ...f, organizationId: orgId, vendorTarget: Number(f.vendorTarget) || undefined }),
            });
            onCreated(r.id);
        } catch (e: any) {
            setErr(e.message);
        } finally {
            setBusy(false);
        }
    }

    return (
        <div className={s.modalBack} onClick={onClose}>
            <form className={s.modal} onClick={(e) => e.stopPropagation()} onSubmit={submit}>
                <h2>New requirement</h2>
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
                    <label>Requested by<input value={f.requestedBy} onChange={set('requestedBy')} placeholder="Defaults to you" /></label>
                    <label>Send updates to WhatsApp<input value={f.notifyWhatsapp} onChange={set('notifyWhatsapp')} placeholder="+91 98xxxxxxxx" /></label>
                    <label className={s.full}>Notes<textarea rows={2} value={f.notes} onChange={set('notes')} /></label>
                </div>
                {err && <div className={s.errorBox}>{err}</div>}
                <div className={s.actions}>
                    <button type="button" className={s.ghost} onClick={onClose}>Cancel</button>
                    <button className={s.primary} disabled={busy}>{busy ? 'Submitting…' : 'Submit and start'}</button>
                </div>
            </form>
        </div>
    );
}

// ---------------------------------------------------------------- detail

function RequirementDetail({ orgId, id, onChange }: { orgId: string; id: string; onChange: () => void }) {
    const [d, setD] = useState<Detail | null>(null);
    const [answers, setAnswers] = useState<string[]>([]);
    const [err, setErr] = useState('');
    const [busy, setBusy] = useState('');
    const [open, setOpen] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);

    const load = useCallback(async () => {
        try {
            setD(await api(`${API}/${encodeURIComponent(id)}?organizationId=${orgId}`));
            setErr('');
        } catch (e: any) {
            setErr(e.message);
        }
    }, [id, orgId]);

    useEffect(() => {
        setD(null);
        setAnswers([]);
        load();
        const t = setInterval(load, 10000);
        return () => clearInterval(t);
    }, [load]);

    const act = async (action: string, extra: object = {}) => {
        setErr('');
        setBusy(action);
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

    const callsByVendor = useMemo(() => {
        const m: Record<string, any[]> = {};
        for (const c of d?.calls ?? []) (m[c.vendorId ?? 'none'] ||= []).push(c);
        return m;
    }, [d]);

    if (!d) return err ? <div className={s.errorBox}>{err}</div> : <p className={s.muted}>Loading…</p>;
    const r = d.requirement;
    const b = r.brief;
    const step = STEP_OF[r.status] ?? 0;
    const toCall = d.vendors.filter((v) => v.status === 'found');

    return (
        <div>
            <div className={s.detailHead}>
                <div>
                    <span className={s.code}>{r.code}</span>{' '}
                    <span className={`${s.chip} ${tone(r.status)}`}>{STATUS_LABEL[r.status] ?? r.status}</span>
                    {r.round > 1 && <span className={s.chip}>Round {r.round}</span>}
                    <h2>{r.input.title}</h2>
                </div>
                <div className={s.actions}>
                    {r.status === 'failed' && <button className={s.ghost} disabled={!!busy} onClick={() => act('retry')}>Retry</button>}
                    {r.ranking && <button className={s.ghost} disabled={!!busy} onClick={() => act('resend_whatsapp')}>Resend WhatsApp</button>}
                    {['notified', 'ranked', 'failed'].includes(r.status) && r.brief && (
                        <button className={s.ghost} disabled={!!busy} onClick={() => act('again')}>Find more vendors</button>
                    )}
                    {b && <a className={s.ghost} href={`${API}/${r.id}?organizationId=${orgId}&format=csv`}>Call CSV</a>}
                    {!['notified', 'cancelled'].includes(r.status) && (
                        <button className={s.ghost} disabled={!!busy} onClick={() => confirm('Cancel this requirement?') && act('cancel')}>Cancel</button>
                    )}
                </div>
            </div>

            <ol className={s.steps}>
                {['Brief', 'Vendors', 'Calls', 'Ranking', 'WhatsApp'].map((label, i) => (
                    <li key={label} className={i < step || r.status === 'notified' ? s.done : i === step ? s.now : ''}>{label}</li>
                ))}
            </ol>

            {err && <div className={s.errorBox}>{err}</div>}
            {r.error && <div className={s.errorBox}>{r.error}</div>}

            {r.status === 'needs_clarification' && (
                <section className={s.card}>
                    <h3>Satej needs a few answers</h3>
                    {(b?.questions ?? []).map((q: string, i: number) => (
                        <label key={i} className={s.full}>
                            {q}
                            <input
                                value={answers[i] ?? ''}
                                onChange={(e) => {
                                    const a = [...answers];
                                    a[i] = e.target.value;
                                    setAnswers(a);
                                }}
                            />
                        </label>
                    ))}
                    <button className={s.primary} disabled={!!busy} onClick={() => act('answer', { answers })}>Send answers and continue</button>
                </section>
            )}

            {r.status === 'awaiting_call_approval' && (
                <section className={s.card}>
                    <h3>Approve the call list</h3>
                    <p className={s.muted}>
                        {toCall.length} vendors are ready. Check them under &quot;Vendors found&quot; below. Calls go out between 10:00 and 18:30 IST,
                        Monday to Saturday.
                    </p>
                    <div style={{ marginTop: 8 }}>
                        <button className={s.primary} disabled={!!busy} onClick={() => act('approve_calls')}>
                            {busy === 'approve_calls' ? 'Scheduling…' : `Start ${toCall.length} calls`}
                        </button>
                    </div>
                </section>
            )}

            {b && (
                <section className={s.card}>
                    <h3>Brief</h3>
                    <div className={s.kv}>
                        <span>Need</span><b>{b.itemSummary}</b>
                        <span>Quantity</span><b>{b.quantityText}</b>
                        <span>Location</span><b>{b.locationText}</b>
                        <span>Timeline</span><b>{b.timelineText || '-'}</b>
                        <span>Type</span><b>{r.input.spendType.toUpperCase()} · {String(b.scopeType).replace(/_/g, ' ')}</b>
                        <span>Vendor types</span><b>{(b.vendorTypes ?? []).join(', ')}</b>
                        <span>Calls</span>
                        <b>{r.callsScheduledAt ? `Scheduled ${fmt(r.callsScheduledAt)}` : '-'}{r.callsCompletedAt ? `, finished ${fmt(r.callsCompletedAt)}` : ''}</b>
                    </div>
                </section>
            )}

            {r.ranking && (
                <section className={s.card}>
                    <h3>Ranked vendors</h3>
                    <div className={s.tableWrap}>
                        <table className={s.table}>
                            <thead>
                                <tr><th>#</th><th>Vendor</th><th>Score</th><th>Status</th><th>Years</th><th>Clients</th><th>Delivery</th><th></th></tr>
                            </thead>
                            <tbody>
                                {r.ranking.map((v: any) => (
                                    <Fragment key={v.vendorId}>
                                        <tr>
                                            <td>{v.rank}</td>
                                            <td><b>{v.vendorName}</b><div className={s.muted}>{v.phone} · {v.area}</div></td>
                                            <td><b>{v.score.total}</b>/100</td>
                                            <td>
                                                <span className={`${s.chip} ${v.score.qualification === 'qualified' ? s.good : v.score.qualification === 'verify_gst' ? s.warn : s.bad}`}>
                                                    {v.score.qualification.replace('_', ' ')}
                                                </span>
                                            </td>
                                            <td>{v.yearsExperience ?? '-'}</td>
                                            <td>{v.clients.slice(0, 3).join(', ') || '-'}</td>
                                            <td>{v.turnaroundText || '-'}</td>
                                            <td><button className={s.link} onClick={() => setOpen(open === v.vendorId ? null : v.vendorId)}>{open === v.vendorId ? 'Hide' : 'Details'}</button></td>
                                        </tr>
                                        {open === v.vendorId && (
                                            <tr><td colSpan={8}><VendorCalls v={v} calls={callsByVendor[v.vendorId] ?? []} /></td></tr>
                                        )}
                                    </Fragment>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </section>
            )}

            {d.summaryText && (
                <section className={s.card}>
                    <h3>Summary for WhatsApp</h3>
                    <pre className={s.summary}>{d.summaryText}</pre>
                    <button
                        className={s.ghost}
                        onClick={() => {
                            navigator.clipboard?.writeText(d.summaryText!).then(() => {
                                setCopied(true);
                                setTimeout(() => setCopied(false), 2000);
                            });
                        }}
                    >
                        {copied ? 'Copied' : 'Copy summary'}
                    </button>
                </section>
            )}

            <section className={s.card}>
                <h3>Vendors found ({d.vendors.length})</h3>
                {d.vendors.length === 0 ? (
                    <p className={s.muted}>None yet.</p>
                ) : (
                    <div className={s.tableWrap}>
                        <table className={s.table}>
                            <thead><tr><th>Vendor</th><th>Phone</th><th>Area</th><th>Sells</th><th>Relevance</th><th>Status</th><th>Source</th></tr></thead>
                            <tbody>
                                {d.vendors.map((v) => (
                                    <tr key={v.id}>
                                        <td>{v.name}{v.website && <div className={s.muted}>{v.website}</div>}</td>
                                        <td>{v.phone}</td>
                                        <td>{[v.area, v.city].filter(Boolean).join(', ')}</td>
                                        <td>{v.sells}</td>
                                        <td>{v.relevance}/10</td>
                                        <td>{v.status.replace('_', ' ')}{v.excludeReason && <div className={s.muted}>{v.excludeReason}</div>}</td>
                                        <td>
                                            {(v.sourceUrls ?? []).slice(0, 2).map((u: string, i: number) => (
                                                <a key={u} className={s.link} href={u} target="_blank" rel="noreferrer">source {i + 1} </a>
                                            ))}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </section>

            <section className={s.card}>
                <h3>Activity</h3>
                <ul className={s.log}>
                    {[...r.events].reverse().map((e: any, i: number) => (
                        <li key={i}><span className={s.muted}>{fmt(e.at)}</span> {e.msg}</li>
                    ))}
                </ul>
            </section>
        </div>
    );
}

function VendorCalls({ v, calls }: { v: any; calls: any[] }) {
    return (
        <div className={s.callBox}>
            <p>{v.summary}</p>
            {v.score.parts.length > 0 && (
                <div className={s.parts}>
                    {v.score.parts.map((p: any) => (
                        <div key={p.label}><b>{p.label}</b> {p.points}/{p.max}<div className={s.muted}>{p.why}</div></div>
                    ))}
                </div>
            )}
            {v.usps.length > 0 && <p><b>USPs:</b> {v.usps.join('; ')}</p>}
            {v.redFlags.length > 0 && <p><b>Watch out:</b> {v.redFlags.join('; ')}</p>}
            {calls.map((c) => (
                <details key={c.id}>
                    <summary>
                        Call {fmt(c.createdAt)} · {c.status} · {c.durationSec ? `${Math.round(c.durationSec)}s` : '-'}{c.retried ? ` · retry ${c.retried}` : ''}
                    </summary>
                    {c.recordingUrl && <audio controls src={c.recordingUrl} className={s.audio} />}
                    {c.analysis?.evidence?.length > 0 && (
                        <ul>{c.analysis.evidence.map((e: any, i: number) => <li key={i}><b>{e.field}:</b> &quot;{e.quote}&quot;</li>)}</ul>
                    )}
                    <pre className={s.transcript}>{c.transcript || 'No transcript'}</pre>
                </details>
            ))}
        </div>
    );
}
