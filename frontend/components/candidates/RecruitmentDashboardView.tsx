'use client';

import React, { useEffect, useState } from 'react';
import { AlarmClock, BadgeIndianRupee, BarChart3, BriefcaseBusiness, CalendarClock, ClipboardList, Clock3, Download, Hourglass, Percent, RefreshCw, Timer } from 'lucide-react';
import { INTERVIEW_STATUS_LABELS, OFFER_STATUS_LABELS, type RecruitmentDashboard } from '@/backend/lib/candidates/types';
import { api, qs } from './api';
import { downloadCsv } from './export-csv';
import { AuditLog } from './PrivacyControls';
import { EmptyBlock, K_BTN, K_BTN_GHOST, K_CARD, K_LABEL, K_SECTION_TITLE, K_TABLE, K_TABLE_WRAP, K_TD, K_TH, K_TR, KpiTile, Loading, PageHeader, Segmented, StatusPill } from './page-kit';

/*
 * The recruitment dashboard (owner 2026-11-21; spec "Dashboard views": Today for the recruiter; Roles for the HR Head
 * and Director, ageing roles first; Funnel for the HR Head). Each view exports to Excel (as CSV, which Excel opens).
 * Owner 2026-11-25: the workspace's "Reports" page; KPI tiles on top, only real numbers.
 */

const csv = (rows: (string | number | null)[][]) => rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
const time = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });

export default function RecruitmentDashboardView({ orgId }: { orgId: string }) {
    const [report, setReport] = useState<'overview' | 'roles' | 'funnel' | 'audit'>('overview');
    const [data, setData] = useState<RecruitmentDashboard | null>(null);
    const [error, setError] = useState('');
    const [nonce, setNonce] = useState(0);
    useEffect(() => {
        const ctrl = new AbortController();
        void api<RecruitmentDashboard>(`/api/candidates/dashboard${qs({ orgId })}`, { signal: ctrl.signal }).then(res => {
            if (ctrl.signal.aborted) return;
            if (!res.ok) { setError(res.error); return; }
            setError('');
            setData(res.data);
        });
        return () => ctrl.abort();
    }, [orgId, nonce]);
    const refresh = <button type="button" onClick={() => setNonce(n => n + 1)} className={K_BTN}><RefreshCw className="h-4 w-4" aria-hidden />Refresh</button>;
    if (error) return <div className="space-y-5"><PageHeader title="Reports" actions={refresh} /><p role="alert" className={`${K_CARD} px-4 py-3 text-sm text-error`}>{error}</p></div>;
    if (!data) return <div className="space-y-5"><PageHeader title="Reports" /><Loading /></div>;
    const t = data.today;
    const ageing = data.roles.filter(r => r.ageing).length;
    const head = (title: string, onExport: () => void, sub?: string) => (
        <div className="flex flex-wrap items-start justify-between gap-2 px-5 pt-4">
            <div className="min-w-0">
                <h3 className={K_SECTION_TITLE}>{title}</h3>
                {sub && <p className="mt-0.5 text-xs text-text-tertiary">{sub}</p>}
            </div>
            <button type="button" onClick={onExport} className={K_BTN_GHOST} aria-label={`Export ${title} to Excel`}><Download className="h-4 w-4" aria-hidden />Excel</button>
        </div>
    );
    const exportToday = () => downloadCsv('recruitment-today.csv', csv([
        ['Section', 'Candidate', 'Detail', 'When / days'],
        ...t.interviews.map(i => ['Interview today', i.candidateName, `${i.round ?? ''} ${i.positionTitle ?? ''} (${INTERVIEW_STATUS_LABELS[i.status]})`, time(i.at)]),
        ...t.scorecardsPending.map(s => ['Scorecard pending', s.candidateName, `${s.panelName ?? ''} · ${s.round ?? ''}`, s.at.slice(0, 10)]),
        ...t.waiting.map(w => ['Waiting over 2 days', w.candidateName, `${w.positionTitle} · ${w.stageName}`, w.days]),
        ...t.offersAwaiting.map(o => ['Offer waiting', o.candidateName, `${o.positionTitle ?? ''} · ${OFFER_STATUS_LABELS[o.status]}`, o.days]),
    ]));
    const max = Math.max(1, ...data.funnel.map(x => x.count));
    return (
        <div className="space-y-5">
            <PageHeader title="Reports"
                sub={`${data.roles.length} open ${data.roles.length === 1 ? 'role' : 'roles'}${ageing ? ` · ${ageing} ageing` : ''} · ${t.interviews.length} ${t.interviews.length === 1 ? 'interview' : 'interviews'} today`}
                actions={refresh} />

            <Segmented label="Report sections" value={report} onChange={setReport} options={[{value:'overview',label:'Hiring overview'}, {value:'roles',label:'Role health'}, {value:'funnel',label:'Conversion funnel'}, {value:'audit',label:'Activity & audit'}]} />
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5" role="group" aria-label="Today at a glance">
                <KpiTile icon={CalendarClock} label="Interviews today" value={t.interviews.length} />
                <KpiTile icon={ClipboardList} label="Scorecards pending" value={t.scorecardsPending.length} />
                <KpiTile icon={Hourglass} label="Waiting over 2 days" value={t.waiting.length} />
                <KpiTile icon={BadgeIndianRupee} label="Offers waiting" value={t.offersAwaiting.length} />
                <KpiTile icon={BriefcaseBusiness} label="Open roles" value={data.roles.length} note={ageing ? `${ageing} ageing` : undefined} />
            </div>

            <section hidden={report !== 'overview'} className={`${K_CARD} pb-4`} aria-label="Today">
                {head('Today', exportToday)}
                <div className="mt-3 grid gap-x-6 gap-y-5 px-5 md:grid-cols-2">
                    <List title={`Interviews today · ${t.interviews.length}`} empty="No interviews today." items={t.interviews.map(i => [i.id, `${time(i.at)} · ${i.candidateName}`, `${i.round ?? 'Interview'} · ${i.positionTitle ?? ''} · ${INTERVIEW_STATUS_LABELS[i.status]}`])} />
                    <List title={`Scorecards pending · ${t.scorecardsPending.length}`} empty="Every scorecard is in." items={t.scorecardsPending.map((s, k) => [`${s.interviewId}-${k}`, `${s.panelName ?? 'Interviewer'} for ${s.candidateName}`, `${s.round ?? 'Interview'} on ${s.at.slice(0, 10)}`])} />
                    <List title={`Waiting over 2 days · ${t.waiting.length}`} empty="Nobody waiting in the early rounds." items={t.waiting.slice(0, 30).map((w, k) => [`${w.candidateName}-${k}`, `${w.candidateName} · ${w.days} days`, `${w.positionTitle} · ${w.stageName}`])} />
                    <List title={`Offers waiting · ${t.offersAwaiting.length}`} empty="No offer waiting." items={t.offersAwaiting.map(o => [o.id, `${o.candidateName} · ${o.days} days`, `${o.positionTitle ?? ''} · ${OFFER_STATUS_LABELS[o.status]}`])} />
                </div>
            </section>

            <section hidden={report !== 'roles'} className={`${K_CARD} overflow-hidden`} aria-label="Roles">
                {head('Roles', () => downloadCsv('recruitment-roles.csv', csv([['Role', 'Location', 'Recruiter', 'Days open', 'Target days', 'Ageing', 'In pipeline', 'Next action'], ...data.roles.map(r => [r.title, r.location, r.recruiterName, r.daysOpen, r.targetDays, r.ageing ? 'yes' : 'no', r.inPipeline, r.nextAction])])), 'Ageing roles first')}
                {data.roles.length === 0 ? <EmptyBlock icon={BriefcaseBusiness} title="No open roles">Open roles show here with their age and next step.</EmptyBlock> : (
                    <div className={`${K_TABLE_WRAP} mt-3`}>
                        <table className={`${K_TABLE} min-w-[640px]`}>
                            <thead><tr><th scope="col" className={K_TH}>Role</th><th scope="col" className={K_TH}>Recruiter</th><th scope="col" className={K_TH}>Days open</th><th scope="col" className={K_TH}>In pipeline</th><th scope="col" className={K_TH}>Next action</th></tr></thead>
                            <tbody>
                                {data.roles.map(r => (
                                    <tr key={r.id} className={K_TR}>
                                        <td className={K_TD}><span className="font-semibold text-text-primary">{r.title}</span>{r.location ? <span className="text-text-secondary"> · {r.location}</span> : null} {r.ageing && <StatusPill tone="amber">Ageing</StatusPill>}</td>
                                        <td className={`${K_TD} text-text-secondary`}>{r.recruiterName ?? <span className="font-medium text-amber-800 dark:text-amber-300">Not assigned</span>}</td>
                                        <td className={`${K_TD} whitespace-nowrap font-medium tabular-nums ${r.ageing ? 'text-red-700 dark:text-red-400' : 'text-text-primary'}`}>{r.daysOpen} <span className="text-xs font-normal text-text-tertiary">of {r.targetDays}</span></td>
                                        <td className={`${K_TD} font-medium tabular-nums text-text-primary`}>{r.inPipeline}</td>
                                        <td className={`${K_TD} text-text-secondary`}>{r.nextAction}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </section>

            <div hidden={report !== 'overview'}>{data.metrics && <Metrics m={data.metrics} />}</div>

            <section hidden={report !== 'funnel'} className={`${K_CARD} pb-4`} aria-label="Funnel">
                {head('Funnel', () => downloadCsv('recruitment-funnel.csv', csv([['Round', 'In the running', 'Rejected here'], ...data.funnel.map(f => [f.column, f.count, f.rejected])])), 'People in each round across the open positions, and how many were rejected there.')}
                {data.funnel.length === 0 ? <EmptyBlock icon={BarChart3} title="No rounds yet">The funnel fills as people move through the pipeline.</EmptyBlock> : (
                    <ul className="mt-4 space-y-2.5 px-5">
                        {data.funnel.map(f => (
                            <li key={f.column} className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_auto] items-center gap-x-3 text-sm sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)_auto]">
                                <span className="truncate text-text-primary" title={f.column}>{f.column}</span>
                                <span className="h-2.5 overflow-hidden rounded-full bg-muted" aria-hidden><span className="block h-full rounded-full bg-primary" style={{ width: `${Math.max(2, (f.count / max) * 100)}%` }} /></span>
                                <span className="whitespace-nowrap text-right"><span className="font-semibold tabular-nums text-text-primary">{f.count}</span>{f.rejected > 0 && <span className="text-xs text-text-tertiary"> · {f.rejected} rejected</span>}</span>
                            </li>
                        ))}
                    </ul>
                )}
            </section>

            {/* Owner 2026-11-24 (product safety): exports, salary and offer changes, data removals. */}
            <div hidden={report !== 'audit'}><AuditLog orgId={orgId} /></div>
        </div>
    );
}

/** Owner 2026-11-24: the last 90 days at a glance. */
function Metrics({ m }: { m: NonNullable<RecruitmentDashboard['metrics']> }) {
    const hours = (h: number | null) => (h === null ? '—' : h >= 48 ? `${Math.round(h / 24 * 10) / 10} days` : `${h} h`);
    const exportMetrics = () => downloadCsv('recruitment-metrics.csv', csv([
        ['Measure', 'Value', 'Note'],
        ['Time to fill (days)', m.timeToFill.days, `${m.timeToFill.offers} offers`],
        ['Offer acceptance (%)', m.offerAcceptance.ratePct, `${m.offerAcceptance.accepted} accepted, ${m.offerAcceptance.declined} declined, ${m.offerAcceptance.waiting} waiting`],
        ['Hiring request approval (hours)', m.approvalTurnaround.requisitionHours, `${m.approvalTurnaround.requisitions} requests`],
        ['Offer approval (hours)', m.approvalTurnaround.offerHours, `${m.approvalTurnaround.offers} offers`],
        ...m.rejectionReasons.map(r => ['Rejection reason', r.count, r.reason]),
        ...m.recruiterLoad.map(r => ['Recruiter load', r.inPipeline, `${r.recruiter}: ${r.openRoles} roles, ${r.ageing} ageing`]),
    ]));
    return (
        <section className="space-y-3" aria-label="Metrics">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className={K_SECTION_TITLE}>The last {m.periodDays} days</h3>
                <button type="button" onClick={exportMetrics} className={K_BTN_GHOST} aria-label="Export the metrics to Excel"><Download className="h-4 w-4" aria-hidden />Excel</button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <KpiTile icon={Timer} label="Time to fill" value={m.timeToFill.days === null ? '—' : `${m.timeToFill.days} days`} note={`opening to acceptance · ${m.timeToFill.offers} offers`} />
                <KpiTile icon={Percent} label="Offer acceptance" value={m.offerAcceptance.ratePct === null ? '—' : `${m.offerAcceptance.ratePct}%`} note={`${m.offerAcceptance.accepted} accepted · ${m.offerAcceptance.declined} declined · ${m.offerAcceptance.waiting} waiting`} />
                <KpiTile icon={Clock3} label="Hiring request approval" value={hours(m.approvalTurnaround.requisitionHours)} note={`submit to decision · ${m.approvalTurnaround.requisitions} requests`} />
                <KpiTile icon={AlarmClock} label="Offer approval" value={hours(m.approvalTurnaround.offerHours)} note={`proposal to final approval · ${m.approvalTurnaround.offers} offers`} />
            </div>
            <div className={`${K_CARD} grid gap-x-6 gap-y-5 px-5 py-4 md:grid-cols-2`}>
                <List title="Rejection reasons" empty="No rejections in this time." items={m.rejectionReasons.map(r => [r.reason, `${r.count} · ${r.reason}`, ''])} />
                <List title="Recruiter load (open roles)" empty="No open roles." items={m.recruiterLoad.map(r => [r.recruiter, `${r.recruiter} · ${r.inPipeline} in pipeline`, `${r.openRoles} roles${r.ageing ? ` · ${r.ageing} ageing` : ''}`])} />
            </div>
        </section>
    );
}

function List({ title, empty, items }: { title: string; empty: string; items: [string, string, string][] }) {
    return (
        <div className="min-w-0">
            <p className={K_LABEL}>{title}</p>
            {items.length === 0 ? <p className="mt-2 text-sm text-text-tertiary">{empty}</p> : (
                <ul className="mt-1.5 divide-y divide-border">{items.map(([k, a, b]) => <li key={k} className="py-2 text-sm"><span className="font-medium text-text-primary">{a}</span>{b && <span className="block text-xs text-text-tertiary">{b}</span>}</li>)}</ul>
            )}
        </div>
    );
}
