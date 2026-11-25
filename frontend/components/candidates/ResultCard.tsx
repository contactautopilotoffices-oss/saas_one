'use client';

import React, { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, ChevronDown, CircleHelp, FileSpreadsheet, FileText, Mail, PanelRightOpen, Phone, UserPlus } from 'lucide-react';
import { NO_QUALIFICATION } from '@/backend/lib/candidates/filters';
import { originLabel, recordOrigin, type CandidateRecord, type RecordStatus, type SearchResult } from '@/backend/lib/candidates/types';
import { telHref } from './export-csv';
import { formatInr, formatMonths, formatNotice } from './format';
import { BlacklistedTag } from './Remarks';
import { BTN_GHOST, CopyButton, Dropdown, EASE_PATIENT, initials, Marked, NUM_LG, NUM_SM, Spinner, STATUS_OPTIONS } from './ui';

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
                <div className={`rounded-lg bg-surface-elevated px-4 py-4 ${stacked ? '' : 'md:col-span-2'}`}>
                    <p className={`${SECTION_TITLE} mb-3`}>Score by criterion</p>
                    <ul className={`grid gap-x-8 gap-y-4 ${stacked ? '' : 'sm:grid-cols-2'}`}>
                        {result.criteria.map(c => <CriterionBar key={c.key} label={c.label} score={c.score} weight={c.weight} />)}
                    </ul>
                </div>
            )}
            {result.reasons.length > 0 && (
                <div className="min-w-0">
                    <p className={`${SECTION_TITLE} mb-2`}>Why it fits</p>
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
                    <p className={`${SECTION_TITLE} mb-2`}>Check:</p>
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

/** Visible keyboard focus inside the card and the quick view (the workspace's one action colour). */
export const FOCUS_IN = '[&_:is(a,button,input,select):focus-visible]:outline-2 [&_:is(a,button,input,select):focus-visible]:outline-offset-2 [&_:is(a,button,input,select):focus-visible]:outline-primary';

/** Search keywords inside a resume line: a light amber tint (with its dark-mode pair) over the shared <Marked> marks. */
export const MARK_TINT = '[&_mark]:bg-amber-100 [&_mark]:text-amber-950 dark:[&_mark]:bg-amber-300/20 dark:[&_mark]:text-amber-50';

/** A small bordered button for the card's own actions ("Open", "Why this match"), as on the search toolbar. */
export const BTN_SMALL = 'inline-flex h-8 shrink-0 items-center gap-x-1.5 rounded-lg border border-border bg-surface px-3 text-sm font-semibold text-text-primary transition-colors hover:bg-surface-elevated';

/** The status select as a small bordered pill (the shared Dropdown's pill is borderless). */
export const STATUS_PILL = '[&>button]:bg-surface [&>button]:ring-1 [&>button]:ring-inset [&>button]:ring-border';

/** A skill: small grey chip. */
export const CHIP = 'rounded-md border border-border bg-surface-elevated px-2 py-0.5 text-xs font-medium text-text-secondary';

/** Section title in the quick view and the match details. */
export const SECTION_TITLE = 'text-[13px] font-semibold text-text-primary';

const PILL_TONE = {
    green: 'bg-emerald-50 text-emerald-800 ring-emerald-200 dark:bg-emerald-400/15 dark:text-emerald-200 dark:ring-emerald-400/25',
    amber: 'bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-400/15 dark:text-amber-200 dark:ring-amber-400/25',
    grey: 'bg-surface-elevated text-text-secondary ring-border',
} as const;

/** A small rounded tag on the card: light tint, dark text of the same family, a hairline ring. */
export function Pill({ tone = 'grey', icon: Icon, title, children }: {
    tone?: keyof typeof PILL_TONE; icon?: React.ComponentType<{ className?: string }>; title?: string; children: React.ReactNode;
}) {
    return (
        <span title={title} className={`inline-flex h-[22px] max-w-full items-center gap-x-1 whitespace-nowrap rounded-md px-2 text-xs font-semibold ring-1 ring-inset ${PILL_TONE[tone]}`}>
            {Icon && <Icon className="h-3 w-3 shrink-0" aria-hidden />}
            <span className="truncate">{children}</span>
        </span>
    );
}

const ROUND_AVATAR = { md: 'h-10 w-10 text-sm', lg: 'h-12 w-12 text-base' } as const;

/** Initials in a round light-teal disc. */
export function RoundAvatar({ name, size = 'md' }: { name: string; size?: keyof typeof ROUND_AVATAR }) {
    return (
        <span aria-hidden className={`${ROUND_AVATAR[size]} inline-flex shrink-0 select-none items-center justify-center rounded-full bg-primary/10 font-display font-semibold text-primary-dark dark:bg-primary/20 dark:text-primary-light`}>
            {initials(name)}
        </span>
    );
}

/** One fact, label and value on one line, so a row of facts stays one line tall. */
function Fact({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <span className="inline-flex min-w-0 items-baseline gap-x-1.5 whitespace-nowrap">
            <span className="text-xs text-text-tertiary">{label}</span>
            <span className="text-sm font-semibold tabular-nums text-text-primary">{children}</span>
        </span>
    );
}

/** Where the record came from: the sheet, an uploaded resume, or typed in (owner 2026-11-11). */
export function OriginTag({ record }: { record: CandidateRecord }) {
    const origin = recordOrigin(record);
    const label = originLabel(record);
    return <Pill icon={origin === 'sheet' ? FileSpreadsheet : origin === 'resume' ? FileText : UserPlus} title={label}>{label}</Pill>;
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
            className={`rounded-xl bg-surface px-4 py-4 shadow-[var(--w-shadow)] transition-shadow duration-[360ms] ease-[var(--w-ease-patient)] hover:shadow-[var(--w-shadow-hover)] ${FOCUS_IN} ${onFocus ? 'cursor-pointer' : ''} ${focused ? 'ring-2 ring-primary' : ''}`}
        >
            <div className="flex items-start gap-x-3">
                <input
                    type="checkbox"
                    checked={checked}
                    onChange={e => onCheck(r, e.target.checked)}
                    aria-label={`Select ${r.fullName}`}
                    className="mt-3 h-4 w-4 shrink-0 cursor-pointer rounded accent-primary"
                />
                <span className="hidden sm:inline-flex"><RoundAvatar name={r.fullName} /></span>

                <div className="flex min-w-0 flex-1 flex-col gap-y-2">
                    {/* Who, the tags, the role line; the match on the right when AI has ranked */}
                    <div className="flex items-start gap-x-3">
                        <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                <h3 className="min-w-0 font-display text-base font-bold leading-snug text-text-primary">
                                    <button type="button" onClick={() => (onFocus ? onFocus(r) : onOpen(r))} className="max-w-full break-words rounded-sm text-left underline-offset-2 hover:underline" title={onFocus ? 'Show in the quick view' : 'Open the full profile'}>
                                        {r.fullName}
                                    </button>
                                </h3>
                                {r.hasResume === true && <Pill tone="green" icon={FileText}>Resume</Pill>}
                                {r.hasResume === false && <Pill tone="amber">No resume</Pill>}
                                <OriginTag record={r} />
                                {r.blacklisted && <BlacklistedTag entry={r.blacklist} />}
                                {blankFields.length > 0 && <Pill tone="amber">Missing {blankFields.join(', ')}</Pill>}
                            </div>
                            {(where || r.location) && (
                                <p className="mt-0.5 truncate text-sm text-text-secondary" title={[where, r.location].filter(Boolean).join(' · ')}>
                                    {where}{where && r.location ? ' · ' : null}{r.location}
                                </p>
                            )}
                        </div>
                        {ranked && (
                            <div className="shrink-0 text-right">
                                <p className={`${NUM_LG} text-[26px] text-text-primary`}>{Math.round(result.matchPercent as number)}<span className="text-sm font-semibold text-text-tertiary">%</span></p>
                                <p className="text-[11px] font-medium text-text-secondary">rank {result.rank}</p>
                            </div>
                        )}
                    </div>

                    {/* The facts on one wrapping row */}
                    {hasFacts && (
                        <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
                            {r.totalExpMonths !== null && <Fact label="Total">{formatMonths(r.totalExpMonths)}{r.inferred?.includes('totalExpMonths') && <WorkedOut />}</Fact>}
                            {r.relevantExpMonths !== null && <Fact label="Relevant">{formatMonths(r.relevantExpMonths)}</Fact>}
                            {r.noticePeriodDays !== null && <Fact label="Notice">{formatNotice(r.noticePeriodDays)}</Fact>}
                            {(r.currentInhand !== null || r.expectedInhand !== null) && (
                                <Fact label={r.currentInhand !== null && r.expectedInhand !== null ? 'In-hand / month' : r.expectedInhand !== null ? 'Expected / month' : 'In-hand / month'}>
                                    {r.currentInhand !== null && formatInr(r.currentInhand)}
                                    {r.currentInhand !== null && r.expectedInhand !== null && <span className="px-1 font-normal text-text-tertiary" aria-label="to">→</span>}
                                    {r.expectedInhand !== null && formatInr(r.expectedInhand)}
                                </Fact>
                            )}
                        </div>
                    )}

                    {/* Education and the position sourced for, a grey label each */}
                    {(education || r.role) && (
                        <div className="flex flex-col gap-y-0.5 text-sm">
                            {education && <p className="flex min-w-0 items-baseline gap-x-1.5"><span className="shrink-0 text-xs text-text-tertiary">Education</span><span className="truncate text-text-primary" title={education}>{education}</span></p>}
                            {r.role && <p className="flex min-w-0 items-baseline gap-x-1.5"><span className="shrink-0 text-xs text-text-tertiary">Sourced for</span><span className="truncate font-medium text-primary-dark dark:text-primary-light" title={r.role}>{r.role}</span></p>}
                        </div>
                    )}

                    {/* Skills and where the keywords matched */}
                    {(skills.length > 0 || hits.length > 0) && (
                        <ul aria-label="Skills and keyword matches" className="flex flex-wrap items-center gap-x-1.5 gap-y-1.5">
                            {hits.map(hit => (
                                <li key={`hit-${hit.text}`}>
                                    <Pill tone={hit.required ? 'green' : 'grey'} icon={Check} title={`${hit.text}: found ${hit.where === 'both' ? 'on the record and in the resume' : hit.where === 'resume' ? 'in the resume' : 'on the record'}`}>
                                        {hit.text}<span className="font-medium opacity-80"> · {hit.where === 'both' ? 'record + resume' : hit.where}</span>
                                    </Pill>
                                </li>
                            ))}
                            {skills.slice(0, CARD_SKILLS).map(skill => <li key={skill} className={CHIP}>{skill}</li>)}
                            {skills.length > CARD_SKILLS && <li className="px-1 text-xs font-medium text-text-secondary">+{skills.length - CARD_SKILLS} more</li>}
                        </ul>
                    )}

                    {/* The remark (or AI's sentence), and the resume line around the keywords, one line each */}
                    {note && <p className="truncate text-[13px] text-text-secondary" title={note}>{note}</p>}
                    {(r.resumeSnippet || resumeSummary) && (
                        <p className={`${MARK_TINT} truncate rounded-lg bg-surface-elevated px-3 py-2 text-[13px] text-text-primary`} title={r.resumeSnippet ? r.resumeSnippet.map(p => p.text).join('') : resumeSummary ?? undefined}>
                            <span className="mr-1.5 text-xs font-semibold text-text-secondary">From the resume</span>
                            {r.resumeSnippet ? <Marked parts={r.resumeSnippet} /> : resumeSummary}
                        </p>
                    )}

                    {/* Status, contact, and the card's actions, under a hairline */}
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border-subtle pt-3">
                        <span className={`inline-flex ${STATUS_PILL}`}>
                            <Dropdown variant="pill" value={r.status} options={STATUS_OPTIONS} onChange={s => onStatus(r, s)} label={`Status of ${r.fullName}`} />
                        </span>
                        {statusBusy && <Spinner className="h-3.5 w-3.5 text-text-tertiary" />}
                        {r.phone && (
                            <span className="inline-flex items-center gap-x-1">
                                <Phone className="h-3.5 w-3.5 shrink-0 text-text-tertiary" aria-hidden />
                                <a href={telHref(r.phone)} aria-label={`Call ${r.fullName} on ${r.phone}`} className="inline-flex items-center rounded-sm text-[13px] tabular-nums text-text-primary underline-offset-2 hover:text-primary-dark hover:underline dark:hover:text-primary-light">{r.phone}</a>
                                <CopyButton value={r.phone} label="phone number" />
                            </span>
                        )}
                        {r.email && (
                            <span className="inline-flex min-w-0 max-w-full items-center gap-x-1 sm:max-w-[280px]">
                                <Mail className="h-3.5 w-3.5 shrink-0 text-text-tertiary" aria-hidden />
                                <a href={`mailto:${r.email}`} aria-label={`Email ${r.fullName} at ${r.email}`} className="inline-flex min-w-0 items-center rounded-sm text-[13px] text-text-primary underline-offset-2 hover:text-primary-dark hover:underline dark:hover:text-primary-light"><span className="truncate">{r.email}</span></a>
                                <CopyButton value={r.email} label="email" />
                            </span>
                        )}
                        <span className="ml-auto inline-flex items-center gap-x-2">
                            {hasDetails && !onFocus && (
                                <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} aria-controls={detailsId} className={`${BTN_GHOST} h-8`}>
                                    {open ? 'Hide details' : 'Why this match'}
                                    <ChevronDown className={`h-4 w-4 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} aria-hidden />
                                </button>
                            )}
                            <button type="button" onClick={() => onOpen(r)} aria-label={`Open the full profile of ${r.fullName}`} className={BTN_SMALL} title="Open the full profile with the resume"><PanelRightOpen className="h-4 w-4" aria-hidden />Open</button>
                        </span>
                    </div>

                    <AnimatePresence initial={false}>
                        {open && hasDetails && !onFocus && (
                            <motion.div
                                id={detailsId}
                                initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                                transition={{ duration: 0.36, ease: EASE_PATIENT }}
                                className="overflow-hidden"
                            >
                                <div className="pt-1"><MatchDetails result={result} /></div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            </div>
        </article>
    );
}
