'use client';

import React from 'react';
import { FileText, Mail, MessageCircle, PanelRightOpen, Phone, X } from 'lucide-react';
import { EDUCATION_TYPES, NO_QUALIFICATION } from '@/backend/lib/candidates/filters';
import type { CandidateRecord, RecordStatus, SearchResult } from '@/backend/lib/candidates/types';
import { telHref, whatsappHref } from './export-csv';
import { formatDate, formatInr, formatMonths, formatNotice } from './format';
import { CHIP, FOCUS_IN, MARK_TINT, MatchDetails, OriginTag, Pill, RoundAvatar, SECTION_TITLE, STATUS_PILL, WorkedOut } from './ResultCard';
import { BlacklistedTag } from './Remarks';
import { BTN_PRIMARY, CopyButton, Dropdown, LABEL, Marked, NUM_LG, Spinner, STATUS_OPTIONS } from './ui';

const ACTION = 'inline-flex h-9 min-w-0 items-center justify-center gap-x-1.5 rounded-lg border border-border bg-surface px-2 text-sm font-semibold text-text-primary transition-colors hover:bg-surface-elevated';
const ACTION_OFF = 'inline-flex h-9 min-w-0 cursor-not-allowed items-center justify-center gap-x-1.5 rounded-lg border border-border-subtle bg-surface-elevated px-2 text-sm font-semibold text-text-tertiary';

function Row({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="flex items-baseline justify-between gap-x-3 py-2">
            <dt className="shrink-0 text-xs text-text-tertiary">{label}</dt>
            <dd className="min-w-0 break-words text-right text-sm font-semibold tabular-nums text-text-primary">{children}</dd>
        </div>
    );
}

/**
 * Reaching the person: a link each, so the phone, WhatsApp or the mail app opens. Nothing is sent or logged from here.
 * A way that has no number or address on record is shown switched off, with the reason.
 */
export function ContactActions({ record: r }: { record: CandidateRecord }) {
    const whatsapp = r.phone ? whatsappHref(r.phone) : null;
    return (
        <div className="space-y-2">
            <div className="grid grid-cols-3 gap-x-2 gap-y-2">
                {r.phone
                    ? <a href={telHref(r.phone)} aria-label={`Call ${r.fullName}`} className={ACTION}><Phone className="h-4 w-4 shrink-0" aria-hidden />Call</a>
                    : <span className={ACTION_OFF} title="No phone number on record" aria-disabled="true"><Phone className="h-4 w-4 shrink-0" aria-hidden />Call</span>}
                {whatsapp
                    ? <a href={whatsapp} target="_blank" rel="noopener noreferrer" aria-label={`WhatsApp ${r.fullName} (opens in a new tab)`} className={ACTION}><MessageCircle className="h-4 w-4 shrink-0" aria-hidden />WhatsApp</a>
                    : <span className={ACTION_OFF} title="No mobile number on record" aria-disabled="true"><MessageCircle className="h-4 w-4 shrink-0" aria-hidden />WhatsApp</span>}
                {r.email
                    ? <a href={`mailto:${r.email}`} aria-label={`Email ${r.fullName}`} className={ACTION}><Mail className="h-4 w-4 shrink-0" aria-hidden />Email</a>
                    : <span className={ACTION_OFF} title="No email on record" aria-disabled="true"><Mail className="h-4 w-4 shrink-0" aria-hidden />Email</span>}
            </div>
            {(r.phone || r.email) && (
                <div className="rounded-lg bg-surface-elevated px-3 py-1.5 text-sm">
                    {r.phone && <p className="flex items-center justify-between gap-x-2 gap-y-2"><span className="inline-flex min-w-0 items-center gap-x-1.5 tabular-nums text-text-primary"><Phone className="h-3.5 w-3.5 shrink-0 text-text-tertiary" aria-hidden />{r.phone}</span><CopyButton value={r.phone} label="phone number" /></p>}
                    {r.email && <p className="flex items-center justify-between gap-x-2 gap-y-2"><span className="inline-flex min-w-0 items-center gap-x-1.5 text-text-primary" title={r.email}><Mail className="h-3.5 w-3.5 shrink-0 text-text-tertiary" aria-hidden /><span className="truncate">{r.email}</span></span><CopyButton value={r.email} label="email" /></p>}
                </div>
            )}
        </div>
    );
}

/**
 * The quick view beside the result list on a wide screen (owner 2026-11-11, redesign): the candidate whose card was
 * clicked, without leaving the list. It is closed until a card is clicked, and has its own close button, so the list
 * has the full width the rest of the time. Calling, WhatsApp and email are plain links (nothing is logged yet). "Open
 * full profile" is the workspace with the resume beside the details. A row with no value is left out.
 */
export default function QuickView({ result, onOpen, onStatus, statusBusy, onClose }: {
    result: SearchResult;
    onOpen: (record: CandidateRecord) => void;
    onStatus: (record: CandidateRecord, status: RecordStatus) => void;
    statusBusy: boolean;
    onClose: () => void;
}) {
    const r = result.record;
    const x = r.extras;
    const ranked = result.matchPercent !== null;
    const hasMatch = result.criteria.length > 0 || result.reasons.length > 0 || result.missing.length > 0;
    const qualifications = x ? [x.ugQualification, x.pgQualification, x.ppgQualification].filter(q => q && q.toLowerCase() !== NO_QUALIFICATION) : [];
    const education = [qualifications.join(', '), x?.institute, x?.degreeYear, EDUCATION_TYPES.find(t => t.id === x?.educationType)?.label].filter(Boolean).join(' · ');
    const role = [r.currentDesignation, r.currentOrganization].filter(Boolean).join(' at ');
    const roleWorkedOut = r.inferred?.includes('currentDesignation') || r.inferred?.includes('currentOrganization');

    return (
        <aside aria-label={`Quick view: ${r.fullName}`} className={`${FOCUS_IN} flex max-h-[calc(100dvh/var(--app-zoom,1)-6rem)] flex-col overflow-hidden rounded-xl bg-surface shadow-[var(--w-shadow)]`}>
            <div className="flex flex-col gap-y-4 overflow-y-auto overscroll-contain px-5 py-5">
                <div className="flex items-start gap-x-3 gap-y-3">
                    <RoundAvatar name={r.fullName} size="lg" />
                    <div className="min-w-0 flex-1">
                        <p className={LABEL}>Quick view</p>
                        <h2 className="break-words font-display text-lg font-bold leading-snug text-text-primary">{r.fullName}</h2>
                        <p className="break-words text-sm text-text-secondary">
                            {role || <span className="text-text-secondary">No current role on record</span>}
                            {role && roleWorkedOut && <WorkedOut what="the latest employer" />}
                        </p>
                    </div>
                    {ranked && (
                        <div className="shrink-0 text-right">
                            <p className={`${NUM_LG} text-text-primary`}>{Math.round(result.matchPercent as number)}<span className="text-base font-semibold text-text-tertiary">%</span></p>
                            <p className={LABEL}>Match</p>
                        </div>
                    )}
                    <button type="button" onClick={onClose} aria-label="Close the quick view" title="Close" className="-mr-2 -mt-2 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-text-secondary transition-colors hover:bg-muted hover:text-text-primary">
                        <X className="h-5 w-5" aria-hidden />
                    </button>
                </div>

                <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1.5">
                    <span className={`inline-flex ${STATUS_PILL}`}>
                        <Dropdown variant="pill" value={r.status} options={STATUS_OPTIONS} onChange={s => onStatus(r, s)} label={`Status of ${r.fullName}`} />
                    </span>
                    {statusBusy && <Spinner className="h-3.5 w-3.5 text-text-tertiary" />}
                    {r.hasResume === true && <Pill tone="green" icon={FileText}>Resume</Pill>}
                    {r.blacklisted && <BlacklistedTag entry={r.blacklist} />}
                    {r.hasResume === false && <Pill tone="amber">No resume</Pill>}
                    <OriginTag record={r} />
                </div>

                <ContactActions record={r} />

                {ranked && hasMatch && (
                    <section aria-label="Why this match">
                        <p className={`${SECTION_TITLE} mb-2`}>Why this match</p>
                        <MatchDetails result={result} stacked />
                    </section>
                )}

                <section aria-label="Details">
                    <p className={`${SECTION_TITLE} mb-1`}>Details</p>
                    <dl className="divide-y divide-border-subtle border-y border-border-subtle">
                    {r.role && <Row label="Role sourced for">{r.role}</Row>}
                    {r.location && <Row label="Location">{r.location}</Row>}
                    {r.totalExpMonths !== null && <Row label="Total experience">{formatMonths(r.totalExpMonths)}{r.inferred?.includes('totalExpMonths') && <WorkedOut />}</Row>}
                    {r.relevantExpMonths !== null && <Row label="Relevant experience">{formatMonths(r.relevantExpMonths)}</Row>}
                    {r.noticePeriodDays !== null && <Row label="Notice period">{formatNotice(r.noticePeriodDays)}</Row>}
                    {r.currentInhand !== null && <Row label="Current in-hand / month">{formatInr(r.currentInhand)}</Row>}
                    {r.expectedInhand !== null && <Row label="Expected in-hand / month">{formatInr(r.expectedInhand)}</Row>}
                    {education && <Row label="Education">{education}</Row>}
                    {x?.industry && <Row label="Industry">{x.industry}</Row>}
                    {x && x.preferredLocations.length > 0 && <Row label="Would move to">{x.preferredLocations.join(', ')}</Row>}
                    {r.sourcingDate && <Row label="Sourced">{formatDate(r.sourcingDate)}{r.candidateSource ? ` · ${r.candidateSource}` : ''}</Row>}
                    </dl>
                </section>

                {(r.resumeSnippet || x?.resumeSummary) && (
                    <section aria-label="From the resume">
                        <p className={`${SECTION_TITLE} mb-1`}>From the resume</p>
                        {x?.resumeSummary && <p className="text-sm leading-relaxed text-text-secondary">{x.resumeSummary}</p>}
                        {r.resumeSnippet && <p className={`${MARK_TINT} mt-2 rounded-lg bg-surface-elevated px-3 py-2 text-[13px] leading-relaxed text-text-primary`}><Marked parts={r.resumeSnippet} /></p>}
                    </section>
                )}

                {x && x.skills.length > 0 && (
                    <section aria-label="Skills">
                        <p className={`${SECTION_TITLE} mb-1.5`}>Skills</p>
                        <ul className="flex flex-wrap gap-x-1.5 gap-y-1.5">
                            {x.skills.map(skill => <li key={skill} className={CHIP}>{skill}</li>)}
                        </ul>
                    </section>
                )}

                {r.remark && (
                    <section aria-label="Remark">
                        <p className={`${SECTION_TITLE} mb-1`}>Remark</p>
                        <p className="whitespace-pre-wrap break-words text-sm text-text-primary">{r.remark}</p>
                    </section>
                )}
            </div>

            <div className="shrink-0 border-t border-border-subtle px-4 py-3">
                <button type="button" onClick={() => onOpen(r)} className={`${BTN_PRIMARY} w-full rounded-lg`}><PanelRightOpen className="h-4 w-4" />Open full profile and resume</button>
            </div>
        </aside>
    );
}
