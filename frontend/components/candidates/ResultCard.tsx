'use client';

import React, { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, ChevronDown, CircleHelp, FileSpreadsheet, FileText, Mail, PanelRightOpen, Phone, UserPlus } from 'lucide-react';
import { NO_QUALIFICATION } from '@/backend/lib/candidates/filters';
import { originLabel, recordOrigin, type CandidateRecord, type RecordStatus, type SearchResult } from '@/backend/lib/candidates/types';
import { telHref } from './export-csv';
import { formatInr, formatMonths, formatNotice } from './format';
import { Avatar, BTN_GHOST, CARD, CARD_HOVER, CopyButton, Dropdown, EASE_PATIENT, LABEL, Marked, NUM_LG, NUM_MD, NUM_SM, Spinner, STATUS_OPTIONS, Tag, WELL } from './ui';

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

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="min-w-0">
            <dt className="text-xs font-medium text-text-secondary">{label}</dt>
            <dd className="mt-0.5 min-w-0 text-text-primary">{children}</dd>
        </div>
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
    return <span className="ml-1.5 whitespace-nowrap text-xs font-medium text-text-secondary" title={`Worked out from ${what} on the resume; the resume does not state it. Edit the candidate to correct it.`}>worked out</span>;
}

/**
 * One search result (owner 2026-11-11, redesign): the same content as before in about two thirds of the height.
 * New: a tick box for the bulk actions, the lines of the resume around the keywords, where the
 * record came from, and (when the quick view is beside the list) the card it shows is outlined.
 *
 * Second round (owner 2026-11-11): a click anywhere on the card opens the quick view; the text is in the full text
 * colour (grey only for the small labels); a fact with no value is left out, and education and skills from the
 * resume are shown.
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
    // Owner 2026-11-11: a fact with no value is left out (a candidate from a resume has no notice or salary; a row of
    // dashes read as "broken"). What the resume does give (education, skills) is shown instead.
    const education = highestQualification(x);
    const skills = x?.skills ?? [];
    const hasFacts = r.totalExpMonths !== null || r.relevantExpMonths !== null || r.noticePeriodDays !== null || r.currentInhand !== null || r.expectedInhand !== null || !!r.role || !!education;

    // A click anywhere on the card shows the candidate in the quick view; the controls inside keep their own job.
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
            className={`${CARD} ${CARD_HOVER} px-4 py-4 ${onFocus ? 'cursor-pointer' : ''} ${focused ? 'ring-2 ring-primary ring-offset-0' : ''}`}
        >
            <div className="flex items-start gap-x-3 gap-y-3">
                <input
                    type="checkbox"
                    checked={checked}
                    onChange={e => onCheck(r, e.target.checked)}
                    aria-label={`Select ${r.fullName}`}
                    className="mt-3 h-4 w-4 shrink-0 accent-[var(--primary-dark)]"
                />
                <span className="hidden sm:block"><Avatar name={r.fullName} /></span>

                <div className="min-w-0 flex-1">
                    {/* Who, and the match when AI has ranked */}
                    <div className="flex items-start gap-x-3 gap-y-3">
                        <div className="min-w-0 flex-1 space-y-0.5">
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                <h3 className="min-w-0 font-display text-[17px] font-semibold leading-snug text-text-primary">
                                    <button type="button" onClick={() => (onFocus ? onFocus(r) : onOpen(r))} className="max-w-full break-words text-left underline-offset-2 hover:underline focus-visible:underline" title={onFocus ? 'Show in the quick view' : 'Open the full profile'}>
                                        {r.fullName}
                                    </button>
                                </h3>
                                {/* Phase 2: a stored resume is linked to this person (absent before the resume update is applied) */}
                                {r.hasResume === true && <Tag tone="success" icon={FileText}>Resume</Tag>}
                                {r.hasResume === false && <Tag>No resume</Tag>}
                                <OriginTag record={r} />
                                {blankFields.length > 0 && <Tag tone="warn">Missing {blankFields.join(', ')}</Tag>}
                            </div>
                            {(where || r.location) && (
                                <p className="break-words text-sm font-medium text-text-primary">
                                    {where}{where && r.location ? <span className="font-normal text-text-secondary"> · </span> : null}{r.location && <span className="font-normal">{r.location}</span>}
                                </p>
                            )}
                        </div>
                        {ranked && (
                            <div className="shrink-0 text-right">
                                <p className={`${NUM_LG} text-text-primary`}>{Math.round(result.matchPercent as number)}<span className="text-base font-semibold text-text-tertiary">%</span></p>
                                <p className={`${LABEL} mt-0.5`}>Match · rank {result.rank}</p>
                            </div>
                        )}
                        <button type="button" onClick={() => onOpen(r)} className={`${BTN_GHOST} -mr-1.5 -mt-1`} title="Open the full profile with the resume"><PanelRightOpen className="h-4 w-4" />Open</button>
                    </div>

                    {/* Facts: only the ones that have a value; numbers on the Binance number-md ramp. */}
                    {hasFacts && (
                        <dl className="mt-3 flex flex-wrap gap-x-8 gap-y-2.5">
                            {r.totalExpMonths !== null && (
                                <Fact label="Total experience">
                                    <span className={NUM_MD}>{formatMonths(r.totalExpMonths)}</span>
                                    {r.inferred?.includes('totalExpMonths') && <WorkedOut />}
                                </Fact>
                            )}
                            {r.relevantExpMonths !== null && <Fact label="Relevant experience"><span className={NUM_MD}>{formatMonths(r.relevantExpMonths)}</span></Fact>}
                            {r.noticePeriodDays !== null && <Fact label="Notice"><span className={NUM_MD}>{formatNotice(r.noticePeriodDays)}</span></Fact>}
                            {(r.currentInhand !== null || r.expectedInhand !== null) && (
                                <Fact label={r.currentInhand !== null && r.expectedInhand !== null ? 'In-hand / month · current → expected' : r.expectedInhand !== null ? 'Expected in-hand / month' : 'Current in-hand / month'}>
                                    <span className={NUM_MD}>
                                        {r.currentInhand !== null && formatInr(r.currentInhand)}
                                        {r.currentInhand !== null && r.expectedInhand !== null && <span className="px-1 text-text-secondary" aria-label="to">→</span>}
                                        {r.expectedInhand !== null && formatInr(r.expectedInhand)}
                                    </span>
                                </Fact>
                            )}
                            {education && <Fact label="Education"><span className="break-words text-sm font-medium text-text-primary">{education}</span></Fact>}
                            {r.role && <Fact label="Sourced for"><span className="break-words text-sm font-medium text-primary-dark">{r.role}</span></Fact>}
                        </dl>
                    )}

                    {skills.length > 0 && (
                        <ul aria-label="Skills" className="mt-3 flex flex-wrap gap-1.5">
                            {skills.slice(0, CARD_SKILLS).map(skill => <li key={skill} className="rounded-lg bg-surface-elevated px-2 py-0.5 text-xs font-medium text-text-primary ring-1 ring-inset ring-border-subtle">{skill}</li>)}
                            {skills.length > CARD_SKILLS && <li className="px-1 py-0.5 text-xs font-medium text-text-secondary">+{skills.length - CARD_SKILLS} more</li>}
                        </ul>
                    )}

                    {note && <p className="mt-3 line-clamp-2 text-sm leading-relaxed text-text-primary">{note}</p>}

                    {/* Where in the resume the keywords stand; without keywords, what the resume says in two lines. */}
                    {(r.resumeSnippet || resumeSummary) && (
                        <p className={`${WELL} mt-3 px-3 py-2 text-[13px] leading-relaxed text-text-primary`}>
                            <span className="mr-1.5 text-xs font-semibold text-text-secondary">From the resume</span>
                            {r.resumeSnippet ? <Marked parts={r.resumeSnippet} /> : resumeSummary}
                        </p>
                    )}

                    {/* Actions */}
                    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                        <Dropdown variant="pill" value={r.status} options={STATUS_OPTIONS} onChange={s => onStatus(r, s)} label={`Status of ${r.fullName}`} />
                        {statusBusy && <Spinner className="h-3.5 w-3.5 text-text-tertiary" />}
                        {r.phone && (
                            <span className="inline-flex items-center gap-x-1 gap-y-1">
                                <Phone className="h-3.5 w-3.5 shrink-0 text-text-tertiary" aria-hidden />
                                <a href={telHref(r.phone)} className="inline-flex items-center text-sm tabular-nums text-text-primary underline-offset-2 hover:text-primary-dark hover:underline">{r.phone}</a>
                                <CopyButton value={r.phone} label="phone number" />
                            </span>
                        )}
                        {r.email && (
                            <span className="inline-flex min-w-0 max-w-[240px] items-center gap-x-1 gap-y-1">
                                <Mail className="h-3.5 w-3.5 shrink-0 text-text-tertiary" aria-hidden />
                                <a href={`mailto:${r.email}`} className="inline-flex min-w-0 items-center text-sm text-text-primary underline-offset-2 hover:text-primary-dark hover:underline"><span className="truncate">{r.email}</span></a>
                                <CopyButton value={r.email} label="email" />
                            </span>
                        )}
                        {hasDetails && !onFocus && (
                            <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} aria-controls={detailsId} className={`${BTN_GHOST} ml-auto`}>
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
                                <div className="pt-4"><MatchDetails result={result} /></div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            </div>
        </article>
    );
}
