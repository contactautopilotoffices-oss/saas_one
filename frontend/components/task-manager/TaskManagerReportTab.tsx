'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, CalendarClock, CheckCircle2, Download, FileText, Info, Loader2, RefreshCw } from 'lucide-react';
import { todayIST } from '@/frontend/components/procurement/tasks/types';
import type { Kpi, Tone, UsageReport } from '@/backend/lib/reports/taskManagerUsage/types';
import type { ReportFrequency, ReportSchedule } from '@/backend/lib/reports/taskManagerUsage/schedule';
import type { SavedReport } from '@/backend/lib/reports/taskManagerUsage/store';
import { daysBetween, shiftDay } from './DateRangePicker';
import SelectMenu from './assign/SelectMenu';

/**
 * Report tab of the Task Manager, for org super admins: generate the Task Manager Usage Report, set its schedule, and
 * reach past reports. The server decides who may see this; this file only shows and sends.
 *
 * The date boxes here are not DateRangePicker: that picker clamps to 31 days for the task screens, and a report may cover
 * up to a year. Only its pure date helpers are used. Dates are IST calendar days, the same as the server.
 *
 * When `provisioned` is false the database update has not been run: generating and downloading still work, and Schedule
 * and Saved reports stay switched off with a note.
 *
 * app/globals.css redefines the plain .p-N and .gap-N classes on a larger scale, forces h2 and h3 sizes on phones and gives
 * every button a 44px minimum. So this file uses px-/py- and gap-x-/gap-y-, which keep Tailwind's scale, and titles are
 * role="heading" rather than h2 or h3. Without that, the tiles and the department table do not fit a phone.
 */

const API = '/api/reports/task-manager-usage';
const MAX_DAYS = 366;
const NETWORK_ERROR = 'Could not reach the server. Check your connection and try again.';

interface Range { from: string; to: string }

const PRESETS: ReadonlyArray<{ id: string; label: string; range: (today: string) => Range }> = [
    { id: 'last7', label: 'Last 7 days', range: t => ({ from: shiftDay(t, -6), to: t }) },
    { id: 'last14', label: 'Last 14 days', range: t => ({ from: shiftDay(t, -13), to: t }) },
    { id: 'last30', label: 'Last 30 days', range: t => ({ from: shiftDay(t, -29), to: t }) },
    { id: 'last90', label: 'Last 90 days', range: t => ({ from: shiftDay(t, -89), to: t }) },
    { id: 'thisMonth', label: 'This month', range: t => ({ from: `${t.slice(0, 8)}01`, to: t }) },
    {
        id: 'lastMonth', label: 'Last month',
        range: t => { const end = shiftDay(`${t.slice(0, 8)}01`, -1); return { from: `${end.slice(0, 8)}01`, to: end }; },
    },
];

function rangeProblem({ from, to }: Range, today: string): string | null {
    if (!from || !to) return 'Choose a start and end date.';
    if (from > to) return 'The start date must be on or before the end date.';
    if (to > today) return 'The end date cannot be in the future.';
    if (daysBetween(from, to) + 1 > MAX_DAYS) return `A report can cover at most ${MAX_DAYS} days.`;
    return null;
}

const messageOf = (err: unknown, fallback: string) => (err instanceof Error && err.message ? err.message : fallback);
const isAbort = (err: unknown) => err instanceof DOMException && err.name === 'AbortError';

/** fetch, with a dropped connection turned into a sentence. An abort stays an abort, so callers can ignore it. */
async function send(url: string, init?: RequestInit): Promise<Response> {
    try {
        return await fetch(url, init);
    } catch (err) {
        if (isAbort(err)) throw err;
        throw new Error(NETWORK_ERROR);
    }
}

async function problemWith(res: Response, fallback: string): Promise<string> {
    if (res.status === 401) return 'Your session has ended. Please sign in again.';
    if (res.status === 403) return 'Only an org super admin can use this report.';
    const json = await res.json().catch(() => null);
    return json?.error || fallback;
}

async function getJson<T>(url: string, fallback: string, signal?: AbortSignal): Promise<T> {
    const res = await send(url, { signal });
    if (!res.ok) throw new Error(await problemWith(res, fallback));
    return res.json();
}

const num = (v: number) => v.toLocaleString('en-IN');
const pct = (v: number | null) => (v === null ? '—' : `${v}%`);

const dayLabel = (iso: string) => {
    const d = new Date(`${iso}T00:00:00Z`);
    return isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
};
const momentLabel = (iso: string) => {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    const date = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
    const time = d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });
    return `${date}, ${time} IST`;
};
const sizeLabel = (bytes: number | null) => {
    if (!bytes) return null;
    return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const TONE: Record<Tone, { label: string; chip: string; text: string }> = {
    good: { label: 'On track', chip: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300', text: 'text-emerald-700 dark:text-emerald-400' },
    warn: { label: 'Watch', chip: 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300', text: 'text-amber-700 dark:text-amber-400' },
    bad: { label: 'Attention', chip: 'bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300', text: 'text-rose-600 dark:text-rose-400' },
    neutral: { label: 'No rating', chip: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300', text: 'text-zinc-500 dark:text-zinc-400' },
};

const FIELD = 'min-h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm font-semibold text-zinc-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:[color-scheme:dark]';
const LABEL = 'text-xs font-semibold text-zinc-600 dark:text-zinc-400';
const PRIMARY = 'inline-flex min-h-11 items-center justify-center gap-x-2 rounded-xl bg-indigo-600 px-5 text-sm font-bold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-40';
const ICON_BUTTON = 'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-zinc-200 bg-white text-zinc-500 hover:text-zinc-800 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:text-zinc-200';

function Banner({ kind, children }: { kind: 'error' | 'ok'; children: React.ReactNode }) {
    return (
        <div role={kind === 'error' ? 'alert' : 'status'} className={`flex items-start gap-x-2 rounded-2xl px-4 py-2.5 text-xs font-bold ${kind === 'ok' ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300' : 'bg-rose-50 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300'}`}>
            {kind === 'ok' ? <CheckCircle2 className="mt-px h-4 w-4 shrink-0" /> : <AlertTriangle className="mt-px h-4 w-4 shrink-0" />}
            <span className="min-w-0">{children}</span>
        </div>
    );
}

function CalmNote({ children }: { children: React.ReactNode }) {
    return (
        <p className="flex items-start gap-x-2 rounded-2xl bg-zinc-100 px-4 py-2.5 text-xs font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
            <Info className="mt-px h-4 w-4 shrink-0 text-zinc-400" />
            <span className="min-w-0">{children}</span>
        </p>
    );
}

function Card({ icon, title, description, action, children }: { icon: React.ReactNode; title: string; description: string; action?: React.ReactNode; children: React.ReactNode }) {
    return (
        <section aria-label={title} className="min-w-0 space-y-4 rounded-2xl border border-zinc-200 bg-white px-4 py-4 sm:px-5 sm:py-5 dark:border-zinc-800 dark:bg-zinc-900">
            <header className="flex items-start gap-x-3">
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">{icon}</span>
                <div className="min-w-0 flex-1">
                    <p role="heading" aria-level={2} className="text-sm font-black text-zinc-900 dark:text-zinc-100">{title}</p>
                    <p className="text-xs text-zinc-500">{description}</p>
                </div>
                {action}
            </header>
            {children}
        </section>
    );
}

function KpiTile({ kpi, wide }: { kpi: Kpi; wide: boolean }) {
    const tone = TONE[kpi.tone];
    return (
        <div className={`min-w-0 rounded-2xl border border-zinc-200 bg-white px-3 py-3 sm:px-4 sm:py-4 dark:border-zinc-800 dark:bg-zinc-900 ${wide ? 'col-span-2 sm:col-span-1' : ''}`}>
            <p className="text-[11px] font-bold text-zinc-500">{kpi.label}</p>
            <p className="mt-0.5 whitespace-nowrap text-xl font-black tabular-nums text-zinc-900 sm:text-2xl dark:text-zinc-100">{kpi.display}</p>
            <p className="mt-0.5 text-[11px] leading-snug text-zinc-500">{kpi.detail}</p>
            <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-black ${tone.chip}`}>{tone.label}</span>
                <span className={`text-[11px] font-bold tabular-nums ${kpi.change === null ? 'text-zinc-400' : TONE[kpi.changeTone].text}`}>{kpi.change ?? 'No comparison'}</span>
            </div>
        </div>
    );
}

function DepartmentTable({ report }: { report: UsageReport }) {
    if (!report.departments.length) {
        return <p className="rounded-2xl border border-dashed border-zinc-300 px-6 py-6 text-center text-xs text-zinc-500 dark:border-zinc-700">No departments are switched on for the Task Manager.</p>;
    }
    const head = 'whitespace-nowrap px-2 py-2 text-[11px] font-bold text-zinc-500 sm:px-3';
    const cell = 'whitespace-nowrap px-2 py-2 tabular-nums text-zinc-700 sm:px-3 dark:text-zinc-300';
    const wideOnly = 'hidden sm:table-cell';
    return (
        <div className="overflow-hidden rounded-2xl border border-zinc-200 dark:border-zinc-800">
            <table className="w-full table-fixed text-left text-xs">
                <thead className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-800/40">
                    <tr>
                        <th scope="col" className={head}>Department</th>
                        <th scope="col" className={`${head} w-[4.25rem] text-right sm:w-24`}>Active</th>
                        <th scope="col" className={`${head} text-right ${wideOnly}`}>Regular</th>
                        <th scope="col" className={`${head} text-right ${wideOnly}`}>Cycles</th>
                        <th scope="col" className={`${head} w-12 text-right sm:w-28`}><span className="sm:hidden">Done</span><span className="hidden sm:inline">Completion</span></th>
                        <th scope="col" className={`${head} text-right ${wideOnly}`}>Open</th>
                        <th scope="col" className={`${head} text-right ${wideOnly}`}>Overdue</th>
                        <th scope="col" className={`${head} w-[5.25rem] sm:w-28`}>Status</th>
                    </tr>
                </thead>
                <tbody>
                    {report.departments.map(d => (
                        <tr key={d.id} className="border-b border-zinc-100 last:border-b-0 dark:border-zinc-800">
                            <td className="truncate px-2 py-2 font-bold text-zinc-900 sm:px-3 dark:text-zinc-100" title={d.name}>{d.name}</td>
                            <td className={`${cell} text-right`}>{num(d.active)} of {num(d.people)}</td>
                            <td className={`${cell} text-right ${wideOnly}`}>{num(d.regular)}</td>
                            <td className={`${cell} text-right ${wideOnly}`}>{num(d.cycles)}</td>
                            <td className={`${cell} text-right`}>{pct(d.completionPct)}</td>
                            <td className={`${cell} text-right ${wideOnly}`}>{num(d.open)}</td>
                            <td className={`${cell} text-right ${wideOnly}`}>{num(d.overdue)}</td>
                            <td className="px-2 py-2 sm:px-3"><span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-black ${TONE[d.tone].chip}`}>{TONE[d.tone].label}</span></td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function GenerateCard({ orgId, savedOn, onGenerated }: { orgId: string; savedOn: boolean | null; onGenerated: () => void }) {
    const today = todayIST();
    const [range, setRange] = useState<Range>(() => PRESETS[0].range(todayIST()));
    const [report, setReport] = useState<UsageReport | null>(null);
    const [loading, setLoading] = useState(true);
    const [previewError, setPreviewError] = useState<string | null>(null);
    const [attempt, setAttempt] = useState(0);
    const [busy, setBusy] = useState(false);
    const [downloadError, setDownloadError] = useState<string | null>(null);
    const [downloaded, setDownloaded] = useState<string | null>(null);

    const problem = rangeProblem(range, today);
    const preset = PRESETS.find(p => { const r = p.range(today); return r.from === range.from && r.to === range.to; })?.id ?? null;

    useEffect(() => {
        if (problem) { setLoading(false); return; }
        const controller = new AbortController();
        setLoading(true);
        setPreviewError(null);
        // Typing a date fires on every keystroke: wait for it to settle before asking the server for a whole report.
        const timer = setTimeout(async () => {
            try {
                const params = new URLSearchParams({ orgId, from: range.from, to: range.to });
                const json = await getJson<{ report: UsageReport }>(`${API}?${params}`, 'Could not build the preview. Please try again.', controller.signal);
                setReport(json.report);
                setLoading(false);
            } catch (err) {
                if (controller.signal.aborted) return;
                setReport(null);
                setPreviewError(messageOf(err, 'Could not build the preview. Please try again.'));
                setLoading(false);
            }
        }, 300);
        return () => { clearTimeout(timer); controller.abort(); };
    }, [orgId, range.from, range.to, problem, attempt]);

    const download = async () => {
        const { from, to } = range;
        setBusy(true);
        setDownloadError(null);
        setDownloaded(null);
        try {
            const res = await send(`${API}/pdf`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ organization_id: orgId, from, to }) });
            if (!res.ok) throw new Error(await problemWith(res, 'Could not generate the PDF. Please try again.'));
            const blob = await res.blob();
            const name = /filename="?([^";]+)"?/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? `task-manager-usage-report-${from}-to-${to}.pdf`;
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = name;
            document.body.appendChild(link);
            link.click();
            link.remove();
            setTimeout(() => URL.revokeObjectURL(url), 10_000);

            const saved = res.headers.get('X-Report-Saved') === 'true';
            setDownloaded(saved ? 'PDF downloaded. A copy is under Saved reports.' : savedOn === false ? 'PDF downloaded.' : 'PDF downloaded, but a copy could not be kept under Saved reports.');
            onGenerated();
        } catch (err) {
            setDownloadError(messageOf(err, 'Could not generate the PDF. Please try again.'));
        } finally {
            setBusy(false);
        }
    };

    const stale = report && (report.period.from !== range.from || report.period.to !== range.to);

    return (
        <Card icon={<FileText className="h-4 w-4" />} title="Generate" description="Choose the days to cover, check the preview, then download the PDF.">
            <div className="grid grid-cols-2 gap-x-1 gap-y-1 rounded-xl bg-zinc-100 px-1 py-1 sm:inline-flex sm:max-w-full sm:flex-wrap dark:bg-zinc-800" role="group" aria-label="Quick dates">
                {PRESETS.map(p => (
                    <button key={p.id} type="button" aria-pressed={preset === p.id} onClick={() => setRange(p.range(today))}
                        className={`min-h-9 whitespace-nowrap rounded-lg px-3 text-[13px] font-bold ${preset === p.id ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-900 dark:text-zinc-100' : 'text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200'}`}>
                        {p.label}
                    </button>
                ))}
            </div>

            <div className="grid grid-cols-2 items-end gap-x-3 gap-y-3 sm:flex sm:flex-wrap">
                <label className="flex min-w-0 flex-col gap-1.5 sm:w-44">
                    <span className={LABEL}>From</span>
                    <input type="date" value={range.from} max={range.to || today} onChange={e => setRange(r => ({ ...r, from: e.target.value }))} className={FIELD} />
                </label>
                <label className="flex min-w-0 flex-col gap-1.5 sm:w-44">
                    <span className={LABEL}>To</span>
                    <input type="date" value={range.to} max={today} onChange={e => setRange(r => ({ ...r, to: e.target.value }))} className={FIELD} />
                </label>
                <button type="button" onClick={download} disabled={busy || !!problem} className={`${PRIMARY} col-span-2 sm:col-span-1`}>
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                    {busy ? 'Generating PDF…' : 'Download PDF'}
                </button>
            </div>

            {busy && <p role="status" className="text-xs font-semibold text-zinc-500">This takes several seconds. Please keep this page open.</p>}
            {problem && <Banner kind="error">{problem}</Banner>}
            {downloadError && <Banner kind="error">{downloadError}</Banner>}
            {downloaded && <Banner kind="ok">{downloaded}</Banner>}

            {!problem && (
                <div className="space-y-3 border-t border-zinc-100 pt-4 dark:border-zinc-800" aria-busy={loading}>
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                        <p role="heading" aria-level={3} className="text-xs font-black text-zinc-900 dark:text-zinc-100">Preview</p>
                        <p className="text-[11px] font-bold text-zinc-500">
                            {loading && <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />}
                            {dayLabel(range.from)} to {dayLabel(range.to)}, {num(daysBetween(range.from, range.to) + 1)} {daysBetween(range.from, range.to) === 0 ? 'day' : 'days'}
                        </p>
                    </div>
                    {previewError && (
                        <div className="space-y-2">
                            <Banner kind="error">{previewError}</Banner>
                            <button type="button" onClick={() => setAttempt(a => a + 1)} className="text-xs font-bold text-indigo-600 hover:underline dark:text-indigo-400">Try again</button>
                        </div>
                    )}
                    {!report && !previewError && <div className="flex items-center gap-x-2 py-6 text-sm text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Working out the numbers…</div>}
                    {report && (
                        <div className={`space-y-3 transition-opacity ${loading || stale ? 'opacity-50' : ''}`}>
                            <div className="grid grid-cols-2 gap-x-3 gap-y-3 sm:grid-cols-3 lg:grid-cols-5">
                                {report.kpis.map((k, i) => <KpiTile key={k.key} kpi={k} wide={i === report.kpis.length - 1 && report.kpis.length % 2 === 1} />)}
                            </div>
                            <DepartmentTable report={report} />
                        </div>
                    )}
                </div>
            )}
        </Card>
    );
}

interface ScheduleState { provisioned: boolean; schedule: ReportSchedule; nextRunAt: string | null }

/** Days in the order the Task Manager shows them, Monday first. The value is the server's: 0 is Sunday. */
const WEEKDAYS: ReadonlyArray<{ value: string; label: string }> = [
    { value: '1', label: 'Monday' }, { value: '2', label: 'Tuesday' }, { value: '3', label: 'Wednesday' }, { value: '4', label: 'Thursday' },
    { value: '5', label: 'Friday' }, { value: '6', label: 'Saturday' }, { value: '0', label: 'Sunday' },
];
const FREQUENCIES: ReadonlyArray<{ value: ReportFrequency; label: string }> = [
    { value: 'weekly', label: 'Weekly' }, { value: 'fortnightly', label: 'Fortnightly' }, { value: 'monthly', label: 'Monthly' },
];
const MONTH_DAYS = Array.from({ length: 28 }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }));
const TIMES = Array.from({ length: 96 }, (_, i) => {
    const hour = Math.floor(i / 4);
    const minute = String((i % 4) * 15).padStart(2, '0');
    return { value: `${String(hour).padStart(2, '0')}:${minute}`, label: `${hour % 12 || 12}:${minute} ${hour < 12 ? 'am' : 'pm'}` };
});

function ScheduleCard({ orgId, onProvisioned }: { orgId: string; onProvisioned: (on: boolean) => void }) {
    const [state, setState] = useState<ScheduleState | null>(null);
    const [draft, setDraft] = useState<ReportSchedule | null>(null);
    const [coverage, setCoverage] = useState('7');
    const [loadError, setLoadError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);
    const [savedNote, setSavedNote] = useState(false);

    const accept = useCallback((next: ScheduleState) => {
        setState(next);
        setDraft(next.schedule);
        setCoverage(String(next.schedule.coverageDays));
        onProvisioned(next.provisioned);
    }, [onProvisioned]);

    const load = useCallback(async (signal?: AbortSignal) => {
        setLoadError(null);
        try {
            accept(await getJson<ScheduleState>(`${API}/schedule?orgId=${encodeURIComponent(orgId)}`, 'Could not read the schedule.', signal));
        } catch (err) {
            if (!signal?.aborted) setLoadError(messageOf(err, 'Could not read the schedule.'));
        }
    }, [orgId, accept]);

    useEffect(() => {
        const controller = new AbortController();
        void load(controller.signal);
        return () => controller.abort();
    }, [load]);

    const change = (patch: Partial<ReportSchedule>) => {
        setDraft(d => (d ? { ...d, ...patch } : d));
        setSaveError(null);
        setSavedNote(false);
    };

    const days = Number(coverage);
    const coverageOk = Number.isInteger(days) && days >= 1 && days <= MAX_DAYS;
    const current = draft ? { ...draft, coverageDays: days } : null;
    const dirty = !!state && !!current && JSON.stringify(current) !== JSON.stringify(state.schedule);

    const save = async () => {
        if (!current || !coverageOk) return;
        setSaving(true);
        setSaveError(null);
        setSavedNote(false);
        try {
            const res = await send(`${API}/schedule`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ organization_id: orgId, schedule: current }) });
            if (!res.ok) throw new Error(await problemWith(res, 'Could not save the schedule.'));
            accept(await res.json());
            setSavedNote(true);
        } catch (err) {
            setSaveError(messageOf(err, 'Could not save the schedule.'));
        } finally {
            setSaving(false);
        }
    };

    const off = state?.provisioned === false;
    const frequency = draft?.frequency ?? 'weekly';

    return (
        <Card icon={<CalendarClock className="h-4 w-4" />} title="Schedule" description="Scheduled reports are not emailed. They appear under Saved reports.">
            {loadError && (
                <div className="space-y-2">
                    <Banner kind="error">{loadError}</Banner>
                    <button type="button" onClick={() => void load()} className="text-xs font-bold text-indigo-600 hover:underline dark:text-indigo-400">Try again</button>
                </div>
            )}
            {!state && !loadError && <div className="flex items-center gap-x-2 text-sm text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>}
            {off && <CalmNote>Scheduling switches on after the database update is run. You can still generate and download reports above.</CalmNote>}

            {draft && (
                // A disabled fieldset also disables the button inside each SelectMenu.
                <fieldset disabled={off || saving} className={`min-w-0 space-y-4 ${off ? 'opacity-50' : ''}`}>
                    <div className="flex items-center justify-between gap-x-3">
                        <div className="min-w-0">
                            <p className="text-sm font-bold text-zinc-900 dark:text-zinc-100">Generate reports on a schedule</p>
                            <p className="text-xs text-zinc-500">{draft.enabled ? 'On' : 'Off'}</p>
                        </div>
                        <button type="button" role="switch" aria-checked={draft.enabled} aria-label="Generate reports on a schedule" onClick={() => change({ enabled: !draft.enabled })}
                            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed">
                            <span className={`inline-flex h-6 w-11 items-center rounded-full transition-colors ${draft.enabled ? 'bg-indigo-600' : 'bg-zinc-300 dark:bg-zinc-700'}`}>
                                <span className={`inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${draft.enabled ? 'translate-x-[22px]' : 'translate-x-0.5'}`} />
                            </span>
                        </button>
                    </div>

                    <div className="grid gap-x-3 gap-y-3 sm:grid-cols-2">
                        <SelectMenu label="How often" value={frequency} options={[...FREQUENCIES]} onChange={v => change({ frequency: v as ReportFrequency })} />
                        {frequency === 'monthly'
                            ? <SelectMenu label="Day of the month" value={String(draft.dayOfMonth)} options={MONTH_DAYS} onChange={v => change({ dayOfMonth: Number(v) })} />
                            : <SelectMenu label="Day of the week" value={String(draft.dayOfWeek)} options={[...WEEKDAYS]} onChange={v => change({ dayOfWeek: Number(v) })} />}
                        <SelectMenu label="Time (IST)" value={draft.timeIst} options={TIMES} onChange={v => change({ timeIst: v })} />
                        <label className="flex flex-col gap-1.5">
                            <span className={LABEL}>Days each report covers</span>
                            <input type="number" inputMode="numeric" min={1} max={MAX_DAYS} step={1} value={coverage} onChange={e => { setCoverage(e.target.value); setSaveError(null); setSavedNote(false); }} className={`${FIELD} tabular-nums`} />
                        </label>
                    </div>
                    <p className="text-xs text-zinc-500">Each report ends on the day before it runs.</p>

                    {!coverageOk && <Banner kind="error">Each report can cover 1 to {MAX_DAYS} days.</Banner>}
                    {saveError && <Banner kind="error">{saveError}</Banner>}
                    {savedNote && !dirty && <Banner kind="ok">Schedule saved.</Banner>}

                    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-3">
                        <p className="min-w-0 text-xs font-semibold text-zinc-600 dark:text-zinc-400">
                            {state?.nextRunAt ? <>Next report: <span className="tabular-nums text-zinc-900 dark:text-zinc-100">{momentLabel(state.nextRunAt)}</span></> : 'No report is scheduled.'}
                        </p>
                        <button type="button" onClick={save} disabled={saving || !dirty || !coverageOk} className={PRIMARY}>
                            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                            {saving ? 'Saving…' : 'Save schedule'}
                        </button>
                    </div>
                </fieldset>
            )}
        </Card>
    );
}

function SavedCard({ orgId, version, onProvisioned }: { orgId: string; version: number; onProvisioned: (on: boolean) => void }) {
    const [reports, setReports] = useState<SavedReport[] | null>(null);
    const [provisioned, setProvisioned] = useState(true);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [openingId, setOpeningId] = useState<string | null>(null);
    const latest = useRef(0);

    const load = useCallback(async () => {
        const ticket = ++latest.current;
        setLoading(true);
        setError(null);
        try {
            const json = await getJson<{ provisioned: boolean; reports: SavedReport[] }>(`${API}/saved?orgId=${encodeURIComponent(orgId)}`, 'Could not read saved reports.');
            if (ticket !== latest.current) return;
            setProvisioned(json.provisioned);
            setReports(json.reports);
            onProvisioned(json.provisioned);
        } catch (err) {
            if (ticket === latest.current) setError(messageOf(err, 'Could not read saved reports.'));
        } finally {
            if (ticket === latest.current) setLoading(false);
        }
    }, [orgId, onProvisioned]);

    useEffect(() => { void load(); }, [load, version]);

    const open = async (id: string) => {
        setOpeningId(id);
        setError(null);
        try {
            const link = await getJson<{ url: string; fileName: string }>(`${API}/saved/${encodeURIComponent(id)}?orgId=${encodeURIComponent(orgId)}`, 'Could not create the download link.');
            // The link is sent as an attachment, so this starts a download and leaves this page where it is. A new
            // window would be stopped by popup blockers, because it no longer follows directly from the click.
            window.location.assign(link.url);
        } catch (err) {
            setError(messageOf(err, 'Could not create the download link.'));
        } finally {
            setOpeningId(null);
        }
    };

    return (
        <Card icon={<Download className="h-4 w-4" />} title="Saved reports" description="Reports you generate and scheduled reports, newest first."
            action={(
                <button type="button" onClick={() => void load()} disabled={loading || !provisioned} aria-label="Refresh saved reports" className={ICON_BUTTON}>
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                </button>
            )}>
            {error && <Banner kind="error">{error}</Banner>}
            {!provisioned && <CalmNote>Saved reports switch on after the database update is run. Until then, keep the PDFs you download.</CalmNote>}
            {provisioned && reports?.length === 0 && !error && (
                <p className="rounded-2xl border border-dashed border-zinc-300 px-6 py-6 text-center text-xs text-zinc-500 dark:border-zinc-700">No saved reports yet.</p>
            )}
            {provisioned && !!reports?.length && (
                <ul className="-my-1 max-h-[26rem] divide-y divide-zinc-100 overflow-y-auto dark:divide-zinc-800">
                    {reports.map(r => {
                        const size = sizeLabel(r.fileSize);
                        return (
                            <li key={r.id} className="flex items-center gap-x-3 py-2.5">
                                <div className="min-w-0 flex-1">
                                    <p className="text-sm font-bold tabular-nums text-zinc-900 dark:text-zinc-100">{dayLabel(r.periodFrom)} to {dayLabel(r.periodTo)}</p>
                                    <p className="text-[11px] text-zinc-500">{r.trigger === 'scheduled' ? 'Scheduled' : 'Manual'}{size ? ` · ${size}` : ''} · {momentLabel(r.createdAt)}</p>
                                </div>
                                {r.status === 'failed'
                                    ? <span className="shrink-0 rounded-full bg-rose-100 px-2.5 py-0.5 text-[11px] font-black text-rose-700 dark:bg-rose-950/60 dark:text-rose-300">Failed</span>
                                    : (
                                        <button type="button" onClick={() => void open(r.id)} disabled={!!openingId} aria-label={`Download report for ${dayLabel(r.periodFrom)} to ${dayLabel(r.periodTo)}`} className={ICON_BUTTON}>
                                            {openingId === r.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                                        </button>
                                    )}
                            </li>
                        );
                    })}
                </ul>
            )}
        </Card>
    );
}

export default function TaskManagerReportTab({ orgId }: { orgId: string }) {
    const [version, setVersion] = useState(0);
    const [savedOn, setSavedOn] = useState<boolean | null>(null);
    const noteSavedOn = useCallback((on: boolean) => setSavedOn(on), []);
    const refreshSaved = useCallback(() => setVersion(v => v + 1), []);

    if (!orgId) {
        return <div className="flex items-center gap-x-2 px-6 py-6 text-sm text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>;
    }
    return (
        <div className="space-y-4">
            <GenerateCard orgId={orgId} savedOn={savedOn} onGenerated={refreshSaved} />
            <div className="grid items-start gap-x-4 gap-y-4 lg:grid-cols-2">
                <ScheduleCard orgId={orgId} onProvisioned={noteSavedOn} />
                <SavedCard orgId={orgId} version={version} onProvisioned={noteSavedOn} />
            </div>
        </div>
    );
}
