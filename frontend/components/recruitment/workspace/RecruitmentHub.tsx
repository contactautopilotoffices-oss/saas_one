'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Check, ClipboardList, Lock, RefreshCw, Sparkles } from 'lucide-react';
import { useAuth } from '@/frontend/context/AuthContext';
import { INTERVIEW_STATUS_LABELS, OFFER_STATUS_LABELS, type RecruitmentDashboard, type RequisitionListResponse } from '@/backend/lib/candidates/types';
import { api, NO_ACCESS_MESSAGE, qs } from '@/frontend/components/candidates/api';
import { Spinner } from '@/frontend/components/candidates/ui';
import type { RecruitmentView } from '@/frontend/components/candidates/CandidateSearchTab';
import { BTN, BTN_PRI, GLASS, H2, INK2, INK3, plural, ROTATE, TONE, type Tone } from './hub-ui';
import HubPipeline from './HubPipeline';
import HubInsights from './HubInsights';
import HubInterviews from './HubInterviews';

/*
 * The Recruitment workspace's Home (owner 2026-11-25, design "21 · Hub", Overview tab). Every number and name comes
 * from the records: the recruitment dashboard (/api/candidates/dashboard) and the hiring requests
 * (/api/recruitment/requisitions). Nothing on this page approves or changes anything: each button opens the screen
 * where that work is done. The design's AI brief and assistant are not built yet (a model call needs registering
 * first, CLAUDE.md "AI models"), so the brief is written from the numbers.
 */

const time = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });
const initialsOf = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join('') || '?';

/** The Hub's tabs (owner 2026-11-25). */
const TABS = [{ id: 'overview', label: 'Overview' }, { id: 'pipeline', label: 'Pipeline' }, { id: 'interviews', label: 'Interviews' }, { id: 'insights', label: 'Insights' }] as const;
type HubTab = (typeof TABS)[number]['id'];
function ago(iso: string | null): string {
    if (!iso) return '';
    const h = Math.floor((Date.now() - new Date(iso).getTime()) / 3_600_000);
    if (h < 1) return 'just now';
    if (h < 24) return plural(h, 'hour ago', 'hours ago');
    const d = Math.floor(h / 24);
    return d === 1 ? 'yesterday' : `${d} days ago`;
}
function greeting(): string {
    const hour = Number(new Date().toLocaleString('en-IN', { hour: 'numeric', hour12: false, timeZone: 'Asia/Kolkata' }));
    return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
}

interface DeckCard { key: string; tag: string; tone: Tone; title: string; text: string; cta: string; view: RecruitmentView }

export default function RecruitmentHub({ orgId, firstName, onOpen }: {
    orgId: string;
    firstName: string;
    onOpen: (view: RecruitmentView) => void;
}) {
    const { user } = useAuth();
    const [data, setData] = useState<RecruitmentDashboard | null>(null);
    const [reqs, setReqs] = useState<RequisitionListResponse | null>(null);
    const [error, setError] = useState('');
    const [noAccess, setNoAccess] = useState(false);
    const [nonce, setNonce] = useState(0);
    const [deckAt, setDeckAt] = useState(0);
    const [tab, setTab] = useState<HubTab>('overview');

    useEffect(() => {
        const ctrl = new AbortController();
        const signal = ctrl.signal;
        void Promise.all([
            api<RecruitmentDashboard>(`/api/candidates/dashboard${qs({ orgId })}`, { signal }),
            api<RequisitionListResponse>(`/api/recruitment/requisitions${qs({ orgId })}`, { signal }),
        ]).then(([dash, list]) => {
            if (signal.aborted) return;
            if (!dash.ok) {
                if (dash.aborted) return;
                if (dash.noAccess) { setNoAccess(true); return; }
                setError(dash.error);
                return;
            }
            setError('');
            setData(dash.data);
            // The hiring requests are a bonus here: if they fail to load, the bar is simply left out.
            setReqs(list.ok ? list.data : null);
        });
        return () => ctrl.abort();
    }, [orgId, nonce]);

    const userId = user?.id;
    const waitingOnMe = useMemo(
        () => (reqs?.requisitions ?? []).filter(r => r.status === 'submitted' && !!userId && r.currentApproverId === userId),
        [reqs, userId],
    );

    const deck = useMemo<DeckCard[]>(() => {
        if (!data) return [];
        const cards: DeckCard[] = [];
        const t = data.today;
        const late = data.roles.filter(r => r.ageing);
        if (late[0]) cards.push({ key: `role-${late[0].id}`, tag: 'Role past target', tone: 'c', title: late[0].title, text: `Open ${late[0].daysOpen} days against a target of ${late[0].targetDays}. ${plural(late[0].inPipeline, 'person', 'people')} in the pipeline.`, cta: late[0].nextAction.startsWith('Assign') ? 'Open positions' : 'Open the pipeline', view: late[0].nextAction.startsWith('Assign') ? 'positions' : 'pipeline' });
        if (t.scorecardsPending.length) cards.push({ key: 'cards', tag: 'Scorecards overdue', tone: 'a', title: plural(t.scorecardsPending.length, 'scorecard is still empty', 'scorecards are still empty'), text: t.scorecardsPending.slice(0, 3).map(s => `${s.panelName ?? 'An interviewer'} for ${s.candidateName}`).join(', ') + (t.scorecardsPending.length > 3 ? ', and more.' : '.'), cta: 'Open the pipeline', view: 'pipeline' });
        if (t.waiting.length) cards.push({ key: 'waiting', tag: 'Waiting over 2 days', tone: 'b', title: plural(t.waiting.length, 'person is waiting', 'people are waiting'), text: t.waiting.slice(0, 3).map(w => `${w.candidateName} (${w.days} days, ${w.stageName})`).join(', ') + (t.waiting.length > 3 ? ', and more.' : '.'), cta: 'Move them on', view: 'pipeline' });
        if (t.offersAwaiting.length) cards.push({ key: 'offers', tag: 'Offers out', tone: 'p', title: plural(t.offersAwaiting.length, 'offer is waiting', 'offers are waiting'), text: t.offersAwaiting.slice(0, 3).map(o => `${o.candidateName}: ${OFFER_STATUS_LABELS[o.status]}, ${o.days} days`).join('; ') + '.', cta: 'Open offers', view: 'offers' });
        const unassigned = data.roles.filter(r => !r.recruiterName);
        if (unassigned.length) cards.push({ key: 'unassigned', tag: 'No recruiter', tone: 'v', title: plural(unassigned.length, 'role has no recruiter', 'roles have no recruiter'), text: unassigned.slice(0, 3).map(r => r.title).join(', ') + (unassigned.length > 3 ? ', and more.' : '.'), cta: 'Open positions', view: 'positions' });
        return cards.slice(0, 5);
    }, [data]);

    if (noAccess) {
        return (
            <div className={`${GLASS} mx-auto mt-8 flex max-w-lg flex-col items-center gap-2 p-8 text-center`}>
                <Lock className={`h-6 w-6 ${INK3}`} aria-hidden />
                <p className="m-0 font-bold">{NO_ACCESS_MESSAGE}</p>
                <p className={`m-0 text-sm ${INK2}`}>Ask an administrator if you need it.</p>
            </div>
        );
    }
    if (error) {
        return (
            <div className={`${GLASS} flex flex-wrap items-center gap-3 p-5`} role="alert">
                <p className="m-0 grow text-sm font-semibold">{error}</p>
                <button type="button" onClick={() => setNonce(n => n + 1)} className={BTN}><RefreshCw className="h-4 w-4" aria-hidden />Try again</button>
            </div>
        );
    }
    if (!data) return <p className={`flex items-center gap-2 text-sm ${INK3}`}><Spinner className="h-3.5 w-3.5" />Loading the dashboard</p>;

    const t = data.today;
    const late = data.roles.filter(r => r.ageing);
    const worst = late[0];
    const inPipeline = data.roles.reduce((n, r) => n + r.inPipeline, 0);
    const m = data.metrics;

    // The brief, written from the numbers. Highlighted parts are the facts.
    const brief: Array<{ text: string; tone?: Tone }> = [{ text: `${greeting()}${firstName ? `, ${firstName}` : ''}.` }];
    if (t.interviews.length) {
        brief.push({ text: 'You have' }, { text: plural(t.interviews.length, 'interview', 'interviews'), tone: 'b' }, { text: `today, the first with ${t.interviews[0].candidateName} at ${time(t.interviews[0].at)}.` });
    } else {
        brief.push({ text: 'No interviews are booked for today.' });
    }
    if (worst) brief.push({ text: `${worst.title} is` }, { text: `${worst.daysOpen - worst.targetDays} days`, tone: 'c' }, { text: 'past its target.' });
    if (t.scorecardsPending.length) brief.push({ text: 'And' }, { text: plural(t.scorecardsPending.length, 'scorecard', 'scorecards'), tone: 'p' }, { text: t.scorecardsPending.length === 1 ? 'is still to be filled in.' : 'are still to be filled in.' });
    if (!worst && !t.scorecardsPending.length && !t.waiting.length) brief.push({ text: 'Nothing is overdue.' });
    const briefActs: Array<{ label: string; view: RecruitmentView }> = [
        ...(t.waiting.length ? [{ label: `Move on ${plural(t.waiting.length, 'person', 'people')} waiting`, view: 'pipeline' as const }] : []),
        ...(t.offersAwaiting.length ? [{ label: `Follow up ${plural(t.offersAwaiting.length, 'offer', 'offers')}`, view: 'offers' as const }] : []),
        { label: 'Review new resumes', view: 'resumes' as const },
    ];

    const kpis: Array<{ value: number; label: string; note: string; view: RecruitmentView }> = [
        { value: data.roles.length, label: 'Open roles', note: late.length ? `${late.length} past target` : 'All on target', view: 'positions' },
        { value: inPipeline, label: 'In the pipeline', note: 'Across the open roles', view: 'pipeline' },
        { value: t.interviews.length, label: 'Interviews today', note: t.interviews[0] ? `First at ${time(t.interviews[0].at)}` : 'None booked', view: 'pipeline' },
        { value: t.offersAwaiting.length, label: 'Offers out', note: 'Waiting for an answer or approval', view: 'offers' },
    ];
    const strip: Array<{ value: string; label: string; note: string; tone: Tone }> = [
        { value: String(t.scorecardsPending.length), label: 'Scorecards overdue', note: 'Interview done, no scorecard', tone: 'a' },
        { value: String(t.waiting.length), label: 'Waiting over 2 days', note: 'In the early rounds', tone: 'b' },
        { value: m?.timeToFill.days == null ? '—' : String(m.timeToFill.days), label: 'Days to hire', note: m ? `Average, last ${m.periodDays} days` : 'Not enough data yet', tone: 'v' },
        { value: m?.offerAcceptance.ratePct == null ? '—' : `${m.offerAcceptance.ratePct}%`, label: 'Offers accepted', note: m ? `Last ${m.periodDays} days` : 'Not enough data yet', tone: 'p' },
    ];

    const card = deck[deckAt];

    return (
        <div className="flex flex-col gap-4">
            <div role="tablist" aria-label="Dashboard views" className="flex max-w-full gap-1 self-start overflow-x-auto rounded-full border border-white/95 bg-white/65 p-1 backdrop-blur-[24px] dark:border-white/[.13] dark:bg-white/[.07]">
                {TABS.map(x => {
                    const on = tab === x.id;
                    return (
                        <button
                            key={x.id}
                            type="button"
                            role="tab"
                            id={`hub-tab-${x.id}`}
                            aria-selected={on}
                            aria-controls={`hub-panel-${x.id}`}
                            onClick={() => setTab(x.id)}
                            className={`inline-flex min-h-11 items-center whitespace-nowrap rounded-full px-[18px] text-sm font-bold transition-colors ${on ? 'bg-[#17152d] text-[#f6f7fb] dark:bg-[#f0eff4] dark:text-[#0f1020]' : `${INK2} hover:bg-[#17152d]/5 hover:text-[#17152d] dark:hover:bg-white/[.07] dark:hover:text-white`}`}
                        >
                            {x.label}
                        </button>
                    );
                })}
            </div>

            {waitingOnMe.length > 0 && (
                <section aria-label="Hiring request waiting for you" aria-live="polite" className="relative flex flex-wrap items-center gap-3 overflow-hidden rounded-3xl border border-white/95 bg-[linear-gradient(115deg,rgba(79,70,229,.12),rgba(139,92,246,.09)_55%,rgba(99,102,241,.1)),rgba(255,255,255,.64)] py-3 pl-4 pr-3.5 backdrop-blur-[24px] dark:border-white/[.13] dark:bg-[linear-gradient(115deg,rgba(79,70,229,.2),rgba(139,92,246,.14)_55%,rgba(99,102,241,.16)),rgba(255,255,255,.07)]">
                    <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#4f46e5] text-white">
                        <span aria-hidden className="absolute -inset-1 rounded-full border-2 border-[#4f46e5] motion-safe:animate-ping" />
                        <ClipboardList className="h-[18px] w-[18px]" aria-hidden />
                    </span>
                    <div className="min-w-0 flex-[1_1_320px]">
                        <div className="flex flex-wrap items-center gap-2">
                            <span className="text-[15px] font-extrabold">Hiring request: {waitingOnMe[0].roleTitle}{waitingOnMe[0].positions > 1 ? `, ${waitingOnMe[0].positions} seats` : ''}</span>
                            <span className={`whitespace-nowrap rounded-full px-3 py-1 text-xs font-extrabold ${TONE.a}`}>{waitingOnMe.length > 1 ? `1 of ${waitingOnMe.length} waiting for you` : 'Waiting for you'}</span>
                        </div>
                        <div className={`text-[13px] ${INK2}`}>{[waitingOnMe[0].department, waitingOnMe[0].raisedByName ? `raised by ${waitingOnMe[0].raisedByName}` : null, ago(waitingOnMe[0].submittedAt), waitingOnMe[0].justification].filter(Boolean).join(' · ')}</div>
                    </div>
                    <button type="button" onClick={() => onOpen('requisitions')} className={BTN_PRI}>Review request<ArrowRight className="h-4 w-4" aria-hidden /></button>
                </section>
            )}

            {tab === 'pipeline' && <div role="tabpanel" id="hub-panel-pipeline" aria-labelledby="hub-tab-pipeline"><HubPipeline data={data} onOpen={onOpen} /></div>}
            {tab === 'interviews' && <div role="tabpanel" id="hub-panel-interviews" aria-labelledby="hub-tab-interviews"><HubInterviews orgId={orgId} data={data} onOpen={onOpen} /></div>}
            {tab === 'insights' && <div role="tabpanel" id="hub-panel-insights" aria-labelledby="hub-tab-insights"><HubInsights data={data} /></div>}

            {tab === 'overview' && <div role="tabpanel" id="hub-panel-overview" aria-labelledby="hub-tab-overview" className="flex flex-col gap-4">
            <div className="flex flex-wrap items-stretch gap-4">
                <section aria-label="Your brief" className="relative min-w-0 flex-[1.45_1_460px] overflow-hidden rounded-[28px] border border-[#dfe3ff] bg-[linear-gradient(120deg,#e4e8ff_0%,#eceeff_55%,#f1ecff_100%)] px-7 py-[26px] shadow-[0_14px_38px_rgba(60,60,120,.1)] dark:border-[rgba(165,180,252,.25)] dark:bg-[linear-gradient(120deg,rgba(79,70,229,.3)_0%,rgba(99,102,241,.2)_55%,rgba(139,92,246,.22)_100%)]">
                    <div className="flex items-center gap-2.5 font-extrabold">
                        <span className="flex h-[34px] w-[34px] items-center justify-center rounded-full bg-[#4f46e5] text-white"><Sparkles className="h-[17px] w-[17px]" aria-hidden /></span>
                        Your brief
                        <span className="grow" />
                        <button type="button" onClick={() => setNonce(n => n + 1)} className={`inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold ${INK3} hover:bg-white/60 dark:hover:bg-white/10`}><RefreshCw className="h-3.5 w-3.5" aria-hidden />Refresh</button>
                    </div>
                    <p className="m-0 mt-4 max-w-[680px] text-2xl font-bold leading-[1.38] tracking-[-0.02em]">
                        {brief.map((w, i) => w.tone
                            ? <span key={i} className={`mr-1.5 inline-block rounded-[9px] px-[9px] ${TONE[w.tone]}`}>{w.text}</span>
                            : <span key={i} className="mr-1.5">{w.text}</span>)}
                    </p>
                    <div className="mt-5 flex flex-wrap gap-2.5">
                        {briefActs.map(a => (
                            <button key={a.label} type="button" onClick={() => onOpen(a.view)} className="inline-flex min-h-11 items-center gap-2 rounded-full border border-[#dfe3ff] bg-white/70 pl-3 pr-4 text-sm font-bold transition-transform hover:-translate-y-0.5 dark:border-[rgba(165,180,252,.25)] dark:bg-white/[.08]">
                                <span className="flex h-[22px] w-[22px] items-center justify-center rounded-full border-2 border-[#4f46e5] text-[#4f46e5] dark:border-[#c7d2fe] dark:text-[#c7d2fe]"><ArrowRight className="h-3 w-3" aria-hidden /></span>
                                {a.label}
                            </button>
                        ))}
                    </div>
                </section>

                <div role="group" aria-label="Key numbers" className="grid min-w-0 flex-[1_1_360px] grid-cols-2 gap-3.5">
                    {kpis.map(k => (
                        <button key={k.label} type="button" onClick={() => onOpen(k.view)} className={`${GLASS} flex flex-col p-4 text-left transition-transform duration-300 hover:-translate-y-1`}>
                            <span className="font-display text-[40px] font-extrabold leading-none tracking-[-0.04em] tabular-nums">{k.value}</span>
                            <span className="mt-2.5 block font-extrabold">{k.label}</span>
                            <span className={`flex items-center gap-1.5 text-[13px] ${INK2}`}><span className="grow">{k.note}</span><ArrowRight className="h-[15px] w-[15px]" aria-hidden /></span>
                        </button>
                    ))}
                </div>
            </div>

            <div role="group" aria-label="More numbers" className="flex flex-wrap gap-2.5">
                {strip.map(k => (
                    <div key={k.label} className="flex flex-[1_1_200px] items-center gap-3 rounded-full border border-white/95 bg-white/65 py-2 pl-2 pr-4 backdrop-blur-[26px] dark:border-white/[.13] dark:bg-white/[.07]">
                        <span className={`flex h-11 min-w-14 items-center justify-center rounded-full px-3 text-lg font-extrabold tabular-nums ${TONE[k.tone]}`}>{k.value}</span>
                        <span className="min-w-0 leading-tight"><span className="block font-extrabold">{k.label}</span><span className={`block text-xs ${INK3}`}>{k.note}</span></span>
                    </div>
                ))}
            </div>

            <div className="flex flex-wrap items-stretch gap-4">
                <section aria-label="Things that need you" className={`${GLASS} flex min-w-0 flex-[1.25_1_380px] flex-col gap-3.5 p-[22px]`}>
                    <div className="flex flex-wrap items-baseline gap-2.5">
                        <h2 className={`${H2} grow`}>Things that need you</h2>
                        <span className={`text-[13px] ${INK3}`}>{deck.length ? `${Math.min(deckAt, deck.length)} of ${deck.length} looked at` : 'Nothing waiting'}</span>
                    </div>
                    {deck.length > 0 && (
                        <div aria-hidden className="flex gap-1.5">
                            {deck.map((c, i) => <span key={c.key} className={`h-1.5 flex-1 rounded-[3px] ${i < deckAt ? 'bg-[#4f46e5]' : i === deckAt ? 'bg-[#a5b4fc]' : 'bg-[#17152d]/10 dark:bg-white/[.14]'}`} />)}
                        </div>
                    )}
                    {card ? (
                        <div key={card.key} className="flex grow flex-col gap-3">
                            <div className="flex items-center gap-2"><span className={`whitespace-nowrap rounded-full px-3 py-1 text-xs font-extrabold ${TONE[card.tone]}`}>{card.tag}</span><span className="grow" /><span className={`text-[13px] ${INK3}`}>{deckAt + 1} of {deck.length}</span></div>
                            <div className="text-[26px] font-extrabold leading-[1.15] tracking-[-0.03em]">{card.title}</div>
                            <div className={INK2}>{card.text}</div>
                            <div className="grow" />
                            <div className="flex flex-wrap gap-2.5">
                                <button type="button" onClick={() => onOpen(card.view)} className={BTN_PRI}>{card.cta}</button>
                                <button type="button" onClick={() => setDeckAt(i => i + 1)} className={BTN}>Next</button>
                            </div>
                        </div>
                    ) : (
                        <div className="flex grow flex-col items-start justify-center gap-2.5 py-3">
                            <span className="flex h-[52px] w-[52px] items-center justify-center rounded-full bg-[#4f46e5] text-white"><Check className="h-6 w-6" aria-hidden /></span>
                            <div className="text-[22px] font-extrabold">All caught up</div>
                            <div className={INK2}>{deck.length ? 'You have looked at everything that needs you.' : 'Nothing is overdue right now.'}</div>
                            {deck.length > 0 && <button type="button" onClick={() => setDeckAt(0)} className={BTN}>Go through them again</button>}
                        </div>
                    )}
                </section>

                <section aria-label="Today's line-up" className={`${GLASS} flex min-w-0 flex-[1_1_300px] flex-col gap-1 p-5`}>
                    <div className="mx-1.5 mb-1.5 flex items-baseline gap-2"><h2 className={`${H2} grow`}>Today&apos;s line-up</h2><span className={`text-[13px] ${INK3}`}>{plural(t.interviews.length, 'interview', 'interviews')}</span></div>
                    {t.interviews.length === 0 && <p className={`mx-1.5 text-sm ${INK3}`}>No interviews today.</p>}
                    {t.interviews.slice(0, 6).map((i, k) => (
                        <div key={i.id} className="flex items-center gap-3 rounded-2xl p-2.5 hover:bg-[#17152d]/5 dark:hover:bg-white/[.07]">
                            <span className={`flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-[14px] text-[13px] font-extrabold ${TONE[ROTATE[k % ROTATE.length]]}`}>{initialsOf(i.candidateName)}</span>
                            <div className="min-w-0 flex-1"><div className="font-extrabold">{i.candidateName}</div><div className={`truncate text-xs ${INK3}`}>{[i.round ?? 'Interview', i.positionTitle, INTERVIEW_STATUS_LABELS[i.status]].filter(Boolean).join(' · ')}</div></div>
                            <span className="font-extrabold tabular-nums">{time(i.at)}</span>
                        </div>
                    ))}
                    <div className="grow" />
                    <button type="button" onClick={() => setTab('interviews')} className={`${BTN} mt-2`}>See the whole week<ArrowRight className="h-[15px] w-[15px]" aria-hidden /></button>
                </section>

                <section aria-label="Offers out" className={`${GLASS} flex min-w-0 flex-[1_1_300px] flex-col gap-1 p-5`}>
                    <div className="mx-1.5 mb-1.5 flex items-baseline gap-2"><h2 className={`${H2} grow`}>Offers out</h2><span className={`text-[13px] ${INK3}`}>{plural(t.offersAwaiting.length, 'offer', 'offers')}</span></div>
                    {t.offersAwaiting.length === 0 && <p className={`mx-1.5 text-sm ${INK3}`}>No offer is waiting.</p>}
                    {t.offersAwaiting.slice(0, 6).map(o => (
                        <button key={o.id} type="button" onClick={() => onOpen('offers')} className="flex items-start gap-3 rounded-2xl p-2 text-left hover:bg-[#17152d]/5 dark:hover:bg-white/[.07]">
                            <span className={`flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[13px] text-[13px] font-extrabold ${o.status === 'pending' ? TONE.a : TONE.p}`}>{initialsOf(o.candidateName)}</span>
                            <span className="block min-w-0 flex-1"><span className="block font-extrabold">{o.candidateName}</span><span className={`block truncate text-xs ${INK3}`}>{[o.positionTitle, OFFER_STATUS_LABELS[o.status]].filter(Boolean).join(' · ')}</span></span>
                            <span className={`shrink-0 text-xs ${INK3}`}>{plural(o.days, 'day', 'days')}</span>
                        </button>
                    ))}
                </section>
            </div>

            </div>}
        </div>
    );
}
