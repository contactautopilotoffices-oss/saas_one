'use client';

import React, { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, ChevronDown, CircleHelp, FileSpreadsheet, FileText, Mail, PanelRightOpen, Phone, UserPlus } from 'lucide-react';
import { NO_QUALIFICATION } from '@/backend/lib/candidates/filters';
import { originLabel, recordOrigin, type CandidateRecord, type RecordStatus, type SearchResult } from '@/backend/lib/candidates/types';
import { telHref } from './export-csv';
import { formatInr, formatMonths, formatNotice } from './format';
import { BlacklistedTag } from './Remarks';
import { Avatar, BTN_GHOST, CARD, CARD_HOVER, CopyButton, Dropdown, EASE_PATIENT, LABEL, Marked, NUM_LG, NUM_SM, Spinner, STATUS_OPTIONS, Tag, WELL } from './ui';

/** Score bar fill. The bar length carries the value; colour stays the brand primary (no traffic-light fills). */
export function CriterionBar({ label, score, weight }: { label: string; score: number; weight: number }) {
    const pct = Math.max(0, Math.min(100, Math.round(score)));
    return (
        <li className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-1.5">
            <span className="truncate text-sm font-medium text-text-primary">{label}</span>
            <span className="text-xs text-text-tertiary">
                <span className={`${NUM_SM} text-text-primary`}>{pct}</span>
                <span className="tabular-nums"> · weight {Math.round(weight)}%</span>
            </span>
            <span className="col-span-2 h-1.5 overflow-hidden rounded-full bg-border" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={`${label} score`}>
                <span className="block h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
            </span>
        </li>
    );
}

/** Why AI placed a candidate where it did: the score per criterion, what supports it, and what HR should check. */
export function MatchDetails({ result, stacked = false }: { result: SearchResult; stacked?: boolean }) {
    return (
        <div className={`grid gap-x-4 gap-y-4 ${stacked ? '' : 'md:grid-cols-2'}`}>
            {result.criteria.length > 0 && (
                <div className={`${WELL} px-4 py-4 ${stacked ? '' : 'md:col-span-2'}`}>
                    <p className={`${LABEL} mb-3`}>Score by criterion</p>
                    <ul className={`grid gap-x-8 gap-y-4 ${stacked ? '' : 'sm:grid-cols-2'}`}>
                        {result.criteria.map(c => <CriterionBar key={c.key} label={c.label} score={c.score} weight={c.weight} />)}
                    </ul>
                </div>
            )}
            {result.reasons.length > 0 && (
                <div className="min-w-0">
                    <p className={`${LABEL} mb-2`}>Why it fits</p>
                    <ul className="space-y-2">
                        {result.reasons.map((x, i) => (
                            <li key={i} className="flex gap-x-2 gap-y-2 text-sm text-text-primary">
                                <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden />
                                <span className="min-w-0 break-words">{x}</span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
            {result.missing.length > 0 && (
                <div className="min-w-0">
                    <p className={`${LABEL} mb-2`}>Check:</p>
                    <ul className="space-y-2">
                        {result.missing.map((x, i) => (
                            <li key={i} className="flex gap-x-2 gap-y-2 text-sm text-text-primary">
                                <CircleHelp className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
                                <span className="min-w-0 break-words"><span className="sr-only">Check: </span>{x}</span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
}

/** One fact, label and value on one line, so a row of facts stays one line tall. */
function Fact({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <span className="inline-flex min-w-0 items-baseline gap-x-1.5 whitespace-nowrap">
            <span className="text-xs font-medium text-text-secondary">{label}</span>
            <span className={`${NUM_SM} text-text-primary`}>{children}</span>
        </span>
    );
}

/** Where the record came from: the sheet, an uploaded resume, or typed in (owner 2026-11-11). */
export function OriginTag({ record }: { record: CandidateRecord }) {
    const origin = recordOrigin(record);
    const label = originLabel(record);
    return <Tag icon={origin === 'sheet' ? FileSpreadsheet : origin === 'resume' ? FileText : UserPlus} title={label}>{label}</Tag>;
}

/** Skills shown on a card before "+N more". */
const CARD_SKILLS = 7;

/** The highest degree on record with where it is from ("MBA · University of Mumbai"); null when the resume gave none. */
export function highestQualification(x: CandidateRecord['extras']): string | null {
    if (!x) return null;
    const degree = [x.ppgQualification, x.pgQualification, x.ugQualification].find(q => q && q.toLowerCase() !== NO_QUALIFICATION) ?? null;
    return degree ? [degree, x.institute].filter(Boolean).join(' · ') : null;
}

/**
 * Beside a value that was worked out from the employers on the resume, not stated on it (owner 2026-11-11): HR sees
 * at a glance that it is a reading of the dates, and the tooltip says so in full.
 */
export function WorkedOut({ what = 'the employment dates' }: { what?: string }) {
    return <span className="ml-1 whitespace-nowrap text-[11px] font-medium text-text-secondary" title={`Worked out from ${what} on the resume; the resume does not state it. Edit the candidate to correct it.`}>worked out</span>;
}

/**
 * One search result. Owner 2026-11-15: the same content as before in about half the height: the facts on one line
 * (label and value side by side), education and "sourced for" on the next, skills and where the keywords matched on
 * one row, the remark and the resume line each clamped to one line, and the status, phone and email on the last.
 * A click anywhere on the card opens the quick view; the controls inside keep their own job.
 */
export default function ResultCard({
    result, onStatus, statusBusy, onOpen, blankFields = [], checked, onCheck, focused = false, onFocus,
}: {
    result: SearchResult;
    onStatus: (record: CandidateRecord, status: RecordStatus) => void;
    statusBusy: boolean;
    /** Opens the candidate's workspace (resume beside the details). */
    onOpen: (record: CandidateRecord) => void;
    /** Filtered fields this record has no value for (shown through "blank details"). */
    blankFields?: string[];
    checked: boolean;
    onCheck: (record: CandidateRecord, on: boolean) => void;
    /** This card is the one shown in the quick view. */
    focused?: boolean;
    /** Given while the quick view is on screen: the name shows the candidate there instead of opening the workspace. */
    onFocus?: (record: CandidateRecord) => void;
}) {
    const [open, setOpen] = useState(false);
    const r = result.record;
    const x = r.extras;
    const detailsId = `cand-details-${r.id}`;
    const where = [r.currentDesignation, r.currentOrganization].filter(Boolean).join(' @ ');
    const hasDetails = result.criteria.length > 0 || result.reasons.length > 0 || result.missing.length > 0;
    const ranked = result.matchPercent !== null;
    const resumeSummary = x?.resumeSummary ?? null;
    // The line under the facts: AI's sentence when ranked, else the remark HR wrote.
    const note = result.summary?.trim() || null;
    const education = highestQualification(x);
    const skills = x?.skills ?? [];
    const hits = r.keywordHits ?? [];
    const hasFacts = r.totalExpMonths !== null || r.relevantExpMonths !== null || r.noticePeriodDays !== null || r.currentInhand !== null || r.expectedInhand !== null;

    const onCardClick = onFocus
        ? (e: React.MouseEvent<HTMLElement>) => {
            if ((e.target as HTMLElement).closest('a, button, input, select, textarea, label, [role="listbox"]')) return;
            if (window.getSelection()?.toString()) return;
            onFocus(r);
        }
        : undefined;

    return (
        <article
            aria-current={focused ? 'true' : undefined}
            onClick={onCardClick}
            className={`${CARD} ${CARD_HOVER} px-3.5 py-3 ${onFocus ? 'cursor-pointer' : ''} ${focused ? 'ring-2 ring-primary ring-offset-0' : ''}`}
        >
            <div className="flex items-start gap-x-2.5">
                <input
                    type="checkbox"
                    checked={checked}
                    onChange={e => onCheck(r, e.target.checked)}
                    aria-label={`Select ${r.fullName}`}
                    className="mt-2 h-4 w-4 shrink-0 accent-[var(--primary-dark)]"
                />
                <span className="hidden sm:block"><Avatar name={r.fullName} size="sm" /></span>

                <div className="min-w-0 flex-1 space-y-1.5">
                    {/* Line 1: who, the tags, the match when AI has ranked, Open */}
                    <div className="flex items-start gap-x-3">
                        <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                <h3 className="min-w-0 font-display text-[15px] font-semibold leading-snug text-text-primary">
                                    <button type="button" onClick={() => (onFocus ? onFocus(r) : onOpen(r))} className="max-w-full break-words text-left underline-offset-2 hover:underline focus-visible:underline" title={onFocus ? 'Show in the quick view' : 'Open the full profile'}>
                                        {r.fullName}
                                    </button>
                                </h3>
                                {r.hasResume === true && <Tag tone="success" icon={FileText}>Resume</Tag>}
                                {r.hasResume === false && <Tag>No resume</Tag>}
                                <OriginTag record={r} />
                                {r.blacklisted && <BlacklistedTag entry={r.blacklist} />}
                                {blankFields.length > 0 && <Tag tone="warn">Missing {blankFields.join(', ')}</Tag>}
                            </div>
                            {(where || r.location) && (
                                <p className="truncate text-sm text-text-primary" title={[where, r.location].filter(Boolean).join(' · ')}>
                                    {where}{where && r.location ? <span className="text-text-secondary"> · </span> : null}{r.location && <span className="text-text-secondary">{r.location}</span>}
                                </p>
                            )}
                        </div>
                        {ranked && (
                            <div className="shrink-0 text-right">
                                <p className={`${NUM_LG} text-[26px] text-text-primary`}>{Math.round(result.matchPercent as number)}<span className="text-sm font-semibold text-text-tertiary">%</span></p>
                                <p className="text-[11px] font-medium text-text-secondary">rank {result.rank}</p>
                            </div>
                        )}
                        <button type="button" onClick={() => onOpen(r)} className={`${BTN_GHOST} -mr-1.5 -mt-1 h-8`} title="Open the full profile with the resume"><PanelRightOpen className="h-4 w-4" />Open</button>
                    </div>

                    {/* Line 2: the facts, one line; education and the role sourced for */}
                    {(hasFacts || education || r.role) && (
                        <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
                            {r.totalExpMonths !== null && <Fact label="Total">{formatMonths(r.totalExpMonths)}{r.inferred?.includes('totalExpMonths') && <WorkedOut />}</Fact>}
                            {r.relevantExpMonths !== null && <Fact label="Relevant">{formatMonths(r.relevantExpMonths)}</Fact>}
                            {r.noticePeriodDays !== null && <Fact label="Notice">{formatNotice(r.noticePeriodDays)}</Fact>}
                            {(r.currentInhand !== null || r.expectedInhand !== null) && (
                                <Fact label={r.currentInhand !== null && r.expectedInhand !== null ? 'In-hand / month' : r.expectedInhand !== null ? 'Expected / month' : 'In-hand / month'}>
                                    {r.currentInhand !== null && formatInr(r.currentInhand)}
                                    {r.currentInhand !== null && r.expectedInhand !== null && <span className="px-1 text-text-secondary" aria-label="to">→</span>}
                                    {r.expectedInhand !== null && formatInr(r.expectedInhand)}
                                </Fact>
                            )}
                            {education && <span className="inline-flex min-w-0 max-w-full items-baseline gap-x-1.5"><span className="shrink-0 text-xs font-medium text-text-secondary">Education</span><span className="truncate text-sm font-medium text-text-primary" title={education}>{education}</span></span>}
                            {r.role && <span className="inline-flex min-w-0 max-w-full items-baseline gap-x-1.5"><span className="shrink-0 text-xs font-medium text-text-secondary">Sourced for</span><span className="truncate text-sm font-medium text-primary-dark" title={r.role}>{r.role}</span></span>}
                        </div>
                    )}

                    {/* Line 3: skills and where the keywords matched */}
                    {(skills.length > 0 || hits.length > 0) && (
                        <ul aria-label="Skills and keyword matches" className="flex flex-wrap items-center gap-1">
                            {hits.map(hit => (
                                <li key={`hit-${hit.text}`}>
                                    <Tag tone={hit.required ? 'success' : 'neutral'} icon={Check} title={`${hit.text}: found ${hit.where === 'both' ? 'on the record and in the resume' : hit.where === 'resume' ? 'in the resume' : 'on the record'}`}>
                                        {hit.text}<span className="font-medium opacity-70"> · {hit.where === 'both' ? 'record + resume' : hit.where}</span>
                                    </Tag>
                                </li>
                            ))}
                            {skills.slice(0, CARD_SKILLS).map(skill => <li key={skill} className="rounded-md bg-surface-elevated px-1.5 py-px text-xs font-medium text-text-primary ring-1 ring-inset ring-border-subtle">{skill}</li>)}
                            {skills.length > CARD_SKILLS && <li className="px-1 text-xs font-medium text-text-secondary">+{skills.length - CARD_SKILLS} more</li>}
                        </ul>
                    )}

                    {/* Line 4: the remark (or AI's sentence), and the resume line around the keywords, one line each */}
                    {note && <p className="truncate text-[13px] text-text-primary" title={note}>{note}</p>}
                    {(r.resumeSnippet || resumeSummary) && (
                        <p className={`${WELL} truncate px-2.5 py-1 text-[13px] text-text-primary`} title={r.resumeSnippet ? r.resumeSnippet.map(p => p.text).join('') : resumeSummary ?? undefined}>
                            <span className="mr-1.5 text-xs font-semibold text-text-secondary">From the resume</span>
                            {r.resumeSnippet ? <Marked parts={r.resumeSnippet} /> : resumeSummary}
                        </p>
                    )}

                    {/* Line 5: status and contact */}
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <Dropdown variant="pill" value={r.status} options={STATUS_OPTIONS} onChange={s => onStatus(r, s)} label={`Status of ${r.fullName}`} />
                        {statusBusy && <Spinner className="h-3.5 w-3.5 text-text-tertiary" />}
                        {r.phone && (
                            <span className="inline-flex items-center gap-x-1">
                                <Phone className="h-3.5 w-3.5 shrink-0 text-text-tertiary" aria-hidden />
                                <a href={telHref(r.phone)} className="inline-flex items-center text-[13px] tabular-nums text-text-primary underline-offset-2 hover:text-primary-dark hover:underline">{r.phone}</a>
                                <CopyButton value={r.phone} label="phone number" />
                            </span>
                        )}
                        {r.email && (
                            <span className="inline-flex min-w-0 max-w-[260px] items-center gap-x-1">
                                <Mail className="h-3.5 w-3.5 shrink-0 text-text-tertiary" aria-hidden />
                                <a href={`mailto:${r.email}`} className="inline-flex min-w-0 items-center text-[13px] text-text-primary underline-offset-2 hover:text-primary-dark hover:underline"><span className="truncate">{r.email}</span></a>
                                <CopyButton value={r.email} label="email" />
                            </span>
                        )}
                        {hasDetails && !onFocus && (
                            <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} aria-controls={detailsId} className={`${BTN_GHOST} ml-auto h-8`}>
                                {open ? 'Hide details' : 'Why this match'}
                                <ChevronDown className={`h-4 w-4 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
                            </button>
                        )}
                    </div>

                    <AnimatePresence initial={false}>
                        {open && hasDetails && !onFocus && (
                            <motion.div
                                id={detailsId}
                                initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                                transition={{ duration: 0.36, ease: EASE_PATIENT }}
                                className="overflow-hidden"
                            >
                                <div className="pt-3"><MatchDetails result={result} /></div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            </div>
        </article>
    );
}
