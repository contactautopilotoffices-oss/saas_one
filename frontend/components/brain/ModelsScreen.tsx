'use client';

/**
 * AI models: which model every AI job in the app uses, a main model and backups, chosen per job. It replaces the
 * Control Centre's "AI models" panel (owner 2026-11-15) and does everything that panel did: per-job save and reset,
 * a one-call test per model, API keys by name, and the read-only list of models chosen elsewhere.
 *
 * Jobs and groups are rendered purely from the server's reply: new jobs appear here without a change on this side.
 * Every job's dropdown lists every model in the catalog (owner 2026-11-15, "Option A"), so no model ever seems missing:
 * the ones the job can use come first and can be picked; a model without its key, then a model the job cannot use
 * (wrong ability, or a provider the job cannot call yet), are shown greyed out with the server's reason beside them.
 * If a chosen model stops working the job moves to the next one and finally to its default, so a setting can never
 * stop a job (task-manager/ai/aiCatalog.ts effectiveChain).
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
    ArrowDown, ArrowUp, Check, ChevronRight, Cpu, KeyRound, Library, Loader2, Lock, OctagonAlert, Plus, RefreshCw, RotateCcw, Search, TriangleAlert, Undo2, X, Zap,
} from 'lucide-react';
import { createHttpApi, type AiInventoryItem, type AiJobRow, type AiModelRow, type AiModelsData, type AiTestResult, type BrainApi, type Plain } from './api';
import { useBrain } from './BrainContext';
import { duration, int, plural } from './labels';
import { Btn, Card, Chip, Empty, ErrorState, LoadingScreen, Screen, Segmented, cx, s, useMotion } from './ui';
import { AnimatePresence, motion } from 'framer-motion';

const MISSING = 'Model choices cannot be saved yet: migration 20261028140001 has not been applied. Every job is using its default model.';

type ModelControls = {
    api: Pick<BrainApi, 'aiModels' | 'saveAiModels' | 'testAiModel'>;
    report?: (failure: Extract<Plain<never>, { ok: false }>) => void;
    toast?: (message: string) => void;
};

export default function ModelsScreen() {
    const { api, report, toast } = useBrain();
    return <ModelSettings api={api} report={report} toast={toast} />;
}

export function HrModelSettings({ orgId }: { orgId: string }) {
    const api = useMemo(() => createHttpApi(orgId, 'hr'), [orgId]);
    return <div className={cx(s.theme, '@container min-w-0 rounded-2xl border border-border bg-surface p-4 sm:p-6')}><ModelSettings api={api} hr /></div>;
}

function ModelSettings({ api, report, toast, hr = false }: ModelControls & { hr?: boolean }) {
    const [nonce, setNonce] = useState(0);
    const [state, setState] = useState<{ n: number; res: Plain<AiModelsData> } | null>(null);
    useEffect(() => {
        let live = true;
        api.aiModels().then(res => {
            if (!live) return;
            if (!res.ok) report?.(res);
            setState({ n: nonce, res });
        });
        return () => { live = false; };
    }, [api, nonce, report]);
    const loading = !state || state.n !== nonce;
    const reload = () => setNonce(n => n + 1);

    return (
        <Screen title={hr ? 'HR AI models' : 'AI models'}
            sub={hr ? 'Choose the main model and backups for Otto and Recruitment. Settings apply across the deployment and take effect within a minute.' : 'Choose a main model and backups for each job. Changes take effect within a minute.'}
            actions={<Btn size="sm" icon={RefreshCw} disabled={loading} onClick={reload}>{loading && state ? 'Refreshing…' : 'Refresh'}</Btn>}>
            {!state && <LoadingScreen label="Loading the AI models" />}
            {state && !state.res.ok && <ErrorState what="the AI models" message={state.res.message} onRetry={reload} />}
            {state?.res.ok && <Body data={state.res.data} reload={reload} busyReload={loading} api={api} report={report} toast={toast} />}
        </Screen>
    );
}

type Notice = { tone: 'ok' | 'bad'; lines: string[] };

function Body({ data, reload, busyReload, api, report, toast }: ModelControls & { data: AiModelsData; reload: () => void; busyReload: boolean }) {
    const [q, setQ] = useState('');
    const [only, setOnly] = useState<'all' | 'changed'>('all');
    const [open, setOpen] = useState<Set<string>>(() => new Set());
    const [drafts, setDrafts] = useState<Record<string, string[]>>({});
    const [busy, setBusy] = useState<string | null>(null);
    const [tests, setTests] = useState<Record<string, AiTestResult>>({});
    const [notices, setNotices] = useState<Record<string, Notice>>({});
    const readOnly = data.tableMissing;

    const byId = useMemo(() => new Map(data.models.map(m => [m.id, m])), [data.models]);
    const name = (id: string) => byId.get(id)?.label ?? id;
    const changedCount = data.jobs.filter(j => j.saved !== null).length;

    const needle = q.trim().toLowerCase();
    const matches = (j: AiJobRow) => !needle || [j.label, j.hint, j.group, j.key, ...[...j.effective, ...j.defaults, ...(j.saved ?? [])].flatMap(id => [id, name(id)])]
        .some(x => x.toLowerCase().includes(needle));
    const shown = data.jobs.filter(j => (only === 'all' || j.saved !== null) && matches(j));
    // Groups in the order the server lists them; jobs keep the server's order inside each group.
    const groups: Array<[string, AiJobRow[]]> = [];
    for (const j of shown) {
        const g = groups.find(([k]) => k === j.group);
        if (g) g[1].push(j); else groups.push([j.group, [j]]);
    }

    const toggle = (key: string) => setOpen(o => { const n = new Set(o); if (n.has(key)) n.delete(key); else n.add(key); return n; });
    const setDraft = (key: string, list: string[]) => setDrafts(d => ({ ...d, [key]: list }));

    const save = async (job: AiJobRow, models: string[] | null) => {
        setBusy(`save:${job.key}`);
        setNotices(n => { const x = { ...n }; delete x[job.key]; return x; });
        const r = await api.saveAiModels(job.key, models);
        setBusy(null);
        if (!r.ok) {
            report?.(r);
            setNotices(n => ({ ...n, [job.key]: { tone: 'bad', lines: [r.message] } }));
            return;
        }
        const message = r.data.message ?? (models === null ? 'Back to the default models.' : 'Saved. It takes effect within a minute.');
        setNotices(n => ({ ...n, [job.key]: { tone: 'ok', lines: [message, ...(r.data.warnings ?? [])] } }));
        setDrafts(d => { const x = { ...d }; delete x[job.key]; return x; });
        toast?.(`${job.label}: ${message}`);
        reload();
    };

    const test = async (job: string, model: string) => {
        const k = `${job}|${model}`;
        setBusy(`test:${k}`);
        const r = await api.testAiModel(job, model);
        setBusy(null);
        if (!r.ok && r.kind === 'forbidden') report?.(r);
        setTests(t => ({ ...t, [k]: r.ok ? r.data.result : { ok: false, message: r.message } }));
    };

    return (
        <div className="flex min-w-0 flex-col gap-[24px]">
            {readOnly && (
                <div className={cx(s.banner, s.bannerWarn)} role="note">
                    <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-(--bc-warn-text)" />
                    <p className="text-[13px] text-(--bc-ink-1)">{MISSING}</p>
                </div>
            )}

            <KeysCard keys={data.keys} />

            {/* Find a job */}
            <div className="flex min-w-0 flex-col gap-[12px] @3xl:flex-row @3xl:items-center @3xl:justify-between">
                <p className={cx(s.tab, 'text-[13px] text-(--bc-ink-2)')}>
                    {plural(data.jobs.length, 'job')} · <b className="font-semibold text-(--bc-accent-text)">{int(changedCount)} changed from the default</b> · up to {int(data.maxChain)} models each
                </p>
                <div className="flex min-w-0 flex-col gap-[8px] @lg:flex-row @lg:items-center">
                    <div className="relative min-w-0 @lg:w-72">
                        <label htmlFor="ai-q" className="sr-only">Search jobs, models and groups</label>
                        <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-(--bc-ink-3)" />
                        <input id="ai-q" type="search" className={cx(s.input, 'pl-9!')} placeholder="Search a job, model or group" value={q} onChange={e => setQ(e.target.value)} autoComplete="off" />
                    </div>
                    <Segmented label="Which jobs" value={only} onChange={setOnly} options={[{ value: 'all', label: 'All jobs' }, { value: 'changed', label: `Changed from default (${changedCount})` }]} />
                </div>
            </div>

            {groups.length === 0 ? (
                <Card>
                    <Empty icon={Cpu} title={only === 'changed' && !needle ? 'No job is changed from its default' : 'No job matches'}>
                        {only === 'changed' && !needle ? 'Every job is running on its default models. Open a job and choose a main model to change it.' : 'Try another word, or show all jobs.'}
                    </Empty>
                </Card>
            ) : groups.map(([group, jobs]) => (
                <section key={group} aria-labelledby={`grp-${group}`} className="flex min-w-0 flex-col gap-[8px]">
                    <h3 id={`grp-${group}`} className={cx(s.label, 'flex items-center gap-[8px]')}>
                        {group}<span className={cx(s.tab, 'font-semibold normal-case tracking-normal text-(--bc-ink-3)')}>{plural(jobs.length, 'job')}{jobs.some(j => j.saved) ? ` · ${jobs.filter(j => j.saved).length} changed` : ''}</span>
                    </h3>
                    <Card as="div" className={cx(s.rows, 'min-w-0 overflow-hidden')}>
                        {jobs.map(job => (
                            <JobRow key={job.key} job={job} models={data.models} maxChain={data.maxChain} name={name} readOnly={readOnly} open={open.has(job.key)} onToggle={() => toggle(job.key)}
                                draft={drafts[job.key] ?? job.saved ?? []} setDraft={list => setDraft(job.key, list)} busy={busy} disabled={busyReload}
                                tests={tests} onTest={model => test(job.key, model)} onSave={models => save(job, models)} notice={notices[job.key]} />
                        ))}
                    </Card>
                </section>
            ))}

            <Elsewhere rows={data.inventory.filter(r => !r.job)} />
        </div>
    );
}

// ── API keys, by name only ────────────────────────────────────────────────────────────────────────────────────────

function KeysCard({ keys }: { keys: AiModelsData['keys'] }) {
    // A one-line summary by default (a missing key is named in it), so the jobs stay near the top; open for the names.
    const [open, setOpen] = useState(false);
    const m = useMotion();
    const missing = keys.filter(k => !k.ready);
    return (
        <Card as="section" className="@container min-w-0" aria-labelledby="ai-keys">
            <button type="button" aria-expanded={open} aria-controls="ai-keys-list" onClick={() => setOpen(o => !o)}
                className="flex w-full min-w-0 flex-wrap items-center gap-x-[12px] gap-y-[6px] p-[16px] text-left @3xl:px-[24px]">
                <ChevronRight className={cx('h-4 w-4 shrink-0 text-(--bc-ink-3) transition-transform duration-300', open && 'rotate-90')} />
                <span id="ai-keys" className={cx(s.label, 'flex items-center gap-[8px]')}><KeyRound className="h-3.5 w-3.5" />API keys</span>
                <span className={cx(s.tab, 'text-[12.5px] text-(--bc-ink-2)')}>{int(keys.length - missing.length)} of {int(keys.length)} ready</span>
                {missing.length > 0 && <Chip tone="bad" icon={X}>Missing: {missing.map(k => k.label).join(', ')}</Chip>}
                <span className="ml-auto text-[12px] text-(--bc-ink-3)">{open ? 'Hide' : 'Show'} key names</span>
            </button>
            <AnimatePresence initial={false}>
                {open && (
                    <motion.div id="ai-keys-list" key="k" initial={m.reduce ? { opacity: 0 } : { height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={m.reduce ? { opacity: 0 } : { height: 0, opacity: 0 }} transition={m.t(0.3)} className="overflow-hidden">
                        <div className="flex min-w-0 flex-col gap-[12px] border-t border-(--bc-line) p-[16px] @3xl:px-[24px]">
                            <p className="text-[12.5px] text-(--bc-ink-3)">Set on the server. Only the names are shown here, never a value.</p>
                            <ul className="grid min-w-0 gap-[12px] @2xl:grid-cols-2 @5xl:grid-cols-3">
                                {keys.map(k => (
                                    <li key={k.label} className={cx(s.well, 'flex min-w-0 flex-col gap-[8px] p-[12px]')}>
                                        <div className="flex min-w-0 items-start justify-between gap-[8px]">
                                            <span className="min-w-0 text-[13px] font-semibold text-(--bc-ink-1)">{k.label}</span>
                                            <Chip tone={k.ready ? 'ok' : 'bad'} icon={k.ready ? Check : X}>{k.ready ? 'Ready' : 'Missing'}</Chip>
                                        </div>
                                        <div className="flex min-w-0 flex-wrap gap-[6px]">
                                            {k.keys.map(x => (
                                                <span key={x.name} className={cx(s.chip, x.set ? s['tone-ok'] : s['tone-neutral'], 'font-normal!')}>
                                                    <span className={s.mono}>{x.name}</span>{x.set ? ' set' : ' not set'}
                                                </span>
                                            ))}
                                        </div>
                                        {k.note && <p className="text-[12px] leading-snug text-(--bc-ink-3)">{k.note}</p>}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </Card>
    );
}

// ── One job ───────────────────────────────────────────────────────────────────────────────────────────────────────

function TestLine({ t }: { t: AiTestResult | undefined }) {
    if (!t) return null;
    if (t.ok === null) return <span className="text-[12px] text-(--bc-ink-3)">{t.message}</span>;
    return t.ok
        ? <span className="flex items-center gap-[4px] text-[12px] text-(--bc-ok-text)"><Check className="h-3.5 w-3.5" />Answered{t.ms !== undefined ? ` in ${duration(t.ms)}` : ''}</span>
        : <span className="flex items-start gap-[4px] text-[12px] text-(--bc-bad-text)"><OctagonAlert className="mt-px h-3.5 w-3.5 shrink-0" />Failed{t.ms !== undefined ? ` after ${duration(t.ms)}` : ''}: {t.message}</span>;
}

/**
 * The server's reason, shortened for a dropdown option that already starts with the model's name:
 * "GLM 5.2 (Engy) cannot read images" → "can't read images"; "This job cannot call X yet" → "this job can't use this
 * provider yet". Anything else is shown as sent, starting lower-case so it reads on after the "·".
 */
function offerReason(label: string, st: { status: string; reason: string }): string {
    if (st.status === 'no_key') return 'API key missing';
    const r = st.reason.trim();
    if (/^This job cannot call .+ yet\.?$/.test(r)) return "this job can't use this provider yet";
    if (r.startsWith(`${label} cannot `)) return `can't ${r.slice(label.length + ' cannot '.length).replace(/\.$/, '')}`;
    return r ? r.charAt(0).toLowerCase() + r.slice(1) : "can't be used by this job";
}

function JobRow({ job, models, maxChain, name, readOnly, open, onToggle, draft, setDraft, busy, disabled, tests, onTest, onSave, notice }: {
    job: AiJobRow; models: AiModelRow[]; maxChain: number; name: (id: string) => string; readOnly: boolean; open: boolean; onToggle: () => void;
    draft: string[]; setDraft: (list: string[]) => void; busy: string | null; disabled: boolean;
    tests: Record<string, AiTestResult>; onTest: (model: string) => void; onSave: (models: string[] | null) => void; notice: Notice | undefined;
}) {
    const m = useMotion();
    const panel = `job-${job.key}`;
    // A one-model job keeps only its first choice; every other job keeps a main model and backups.
    const single = !!job.single;
    const chosen = single ? draft.slice(0, 1) : draft;
    const changed = JSON.stringify(chosen) !== JSON.stringify(job.saved ?? []);
    const statusOf = (id: string) => models.find(x => x.id === id)?.status[job.key] ?? { status: 'cannot' as const, reason: 'Unknown model' };
    // Every model not already chosen, in three groups: usable, key missing, and ones this job cannot use. Only the
    // first group can be picked; the others stay visible, greyed out, with the reason, so no model seems missing.
    const stOf = (x: AiModelRow) => x.status[job.key] ?? { status: 'cannot' as const, reason: 'Unknown job' };
    const rest = models.filter(x => !chosen.includes(x.id));
    const offerGroups = ([['ready', 'Can be used'], ['no_key', 'Key missing'], ['cannot', "This job can't use"]] as const)
        .map(([status, label]) => ({ status, label, list: rest.filter(x => stOf(x).status === status) }))
        .filter(g => g.list.length > 0);
    const usable = offerGroups.find(g => g.status === 'ready')?.list.length ?? 0;
    const greyed = rest.length - usable;
    const hintId = `${panel}-offer-hint`;
    const lock = readOnly || !!busy || disabled;
    const move = (i: number, d: number) => { const n = [...draft]; [n[i], n[i + d]] = [n[i + d], n[i]]; setDraft(n); };
    const now = job.effective[0];

    return (
        <div className="min-w-0">
            <button type="button" aria-expanded={open} aria-controls={panel} onClick={onToggle}
                className="flex w-full min-w-0 items-start gap-[12px] px-[16px] py-[12px] text-left transition-colors hover:bg-(--bc-l0)! @3xl:px-[24px]">
                <ChevronRight className={cx('mt-0.5 h-4 w-4 shrink-0 text-(--bc-ink-3) transition-transform duration-300', open && 'rotate-90')} />
                <span className="flex min-w-0 flex-1 flex-col gap-[2px]">
                    <span className="flex min-w-0 flex-wrap items-center gap-x-[8px] gap-y-[4px]">
                        <span className="text-[13.5px] font-semibold text-(--bc-ink-1)">{job.label}</span>
                        {job.saved && <Chip tone="accent">Changed from default</Chip>}
                    </span>
                    <span className={cx('text-[12.5px] leading-snug text-(--bc-ink-3)', !open && 'line-clamp-1')}>{job.hint}</span>
                </span>
                {/* Two lines, like the words on the left, so 30+ jobs stay compact. */}
                <span className="hidden shrink-0 flex-col items-end gap-[2px] text-right @2xl:flex">
                    <span className="text-[13px] font-semibold text-(--bc-ink-1)">{now ? name(now) : 'None'}</span>
                    <span className="text-[12px] text-(--bc-ink-3)">In force now{job.effective.length > 1 ? ` · then ${plural(job.effective.length - 1, 'backup')}` : ''}</span>
                </span>
            </button>
            <AnimatePresence initial={false}>
                {open && (
                    <motion.div id={panel} key="p" initial={m.reduce ? { opacity: 0 } : { height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={m.reduce ? { opacity: 0 } : { height: 0, opacity: 0 }} transition={m.t(0.3)} className="overflow-hidden">
                        <div className="@container flex min-w-0 flex-col gap-[16px] px-[16px] pt-[4px] pb-[16px] @3xl:pl-[52px] @3xl:pr-[24px]">
                            <div className="grid min-w-0 gap-[16px] @3xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
                                {/* The chosen main + backups */}
                                <div className="flex min-w-0 flex-col gap-[8px]">
                                    <span className={s.label}>{single ? 'Your choice' : 'Your choice, in order'}</span>
                                    {single && <p className="text-[12.5px] leading-snug text-(--bc-ink-3)">This job uses one model. If the chosen one fails, it falls back to the default for that request.</p>}
                                    {chosen.length === 0 ? (
                                        <p className={cx(s.well, 'p-[12px] text-[13px] text-(--bc-ink-2)')}>Using the default. Add a model to choose your own main model; the default models stay behind it as the last resort.</p>
                                    ) : (
                                        <ol className="flex min-w-0 flex-col gap-[6px]">
                                            {chosen.map((id, i) => {
                                                const st = statusOf(id);
                                                const k = `${job.key}|${id}`;
                                                return (
                                                    <li key={id} className={cx(s.well, 'flex min-w-0 flex-col gap-[6px] px-[12px] py-[8px]')}>
                                                        <div className="flex min-w-0 flex-wrap items-center gap-x-[8px] gap-y-[6px]">
                                                            <span className={cx(s.kbd, 'px-[6px]!')}>{single ? 'Model' : i === 0 ? 'Main' : `Backup ${i}`}</span>
                                                            <span className="min-w-0 text-[13px] font-semibold text-(--bc-ink-1)">{name(id)}</span>
                                                            {st.status === 'no_key' && <Chip tone="warn" icon={KeyRound}>API key missing: skipped until it is added</Chip>}
                                                            {st.status === 'cannot' && <Chip tone="bad">{st.reason}</Chip>}
                                                            <span className="ml-auto flex items-center gap-[2px]">
                                                                <Btn size="sm" variant="quiet" icon={busy === `test:${k}` ? Loader2 : Zap} disabled={!!busy} onClick={() => onTest(id)}
                                                                    className={busy === `test:${k}` ? '[&>svg]:animate-spin' : undefined}>Test</Btn>
                                                                {!single && <>
                                                                    <Btn size="sm" variant="quiet" icon={ArrowUp} aria-label={`Move ${name(id)} up`} disabled={lock || i === 0} onClick={() => move(i, -1)} />
                                                                    <Btn size="sm" variant="quiet" icon={ArrowDown} aria-label={`Move ${name(id)} down`} disabled={lock || i === chosen.length - 1} onClick={() => move(i, 1)} />
                                                                </>}
                                                                <Btn size="sm" variant="quiet" icon={X} aria-label={single ? `Remove ${name(id)} and use the default` : `Remove ${name(id)}`} disabled={lock} onClick={() => setDraft(chosen.filter(x => x !== id))} />
                                                            </span>
                                                        </div>
                                                        <TestLine t={tests[k]} />
                                                    </li>
                                                );
                                            })}
                                        </ol>
                                    )}
                                    {single || chosen.length < maxChain ? (
                                        <div className="flex min-w-0 flex-col gap-[4px]">
                                            {greyed > 0 && (
                                                <p id={hintId} className="text-[12.5px] leading-snug text-(--bc-ink-3)">
                                                    Every model is listed. Greyed-out ones cannot be used by this job; the reason is shown beside each.
                                                </p>
                                            )}
                                            <label className="flex min-w-0 flex-col gap-[4px]">
                                                <span className="sr-only">{single ? `Choose the model for ${job.label}` : `Add a model to ${job.label}`}</span>
                                                <span className="relative min-w-0">
                                                    <Plus className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-(--bc-ink-3)" />
                                                    <select className={cx(s.input, 'pl-9!')} value="" disabled={lock || rest.length === 0} aria-describedby={greyed > 0 ? hintId : undefined}
                                                        onChange={e => {
                                                            const id = e.target.value;
                                                            // Only a usable model can be added, even if a disabled option were somehow chosen.
                                                            const x = rest.find(r => r.id === id);
                                                            if (x && stOf(x).status === 'ready') setDraft(single ? [id] : [...chosen, id]);
                                                        }}>
                                                        <option value="">{usable === 0 ? 'No other model can be used for this job' : single ? (chosen.length ? 'Change the model' : 'Choose the model') : chosen.length === 0 ? 'Choose a main model' : `Add backup ${chosen.length}`}</option>
                                                        {offerGroups.map(g => (
                                                            <optgroup key={g.status} label={g.label}>
                                                                {g.list.map(x => {
                                                                    const st = stOf(x);
                                                                    return (
                                                                        <option key={x.id} value={x.id} disabled={st.status !== 'ready'}>
                                                                            {x.label}{st.status === 'ready' ? (x.note ? ` · ${x.note}` : '') : ` · ${offerReason(x.label, st)}`}
                                                                        </option>
                                                                    );
                                                                })}
                                                            </optgroup>
                                                        ))}
                                                    </select>
                                                </span>
                                            </label>
                                        </div>
                                    ) : <p className="text-[12px] text-(--bc-ink-3)">At most {int(maxChain)} models: a main model and {int(maxChain - 1)} backups.</p>}
                                </div>

                                {/* What runs now, and the default */}
                                <div className="flex min-w-0 flex-col gap-[12px]">
                                    <div className="flex min-w-0 flex-col gap-[6px]">
                                        <span className={s.label}>Runs now</span>
                                        <ol className="flex min-w-0 flex-col gap-[4px] text-[13px]">
                                            {job.effective.map((id, i) => (
                                                <li key={id} className="flex min-w-0 items-center gap-[8px]">
                                                    <span className={cx(s.kbd, 'shrink-0')}>{i + 1}</span>
                                                    <span className={cx('min-w-0 truncate', i === 0 ? 'font-semibold text-(--bc-ink-1)' : 'text-(--bc-ink-2)')}>{name(id)}</span>
                                                    {i === 0 && <Chip tone="ok">In force</Chip>}
                                                </li>
                                            ))}
                                        </ol>
                                    </div>
                                    <div className="flex min-w-0 flex-col gap-[6px]">
                                        <span className={s.label}>Default (the last resort)</span>
                                        <p className="text-[13px] text-(--bc-ink-2)">{job.defaults.map(name).join(' → ') || 'None'}</p>
                                        {chosen.length === 0 && job.defaults.length > 0 && (
                                            <div className="flex flex-col gap-[4px]">
                                                {job.defaults.map(id => (
                                                    <span key={id} className="flex min-w-0 flex-wrap items-center gap-[8px]">
                                                        <Btn size="sm" variant="quiet" icon={busy === `test:${job.key}|${id}` ? Loader2 : Zap} disabled={!!busy} onClick={() => onTest(id)}
                                                            className={cx('-ml-[10px]', busy === `test:${job.key}|${id}` && '[&>svg]:animate-spin')}>Test {name(id)}</Btn>
                                                        <TestLine t={tests[`${job.key}|${id}`]} />
                                                    </span>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {notice && (
                                <div role={notice.tone === 'bad' ? 'alert' : 'status'} className={cx(s.banner, notice.tone === 'bad' ? s.bannerBad : s.bannerInfo, 'py-[10px]!')}>
                                    {notice.tone === 'bad' ? <OctagonAlert className="mt-0.5 h-4 w-4 shrink-0 text-(--bc-bad-text)" /> : <Check className="mt-0.5 h-4 w-4 shrink-0 text-(--bc-ok-text)" />}
                                    <ul className="flex flex-col gap-[2px] text-[13px] text-(--bc-ink-1)">{notice.lines.map(l => <li key={l}>{l}</li>)}</ul>
                                </div>
                            )}

                            <div className="flex min-w-0 flex-wrap items-center justify-end gap-[8px] border-t border-(--bc-line) pt-[12px]">
                                {readOnly && <span className="mr-auto text-[12.5px] text-(--bc-ink-3)">Read only until the migration is applied.</span>}
                                {job.saved && <Btn size="sm" icon={RotateCcw} disabled={lock} onClick={() => onSave(null)}>Back to the default</Btn>}
                                {changed && <Btn size="sm" variant="quiet" icon={Undo2} disabled={lock} onClick={() => setDraft(job.saved ?? [])}>Undo changes</Btn>}
                                <Btn size="sm" variant="primary" disabled={lock || !changed} onClick={() => onSave(chosen.length ? chosen : null)}>
                                    {busy === `save:${job.key}` ? 'Saving…' : 'Save'}
                                </Btn>
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}

// ── Models chosen elsewhere (read only) ───────────────────────────────────────────────────────────────────────────

function Elsewhere({ rows }: { rows: AiInventoryItem[] }) {
    const [open, setOpen] = useState(false);
    const m = useMotion();
    const areas: Array<[string, AiInventoryItem[]]> = [];
    for (const r of rows) {
        const a = areas.find(([k]) => k === r.area);
        if (a) a[1].push(r); else areas.push([r.area, [r]]);
    }
    return (
        <Card as="section" className="@container min-w-0" aria-labelledby="ai-elsewhere">
            <button type="button" aria-expanded={open} aria-controls="ai-elsewhere-list" onClick={() => setOpen(o => !o)}
                className="flex w-full min-w-0 items-start gap-[12px] p-[16px] text-left @3xl:px-[24px]">
                <ChevronRight className={cx('mt-0.5 h-4 w-4 shrink-0 text-(--bc-ink-3) transition-transform duration-300', open && 'rotate-90')} />
                <span className="flex min-w-0 flex-col gap-[2px]">
                    <span id="ai-elsewhere" className={cx(s.label, 'flex items-center gap-[8px]')}><Library className="h-3.5 w-3.5" />Cannot be changed here</span>
                    <span className="text-[12.5px] text-(--bc-ink-3)">{plural(rows.length, 'other use')} of AI models in the app, chosen in code or in server settings. For reference only.</span>
                </span>
            </button>
            <AnimatePresence initial={false}>
                {open && (
                    <motion.div id="ai-elsewhere-list" key="l" initial={m.reduce ? { opacity: 0 } : { height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={m.reduce ? { opacity: 0 } : { height: 0, opacity: 0 }} transition={m.t(0.3)} className="overflow-hidden">
                        <div className="flex min-w-0 flex-col gap-[20px] border-t border-(--bc-line) px-[16px] pt-[16px] pb-[16px] @3xl:px-[24px]">
                            {areas.map(([area, list]) => (
                                <section key={area} className="flex min-w-0 flex-col gap-[4px]">
                                    <h4 className={s.label}>{area}</h4>
                                    <ul className={s.rows}>
                                        {list.map(r => (
                                            <li key={`${r.area}|${r.feature}`} className="grid min-w-0 gap-[6px] py-[12px] @3xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1.1fr)] @3xl:gap-[24px]">
                                                <div className="min-w-0">
                                                    <p className="flex flex-wrap items-center gap-[6px] text-[13px] font-semibold text-(--bc-ink-1)">{r.feature}<Chip>{r.kind}</Chip></p>
                                                    <p className={cx(s.mono, 'mt-[2px] text-(--bc-ink-3)')}>{r.where}</p>
                                                </div>
                                                <div className="min-w-0">
                                                    <span className={s.label}>Model</span>
                                                    <p className="text-[13px] break-words text-(--bc-ink-2)">{r.models}</p>
                                                </div>
                                                <div className="flex min-w-0 flex-col gap-[4px]">
                                                    <span className={s.label}>Where it is chosen</span>
                                                    <p className="text-[13px] text-(--bc-ink-2)">{r.chosen}</p>
                                                    {r.modelEnv && (
                                                        <p className="text-[12px] text-(--bc-ink-3)"><span className={cx(s.mono, 'text-(--bc-ink-2)')}>{r.modelEnv}</span> {r.modelEnvSet ? 'is set, so it overrides the default shown' : 'is not set'}</p>
                                                    )}
                                                    {r.keyStatus.length > 0 && (
                                                        <span className="flex min-w-0 flex-wrap gap-[4px]">
                                                            {r.keyStatus.map(k => <span key={k.name} className={cx(s.chip, k.set ? s['tone-ok'] : s['tone-neutral'], 'font-normal!')}><span className={s.mono}>{k.name}</span>{k.set ? ' set' : ' not set'}</span>)}
                                                        </span>
                                                    )}
                                                </div>
                                                {r.why && (
                                                    <p className="flex min-w-0 items-start gap-[6px] text-[12.5px] text-(--bc-ink-2) @3xl:col-span-3">
                                                        <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-(--bc-ink-3)" /><span><span className="text-(--bc-ink-3)">Why it is not here: </span>{r.why}</span>
                                                    </p>
                                                )}
                                            </li>
                                        ))}
                                    </ul>
                                </section>
                            ))}
                            {rows.length === 0 && <p className="text-[13px] text-(--bc-ink-3)">Every AI model in the app can be chosen above.</p>}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </Card>
    );
}
