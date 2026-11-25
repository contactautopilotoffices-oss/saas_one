'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, MapPin, RefreshCw, Users, Video } from 'lucide-react';
import { INTERVIEW_STATUS_LABELS, type CalendarInterview, type RecruitmentDashboard } from '@/backend/lib/candidates/types';
import { api, qs } from '@/frontend/components/candidates/api';
import { Spinner } from '@/frontend/components/candidates/ui';
import type { RecruitmentView } from '@/frontend/components/candidates/CandidateSearchTab';
import { BTN, GLASS, H2, INK2, INK3, plural, ROW_HOVER, TONE, type Tone } from './hub-ui';

/*
 * The Hub's Interviews tab (owner 2026-11-25): the week's interviews on a calendar, Monday to Sunday in India time,
 * coloured by how they happen (online, in person, hybrid), with the chosen interview's details beside it and the
 * scorecards still to come in. Every interview is a real one from the records (cancelled ones are left out). The
 * calendar shows when each starts; the app does not keep an end time, so each takes one hour's row.
 */

const DAY = 86_400_000;
const IST = 5.5 * 3_600_000;
const ROW = 56; // px per hour
const ist = (d: Date | number) => new Date((typeof d === 'number' ? d : d.getTime()) + IST);

/** Monday 00:00 India time of the week `offset` weeks from this one, as an instant. */
function weekStart(offset: number): number {
    const now = ist(Date.now());
    const dow = (now.getUTCDay() + 6) % 7;
    return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - dow + offset * 7) - IST;
}

const MODES: Array<{ key: string; label: string; tone: Tone; match: (m: string | null) => boolean }> = [
    { key: 'online', label: 'Online', tone: 'b', match: m => m === 'online' || m === 'video' || m === 'phone' },
    { key: 'in_person', label: 'In person', tone: 'a', match: m => m === 'in_person' },
    { key: 'hybrid', label: 'Hybrid', tone: 'p', match: m => m === 'hybrid' },
];
const modeOf = (m: string | null) => MODES.find(x => x.match(m)) ?? { key: 'other', label: 'Not set', tone: 'v' as Tone };
const time = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });
const dayLabel = (ms: number, opts: Intl.DateTimeFormatOptions) => new Date(ms).toLocaleDateString('en-IN', { ...opts, timeZone: 'Asia/Kolkata' });

export default function HubInterviews({ orgId, data, onOpen }: { orgId: string; data: RecruitmentDashboard; onOpen: (view: RecruitmentView) => void }) {
    const [offset, setOffset] = useState(0);
    const [list, setList] = useState<CalendarInterview[] | null>(null);
    const [error, setError] = useState('');
    const [nonce, setNonce] = useState(0);
    const [picked, setPicked] = useState<string | null>(null);
    const from = weekStart(offset);
    const to = from + 7 * DAY;

    useEffect(() => {
        const ctrl = new AbortController();
        setList(null);
        void api<{ interviews: CalendarInterview[] }>(`/api/candidates/interviews${qs({ orgId, from: new Date(from).toISOString(), to: new Date(to).toISOString() })}`, { signal: ctrl.signal }).then(res => {
            if (ctrl.signal.aborted) return;
            if (!res.ok) { if (!res.aborted) setError(res.error); return; }
            setError('');
            setList(res.data.interviews);
        });
        return () => ctrl.abort();
    }, [orgId, from, to, nonce]);

    // The hours shown: 9 am to 7 pm, stretched to fit any interview outside them.
    const [startHour, endHour] = useMemo(() => {
        let lo = 9, hi = 19;
        for (const iv of list ?? []) { const h = ist(new Date(iv.at)).getUTCHours(); lo = Math.min(lo, h); hi = Math.max(hi, h + 1); }
        return [lo, hi];
    }, [list]);
    const hours = Array.from({ length: endHour - startHour }, (_, i) => startHour + i);
    const days = Array.from({ length: 7 }, (_, i) => from + i * DAY);
    const todayStart = weekStart(0) + ((ist(Date.now()).getUTCDay() + 6) % 7) * DAY;
    const nowIst = ist(Date.now());
    const nowHour = nowIst.getUTCHours() + nowIst.getUTCMinutes() / 60;

    // Interviews per day, and side by side when two start in the same hour.
    const placed = useMemo(() => {
        const out = new Map<number, Array<{ iv: CalendarInterview; top: number; lane: number; lanes: number }>>();
        for (let d = 0; d < 7; d++) {
            const dayItems = (list ?? []).filter(iv => { const t = new Date(iv.at).getTime(); return t >= from + d * DAY && t < from + (d + 1) * DAY; });
            const byHour = new Map<number, CalendarInterview[]>();
            for (const iv of dayItems) { const h = ist(new Date(iv.at)).getUTCHours(); byHour.set(h, [...(byHour.get(h) ?? []), iv]); }
            out.set(d, dayItems.map(iv => {
                const p = ist(new Date(iv.at));
                const group = byHour.get(p.getUTCHours()) ?? [iv];
                return { iv, top: (p.getUTCHours() + p.getUTCMinutes() / 60 - startHour) * ROW, lane: group.indexOf(iv), lanes: group.length };
            }));
        }
        return out;
    }, [list, from, startHour]);

    const sel = (list ?? []).find(iv => iv.id === picked) ?? null;
    const upcoming = (list ?? []).filter(iv => new Date(iv.at).getTime() >= Date.now() && iv.status === 'scheduled').slice(0, 6);
    const count = list?.length ?? 0;
    const weekLabel = `${dayLabel(from, { day: 'numeric', month: 'short' })} to ${dayLabel(to - DAY, { day: 'numeric', month: 'short', year: 'numeric' })}`;

    return (
        <div className="flex flex-col gap-4">
            <section aria-label="Interview calendar" className={`${GLASS} p-[22px]`}>
                <div className="mb-3 flex flex-wrap items-center gap-2.5">
                    <h2 className={`${H2} mr-2`}>{weekLabel}</h2>
                    <span className={`text-[13px] ${INK3}`}>{list === null ? 'Loading' : plural(count, 'interview', 'interviews')}</span>
                    <span className="grow" />
                    <button type="button" onClick={() => setOffset(0)} disabled={offset === 0} className={`${BTN} disabled:opacity-50`}>This week</button>
                    <button type="button" onClick={() => setOffset(o => o - 1)} aria-label="Previous week" className={`${BTN} px-3`}><ChevronLeft className="h-4 w-4" aria-hidden /></button>
                    <button type="button" onClick={() => setOffset(o => o + 1)} aria-label="Next week" className={`${BTN} px-3`}><ChevronRight className="h-4 w-4" aria-hidden /></button>
                </div>
                <div className="mb-3 flex flex-wrap gap-2" aria-label="How the interview happens">
                    {[...MODES, { key: 'other', label: 'Not set', tone: 'v' as Tone }].map(m => (
                        <span key={m.key} className={`rounded-full px-3 py-1 text-xs font-bold ${TONE[m.tone]}`}>{m.label}</span>
                    ))}
                    <span className={`rounded-full px-3 py-1 text-xs font-bold ${TONE.c}`}>No-show</span>
                </div>

                {error ? (
                    <div className="flex flex-wrap items-center gap-3" role="alert"><p className="m-0 grow text-sm font-semibold">{error}</p><button type="button" onClick={() => setNonce(n => n + 1)} className={BTN}><RefreshCw className="h-4 w-4" aria-hidden />Try again</button></div>
                ) : (
                    <div className="overflow-x-auto">
                        <div className="relative min-w-[760px]" aria-busy={list === null}>
                            <div className="grid grid-cols-[56px_repeat(7,minmax(0,1fr))] border-b border-[#17152d]/10 pb-2 dark:border-white/[.14]">
                                <span className={`text-xs font-bold ${INK3}`}>Time</span>
                                {days.map(d => (
                                    <span key={d} className={`text-center text-[13px] font-bold ${d === todayStart ? 'text-[#4f46e5] dark:text-[#a5b4fc]' : ''}`}>
                                        <span className={d === todayStart ? 'rounded-full bg-[#4f46e5]/10 px-2.5 py-0.5' : ''}>{dayLabel(d, { weekday: 'short', day: 'numeric' })}</span>
                                    </span>
                                ))}
                            </div>
                            <div className="relative grid grid-cols-[56px_repeat(7,minmax(0,1fr))]" style={{ height: hours.length * ROW }}>
                                <div className="relative">
                                    {hours.map((h, i) => <span key={h} className={`absolute left-0 text-[11px] ${INK3}`} style={{ top: i * ROW + 2 }}>{h === 12 ? '12 pm' : h > 12 ? `${h - 12} pm` : `${h} am`}</span>)}
                                </div>
                                {days.map((d, di) => (
                                    <div key={d} className={`relative border-l border-[#17152d]/10 dark:border-white/[.14] ${d === todayStart ? 'bg-[#4f46e5]/[.04]' : ''}`}>
                                        {hours.map((h, i) => <span key={h} aria-hidden className="absolute inset-x-0 border-t border-dashed border-[#17152d]/[.07] dark:border-white/[.08]" style={{ top: i * ROW }} />)}
                                        {d === todayStart && nowHour >= startHour && nowHour < endHour && (
                                            <span aria-hidden className="absolute inset-x-0 z-10 h-0.5 bg-[#f87171]" style={{ top: (nowHour - startHour) * ROW }} />
                                        )}
                                        {(placed.get(di) ?? []).map(({ iv, top, lane, lanes }) => {
                                            const m = modeOf(iv.mode);
                                            const tone: Tone = iv.status === 'no_show' ? 'c' : m.tone;
                                            return (
                                                <button
                                                    key={iv.id}
                                                    type="button"
                                                    onClick={() => setPicked(iv.id)}
                                                    aria-pressed={picked === iv.id}
                                                    title={`${iv.candidateName} · ${time(iv.at)} · ${iv.round ?? 'Interview'}${iv.positionTitle ? ` · ${iv.positionTitle}` : ''}`}
                                                    className={`absolute overflow-hidden rounded-xl px-2 py-1.5 text-left text-xs leading-tight transition-transform hover:z-20 hover:scale-[1.02] ${TONE[tone]} ${picked === iv.id ? 'z-20 ring-2 ring-[#4f46e5]' : ''} ${iv.status === 'done' ? 'opacity-70' : ''}`}
                                                    style={{ top: top + 2, height: ROW - 4, left: `calc(${(lane / lanes) * 100}% + 3px)`, width: `calc(${100 / lanes}% - 6px)` }}
                                                >
                                                    <span className="block truncate font-extrabold">{iv.candidateName}</span>
                                                    <span className="block truncate opacity-90">{time(iv.at)} · {iv.round ?? 'Interview'}</span>
                                                </button>
                                            );
                                        })}
                                    </div>
                                ))}
                                {list === null && <span className="absolute inset-0 flex items-center justify-center"><Spinner className="h-5 w-5" /></span>}
                            </div>
                        </div>
                    </div>
                )}
                <p className={`mb-0 mt-3 text-xs ${INK3}`}>Each block starts at the interview&apos;s time. The red line is now.</p>
            </section>

            <div className="flex flex-wrap items-stretch gap-4">
                <section aria-label="Interview details" className={`${GLASS} min-w-0 flex-[1.2_1_380px] p-[22px]`}>
                    {sel ? (
                        <>
                            <div className="mb-1 flex flex-wrap items-center gap-2">
                                <h2 className={`${H2} grow`}>{sel.candidateName}</h2>
                                <span className={`rounded-full px-3 py-1 text-xs font-extrabold ${TONE[sel.status === 'no_show' ? 'c' : sel.status === 'done' ? 'v' : 'b']}`}>{INTERVIEW_STATUS_LABELS[sel.status]}</span>
                            </div>
                            <p className={`m-0 text-[13px] ${INK2}`}>{[sel.round ?? 'Interview', sel.positionTitle].filter(Boolean).join(' · ')}</p>
                            <dl className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
                                <div><dt className={`text-xs font-bold ${INK3}`}>When</dt><dd className="m-0 font-bold">{dayLabel(new Date(sel.at).getTime(), { weekday: 'short', day: 'numeric', month: 'short' })}, {time(sel.at)}</dd></div>
                                <div><dt className={`text-xs font-bold ${INK3}`}>How</dt><dd className="m-0 flex items-center gap-1.5 font-bold">{modeOf(sel.mode).key === 'in_person' ? <MapPin className="h-4 w-4" aria-hidden /> : <Video className="h-4 w-4" aria-hidden />}{modeOf(sel.mode).label}{sel.venue ? <span className={`font-normal ${INK2}`}> · {sel.venue}</span> : null}</dd></div>
                                <div><dt className={`text-xs font-bold ${INK3}`}>Panel</dt><dd className="m-0 flex items-center gap-1.5 font-bold"><Users className="h-4 w-4 shrink-0" aria-hidden /><span className="truncate">{sel.panel.length ? sel.panel.join(', ') : 'Not set'}</span></dd></div>
                            </dl>
                            <div className="mt-4 flex flex-wrap gap-2.5">
                                <button type="button" onClick={() => onOpen('pipeline')} className={BTN}>Open the pipeline</button>
                            </div>
                        </>
                    ) : (
                        <>
                            <h2 className={`${H2} mb-1`}>Coming up</h2>
                            <p className={`m-0 mb-2 text-[13px] ${INK3}`}>Pick an interview on the calendar to see its details.</p>
                            {upcoming.length === 0 && <p className={`m-0 text-sm ${INK3}`}>{offset < 0 ? 'This week is over.' : 'Nothing else is booked this week.'}</p>}
                            <div className="flex flex-col gap-1">
                                {upcoming.map(iv => (
                                    <button key={iv.id} type="button" onClick={() => setPicked(iv.id)} className={`flex items-center gap-3 rounded-2xl p-2 text-left ${ROW_HOVER}`}>
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
