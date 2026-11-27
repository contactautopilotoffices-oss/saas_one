'use client';

import { useState } from 'react';
import type { CandidateRecord, RecruitmentDashboard } from '@/backend/lib/candidates/types';
import { OFFER_STATUS_LABELS } from '@/backend/lib/candidates/types';
import type { RecruitmentView } from '@/frontend/components/candidates/CandidateSearchTab';
import { formatDate, formatMonths, formatNotice } from '@/frontend/components/candidates/format';
import { BTN, BTN_PRI, GLASS, H2, initials, INK3, stageFill, TONE, TRACK } from './hub-ui';

export default function HubCandidates({ data, onOpen, onProfile, onMove }: {
    data: RecruitmentDashboard;
    onOpen: (view: RecruitmentView) => void;
    onProfile: (record: CandidateRecord) => void;
    onMove: (person: NonNullable<RecruitmentDashboard['spotlight']>[number]) => void;
}) {
    const [column, setColumn] = useState<string | null>(null);
    const [id, setId] = useState<string | null>(null);
    const entries = data.spotlight ?? [];
    const shown = entries.filter(p => column === null || p.column === column);
    const person = shown.find(p => p.record.id === id) ?? shown[0];
    const color = (name: string) => stageFill(Math.max(0, data.funnel.findIndex(f => f.column === name)));
    const offers = data.offersInPlay ?? data.today.offersAwaiting.map(o => ({ ...o, joiningDate: null }));

    return <div className="grid gap-3">
        <div className="hub-split">
            <section aria-label="Candidate matches" className={`${GLASS} min-w-0 p-5`}>
                <header className="flex flex-wrap items-center gap-2">
                    <h2 className={`${H2} mr-auto`}>Top candidates in play</h2>
                    <div role="group" aria-label="Filter by stage" className="flex flex-wrap gap-1">
                        {[null, ...new Set(entries.map(p => p.column))].map(name => <button type="button" key={name ?? ''} aria-pressed={name === column} onClick={() => setColumn(name)} className="flex min-h-9 items-center gap-1.5 rounded-full px-2.5 text-xs font-bold hover:bg-indigo-500/10 aria-pressed:bg-[#17152e] aria-pressed:text-white">
                            {name && <span aria-hidden className="size-2 rounded-full" style={{ background: color(name)[0] }} />}{name ?? 'All'}
                        </button>)}
                    </div>
                </header>
                {shown.length ? <div className="hub-bubbles flex min-h-64 flex-wrap items-center justify-center gap-4 px-2 py-7">
                    {shown.map(p => {
                        const [background, foreground] = color(p.column);
                        const size = 54 + (p.member.score?.overall ?? 0) * 10;
                        return <button type="button" key={p.record.id} title={p.record.fullName} aria-label={p.record.fullName} aria-pressed={p === person} onClick={() => setId(p.record.id)} className="hub-bubble flex shrink-0 flex-col items-center justify-center rounded-full font-extrabold" style={{ width: size, height: size, background, color: foreground }}>
                            {initials(p.record.fullName)}
                            {p.member.score && <span className="text-[11px]">{p.member.score.overall}/5</span>}
                        </button>;
                    })}
                </div> : <p className={`py-16 text-center text-sm ${INK3}`}>No active candidates to display.</p>}
                <p className={`text-xs ${INK3}`}>Color shows the pipeline stage. Larger bubbles show higher submitted interview ratings.</p>
            </section>
            <section aria-label="Candidate spotlight" className={`${GLASS} flex min-w-0 flex-col gap-4 p-5`}>
                {person ? <>
                    <div className="flex items-center gap-3">
                        <span className="flex size-14 shrink-0 items-center justify-center rounded-full bg-violet-600 font-extrabold text-white ring-2 ring-violet-400 ring-offset-2">{initials(person.record.fullName)}</span>
                        <div className="min-w-0"><h2 className={H2}>{person.record.fullName}</h2><p className={`text-sm ${INK3}`}>{person.position.title}</p><strong className="text-sm">{person.member.score ? `${person.member.score.overall}/5 interview rating` : 'No submitted rating'}</strong></div>
                    </div>
                    <div className="flex flex-wrap gap-2 text-xs font-bold">
                        {[person.column, person.record.candidateSource, formatNotice(person.record.noticePeriodDays)].filter(Boolean).map((label, i) => <span key={i} className={`rounded-full px-2 py-1 ${TONE[i === 2 ? 'a' : 'v']}`}>{label}</span>)}
                    </div>
                    <div className="grow space-y-3">
                        {person.member.score?.rounds.map((round, i) => <div key={round.round}>
                            <div className="mb-1 flex justify-between gap-2 text-sm font-bold"><span>{round.round}</span><span>{round.overall}/5</span></div>
                            <div className={`h-2 rounded-full ${TRACK}`}><div className="h-full rounded-full" style={{ width: `${round.overall * 20}%`, background: stageFill(i)[0] }} /></div>
                        </div>)}
                        <p className={`text-sm ${INK3}`}>{[formatMonths(person.record.totalExpMonths), person.record.location].filter(Boolean).join(' · ')}</p>
                    </div>
                    <div className="flex flex-wrap gap-2"><button type="button" className={BTN_PRI} onClick={() => onMove(person)}>Move forward</button><button type="button" className={BTN} onClick={() => onProfile(person.record)}>Open profile</button></div>
                </> : <><h2 className={H2}>Candidate spotlight</h2><button type="button" className={BTN} onClick={() => onOpen('candidates')}>Browse candidates</button></>}
            </section>
        </div>
        <section aria-label="Offers out" className={`${GLASS} p-5`}>
            <div className="flex items-center justify-between gap-3"><h2 className={H2}>Offers out</h2><button type="button" className={BTN} onClick={() => onOpen('offers')}>All offers</button></div>
            {offers.length ? <ul className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">{offers.slice(0, 6).map(o => <li key={o.id} className="flex items-center gap-2 rounded-2xl bg-indigo-500/5 p-2.5 text-sm">
                <span className={`grid size-9 shrink-0 place-items-center rounded-xl font-bold ${TONE.a}`}>{initials(o.candidateName)}</span>
                <span className="min-w-0 grow"><strong className="block truncate">{o.candidateName}</strong><span className={`block truncate text-xs ${INK3}`}>{[o.positionTitle, o.status === 'accepted' && o.joiningDate ? `Joins ${formatDate(o.joiningDate)}` : null].filter(Boolean).join(' · ')}</span></span>
                <span className={`rounded-full px-2 py-1 text-xs font-bold ${o.status === 'pending' ? TONE.a : TONE.b}`}>{OFFER_STATUS_LABELS[o.status]}</span>
            </li>)}</ul> : <p className={`text-sm ${INK3}`}>No offers awaiting a decision or response.</p>}
        </section>
    </div>;
}
