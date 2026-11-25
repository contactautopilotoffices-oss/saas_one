'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, MapPin, RefreshCw, Users, Video } from 'lucide-react';
import { INTERVIEW_STATUS_LABELS, type CalendarInterview, type RecruitmentDashboard } from '@/backend/lib/candidates/types';
import { api, qs } from '@/frontend/components/candidates/api';
import { Spinner } from '@/frontend/components/candidates/ui';
import type { RecruitmentView } from '@/frontend/components/candidates/CandidateSearchTab';
import { BTN, GLASS, H2, INK2, INK3, plural, ROW_HOVER, TONE, TRACK, type Tone } from './hub-ui';

/*
 * The Hub's Interviews tab (owner 2026-11-25): the interviews on a calendar in India time, as one day, one week
 * (Monday to Sunday) or one month, coloured by how they happen (online, in person, hybrid), with the chosen interview's
 * details beside it and the scorecards still to come in. Every interview is a real one from the records (cancelled ones
 * are left out). The calendar shows when each starts; the app does not keep an end time, so each takes one hour's row.
 */

type CalView = 'day' | 'week' | 'month';

const DAY = 86_400_000;
const IST = 5.5 * 3_600_000;
const ROW = 64; // px per hour
const ist = (d: Date | number) => new Date((typeof d === 'number' ? d : d.getTime()) + IST);
const nowMs = () => Date.now();

/** Midnight India time of the day `ms` falls on, as an instant. */
function dayStart(ms: number): number {
    const p = ist(ms);
    return Date.UTC(p.getUTCFullYear(), p.getUTCMonth(), p.getUTCDate()) - IST;
}

/** The days a view shows around `anchor` (an India-time midnight): one day, Monday to Sunday, or the full weeks covering the month (at most 42 days, the server's cap). */
function rangeOf(view: CalView, anchor: number): { from: number; to: number } {
    if (view === 'day') return { from: anchor, to: anchor + DAY };
    if (view === 'week') {
        const from = anchor - ((ist(anchor).getUTCDay() + 6) % 7) * DAY;
        return { from, to: from + 7 * DAY };
    }
    const p = ist(anchor);
    const first = Date.UTC(p.getUTCFullYear(), p.getUTCMonth(), 1) - IST;
    const last = Date.UTC(p.getUTCFullYear(), p.getUTCMonth() + 1, 1) - IST - DAY;
    return { from: first - ((ist(first).getUTCDay() + 6) % 7) * DAY, to: last + (7 - ((ist(last).getUTCDay() + 6) % 7)) * DAY };
}

/** Moves `anchor` one day, week or month back or forward. */
function step(view: CalView, anchor: number, dir: 1 | -1): number {
    if (view === 'day') return anchor + dir * DAY;
    if (view === 'week') return anchor + dir * 7 * DAY;
    const p = ist(anchor);
    return Date.UTC(p.getUTCFullYear(), p.getUTCMonth() + dir, 1) - IST;
}

const MODES: Array<{ key: string; label: string; tone: Tone; match: (m: string | null) => boolean }> = [
    { key: 'online', label: 'Online', tone: 'b', match: m => m === 'online' || m === 'video' || m === 'phone' },
    { key: 'in_person', label: 'In person', tone: 'a', match: m => m === 'in_person' },
    { key: 'hybrid', label: 'Hybrid', tone: 'p', match: m => m === 'hybrid' },
];
const modeOf = (m: string | null) => MODES.find(x => x.match(m)) ?? { key: 'other', label: 'Not set', tone: 'v' as Tone };
const toneOf = (iv: CalendarInterview): Tone => (iv.status === 'no_show' ? 'c' : modeOf(iv.mode).tone);
const time = (iso: string | number) => new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });
const dayLabel = (ms: number, opts: Intl.DateTimeFormatOptions) => new Date(ms).toLocaleDateString('en-IN', { ...opts, timeZone: 'Asia/Kolkata' });
const monthYear = (ms: number) => `${dayLabel(ms, { month: 'long' })} ${dayLabel(ms, { year: 'numeric' })}`;
const hourLabel = (h: number) => (h === 0 ? '12 am' : h === 12 ? '12 pm' : h > 12 ? `${h - 12} pm` : `${h} am`);
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';
const roundLine = (iv: CalendarInterview) => [iv.round ?? 'Interview', iv.positionTitle].filter(Boolean).join(' · ');
const fullLabel = (iv: CalendarInterview) => `${iv.candidateName}, ${dayLabel(new Date(iv.at).getTime(), { weekday: 'short', day: 'numeric', month: 'short' })} ${time(iv.at)}, ${roundLine(iv)}, ${modeOf(iv.mode).label}${iv.status === 'no_show' ? ', no-show' : ''}`;

// Local finishing touches: a visible keyboard focus ring, and no movement for people who ask for less of it.
const FOCUS = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4f46e5]';
const CALM = 'motion-reduce:transition-none motion-reduce:hover:translate-y-0 motion-reduce:hover:scale-100';
const LINE = 'border-[#17152d]/10 dark:border-white/[.14]';
const PAST = 'bg-[repeating-linear-gradient(135deg,rgba(23,21,45,.04)_0_6px,transparent_6px_12px)] dark:bg-[repeating-linear-gradient(135deg,rgba(255,255,255,.04)_0_6px,transparent_6px_12px)]';
const VIEWS: Array<{ key: CalView; label: string }> = [{ key: 'day', label: 'Day' }, { key: 'week', label: 'Week' }, { key: 'month', label: 'Month' }];

export default function HubInterviews({ orgId, data, onOpen }: { orgId: string; data: RecruitmentDashboard; onOpen: (view: RecruitmentView) => void }) {
    const [view, setView] = useState<CalView>('week');
    const [now, setNow] = useState(nowMs);
    const [anchor, setAnchor] = useState(() => dayStart(nowMs()));
    const [loaded, setLoaded] = useState<{ key: string; items: CalendarInterview[] } | null>(null);
    const [error, setError] = useState('');
    const [nonce, setNonce] = useState(0);
    const [picked, setPicked] = useState<string | null>(null);
    const { from, to } = rangeOf(view, anchor);
    const today = dayStart(now);
    const atToday = rangeOf(view, today).from === from;
    // The interviews for the range on screen; null while that range is still loading.
    const fetchKey = `${orgId}|${from}|${to}|${nonce}`;
    const list = loaded?.key === fetchKey ? loaded.items : null;

    // Keeps the red "now" line moving.
    useEffect(() => {
        const t = setInterval(() => setNow(Date.now()), 60_000);
        return () => clearInterval(t);
    }, []);

    useEffect(() => {
        const ctrl = new AbortController();
        const key = `${orgId}|${from}|${to}|${nonce}`;
        void api<{ interviews: CalendarInterview[] }>(`/api/candidates/interviews${qs({ orgId, from: new Date(from).toISOString(), to: new Date(to).toISOString() })}`, { signal: ctrl.signal }).then(res => {
            if (ctrl.signal.aborted) return;
            if (!res.ok) { if (!res.aborted) setError(res.error); return; }
            setError('');
            setLoaded({ key, items: res.data.interviews });
        });
        return () => ctrl.abort();
    }, [orgId, from, to, nonce]);

    // Interviews by the India-time day they start on, earliest first.
    const byDay = useMemo(() => {
        const out = new Map<number, CalendarInterview[]>();
        const sorted = [...(list ?? [])].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
        for (const iv of sorted) { const d = dayStart(new Date(iv.at).getTime()); out.set(d, [...(out.get(d) ?? []), iv]); }
        return out;
    }, [list]);

    const days = useMemo(() => Array.from({ length: Math.round((to - from) / DAY) }, (_, i) => from + i * DAY), [from, to]);

    // The hours shown: 9 am to 7 pm, stretched to fit any interview outside them.
    const [startHour, endHour] = useMemo(() => {
        let lo = 9, hi = 19;
        for (const iv of list ?? []) { const h = ist(new Date(iv.at)).getUTCHours(); lo = Math.min(lo, h); hi = Math.max(hi, h + 1); }
        return [lo, hi];
    }, [list]);
    const hours = Array.from({ length: endHour - startHour }, (_, i) => startHour + i);
    const nowIst = ist(now);
    const nowHour = nowIst.getUTCHours() + nowIst.getUTCMinutes() / 60;
    const showNow = view !== 'month' && days.includes(today) && nowHour >= startHour && nowHour < endHour;
    const nowTop = (nowHour - startHour) * ROW;

    // Where each interview sits on the time grid, side by side when two start in the same hour.
    const placed = useMemo(() => {
        const out = new Map<number, Array<{ iv: CalendarInterview; top: number; lane: number; lanes: number }>>();
        if (view === 'month') return out;
        for (const d of days) {
            const dayItems = byDay.get(d) ?? [];
            const byHour = new Map<number, CalendarInterview[]>();
            for (const iv of dayItems) { const h = ist(new Date(iv.at)).getUTCHours(); byHour.set(h, [...(byHour.get(h) ?? []), iv]); }
            out.set(d, dayItems.map(iv => {
                const p = ist(new Date(iv.at));
                const group = byHour.get(p.getUTCHours()) ?? [iv];
                return { iv, top: (p.getUTCHours() + p.getUTCMinutes() / 60 - startHour) * ROW, lane: group.indexOf(iv), lanes: group.length };
            }));
        }
        return out;
    }, [view, days, byDay, startHour]);

    const sel = (list ?? []).find(iv => iv.id === picked) ?? null;
    const upcoming = (list ?? []).filter(iv => new Date(iv.at).getTime() >= now && iv.status === 'scheduled').slice(0, 6);
    const count = list?.length ?? 0;
    const lastDay = to - DAY;
    const title = view === 'day'
        ? `${dayLabel(anchor, { weekday: 'short' })} ${dayLabel(anchor, { day: 'numeric' })} ${monthYear(anchor)}`
        : view === 'month'
            ? monthYear(anchor)
            : monthYear(from) === monthYear(lastDay)
                ? monthYear(from)
                : dayLabel(from, { year: 'numeric' }) === dayLabel(lastDay, { year: 'numeric' })
                    ? `${dayLabel(from, { month: 'long' })} to ${monthYear(lastDay)}`
                    : `${monthYear(from)} to ${monthYear(lastDay)}`;
    const subtitle = view === 'week' ? `${dayLabel(from, { day: 'numeric', month: 'short' })} to ${dayLabel(lastDay, { day: 'numeric', month: 'short' })} · ` : '';
    const period = view === 'day' ? 'day' : view === 'week' ? 'week' : 'month';
    const openDay = (d: number) => { setAnchor(d); setView('day'); };

    const card = (iv: CalendarInterview, top: number, lane: number, lanes: number, wide: boolean) => (
        <button
            key={iv.id}
            type="button"
            onClick={() => setPicked(iv.id)}
            aria-pressed={picked === iv.id}
            aria-label={fullLabel(iv)}
            title={fullLabel(iv)}
            className={`absolute flex overflow-hidden rounded-xl border-l-[3px] border-current px-2 py-1.5 text-left text-xs leading-tight shadow-[0_4px_12px_rgba(60,60,120,.08)] transition-transform hover:z-20 hover:scale-[1.02] ${CALM} ${FOCUS} ${TONE[toneOf(iv)]} ${picked === iv.id ? 'z-20 ring-2 ring-[#4f46e5]' : ''} ${iv.status === 'done' ? 'opacity-70' : ''} ${wide ? 'items-center gap-3' : 'flex-col'}`}
            style={{ top: top + 2, height: ROW - 4, left: `calc(${(lane / lanes) * 100}% + 3px)`, width: `calc(${100 / lanes}% - 6px)` }}
        >
            {wide ? (
                <>
                    <span aria-hidden className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/75 text-[11px] font-extrabold dark:bg-white/15">{initials(iv.candidateName)}</span>
                    <span className="block min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-extrabold">{iv.candidateName}</span>
                        <span className="block truncate opacity-90">{roundLine(iv)}</span>
                        <span className="flex min-w-0 items-center gap-1 opacity-90"><Users className="h-3 w-3 shrink-0" aria-hidden /><span className="truncate">{iv.panel.length ? iv.panel.join(', ') : 'Panel not set'}</span></span>
                    </span>
                    <span className="hidden min-w-0 max-w-[40%] shrink-0 flex-col items-end text-right sm:flex">
                        <span className="font-extrabold tabular-nums">{time(iv.at)}</span>
                        <span className="flex max-w-full items-center gap-1 opacity-90">{modeOf(iv.mode).key === 'in_person' ? <MapPin className="h-3 w-3 shrink-0" aria-hidden /> : <Video className="h-3 w-3 shrink-0" aria-hidden />}<span className="truncate">{[modeOf(iv.mode).label, iv.venue].filter(Boolean).join(' · ')}</span></span>
                    </span>
                </>
            ) : (
                <>
                    <span className="flex min-w-0 items-center gap-1.5">
                        <span aria-hidden className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/75 text-[9px] font-extrabold dark:bg-white/15">{initials(iv.candidateName)}</span>
                        <span className="truncate font-extrabold">{iv.candidateName}</span>
                    </span>
                    <span className="mt-0.5 block truncate opacity-90">{roundLine(iv)}</span>
                    <span className="mt-auto block truncate font-bold tabular-nums opacity-90">{time(iv.at)}</span>
                </>
            )}
        </button>
    );

    const timeGrid = (
        <div className="overflow-x-auto">
            <div className={`relative ${view === 'week' ? 'min-w-[820px]' : 'min-w-[320px]'}`} aria-busy={list === null}>
                <div className={`grid border-b ${LINE} pb-2`} style={{ gridTemplateColumns: `64px repeat(${days.length}, minmax(0, 1fr))` }}>
                    <span className={`self-end text-xs font-bold ${INK3}`}>Time</span>
                    {days.map(d => (
                        <span key={d} className="px-1 text-center text-[12px] font-bold">
                            <span className={`inline-block rounded-full px-2.5 py-1 ${d === today ? 'bg-[#4f46e5]/10 text-[#4f46e5] ring-1 ring-[#4f46e5]/30 dark:text-[#a5b4fc]' : d < today ? INK3 : ''}`}>
                                {view === 'day' ? `${dayLabel(d, { weekday: 'long' })}, ${dayLabel(d, { day: '2-digit', month: 'long' })}` : `${dayLabel(d, { weekday: 'long' })}, ${dayLabel(d, { day: '2-digit' })}`}
                            </span>
                        </span>
                    ))}
                </div>
                <div className="relative grid" style={{ gridTemplateColumns: `64px repeat(${days.length}, minmax(0, 1fr))`, height: hours.length * ROW }}>
                    <div className="relative">
                        {hours.map((h, i) => <span key={h} className={`absolute left-0 text-[11px] ${INK3}`} style={{ top: i * ROW + 2 }}>{hourLabel(h)}</span>)}
                        {showNow && <span className={`absolute left-0 z-30 -translate-y-1/2 rounded-full px-1.5 py-0.5 text-[10px] font-extrabold tabular-nums ${TONE.c}`} style={{ top: nowTop }}>{time(now)}</span>}
                    </div>
                    {days.map(d => (
                        <div key={d} className={`relative border-l ${LINE} ${d < today ? PAST : d === today ? 'bg-[#4f46e5]/[.04]' : ''}`}>
                            {hours.map((h, i) => <span key={h} aria-hidden className="absolute inset-x-0 border-t border-dashed border-[#17152d]/[.07] dark:border-white/[.08]" style={{ top: i * ROW }} />)}
                            {d === today && showNow && <span aria-hidden className={`absolute inset-x-0 top-0 ${PAST}`} style={{ height: nowTop }} />}
                            {d === today && showNow && (
                                <span aria-hidden className="absolute inset-x-0 z-10 h-0.5 bg-[#f87171]" style={{ top: nowTop }}>
                                    <span className="absolute -left-1 -top-[3px] h-2 w-2 rounded-full bg-[#f87171]" />
                                </span>
                            )}
                            {(placed.get(d) ?? []).map(({ iv, top, lane, lanes }) => card(iv, top, lane, lanes, view === 'day'))}
                        </div>
                    ))}
                    {showNow && <span aria-hidden className="pointer-events-none absolute left-16 right-0 h-px bg-[#f87171]/40" style={{ top: nowTop }} />}
                    {list === null && <span className="absolute inset-0 flex items-center justify-center"><Spinner className="h-5 w-5" /></span>}
                </div>
                {view === 'day' && list !== null && (byDay.get(anchor) ?? []).length === 0 && <p className={`m-0 mt-3 text-sm ${INK3}`}>No interviews on this day.</p>}
            </div>
        </div>
    );

    const monthMonth = ist(anchor).getUTCMonth();
    const monthGrid = (
        <div className="overflow-x-auto">
            <div className="relative min-w-[700px]" aria-busy={list === null}>
                <div className={`grid grid-cols-7 border-b ${LINE} pb-2`}>
                    {days.slice(0, 7).map(d => <span key={d} className={`text-center text-xs font-bold ${INK3}`}>{dayLabel(d, { weekday: 'short' })}</span>)}
                </div>
                <div className={`grid grid-cols-7 border-l ${LINE}`}>
                    {days.map(d => {
                        const items = byDay.get(d) ?? [];
                        const inMonth = ist(d).getUTCMonth() === monthMonth;
                        const dateText = dayLabel(d, { weekday: 'long', day: 'numeric', month: 'long' });
                        return (
                            <div key={d} className={`flex min-h-[116px] min-w-0 flex-col gap-1 border-b border-r ${LINE} p-1.5 ${d < today ? PAST : d === today ? 'bg-[#4f46e5]/[.04]' : ''} ${inMonth ? '' : 'opacity-50'}`}>
                                <button
                                    type="button"
                                    onClick={() => openDay(d)}
                                    aria-label={`Open ${dateText} in the day view`}
                                    className={`flex h-7 min-w-7 items-center justify-center self-start rounded-full px-1.5 text-xs font-extrabold tabular-nums ${FOCUS} ${d === today ? 'bg-[#4f46e5] text-white' : `${ROW_HOVER} ${inMonth ? '' : INK3}`}`}
                                >
                                    {dayLabel(d, { day: 'numeric' })}
                                </button>
                                {items.slice(0, 3).map(iv => (
                                    <button
                                        key={iv.id}
                                        type="button"
                                        onClick={() => setPicked(iv.id)}
                                        aria-pressed={picked === iv.id}
                                        aria-label={fullLabel(iv)}
                                        title={fullLabel(iv)}
                                        className={`flex w-full min-w-0 items-center gap-1 rounded-md border-l-[3px] border-current px-1.5 py-0.5 text-left text-[11px] leading-tight ${FOCUS} ${TONE[toneOf(iv)]} ${picked === iv.id ? 'ring-2 ring-[#4f46e5]' : ''} ${iv.status === 'done' ? 'opacity-70' : ''}`}
                                    >
                                        <span className="shrink-0 font-extrabold tabular-nums">{time(iv.at)}</span>
                                        <span className="truncate">{iv.candidateName}</span>
                                    </button>
                                ))}
                                {items.length > 3 && (
                                    <button type="button" onClick={() => openDay(d)} className={`self-start rounded-md px-1.5 py-0.5 text-[11px] font-bold ${INK2} ${ROW_HOVER} ${FOCUS}`}>
                                        +{items.length - 3} more
                                    </button>
                                )}
                            </div>
                        );
                    })}
                </div>
                {list === null && <span className="absolute inset-0 flex items-center justify-center"><Spinner className="h-5 w-5" /></span>}
            </div>
        </div>
    );

    return (
        <div className="flex flex-col gap-4">
            <section aria-label="Interview calendar" className={`${GLASS} p-[22px]`}>
                <div className="mb-3 grid grid-cols-1 items-center gap-3 md:grid-cols-[1fr_auto_1fr]">
                    <div role="group" aria-label="Calendar view" className={`inline-flex justify-self-start rounded-full p-1 ${TRACK}`}>
                        {VIEWS.map(v => (
                            <button
                                key={v.key}
                                type="button"
                                aria-pressed={view === v.key}
                                onClick={() => setView(v.key)}
                                className={`min-h-9 rounded-full px-4 text-sm font-bold transition-colors motion-reduce:transition-none ${FOCUS} ${view === v.key ? 'bg-[#4f46e5] text-white shadow-[0_6px_16px_rgba(79,70,229,.22)]' : INK2}`}
                            >
                                {v.label}
                            </button>
                        ))}
                    </div>
                    <div className="text-left md:text-center">
                        <h2 className={H2} aria-live="polite">{title}</h2>
                        <span className={`text-[13px] ${INK3}`}>{subtitle}{list === null ? 'Loading' : plural(count, 'interview', 'interviews')}</span>
                    </div>
                    <div className="flex items-center gap-2 md:justify-self-end">
                        <button type="button" onClick={() => setAnchor(today)} disabled={atToday} className={`${BTN} ${CALM} ${FOCUS} disabled:opacity-50`}>Today</button>
                        <button type="button" onClick={() => setAnchor(a => step(view, a, -1))} aria-label={`Previous ${period}`} className={`${BTN} ${CALM} ${FOCUS} px-3`}><ChevronLeft className="h-4 w-4" aria-hidden /></button>
                        <button type="button" onClick={() => setAnchor(a => step(view, a, 1))} aria-label={`Next ${period}`} className={`${BTN} ${CALM} ${FOCUS} px-3`}><ChevronRight className="h-4 w-4" aria-hidden /></button>
                    </div>
                </div>
                <div className="mb-3 flex flex-wrap gap-2" aria-label="How the interview happens">
                    {[...MODES, { key: 'other', label: 'Not set', tone: 'v' as Tone }].map(m => (
                        <span key={m.key} className={`rounded-full border-l-[3px] border-current px-3 py-1 text-xs font-bold ${TONE[m.tone]}`}>{m.label}</span>
                    ))}
                    <span className={`rounded-full border-l-[3px] border-current px-3 py-1 text-xs font-bold ${TONE.c}`}>No-show</span>
                </div>

                {error ? (
                    <div className="flex flex-wrap items-center gap-3" role="alert"><p className="m-0 grow text-sm font-semibold">{error}</p><button type="button" onClick={() => setNonce(n => n + 1)} className={`${BTN} ${CALM} ${FOCUS}`}><RefreshCw className="h-4 w-4" aria-hidden />Try again</button></div>
                ) : view === 'month' ? monthGrid : timeGrid}
                <p className={`mb-0 mt-3 text-xs ${INK3}`}>
                    {view === 'month'
                        ? 'Each chip shows when the interview starts; pick a date to see that day in full.'
                        : 'The app keeps only when each interview starts, not how long it runs, so every block is drawn one hour tall and shows the start time. The red line is now.'}
                </p>
            </section>

            <div className="flex flex-wrap items-stretch gap-4">
                <section aria-label="Interview details" className={`${GLASS} min-w-0 flex-[1.2_1_380px] p-[22px]`}>
                    {sel ? (
                        <>
                            <div className="mb-1 flex flex-wrap items-center gap-2">
                                <h2 className={`${H2} grow`}>{sel.candidateName}</h2>
                                <span className={`rounded-full px-3 py-1 text-xs font-extrabold ${TONE[sel.status === 'no_show' ? 'c' : sel.status === 'done' ? 'v' : 'b']}`}>{INTERVIEW_STATUS_LABELS[sel.status]}</span>
                            </div>
                            <p className={`m-0 text-[13px] ${INK2}`}>{roundLine(sel)}</p>
                            <dl className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
                                <div><dt className={`text-xs font-bold ${INK3}`}>When</dt><dd className="m-0 font-bold">{dayLabel(new Date(sel.at).getTime(), { weekday: 'short', day: 'numeric', month: 'short' })}, {time(sel.at)}</dd></div>
                                <div><dt className={`text-xs font-bold ${INK3}`}>How</dt><dd className="m-0 flex items-center gap-1.5 font-bold">{modeOf(sel.mode).key === 'in_person' ? <MapPin className="h-4 w-4" aria-hidden /> : <Video className="h-4 w-4" aria-hidden />}{modeOf(sel.mode).label}{sel.venue ? <span className={`font-normal ${INK2}`}> · {sel.venue}</span> : null}</dd></div>
                                <div><dt className={`text-xs font-bold ${INK3}`}>Panel</dt><dd className="m-0 flex items-center gap-1.5 font-bold"><Users className="h-4 w-4 shrink-0" aria-hidden /><span className="truncate">{sel.panel.length ? sel.panel.join(', ') : 'Not set'}</span></dd></div>
                            </dl>
                            <div className="mt-4 flex flex-wrap gap-2.5">
                                <button type="button" onClick={() => onOpen('pipeline')} className={`${BTN} ${CALM} ${FOCUS}`}>Open the pipeline</button>
                            </div>
                        </>
                    ) : (
                        <>
                            <h2 className={`${H2} mb-1`}>Coming up</h2>
                            <p className={`m-0 mb-2 text-[13px] ${INK3}`}>Pick an interview on the calendar to see its details.</p>
                            {upcoming.length === 0 && <p className={`m-0 text-sm ${INK3}`}>{to <= now ? `This ${period} is over.` : `Nothing else is booked this ${period}.`}</p>}
                            <div className="flex flex-col gap-1">
                                {upcoming.map(iv => (
                                    <button key={iv.id} type="button" onClick={() => setPicked(iv.id)} className={`flex items-center gap-3 rounded-2xl p-2 text-left ${ROW_HOVER} ${FOCUS}`}>
                                        <span className={`flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-[14px] text-[11px] font-extrabold leading-tight ${TONE[modeOf(iv.mode).tone]}`}>
                                            <span>{dayLabel(new Date(iv.at).getTime(), { day: 'numeric' })}</span><span>{dayLabel(new Date(iv.at).getTime(), { month: 'short' })}</span>
                                        </span>
                                        <span className="block min-w-0 flex-1"><span className="block truncate font-extrabold">{iv.candidateName}</span><span className={`block truncate text-xs ${INK3}`}>{[iv.round ?? 'Interview', iv.positionTitle, iv.panel.length ? `with ${iv.panel.join(', ')}` : null].filter(Boolean).join(' · ')}</span></span>
                                        <span className="shrink-0 font-extrabold tabular-nums">{time(iv.at)}</span>
                                    </button>
                                ))}
                            </div>
                        </>
                    )}
                </section>

                <section aria-label="Scorecards still to come in" className={`${GLASS} min-w-0 flex-[1_1_320px] p-[22px]`}>
                    <div className="mb-2 flex flex-wrap items-baseline gap-2.5"><h2 className={`${H2} grow`}>Scorecards still to come in</h2><span className={`text-[13px] ${INK3}`}>{data.today.scorecardsPending.length}</span></div>
                    {data.today.scorecardsPending.length === 0 && <p className={`m-0 text-sm ${INK3}`}>Every scorecard is in.</p>}
                    <div className="flex flex-col gap-1">
                        {data.today.scorecardsPending.slice(0, 8).map((s, k) => (
                            <div key={`${s.interviewId}-${k}`} className="flex items-center gap-3 rounded-2xl p-2">
                                <span className={`flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[13px] text-xs font-extrabold ${TONE.a}`}>{dayLabel(new Date(s.at).getTime(), { day: 'numeric' })}</span>
                                <span className="block min-w-0 flex-1"><span className="block truncate font-extrabold">{s.panelName ?? 'An interviewer'}</span><span className={`block truncate text-xs ${INK3}`}>for {s.candidateName} · {s.round ?? 'Interview'}</span></span>
                            </div>
                        ))}
                    </div>
                    <p className={`mb-0 mt-2 text-xs ${INK3}`}>The app already reminds interviewers on its own; this is who it is still waiting for.</p>
                </section>
            </div>
        </div>
    );
}
