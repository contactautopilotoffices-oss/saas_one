'use client';

/**
 * AI Access settings (plan section 6.5): who may use the AI assistant, where, and for what. Org super admin only; the
 * API enforces that. Settings can only narrow access: whatever is ticked here, a person never gets more than the app
 * already gives their role.
 */
import { useEffect, useMemo, useState } from 'react';
import AiLearningPanel from './AiLearningPanel';

type GridLevel = 'off' | 'questions' | 'questions_actions';
type ModuleId = 'tickets' | 'electricity_readings';
interface Config {
    enabled: boolean;
    channels: { app_chat: boolean; whatsapp: boolean; app_voice: boolean };
    access: { mode: 'selected_people' | 'selected_roles' | 'people_and_roles' | 'all_staff'; userIds: string[]; roles: string[] };
    blockedUserIds: string[];
    propertyIds: string[] | null;
    grid: Record<string, Partial<Record<ModuleId, GridLevel>>>;
    entryModes: Record<string, 'off' | 'shadow' | 'live'>;
    limits: { perUserPerHour: number; actionsPerUserPerDay: number };
    learning: { enabled: boolean };
    aliases: Record<string, string[]>;
}
interface Entry { id: string; kind: 'question' | 'write'; module: ModuleId; defaultMode: 'off' | 'shadow' | 'live'; label: string }
interface Person { id: string; name: string; email: string }
interface CheckLine { ok: boolean; label: string; detail: string }
type CheckState = { loading: true } | { loading: false; lines?: CheckLine[]; error?: string };
interface ActivityRow { id: string; created_at: string; actor_name: string | null; entry_id: string | null; decision: string; refusal_reason: string | null; topic: string | null; result_ref: string | null }

const MODULES: Array<{ id: ModuleId; label: string }> = [{ id: 'tickets', label: 'Tickets' }, { id: 'electricity_readings', label: 'Meter readings' }];
const OWN_RECORD_ROLES = ['tenant', 'super_tenant', 'vendor', 'maintenance_vendor'];
const LEVELS: Array<{ id: GridLevel; label: string }> = [{ id: 'off', label: 'Off' }, { id: 'questions', label: 'Questions only' }, { id: 'questions_actions', label: 'Questions + actions' }];

/** Cells a role can never use in the app are greyed out, with the reason. */
function blockedReason(role: string, module: ModuleId): string | null {
    if (module === 'electricity_readings' && OWN_RECORD_ROLES.includes(role)) return 'Tenants and vendors cannot see building meter readings in the app';
    return null;
}

const card = 'bg-white rounded-2xl border border-slate-200 p-4 md:p-6';
const h = 'text-sm font-black text-slate-900';
const sub = 'text-xs text-slate-500 mt-1';

export default function AiAccessSettings({ organizationId }: { organizationId: string }) {
    const [config, setConfig] = useState<Config | null>(null);
    const [entries, setEntries] = useState<Entry[]>([]);
    const [roles, setRoles] = useState<string[]>([]);
    const [properties, setProperties] = useState<Array<{ id: string; name: string }>>([]);
    const [people, setPeople] = useState<Person[]>([]);
    const [limits, setLimits] = useState({ perUserPerHour: 60, actionsPerUserPerDay: 100 });
    const [tableMissing, setTableMissing] = useState(false);
    const [activity, setActivity] = useState<ActivityRow[]>([]);
    const [status, setStatus] = useState('');
    const [busy, setBusy] = useState(false);
    const [search, setSearch] = useState('');
    const [blockSearch, setBlockSearch] = useState('');
    const [checks, setChecks] = useState<Record<string, CheckState>>({});

    useEffect(() => {
        const controller = new AbortController();
        const q = `organizationId=${encodeURIComponent(organizationId)}`;
        setConfig(null); setStatus('');
        Promise.all([
            fetch(`/api/ai-layer/settings?${q}`, { signal: controller.signal, cache: 'no-store' }).then(async r => { const d = await r.json(); if (!r.ok) throw new Error(d.error || 'Could not load'); return d; }),
            fetch(`/api/ai-layer/activity?${q}`, { signal: controller.signal, cache: 'no-store' }).then(r => r.json()).catch(() => ({ rows: [] })),
        ]).then(([d, a]) => {
            setConfig(d.config); setEntries(d.entries); setRoles(d.roles); setProperties(d.properties); setPeople(d.users);
            setLimits(d.platformLimits); setTableMissing(d.tableMissing); setActivity(a.rows || []);
        }).catch(err => { if (err.name !== 'AbortError') setStatus(err.message); });
        return () => controller.abort();
    }, [organizationId]);

    const byId = useMemo(() => new Map(people.map(p => [p.id, p])), [people]);
    if (!config) return <div className={card}><p className="text-sm text-slate-500">{status || 'Loading AI assistant settings…'}</p></div>;

    const set = (patch: Partial<Config>) => setConfig({ ...config, ...patch });
    const toggleIn = (list: string[], id: string) => (list.includes(id) ? list.filter(x => x !== id) : [...list, id]);
    const setCell = (role: string, module: ModuleId, level: GridLevel) =>
        set({ grid: { ...config.grid, [role]: { ...(config.grid[role] || {}), [module]: level } } });

    async function save() {
        if (!config) return;
        setBusy(true); setStatus('');
        try {
            const r = await fetch('/api/ai-layer/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ organizationId, config }) });
            const d = await r.json();
            if (!r.ok) throw new Error([d.error, ...(d.details || [])].filter(Boolean).join(' · '));
            setConfig(d.config); setStatus('Saved. Changes apply to the next message.');
        } catch (err) { setStatus(err instanceof Error ? err.message : 'Could not save'); }
        finally { setBusy(false); }
    }

    /** "Check": why the WhatsApp AI does or doesn't answer this person, from the SAVED settings. */
    async function runCheck(userId: string) {
        setChecks(c => ({ ...c, [userId]: { loading: true } }));
        try {
            const r = await fetch(`/api/ai-layer/settings?organizationId=${encodeURIComponent(organizationId)}&view=check&userId=${encodeURIComponent(userId)}`, { cache: 'no-store' });
            const d = await r.json();
            if (!r.ok) throw new Error(d.error || 'Check failed');
            setChecks(c => ({ ...c, [userId]: { loading: false, lines: d.lines } }));
        } catch (err) {
            setChecks(c => ({ ...c, [userId]: { loading: false, error: err instanceof Error ? err.message : 'Check failed' } }));
        }
    }

    const picker = (selected: string[], onChange: (ids: string[]) => void, query: string, setQuery: (q: string) => void, label: string, withCheck = false) => {
        const ql = query.trim().toLowerCase();
        const matches = ql ? people.filter(p => !selected.includes(p.id) && `${p.name} ${p.email}`.toLowerCase().includes(ql)).slice(0, 8) : [];
        return (
            <div className="mt-3">
                <input value={query} onChange={e => setQuery(e.target.value)} placeholder={`Search people to ${label}`} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" />
                {matches.length > 0 && (
                    <ul className="mt-1 rounded-xl border border-slate-200 divide-y divide-slate-100">
                        {matches.map(p => <li key={p.id}><button type="button" onClick={() => { onChange([...selected, p.id]); setQuery(''); }} className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50">{p.name || p.email} <span className="text-slate-400">{p.email}</span></button></li>)}
                    </ul>
                )}
                <div className="flex flex-wrap gap-2 mt-2">
                    {selected.map(id => (
                        <span key={id} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                            {byId.get(id)?.name || 'Unavailable account'}
                            {withCheck && <button type="button" onClick={() => runCheck(id)} className="ml-1 rounded-full bg-white px-2 text-[11px] font-bold text-primary border border-slate-200 hover:bg-slate-50" title="Check whether the WhatsApp AI will answer this person (uses the saved settings)">Check</button>}
                            <button type="button" aria-label="Remove" onClick={() => onChange(selected.filter(x => x !== id))} className="text-slate-400 hover:text-slate-700">×</button>
                        </span>
                    ))}
                </div>
                {withCheck && selected.map(id => {
                    const c = checks[id];
                    if (!c) return null;
                    return (
                        <div key={`check-${id}`} className="mt-3 rounded-xl border border-slate-200 p-3 text-sm">
                            <p className="font-bold text-slate-900">WhatsApp check: {byId.get(id)?.name || 'this person'} <span className="font-normal text-xs text-slate-500">(saved settings)</span></p>
                            {c.loading ? <p className="text-slate-500 mt-1">Checking…</p> : c.error ? <p className="text-rose-600 mt-1">{c.error}</p> : (
                                <ul className="mt-2 space-y-1">
                                    {c.lines!.map(l => (
                                        <li key={l.label} className="flex gap-2">
                                            <span className={l.ok ? 'text-emerald-600' : 'text-rose-600'}>{l.ok ? '✓' : '✗'}</span>
                                            <span><span className="font-semibold">{l.label}:</span> {l.detail}</span>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    );
                })}
            </div>
        );
    };

    const showPeople = config.access.mode !== 'selected_roles';
    const showRoles = config.access.mode !== 'selected_people';

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h2 className="text-lg font-black text-slate-900">AI Assistant access</h2>
                    <p className="text-sm text-slate-500">Choose who can use the AI assistant and for what. People never get more than their role already allows in the app.</p>
                </div>
                <a href={`/${organizationId}/ai-assistant/train`} className="rounded-xl bg-primary px-4 py-2 text-sm font-bold text-white hover:opacity-90">💬 Open training chat</a>
            </div>

            {!config.enabled && (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
                    <b>The AI assistant is OFF for this organization</b>, so nobody gets it, whatever else is set below.
                    Tick <b>&ldquo;AI assistant for this organization&rdquo;</b> and click <b>Save AI settings</b> to turn it on.
                </div>
            )}

            {tableMissing && (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                    The AI settings tables are not set up yet, so the assistant stays off. Your team needs to run the migration <code>20261104000002_ai_action_layer.sql</code>.
                </div>
            )}

            <section className={card}>
                <label className="flex items-center justify-between gap-4">
                    <span><span className={h}>AI assistant for this organization <span className={`ml-2 rounded-full px-2 py-0.5 text-[11px] font-black ${config.enabled ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}`}>{config.enabled ? 'ON' : 'OFF'}</span></span><span className={`block ${sub}`}>Off by default. This is the main switch: turning it off stops it for everyone at once.</span></span>
                    <input type="checkbox" className="h-5 w-5" checked={config.enabled} onChange={e => set({ enabled: e.target.checked })} />
                </label>
                <div className="mt-4 grid gap-2 sm:grid-cols-3">
                    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={config.channels.app_chat} onChange={e => set({ channels: { ...config.channels, app_chat: e.target.checked } })} /> In-app chat</label>
                    <label className="flex items-center gap-2 text-sm" title="Keep WhatsApp to a few trusted people: WhatsApp messages are matched by phone number only"><input type="checkbox" checked={config.channels.whatsapp} onChange={e => set({ channels: { ...config.channels, whatsapp: e.target.checked } })} /> WhatsApp</label>
                    <label className="flex items-center gap-2 text-sm text-slate-400"><input type="checkbox" disabled checked={false} readOnly /> In-app voice (coming later)</label>
                </div>
            </section>

            <section className={card}>
                <p className={h}>Who can use it</p>
                <select value={config.access.mode} onChange={e => set({ access: { ...config.access, mode: e.target.value as Config['access']['mode'] } })} className="mt-3 rounded-xl border border-slate-200 px-3 py-2 text-sm">
                    <option value="selected_people">Selected people</option>
                    <option value="selected_roles">Selected roles</option>
                    <option value="people_and_roles">Selected people + roles</option>
                    <option value="all_staff">All staff (tenants and vendors only if picked)</option>
                </select>
                {showRoles && (
                    <div className="mt-3 flex flex-wrap gap-2">
                        {roles.map(role => (
                            <label key={role} className="inline-flex items-center gap-2 rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold">
                                <input type="checkbox" checked={config.access.roles.includes(role)} onChange={() => set({ access: { ...config.access, roles: toggleIn(config.access.roles, role) } })} /> {role}
                            </label>
                        ))}
                    </div>
                )}
                {showPeople && picker(config.access.userIds, ids => set({ access: { ...config.access, userIds: ids } }), search, setSearch, 'allow', true)}
                <p className={`${h} mt-5`}>Blocked people</p>
                <p className={sub}>Always refused, whatever else is set.</p>
                {picker(config.blockedUserIds, ids => set({ blockedUserIds: ids }), blockSearch, setBlockSearch, 'block')}
            </section>

            <section className={card}>
                <p className={h}>Buildings</p>
                <label className="mt-3 flex items-center gap-2 text-sm"><input type="radio" checked={config.propertyIds === null} onChange={() => set({ propertyIds: null })} /> All buildings</label>
                <label className="mt-1 flex items-center gap-2 text-sm"><input type="radio" checked={config.propertyIds !== null} onChange={() => set({ propertyIds: [] })} /> Only selected buildings (for a pilot)</label>
                {config.propertyIds !== null && (
                    <div className="mt-2 grid gap-1 sm:grid-cols-2">
                        {properties.map(p => <label key={p.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={config.propertyIds!.includes(p.id)} onChange={() => set({ propertyIds: toggleIn(config.propertyIds!, p.id) })} /> {p.name}</label>)}
                    </div>
                )}
            </section>

            <section className={card}>
                <p className={h}>Property nicknames</p>
                <p className={sub}>Other names people use for a property, separated by commas (e.g. &ldquo;DMC, Mafatlal&rdquo;). The AI then recognises them, and small spelling mistakes too.</p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {properties.map(p => (
                        <label key={p.id} className="text-sm">
                            <span className="text-slate-700">{p.name}</span>
                            <input className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm" placeholder="Nicknames…"
                                defaultValue={(config.aliases?.[p.id] || []).join(', ')}
                                onBlur={e => {
                                    const list = e.target.value.split(',').map(x => x.trim()).filter(x => x.length >= 2).slice(0, 10).map(x => x.slice(0, 40));
                                    const next = { ...(config.aliases || {}) };
                                    if (list.length) next[p.id] = list; else delete next[p.id];
                                    set({ aliases: next });
                                }} />
                        </label>
                    ))}
                </div>
            </section>

            <section className={card}>
                <label className="flex items-center justify-between gap-4">
                    <span><span className={h}>Learning loop</span><span className={`block ${sub}`}>When on, messages the AI probably got wrong (didn&apos;t understand, &ldquo;no, I meant…&rdquo;, asked again, going in circles) are kept for 30 days in <b>Review mistakes</b> below, so you can teach it. Phone numbers are masked; HR complaints are never kept.</span></span>
                    <input type="checkbox" className="h-5 w-5" checked={config.learning?.enabled === true} onChange={e => set({ learning: { enabled: e.target.checked } })} />
                </label>
            </section>

            <section className={card}>
                <p className={h}>What each role can use</p>
                <p className={sub}>Answers are always limited to the buildings and records the person can already see.</p>
                <div className="mt-3 overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead><tr className="text-left text-xs text-slate-500"><th className="py-2 pr-3">Role</th>{MODULES.map(m => <th key={m.id} className="py-2 pr-3">{m.label}</th>)}</tr></thead>
                        <tbody>
                            {roles.map(role => (
                                <tr key={role} className="border-t border-slate-100">
                                    <td className="py-2 pr-3 font-semibold text-slate-700">{role}</td>
                                    {MODULES.map(m => {
                                        const reason = blockedReason(role, m.id);
                                        return (
                                            <td key={m.id} className="py-2 pr-3" title={reason ?? ''}>
                                                <select disabled={!!reason} value={reason ? 'off' : (config.grid[role]?.[m.id] ?? 'off')} onChange={e => setCell(role, m.id, e.target.value as GridLevel)} className="rounded-lg border border-slate-200 px-2 py-1 text-xs disabled:bg-slate-50 disabled:text-slate-400">
                                                    {LEVELS.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}
                                                </select>
                                            </td>
                                        );
                                    })}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </section>

            <section className={card}>
                <p className={h}>Each capability</p>
                <p className={sub}>Shadow = it runs and is logged, but nothing is created. Review the activity below, then switch to Live.</p>
                <div className="mt-3 space-y-2">
                    {entries.map(e => (
                        <div key={e.id} className="flex items-center justify-between gap-3 text-sm">
                            <span>{e.label} <span className="text-xs text-slate-400">({e.kind === 'write' ? 'action' : 'question'})</span></span>
                            <select value={config.entryModes[e.id] ?? e.defaultMode} onChange={ev => set({ entryModes: { ...config.entryModes, [e.id]: ev.target.value as 'off' | 'shadow' | 'live' } })} className="rounded-lg border border-slate-200 px-2 py-1 text-xs">
                                <option value="off">Off</option>
                                {e.kind === 'write' && <option value="shadow">Shadow</option>}
                                <option value="live">Live</option>
                            </select>
                        </div>
                    ))}
                </div>
            </section>

            <section className={card}>
                <p className={h}>Limits</p>
                <p className={sub}>Capped by the platform at {limits.perUserPerHour} messages an hour and {limits.actionsPerUserPerDay} actions a day per person.</p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <label className="text-sm">Messages per person per hour
                        <input type="number" min={1} max={limits.perUserPerHour} value={config.limits.perUserPerHour} onChange={e => set({ limits: { ...config.limits, perUserPerHour: Math.max(1, Math.min(limits.perUserPerHour, Number(e.target.value) || 1)) } })} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2" />
                    </label>
                    <label className="text-sm">Actions per person per day
                        <input type="number" min={1} max={limits.actionsPerUserPerDay} value={config.limits.actionsPerUserPerDay} onChange={e => set({ limits: { ...config.limits, actionsPerUserPerDay: Math.max(1, Math.min(limits.actionsPerUserPerDay, Number(e.target.value) || 1)) } })} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2" />
                    </label>
                </div>
            </section>

            <div className="flex items-center gap-3">
                <button type="button" onClick={save} disabled={busy || tableMissing} className="rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50">{busy ? 'Saving…' : 'Save AI settings'}</button>
                {status && <p className="text-sm text-slate-600">{status}</p>}
            </div>

            <section className={card}>
                <p className={h}>Recent AI activity</p>
                <p className={sub}>The latest 200 messages. Confidential HR items are never shown here.</p>
                {activity.length === 0 ? <p className="mt-3 text-sm text-slate-500">Nothing yet.</p> : (
                    <div className="mt-3 overflow-x-auto">
                        <table className="w-full text-xs">
                            <thead><tr className="text-left text-slate-500"><th className="py-1 pr-3">When</th><th className="py-1 pr-3">Who</th><th className="py-1 pr-3">What</th><th className="py-1 pr-3">Result</th><th className="py-1 pr-3">Details</th></tr></thead>
                            <tbody>
                                {activity.map(r => (
                                    <tr key={r.id} className="border-t border-slate-100">
                                        <td className="py-1 pr-3 whitespace-nowrap">{new Date(r.created_at).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })}</td>
                                        <td className="py-1 pr-3">{r.actor_name ?? '·'}</td>
                                        <td className="py-1 pr-3">{r.entry_id ?? '·'}</td>
                                        <td className="py-1 pr-3">{r.decision}</td>
                                        <td className="py-1 pr-3 text-slate-500">{r.result_ref || r.refusal_reason || r.topic || ''}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </section>

            <AiLearningPanel organizationId={organizationId} />
        </div>
    );
}
