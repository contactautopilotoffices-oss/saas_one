'use client';

import React, { useEffect, useState } from 'react';
import { Download, RefreshCw } from 'lucide-react';
import { INTERVIEW_STATUS_LABELS, OFFER_STATUS_LABELS, type RecruitmentDashboard } from '@/backend/lib/candidates/types';
import { api, qs } from './api';
import { downloadCsv } from './export-csv';
import { AuditLog } from './PrivacyControls';
import { BTN_GHOST, CARD, LABEL, NUM_MD, NUM_SM, Spinner, Tag } from './ui';

/*
 * The recruitment dashboard (owner 2026-11-21; spec "Dashboard views": Today for the recruiter; Roles for the HR Head
 * and Director, ageing roles first; Funnel for the HR Head). Each view exports to Excel (as CSV, which Excel opens).
 */

const csv = (rows: (string | number | null)[][]) => rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
const time = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });

export default function RecruitmentDashboardView({ orgId }: { orgId: string }) {
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
    if (error) return <p role="alert" className="text-sm text-error">{error}</p>;
    if (!data) return <p className="flex items-center gap-x-2 text-sm text-text-tertiary"><Spinner className="h-3.5 w-3.5" />Loading</p>;
    const t = data.today;
    const head = (title: string, onExport: () => void) => (
        <div className="flex items-center justify-between gap-2">
            <h2 className="font-display text-base font-semibold text-text-primary">{title}</h2>
            <button type="button" onClick={onExport} className={`${BTN_GHOST} h-8`}><Download className="h-4 w-4" />Excel</button>
        </div>
    );
    const exportToday = () => downloadCsv('recruitment-today.csv', csv([
        ['Section', 'Candidate', 'Detail', 'When / days'],
        ...t.interviews.map(i => ['Interview today', i.candidateName, `${i.round ?? ''} ${i.positionTitle ?? ''} (${INTERVIEW_STATUS_LABELS[i.status]})`, time(i.at)]),
        ...t.scorecardsPending.map(s => ['Scorecard pending', s.candidateName, `${s.panelName ?? ''} · ${s.round ?? ''}`, s.at.slice(0, 10)]),
        ...t.waiting.map(w => ['Waiting over 2 days', w.candidateName, `${w.positionTitle} · ${w.stageName}`, w.days]),
        ...t.offersAwaiting.map(o => ['Offer waiting', o.candidateName, `${o.positionTitle ?? ''} · ${OFFER_STATUS_LABELS[o.status]}`, o.days]),
    ]));
    return (
        <div className="space-y-6">
            <div className="flex justify-end"><button type="button" onClick={() => setNonce(n => n + 1)} className={`${BTN_GHOST} h-8`}><RefreshCw className="h-4 w-4" />Refresh</button></div>

            <section className={`${CARD} space-y-3 px-5 py-4`} aria-label="Today">
                {head('Today', exportToday)}
                <div className="grid gap-4 md:grid-cols-2">
                    <List title={`Interviews today · ${t.interviews.length}`} empty="No interviews today." items={t.interviews.map(i => [i.id, `${time(i.at)} · ${i.candidateName}`, `${i.round ?? 'Interview'} · ${i.positionTitle ?? ''} · ${INTERVIEW_STATUS_LABELS[i.status]}`])} />
                    <List title={`Scorecards pending · ${t.scorecardsPending.length}`} empty="Every scorecard is in." items={t.scorecardsPending.map((s, k) => [`${s.interviewId}-${k}`, `${s.panelName ?? 'Interviewer'} for ${s.candidateName}`, `${s.round ?? 'Interview'} on ${s.at.slice(0, 10)}`])} />
                    <List title={`Waiting over 2 days · ${t.waiting.length}`} empty="Nobody waiting in the early rounds." items={t.waiting.slice(0, 30).map((w, k) => [`${w.candidateName}-${k}`, `${w.candidateName} · ${w.days} days`, `${w.positionTitle} · ${w.stageName}`])} />
                    <List title={`Offers waiting · ${t.offersAwaiting.length}`} empty="No offer waiting." items={t.offersAwaiting.map(o => [o.id, `${o.candidateName} · ${o.days} days`, `${o.positionTitle ?? ''} · ${OFFER_STATUS_LABELS[o.status]}`])} />
                </div>
            </section>

            <section className={`${CARD} space-y-3 px-5 py-4`} aria-label="Roles">
                {head('Roles', () => downloadCsv('recruitment-roles.csv', csv([['Role', 'Location', 'Recruiter', 'Days open', 'Target days', 'Ageing', 'In pipeline', 'Next action'], ...data.roles.map(r => [r.title, r.location, r.recruiterName, r.daysOpen, r.targetDays, r.ageing ? 'yes' : 'no', r.inPipeline, r.nextAction])])))}
                {data.roles.length === 0 ? <p className="text-sm text-text-tertiary">No open roles.</p> : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="text-left text-xs text-text-secondary"><tr><th className="py-1.5 pr-3 font-medium">Role</th><th className="py-1.5 pr-3 font-medium">Recruiter</th><th className="py-1.5 pr-3 font-medium">Days open</th><th className="py-1.5 pr-3 font-medium">In pipeline</th><th className="py-1.5 font-medium">Next action</th></tr></thead>
                            <tbody className="divide-y divide-border-subtle">
                                {data.roles.map(r => (
                                    <tr key={r.id}>
                                        <td className="py-2 pr-3"><span className="font-semibold text-text-primary">{r.title}</span>{r.location ? <span className="text-text-secondary"> · {r.location}</span> : null} {r.ageing && <Tag tone="warn">Ageing</Tag>}</td>
                                        <td className="py-2 pr-3 text-text-secondary">{r.recruiterName ?? <span className="text-amber-800">Not assigned</span>}</td>
                                        <td className={`py-2 pr-3 ${NUM_SM} ${r.ageing ? 'text-red-700' : 'text-text-primary'}`}>{r.daysOpen} <span className="text-xs font-normal text-text-tertiary">of {r.targetDays}</span></td>
                                        <td className={`py-2 pr-3 ${NUM_SM}`}>{r.inPipeline}</td>
                                        <td className="py-2 text-text-secondary">{r.nextAction}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </section>

            {data.metrics && <Metrics m={data.metrics} />}

            <section className={`${CARD} space-y-3 px-5 py-4`} aria-label="Funnel">
                {head('Funnel', () => downloadCsv('recruitment-funnel.csv', csv([['Round', 'In the running', 'Rejected here'], ...data.funnel.map(f => [f.column, f.count, f.rejected])])))}
                <p className="text-xs text-text-secondary">People in each round across the open positions, and how many were rejected there.</p>
                <ul className="space-y-1.5">
                    {data.funnel.map(f => {
                        const max = Math.max(1, ...data.funnel.map(x => x.count));
                        return (
                            <li key={f.column} className="flex items-center gap-x-3 text-sm">
                                <span className="w-44 shrink-0 truncate text-text-primary" title={f.column}>{f.column}</span>
                                <span className="h-3 rounded-full bg-primary" style={{ width: `${Math.max(2, (f.count / max) * 60)}%` }} aria-hidden />
                                <span className={`${NUM_SM} text-text-primary`}>{f.count}</span>
                                {f.rejected > 0 && <span className="text-xs text-text-tertiary">· {f.rejected} rejected</span>}
                            </li>
                        );
                    })}
                </ul>
            </section>

            {/* Owner 2026-11-24 (product safety): exports, salary and offer changes, data removals. */}
            <AuditLog orgId={orgId} />
        </div>
    );
}

/** Owner 2026-11-24: the last 90 days at a glance. */
function Metrics({ m }: { m: NonNullable<RecruitmentDashboard['metrics']> }) {
    const tile = (label: string, value: string, note: string) => (
        <div className="rounded-xl bg-surface-elevated px-3 py-2.5"><p className={LABEL}>{label}</p><p className={`${NUM_MD} text-text-primary`}>{value}</p><p className="text-xs text-text-tertiary">{note}</p></div>
    );
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
        <section className={`${CARD} space-y-3 px-5 py-4`} aria-label="Metrics">
            <div className="flex items-center justify-between gap-2">
                <h2 className="font-display text-base font-semibold text-text-primary">The last {m.periodDays} days</h2>
                <button type="button" onClick={exportMetrics} className={`${BTN_GHOST} h-8`}><Download className="h-4 w-4" />Excel</button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {tile('Time to fill', m.timeToFill.days === null ? '—' : `${m.timeToFill.days} days`, `opening to acceptance · ${m.timeToFill.offers} offers`)}
                {tile('Offer acceptance', m.offerAcceptance.ratePct === null ? '—' : `${m.offerAcceptance.ratePct}%`, `${m.offerAcceptance.accepted} accepted · ${m.offerAcceptance.declined} declined · ${m.offerAcceptance.waiting} waiting`)}
                {tile('Hiring request approval', hours(m.approvalTurnaround.requisitionHours), `submit to decision · ${m.approvalTurnaround.requisitions} requests`)}
                {tile('Offer approval', hours(m.approvalTurnaround.offerHours), `proposal to final approval · ${m.approvalTurnaround.offers} offers`)}
            </div>
            <div className="grid gap-4 md:grid-cols-2">
                <List title="Rejection reasons" empty="No rejections in this time." items={m.rejectionReasons.map(r => [r.reason, `${r.count} · ${r.reason}`, ''])} />
                <List title="Recruiter load (open roles)" empty="No open roles." items={m.recruiterLoad.map(r => [r.recruiter, `${r.recruiter} · ${r.inPipeline} in pipeline`, `${r.openRoles} roles${r.ageing ? ` · ${r.ageing} ageing` : ''}`])} />
            </div>
        </section>
    );
}

function List({ title, empty, items }: { title: string; empty: string; items: [string, string, string][] }) {
    return (
        <div>
            <p className={LABEL}>{title}</p>
            {items.length === 0 ? <p className="mt-1 text-sm text-text-tertiary">{empty}</p> : (
                <ul className="mt-1 space-y-1">{items.map(([k, a, b]) => <li key={k} className="text-sm"><span className="font-semibold text-text-primary">{a}</span><span className="block text-xs text-text-secondary">{b}</span></li>)}</ul>
            )}
        </div>
    );
}
