'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Check, ClipboardList, Lock, RefreshCw, Sparkles } from 'lucide-react';
import { useAuth } from '@/frontend/context/AuthContext';
import { INTERVIEW_STATUS_LABELS, OFFER_STATUS_LABELS, STATUS_LABELS, type CandidateRecord, type CandidateListResponse, type RecruitmentDashboard, type RequisitionListResponse } from '@/backend/lib/candidates/types';
import { api, NO_ACCESS_MESSAGE, qs } from '@/frontend/components/candidates/api';
import CandidateDetails from '@/frontend/components/candidates/CandidateDetails';
import RecordForm from '@/frontend/components/candidates/RecordForm';
import { formatMonths, formatNotice } from '@/frontend/components/candidates/format';
import { Spinner, UiProvider } from '@/frontend/components/candidates/ui';
import type { RecruitmentView } from '@/frontend/components/candidates/CandidateSearchTab';
import { BTN, BTN_PRI, GLASS, H2, INK2, INK3, plural, ROTATE, TONE, type Tone } from './hub-ui';
import HubPipeline from './HubPipeline';
import HubInsights from './HubInsights';
import HubInterviews from './HubInterviews';

// The Halo brief uses recorded facts; candidate actions reuse the existing profile and edit workflows.

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
    const [people, setPeople] = useState<CandidateRecord[]>([]);
    const [peopleError, setPeopleError] = useState('');
    const [personId, setPersonId] = useState<string | null>(null);
    const [profileOpen, setProfileOpen] = useState(false);
    const [editing, setEditing] = useState(false);
    const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
    const ui = useMemo(() => ({
        notify: (text: string, type?: 'success' | 'error' | 'info') => setNotice({ text, error: type === 'error' }),
        reportError: (failure: { error: string }) => setNotice({ text: failure.error, error: true }),
    }), []);
    const person = people.find(p => p.id === personId) ?? people[0];

    useEffect(() => {
        const ctrl = new AbortController();
        const signal = ctrl.signal;
        void Promise.all([
            api<RecruitmentDashboard>(`/api/candidates/dashboard${qs({ orgId })}`, { signal }),
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
            // The hiring requests are a bonus here: if they fail to load, the bar is simply left out.
            setReqs(list.ok ? list.data : null);
            setPeople(candidates.ok ? candidates.data.records : []);
            setPeopleError(candidates.ok ? '' : candidates.error);
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
        <UiProvider value={ui}>
        <div className="flex flex-col gap-4">
            {notice && <p role={notice.error ? 'alert' : 'status'} className={`${GLASS} px-4 py-3 text-sm ${notice.error ? 'text-error' : ''}`}>{notice.text}<button type="button" className="ml-3 underline" onClick={() => setNotice(null)}>Dismiss</button></p>}
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
                            className={`inline-flex min-h-11 items-center whitespace-nowrap rounded-full px-[18px] text-sm font-bold transition-colors ${on ? 'bg-[#262626] text-[#f7f7f5] dark:bg-[#fafaf9] dark:text-[#171717]' : `${INK2} hover:bg-[#262626]/5 hover:text-[#262626] dark:hover:bg-white/[.07] dark:hover:text-white`}`}
                        >
                            {x.label}
                        </button>
                    );
                })}
            </div>

            {waitingOnMe.length > 0 && (
                <section aria-label="Hiring request waiting for you" aria-live="polite" className="relative flex flex-wrap items-center gap-3 overflow-hidden rounded-3xl border border-white/95 bg-[linear-gradient(115deg,rgba(53,53,53,.12),rgba(180,160,125,.09)_55%,rgba(163,151,130,.1)),rgba(255,255,255,.64)] py-3 pl-4 pr-3.5 backdrop-blur-[24px] dark:border-white/[.13] dark:bg-[linear-gradient(115deg,rgba(53,53,53,.2),rgba(180,160,125,.14)_55%,rgba(163,151,130,.16)),rgba(255,255,255,.07)]">
                    <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#353535] text-white">
                        <span aria-hidden className="absolute -inset-1 rounded-full border-2 border-[#353535] motion-safe:animate-ping" />
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
            <div className="halo-top">
                <section aria-label="Your brief" className="halo-brief relative min-w-0 flex-[1.45_1_460px] overflow-hidden rounded-[28px] border border-[#e8e8e5] bg-[linear-gradient(120deg,#ffffff_0%,#fdfcf9_55%,#ffffff_100%)] px-7 py-[26px] shadow-[0_14px_38px_rgba(45,45,40,.1)] dark:border-[rgba(180,170,150,.25)] dark:bg-[linear-gradient(120deg,rgba(53,53,53,.3)_0%,rgba(163,151,130,.2)_55%,rgba(180,160,125,.22)_100%)]">
                    <div className="flex items-center gap-2.5 font-extrabold">
                        <span className="flex h-[34px] w-[34px] items-center justify-center rounded-full bg-[#262626] text-white"><Sparkles className="h-[17px] w-[17px]" aria-hidden /></span>
                        Your daily brief
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
                                <span aria-hidden className="h-[22px] w-[22px] shrink-0 rounded-full border-2 border-[#262626] dark:border-[#f5f5f3]" />
                                {a.label}
                            </button>
                        ))}
                    </div>
                </section>

                <section aria-label="Candidate spotlight" className={`${GLASS} halo-person flex min-w-0 flex-col px-6 py-6`}>
                    <p className={`mb-4 text-xs font-semibold uppercase tracking-wider ${INK3}`}>Candidate spotlight</p>
                    {person ? <>
                        <div className="flex items-center gap-4"><span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-3xl bg-primary text-2xl font-bold text-white">{initialsOf(person.fullName)}</span><div className="min-w-0"><h2 className="break-words text-2xl font-bold">{person.fullName}</h2><p className={`mt-1 text-sm ${INK2}`}>{person.currentDesignation || person.role || 'Candidate'}</p></div></div>
                        <div className="mt-5 flex flex-wrap gap-2"><span className={`rounded-full px-3 py-1 text-sm font-semibold ${TONE.v}`}>{STATUS_LABELS[person.status]}</span>{person.candidateSource && <span className={`rounded-full px-3 py-1 text-sm ${TONE.b}`}>{person.candidateSource}</span>}</div>
                        <dl className="my-6 divide-y divide-border">
                            <div className="flex justify-between gap-4 py-3"><dt className={INK2}>Experience</dt><dd className="font-semibold">{formatMonths(person.totalExpMonths)}</dd></div>
                            <div className="flex justify-between gap-4 py-3"><dt className={INK2}>Notice period</dt><dd className="font-semibold">{formatNotice(person.noticePeriodDays)}</dd></div>
                            <div className="flex justify-between gap-4 py-3"><dt className={INK2}>Location</dt><dd className="text-right font-semibold">{person.location || 'Not recorded'}</dd></div>
                        </dl>
                        <div className="mt-auto flex flex-wrap gap-3"><button type="button" className={`${BTN_PRI} flex-1`} onClick={() => setProfileOpen(true)}>Open profile</button><button type="button" className={`${BTN} flex-1`} onClick={() => onOpen('candidates')}>All people</button></div>
                    </> : <div className="flex flex-1 flex-col justify-center gap-3"><h2 className="text-xl font-bold">{peopleError ? 'People could not be loaded' : 'Your next hire starts here'}</h2><p className={`text-sm ${INK2}`}>{peopleError || 'Add candidates or import resumes to build your talent pool.'}</p><button type="button" className={BTN_PRI} onClick={() => onOpen('candidates')}>Open people</button></div>}
                </section>
            </div>

            {people.length > 0 && <section aria-label="People in your talent pool">
                <div className="mb-4 flex items-center justify-between gap-3"><h2 className={H2}>People in your talent pool</h2><button type="button" className="text-sm font-semibold text-primary" onClick={() => onOpen('candidates')}>All candidates</button></div>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{people.slice(0, 4).map(candidate => <button type="button" key={candidate.id} aria-pressed={candidate.id === person?.id} onClick={() => setPersonId(candidate.id)} className={`${GLASS} halo-person px-5 py-5 text-left ${candidate.id === person?.id ? 'ring-1 ring-primary ring-offset-[3px] ring-offset-primary/20' : ''}`}>
                    <span className="flex items-center gap-3"><span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl font-bold ${TONE.b}`}>{initialsOf(candidate.fullName)}</span><span className="min-w-0"><span className="block truncate font-bold">{candidate.fullName}</span><span className={`block truncate text-sm ${INK2}`}>{candidate.currentDesignation || candidate.role || 'Candidate'}</span></span></span>
                    <span className="mt-5 flex flex-wrap items-center gap-2"><span className={`rounded-full px-3 py-1 text-xs font-semibold ${TONE.v}`}>{STATUS_LABELS[candidate.status]}</span><span className={`text-xs ${INK3}`}>{formatNotice(candidate.noticePeriodDays)}</span></span>
                </button>)}</div>
            </section>}

            <div role="group" aria-label="Key numbers" className="halo-metrics">
                {kpis.map(k => <button key={k.label} type="button" onClick={() => onOpen(k.view)} className={`${GLASS} halo-metric text-left`}><strong>{k.value}</strong><span className="min-w-0"><span className="block font-bold">{k.label}</span><span className={`block text-xs ${INK2}`}>{k.note}</span></span></button>)}
            </div>

            {data.roles.length > 0 && <section className={`${GLASS} px-6 py-5`} aria-label="Hiring priorities"><div className="flex items-center justify-between gap-3"><h2 className={H2}>Roles to focus on</h2><button type="button" className={BTN} onClick={() => onOpen('positions')}>All positions</button></div><div className="mt-4 grid gap-3 md:grid-cols-3">{[...data.roles].sort((a, b) => Number(b.ageing) - Number(a.ageing) || b.daysOpen - a.daysOpen).slice(0,3).map(role => <article key={role.id} className="rounded-2xl border border-border bg-surface px-4 py-4 text-left"><span className="block font-semibold">{role.title}</span><span className="mt-1 block text-sm text-text-secondary">{role.inPipeline} in pipeline · {role.recruiterName ?? 'Unassigned'}</span><span className={`mt-3 block text-sm ${role.ageing ? 'text-error' : 'text-primary'}`}>{role.ageing ? `${role.daysOpen - role.targetDays} days past target` : `${role.targetDays - role.daysOpen} days to target`}</span><span className="mt-2 block text-xs text-text-secondary">{role.nextAction}</span></article>)}</div></section>}
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
                            <span className="flex h-[52px] w-[52px] items-center justify-center rounded-full bg-[#353535] text-white"><Check className="h-6 w-6" aria-hidden /></span>
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
                        <button key={o.id} type="button" onClick={() => onOpen('offers')} className="flex items-start gap-3 rounded-2xl p-2 text-left hover:bg-[#262626]/5 dark:hover:bg-white/[.07]">
                            <span className={`flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[13px] text-[13px] font-extrabold ${o.status === 'pending' ? TONE.a : TONE.p}`}>{initialsOf(o.candidateName)}</span>
                            <span className="block min-w-0 flex-1"><span className="block font-extrabold">{o.candidateName}</span><span className={`block truncate text-xs ${INK3}`}>{[o.positionTitle, OFFER_STATUS_LABELS[o.status]].filter(Boolean).join(' · ')}</span></span>
                            <span className={`shrink-0 text-xs ${INK3}`}>{plural(o.days, 'day', 'days')}</span>
                        </button>
                    ))}
                </section>
            </div>

            </div>}
        </div>
        {person && <CandidateDetails record={person} open={profileOpen} onClose={() => setProfileOpen(false)} onEdit={() => { setProfileOpen(false); setEditing(true); }} orgId={orgId} onChanged={() => setNonce(n => n + 1)} />}
        {person && <RecordForm orgId={orgId} record={person} open={editing} onClose={() => { setEditing(false); setProfileOpen(true); }} onSaved={saved => { setPeople(items => items.map(item => item.id === saved.id ? saved : item)); setEditing(false); setProfileOpen(true); setNonce(n => n + 1); }} />}
        </UiProvider>
    );
}
