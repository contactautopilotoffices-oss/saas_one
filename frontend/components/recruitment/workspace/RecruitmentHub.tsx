'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Check, ClipboardList, Lock, RefreshCw, Sparkles } from 'lucide-react';
import { RequisitionDrawer } from '@/frontend/components/recruitment/RequisitionsView';
import HubBars from './HubBars';
import HubCandidates from './HubCandidates';
import { INTERVIEW_STATUS_LABELS, OFFER_STATUS_LABELS, STATUS_LABELS, type CandidateRecord, type CandidateListResponse, type RecruitmentDashboard, type RequisitionListResponse } from '@/backend/lib/candidates/types';
import { api, NO_ACCESS_MESSAGE, qs } from '@/frontend/components/candidates/api';
import CandidateDetails from '@/frontend/components/candidates/CandidateDetails';
import RecordForm from '@/frontend/components/candidates/RecordForm';
import { formatDate, formatNotice } from '@/frontend/components/candidates/format';
import { Spinner, UiProvider } from '@/frontend/components/candidates/ui';
import type { RecruitmentView } from '@/frontend/components/candidates/CandidateSearchTab';
import { BTN, BTN_PRI, GLASS, H2, initials, INK2, INK3, plural, ROTATE, TONE, type Tone } from './hub-ui';
import HubPipeline from './HubPipeline';
import HubInsights from './HubInsights';
import HubInterviews from './HubInterviews';

// The Halo brief uses recorded facts; candidate actions reuse the existing profile and edit workflows.

const time = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });

/** The Hub's tabs (owner 2026-11-25). */
const TABS = [{ id: 'overview', label: 'Overview' }, { id: 'pipeline', label: 'Pipeline' }, { id: 'candidates', label: 'Candidates' }, { id: 'interviews', label: 'Interviews' }, { id: 'insights', label: 'Insights' }] as const;
export type HubTab = (typeof TABS)[number]['id'];
export function HubTabs({ tab, setTab }: { tab: HubTab; setTab: (tab: HubTab) => void }) {
    return (
            <div role="tablist" aria-label="Dashboard views" className="order-last flex w-full max-w-full gap-0.5 overflow-x-auto rounded-full border border-white/95 bg-white/65 p-1 backdrop-blur-[24px] lg:order-none lg:w-auto lg:gap-1 dark:border-white/[.13] dark:bg-white/[.07]">
                {TABS.map(x => {
                    const on = tab === x.id;
                    return (
                        <button
                            key={x.id}
                            type="button"
                            role="tab"
                            id={`hub-tab-${x.id}`}
                            aria-selected={on}
                            tabIndex={on ? 0 : -1}
                            onKeyDown={event => {
                                const index = TABS.findIndex(item => item.id === tab);
                                const next = event.key === 'ArrowRight' ? (index + 1) % TABS.length
                                    : event.key === 'ArrowLeft' ? (index + TABS.length - 1) % TABS.length
                                    : event.key === 'Home' ? 0 : event.key === 'End' ? TABS.length - 1 : -1;
                                if (next < 0) return;
                                event.preventDefault();
                                setTab(TABS[next].id);
                                document.getElementById(`hub-tab-${TABS[next].id}`)?.focus();
                            }}
                            aria-controls={`hub-panel-${x.id}`}
                            onClick={() => setTab(x.id)}
                            className={`inline-flex min-h-11 shrink-0 grow items-center justify-center whitespace-nowrap rounded-full px-2 text-xs font-bold transition-colors focus-visible:outline-offset-[-3px] sm:px-3 sm:text-sm xl:px-3.5 ${on ? 'bg-[#17152e] text-white dark:bg-[#fafaf9] dark:text-[#171717]' : `${INK2} hover:bg-[#262626]/5 hover:text-[#262626] dark:hover:bg-white/[.07] dark:hover:text-white`}`}
                        >
                            {x.label}
                        </button>
                    );
                })}
            </div>
    );
}
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

export default function RecruitmentHub({ orgId, firstName, onOpen, tab, setTab }: {
    orgId: string;
    firstName: string;
    tab: HubTab;
    setTab: (tab: HubTab) => void;
    onOpen: (view: RecruitmentView) => void;
}) {
    const [data, setData] = useState<RecruitmentDashboard | null>(null);
    const [reqs, setReqs] = useState<RequisitionListResponse | null>(null);
    const [error, setError] = useState('');
    const [noAccess, setNoAccess] = useState(false);
    const [nonce, setNonce] = useState(0);
    const [asOf, setAsOf] = useState(Date.now);
    const [deckAt, setDeckAt] = useState(0);
    const [request, setRequest] = useState<{ id: string; decision: 'hold' | 'approve' | null } | null>(null);
    const [people, setPeople] = useState<CandidateRecord[]>([]);
    const [picked, setPicked] = useState<CandidateRecord | null>(null);
    const [activeMember, setActiveMember] = useState<string | null>(null);
    const [profileTab, setProfileTab] = useState<{ tab: 'positions' | 'interviews'; nonce: number } | null>(null);
    const [profileOpen, setProfileOpen] = useState(false);
    const [editing, setEditing] = useState(false);
    const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
    const ui = useMemo(() => ({
        notify: (text: string, type?: 'success' | 'error' | 'info') => setNotice({ text, error: type === 'error' }),
        reportError: (failure: { error: string }) => setNotice({ text: failure.error, error: true }),
    }), []);
    const person = picked;
    const openProfile = (record: CandidateRecord, tab?: 'positions' | 'interviews') => {
        setPicked(record);
        setActiveMember(null);
        setProfileTab(previous => tab ? { tab, nonce: (previous?.nonce ?? 0) + 1 } : null);
        setProfileOpen(true);
    };
    const openInterview = async (applicationId: string) => {
        const result = await api<{ record: CandidateRecord }>(`/api/candidates/${encodeURIComponent(applicationId)}${qs({ orgId })}`);
        if (result.ok) openProfile(result.data.record, 'interviews');
        else setNotice({ text: result.error, error: true });
    };

    useEffect(() => {
        const ctrl = new AbortController();
        const signal = ctrl.signal;
        void Promise.all([
            api<RecruitmentDashboard>(`/api/candidates/dashboard${qs({ orgId, hub: 1 })}`, { signal }),
            api<RequisitionListResponse>(`/api/recruitment/requisitions${qs({ orgId })}`, { signal }),
            api<CandidateListResponse>(`/api/candidates${qs({ orgId, pageSize: 4 })}`, { signal }),
        ]).then(([dash, list, candidates]) => {
            if (signal.aborted) return;
            if (!dash.ok) {
                if (dash.aborted) return;
                if (dash.noAccess) { setNoAccess(true); return; }
                setError(dash.error);
                return;
            }
            setError('');
            setData(dash.data);
            setAsOf(Date.now());
            // The hiring requests are a bonus here: if they fail to load, the bar is simply left out.
            setReqs(list.ok ? list.data : null);
            setPeople(candidates.ok ? candidates.data.records : []);
        });
        return () => ctrl.abort();
    }, [orgId, nonce]);

    const waitingOnMe = useMemo(
        () => (reqs?.requisitions ?? []).filter(r => r.status === 'submitted' && r.currentLevel !== null && (r.currentLevel === 'hod' ? !!reqs?.access.userId && r.currentApproverId === reqs.access.userId : reqs?.access.approverLevels.includes(r.currentLevel))),
        [reqs],
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
    const interviewCount = data.interviewWeek.reduce((n, day) => n + day.count, 0);
    const m = data.metrics;

    // The brief, written from the numbers. Highlighted parts are the facts.
    const brief: Array<{ text: string; tone?: Tone }> = [{ text: `${greeting()}${firstName ? `, ${firstName}` : ''}.` }];
    if (waitingOnMe.length) brief.push({ text: plural(waitingOnMe.length, 'hiring request needs', 'hiring requests need'), tone: 'v' }, { text: 'your decision.' });
    if (t.interviews.length) {
        brief.push({ text: 'You have' }, { text: plural(t.interviews.length, 'interview', 'interviews'), tone: 'b' }, { text: `today, the first with ${t.interviews[0].candidateName} at ${time(t.interviews[0].at)}.` });
    } else {
        brief.push({ text: 'No interviews are booked for today.' });
    }
    if (worst) brief.push({ text: `${worst.title} is` }, { text: `${worst.daysOpen - worst.targetDays} days`, tone: 'c' }, { text: 'past its target.' });
    if (t.scorecardsPending.length) brief.push({ text: 'And' }, { text: plural(t.scorecardsPending.length, 'scorecard', 'scorecards'), tone: 'p' }, { text: t.scorecardsPending.length === 1 ? 'is still to be filled in.' : 'are still to be filled in.' });
    if (!worst && !t.scorecardsPending.length && !t.waiting.length) brief.push({ text: 'Nothing is overdue.' });
    const briefActs: Array<{ label: string; view: RecruitmentView }> = [
        ...(waitingOnMe.length ? [{ label: `Review ${plural(waitingOnMe.length, 'request', 'requests')}`, view: 'requisitions' as const }] : []),
        ...(t.waiting.length ? [{ label: `Move on ${plural(t.waiting.length, 'person', 'people')} waiting`, view: 'pipeline' as const }] : []),
        ...(t.offersAwaiting.length ? [{ label: `Follow up ${plural(t.offersAwaiting.length, 'offer', 'offers')}`, view: 'offers' as const }] : []),
        { label: 'Review new resumes', view: 'resumes' as const },
    ];

    const kpis: Array<{ value: number; label: string; note: string; view: RecruitmentView }> = [
        { value: data.roles.length, label: 'Open roles', note: late.length ? `${late.length} past target` : 'All on target', view: 'positions' },
        { value: data.activeCandidates, label: 'Active candidates', note: 'Across open roles', view: 'candidates' },
        { value: interviewCount, label: 'Interviews this week', note: `${t.interviews.length} today`, view: 'pipeline' },
        { value: t.offersAwaiting.length, label: 'Offers out', note: 'Waiting for an answer or approval', view: 'offers' },
    ];
    const charts = [
        { values: data.activity?.openings, label: 'Current open roles created per day over the last seven days' },
        { values: data.activity?.candidateMoves, label: 'Current active applications by day of last stage change' },
        { values: data.interviewWeek.map(day => day.count), label: 'Interviews per day this week', color: '#873dec' },
        { values: data.activity?.offers, label: 'Current outstanding offers created per day over the last seven days', color: '#d97706' },
    ];
    const dateInIndia = (ms: number) => new Date(ms + 5.5 * 3_600_000).toISOString().slice(0, 10);
    const today = dateInIndia(asOf);
    const inSevenDays = dateInIndia(asOf + 7 * 86_400_000);
    const joining = (data.offersInPlay ?? []).flatMap(o => o.status === 'accepted' && o.joiningDate && o.joiningDate >= today && o.joiningDate <= inSevenDays ? [o.joiningDate] : []).sort();
    const strip: Array<{ value: string; label: string; note: string; tone: Tone }> = [
        { value: m?.timeToFill.days == null ? '—' : String(m.timeToFill.days), label: 'Days to hire', note: m ? `Average, last ${m.periodDays} days` : 'Not enough data yet', tone: 'v' },
        { value: String(t.waiting.length), label: 'Waiting over 2 days', note: 'In the early rounds', tone: 'b' },
        { value: String(joining.length), label: 'Joining soon', note: joining[0] ? `Next on ${formatDate(joining[0])}` : 'Next seven days', tone: 'p' },
        { value: String(late.length), label: 'Roles past target', note: worst?.title ?? 'All roles on track', tone: 'c' },
    ];

    const card = deck[deckAt];
    const moving = data.spotlight?.find(p => p.member.id === activeMember);
    const pipeline = moving ? {
        position: moving.position, member: { ...moving.member, record: moving.record }, index: 1, total: 1, scopeLabel: moving.column,
        onPrev: null, onNext: null, onMoved: () => setNonce(n => n + 1),
        onRemoved: () => { setProfileOpen(false); setNonce(n => n + 1); },
    } : null;

    return (
        <UiProvider value={ui}>
        <div className="flex flex-col gap-4">
            {notice && <p role={notice.error ? 'alert' : 'status'} className={`${GLASS} px-4 py-3 text-sm ${notice.error ? 'text-error' : ''}`}>{notice.text}<button type="button" className="ml-3 underline" onClick={() => setNotice(null)}>Dismiss</button></p>}


            {waitingOnMe.length > 0 && (
                <section aria-label="Hiring request waiting for you" aria-live="polite" className="relative flex flex-wrap items-center gap-3 overflow-hidden rounded-3xl border border-white/95 bg-gradient-to-r from-indigo-100 to-violet-100 py-3 pl-4 pr-3.5 backdrop-blur-[24px] dark:border-white/[.13] dark:from-indigo-950 dark:to-violet-950">
                    <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-white">
                        <span aria-hidden className="absolute -inset-1 rounded-full border-2 border-indigo-500 motion-safe:animate-pulse" />
                        <ClipboardList className="h-[18px] w-[18px]" aria-hidden />
                    </span>
                    <div className="min-w-0 flex-[1_1_320px]">
                        <div className="flex flex-wrap items-center gap-2">
                            <span className="text-[15px] font-extrabold">Hiring request: {waitingOnMe[0].roleTitle}{waitingOnMe[0].positions > 1 ? `, ${waitingOnMe[0].positions} seats` : ''}</span>
                            <span className={`whitespace-nowrap rounded-full px-3 py-1 text-xs font-extrabold ${TONE.a}`}>{waitingOnMe.length > 1 ? `1 of ${waitingOnMe.length} waiting for you` : 'Waiting for you'}</span>
                        </div>
                        <div className={`text-[13px] ${INK2}`}>{[waitingOnMe[0].department, waitingOnMe[0].raisedByName ? `raised by ${waitingOnMe[0].raisedByName}` : null, ago(waitingOnMe[0].submittedAt), waitingOnMe[0].justification].filter(Boolean).join(' · ')}</div>
                    </div>
                    <button type="button" onClick={() => setRequest({ id: waitingOnMe[0].id, decision: null })} className={BTN}>View request</button>
                    <button type="button" onClick={() => setRequest({ id: waitingOnMe[0].id, decision: 'hold' })} className={BTN}>Hold</button>
                    <button type="button" onClick={() => setRequest({ id: waitingOnMe[0].id, decision: 'approve' })} className={BTN_PRI}><Check className="size-4" aria-hidden />Approve</button>
                </section>
            )}

            {tab === 'pipeline' && <div role="tabpanel" id="hub-panel-pipeline" aria-labelledby="hub-tab-pipeline"><HubPipeline data={data} onOpen={onOpen} /></div>}
            {tab === 'candidates' && <div role="tabpanel" id="hub-panel-candidates" aria-labelledby="hub-tab-candidates"><HubCandidates data={data} onOpen={onOpen} onProfile={openProfile} onMove={p => { openProfile(p.record); setActiveMember(p.member.id); }} /></div>}
            {tab === 'interviews' && <div role="tabpanel" id="hub-panel-interviews" aria-labelledby="hub-tab-interviews"><HubInterviews orgId={orgId} data={data} onOpen={onOpen} onInterview={openInterview} /></div>}
            {tab === 'insights' && <div role="tabpanel" id="hub-panel-insights" aria-labelledby="hub-tab-insights"><HubInsights data={data} /></div>}

            {tab === 'overview' && <div role="tabpanel" id="hub-panel-overview" aria-labelledby="hub-tab-overview" className="flex flex-col gap-4">
            <div className="halo-top">
                <section aria-label="Your morning brief" className="halo-brief relative min-w-0 flex-[1.45_1_460px] overflow-hidden rounded-[28px] border border-indigo-100 bg-gradient-to-br from-indigo-100 to-violet-100 px-7 py-[26px] shadow-[0_14px_38px_rgba(45,45,40,.1)] dark:border-[rgba(180,170,150,.25)] dark:from-indigo-950 dark:to-violet-950">
                    <div className="flex items-center gap-2.5 font-extrabold">
                        <span className="flex h-[34px] w-[34px] items-center justify-center rounded-full bg-indigo-600 text-white"><Sparkles className="h-[17px] w-[17px]" aria-hidden /></span>
                        Your morning brief
                        <span className="grow" />
                        <button type="button" onClick={() => setNonce(n => n + 1)} className={`inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold ${INK3} hover:bg-white/60 dark:hover:bg-white/10`}><RefreshCw className="h-3.5 w-3.5" aria-hidden />Refresh</button>
                    </div>
                    <p className="halo-brief-copy m-0 mt-5 font-bold leading-[1.38] tracking-[-0.02em]">
                        {brief.map((w, i) => w.tone
                            ? <span key={i} className={`mr-1.5 inline-block rounded-[9px] px-[9px] ${TONE[w.tone]}`}>{w.text}</span>
                            : <span key={i} className="mr-1.5">{w.text}</span>)}
                    </p>
                    <div className="mt-5 flex flex-wrap gap-2.5">
                        {briefActs.map(a => (
                            <button key={a.label} type="button" onClick={() => onOpen(a.view)} className="inline-flex min-h-11 items-center gap-2 rounded-full border border-[#e8e8e5] bg-white/70 pl-3 pr-4 text-sm font-bold transition-transform hover:-translate-y-0.5 dark:border-[rgba(180,170,150,.25)] dark:bg-white/[.08]">
                                <span aria-hidden className="h-[22px] w-[22px] shrink-0 rounded-full border-2 border-indigo-500" />
                                {a.label}
                            </button>
                        ))}
                    </div>
                </section>

                <div role="group" aria-label="Key numbers" className="grid min-w-0 grid-cols-2 gap-3">
                    {kpis.map((k, i) => <button key={k.label} type="button" onClick={() => {
                        if (k.label === 'Interviews this week') setTab('interviews');
                        else if (k.view === 'candidates') setTab('candidates');
                        else onOpen(k.view);
                    }} className={`${GLASS} hub-tile p-4 text-left`}>
                        <span className="flex flex-wrap items-end justify-between gap-1"><strong className="text-4xl font-extrabold tracking-tight tabular-nums">{k.value}</strong><HubBars {...charts[i]} /></span>
                        <span className="mt-2 block font-extrabold">{k.label}</span>
                        <span className={`flex items-center justify-between gap-1 text-xs ${INK2}`}>{k.note}<ArrowRight className="size-4 shrink-0" aria-hidden /></span>
                    </button>)}
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

            <div className="grid gap-3 lg:grid-cols-[1.15fr_1fr_1fr]">
                <section aria-label="Things that need you" className={`${GLASS} flex min-w-0 flex-[1.25_1_380px] flex-col gap-3.5 p-[22px]`}>
                    <div className="flex flex-wrap items-baseline gap-2.5">
                        <h2 className={`${H2} grow`}>Things that need you</h2>
                        <span className={`text-[13px] ${INK3}`}>{deck.length ? `${Math.min(deckAt, deck.length)} of ${deck.length} looked at` : 'Nothing waiting'}</span>
                    </div>
                    {deck.length > 0 && (
                        <div aria-hidden className="flex gap-1.5">
                            {deck.map((c, i) => <span key={c.key} className={`h-1.5 flex-1 rounded-[3px] ${i < deckAt ? 'bg-[#353535]' : i === deckAt ? 'bg-[#d6d3cd]' : 'bg-[#262626]/10 dark:bg-white/[.14]'}`} />)}
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
                            <span className="flex h-[52px] w-[52px] items-center justify-center rounded-full bg-indigo-600 text-white"><Check className="h-6 w-6" aria-hidden /></span>
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
                        <div key={i.id} className="flex items-center gap-3 rounded-2xl p-2.5 hover:bg-[#262626]/5 dark:hover:bg-white/[.07]">
                            <span className={`flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-[14px] text-[13px] font-extrabold ${TONE[ROTATE[k % ROTATE.length]]}`}>{initials(i.candidateName)}</span>
                            <div className="min-w-0 flex-1"><div className="font-extrabold">{i.candidateName}</div><div className={`truncate text-xs ${INK3}`}>{[i.round ?? 'Interview', i.positionTitle, INTERVIEW_STATUS_LABELS[i.status]].filter(Boolean).join(' · ')}</div></div>
                            <span className="font-extrabold tabular-nums">{time(i.at)}</span>
                        </div>
                    ))}
                    <div className="grow" />
                    <button type="button" onClick={() => setTab('interviews')} className={`${BTN} mt-2`}>See the whole week<ArrowRight className="h-[15px] w-[15px]" aria-hidden /></button>
                </section>

                <section aria-label="Just in" className={`${GLASS} flex min-w-0 flex-[1_1_300px] flex-col gap-1 p-5`}>
                    <div className="mx-1.5 mb-1.5 flex items-baseline gap-2"><h2 className={`${H2} grow`}>Just in</h2><span className={`text-[13px] ${INK3}`}>{plural(t.offersAwaiting.length, 'offer', 'offers')}</span></div>
                    {!t.offersAwaiting.length && !t.scorecardsPending.length && <p className={`mx-1.5 text-sm ${INK3}`}>No offers or scorecards to follow up.</p>}
                    {t.scorecardsPending.length > 0 && <button type="button" onClick={() => setTab('interviews')} className="rounded-xl p-2 text-left font-bold hover:bg-indigo-500/10">{plural(t.scorecardsPending.length, 'scorecard overdue', 'scorecards overdue')}</button>}
                    {t.offersAwaiting.slice(0, 6).map(o => (
                        <button key={o.id} type="button" onClick={() => onOpen('offers')} className="flex items-start gap-3 rounded-2xl p-2 text-left hover:bg-[#262626]/5 dark:hover:bg-white/[.07]">
                            <span className={`flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[13px] text-[13px] font-extrabold ${o.status === 'pending' ? TONE.a : TONE.p}`}>{initials(o.candidateName)}</span>
                            <span className="block min-w-0 flex-1"><span className="block font-extrabold">{o.candidateName}</span><span className={`block truncate text-xs ${INK3}`}>{[o.positionTitle, OFFER_STATUS_LABELS[o.status]].filter(Boolean).join(' · ')}</span></span>
                            <span className={`shrink-0 text-xs ${INK3}`}>{plural(o.days, 'day', 'days')}</span>
                        </button>
                    ))}
                </section>
            </div>

            {people.length > 0 && <section aria-label="People in your talent pool">
                <div className="mb-4 flex items-center justify-between gap-3"><h2 className={H2}>Recently updated candidates</h2><button type="button" className="text-sm font-semibold text-primary" onClick={() => onOpen('candidates')}>All candidates</button></div>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{people.slice(0, 4).map(candidate => <button type="button" key={candidate.id} aria-pressed={candidate.id === person?.id} onClick={() => openProfile(candidate)} className={`${GLASS} halo-person px-5 py-5 text-left ${candidate.id === person?.id ? 'ring-1 ring-primary ring-offset-[3px] ring-offset-primary/20' : ''}`}>
                    <span className="flex items-center gap-3"><span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl font-bold ${TONE.b}`}>{initials(candidate.fullName)}</span><span className="min-w-0"><span className="block truncate font-bold">{candidate.fullName}</span><span className={`block truncate text-sm ${INK2}`}>{candidate.currentDesignation || candidate.role || 'Candidate'}</span></span></span>
                    <span className="mt-5 flex flex-wrap items-center gap-2"><span className={`rounded-full px-3 py-1 text-xs font-semibold ${TONE.v}`}>{STATUS_LABELS[candidate.status]}</span><span className={`text-xs ${INK3}`}>{formatNotice(candidate.noticePeriodDays)}</span></span>
                </button>)}</div>
            </section>}

            </div>}
        </div>
        {request && <RequisitionDrawer orgId={orgId} id={request.id} initialDecision={request.decision} onClose={() => setRequest(null)} onChanged={() => setNonce(n => n + 1)} />}
        {person && <CandidateDetails key={person.id} record={person} showTab={profileTab} pipeline={pipeline} open={profileOpen} onClose={() => setProfileOpen(false)} onEdit={() => { setProfileOpen(false); setEditing(true); }} orgId={orgId} onChanged={() => setNonce(n => n + 1)} />}
        {person && <RecordForm orgId={orgId} record={person} open={editing} onClose={() => { setEditing(false); setProfileOpen(true); }} onSaved={saved => { setPicked(saved); setPeople(items => items.map(item => item.id === saved.id ? saved : item)); setEditing(false); setProfileOpen(true); setNonce(n => n + 1); }} />}
        </UiProvider>
    );
}
