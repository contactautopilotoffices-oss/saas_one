'use client';

import React, { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, ChevronDown, CircleHelp, FileSpreadsheet, Mail, PencilLine, Phone, UserPlus } from 'lucide-react';
import type { CandidateRecord, RecordStatus, SearchResult } from '@/backend/lib/candidates/types';
import { formatInr, formatMonths, formatNotice } from './format';
import { BTN_GHOST, CARD, CARD_HOVER, CopyButton, EASE_PATIENT, LABEL, NUM_LG, NUM_MD, NUM_SM, StatusSelect, WELL } from './ui';

/** Score bar fill. The bar length carries the value; colour stays the brand primary (no traffic-light fills). */
function CriterionBar({ label, score, weight }: { label: string; score: number; weight: number }) {
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

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="min-w-0">
            <dt className={LABEL}>{label}</dt>
            <dd className="mt-1 min-w-0 text-text-primary">{children}</dd>
        </div>
    );
}

export default function ResultCard({
    result, aiRanked, onStatus, statusBusy, onOpen,
}: {
    result: SearchResult;
    aiRanked: boolean;
    onStatus: (record: CandidateRecord, status: RecordStatus) => void;
    statusBusy: boolean;
    onOpen: (record: CandidateRecord) => void;
}) {
    const [open, setOpen] = useState(false);
    const r = result.record;
    const detailsId = `cand-details-${r.id}`;
    const where = [r.currentDesignation, r.currentOrganization].filter(Boolean).join(' @ ');
    const hasDetails = result.criteria.length > 0 || result.reasons.length > 0 || result.missing.length > 0;

    return (
        <article className={`${CARD} ${CARD_HOVER} p-4 sm:p-6`}>
            {/* Header: rank, who, match. Interior stack is 8px (Vercel tight interior). */}
            <div className="flex items-start gap-3">
                <span className={`${WELL} ${NUM_SM} inline-flex h-8 min-w-8 shrink-0 items-center justify-center px-2 text-text-secondary`} aria-label={`Rank ${result.rank}`}>
                    {result.rank}
                </span>
                <div className="min-w-0 flex-1 space-y-1">
                    <h3 className="break-words font-display text-base font-semibold leading-snug text-text-primary">{r.fullName}</h3>
                    {r.role && <p className="text-sm font-medium text-primary-dark">For {r.role}</p>}
                    {(where || r.location) && (
                        <p className="break-words text-sm text-text-secondary">
                            {where}{where && r.location ? ' · ' : ''}{r.location}
                        </p>
                    )}
                </div>
                <div className="shrink-0 text-right">
                    {result.matchPercent !== null ? (
                        <>
                            <p className={`${NUM_LG} text-text-primary`}>{Math.round(result.matchPercent)}<span className="text-base font-semibold text-text-tertiary">%</span></p>
                            <p className={`${LABEL} mt-0.5`}>Match</p>
                        </>
                    ) : (
                        <>
                            <p className={`${NUM_LG} text-text-tertiary`} title={aiRanked ? 'No score for this record' : 'AI ranking was unavailable, so results are in search order'}>—</p>
                            <p className="mt-0.5 max-w-[7rem] text-[11px] leading-tight text-text-tertiary">{aiRanked ? 'Not scored' : 'Search order, not scored'}</p>
                        </>
                    )}
                </div>
            </div>

            {result.summary && <p className="mt-4 text-sm leading-relaxed text-text-secondary">{result.summary}</p>}

            {/* Facts: numbers on the Binance number-md ramp. */}
            <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
                <Fact label="Relevant / total">
                    <span className={NUM_MD}>{formatMonths(r.relevantExpMonths)}</span>
                    <span className="block text-xs tabular-nums text-text-tertiary">of {formatMonths(r.totalExpMonths)}</span>
                </Fact>
                <Fact label="Notice"><span className={NUM_MD}>{formatNotice(r.noticePeriodDays)}</span></Fact>
                <Fact label="In-hand / month">
                    <span className={NUM_MD}>{formatInr(r.currentInhand)}<span className="px-1 text-text-tertiary" aria-label="to">→</span>{formatInr(r.expectedInhand)}</span>
                    <span className="block text-xs text-text-tertiary">current → expected</span>
                </Fact>
                <Fact label="Source">
                    <span className="flex min-w-0 items-center gap-1.5 text-sm">
                        {r.sheetName ? <FileSpreadsheet className="h-3.5 w-3.5 shrink-0 text-text-tertiary" aria-hidden /> : <UserPlus className="h-3.5 w-3.5 shrink-0 text-text-tertiary" aria-hidden />}
                        <span className="truncate" title={r.sheetName ?? 'Added by hand'}>{r.sheetName ?? 'Added by hand'}</span>
                    </span>
                </Fact>
            </dl>

            {(r.email || r.phone) && (
                <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1">
                    {r.email && (
                        <span className="inline-flex min-w-0 max-w-full items-center gap-1">
                            <Mail className="h-3.5 w-3.5 shrink-0 text-text-tertiary" aria-hidden />
                            <a href={`mailto:${r.email}`} className="inline-flex min-w-0 items-center text-sm text-text-primary underline-offset-2 hover:text-primary-dark hover:underline"><span className="truncate">{r.email}</span></a>
                            <CopyButton value={r.email} label="email" />
                        </span>
                    )}
                    {r.phone && (
                        <span className="inline-flex items-center gap-1">
                            <Phone className="h-3.5 w-3.5 shrink-0 text-text-tertiary" aria-hidden />
                            <a href={`tel:${r.phone.replace(/[^\d+]/g, '')}`} className="inline-flex items-center text-sm tabular-nums text-text-primary underline-offset-2 hover:text-primary-dark hover:underline">{r.phone}</a>
                            <CopyButton value={r.phone} label="phone number" />
                        </span>
                    )}
                </div>
            )}

            {/* Actions */}
            <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border-subtle pt-4">
                <StatusSelect value={r.status} busy={statusBusy} onChange={s => onStatus(r, s)} label={`Status of ${r.fullName}`} />
                <button type="button" onClick={() => onOpen(r)} className={BTN_GHOST}><PencilLine className="h-4 w-4" />Open</button>
                {hasDetails && (
                    <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} aria-controls={detailsId} className={`${BTN_GHOST} ml-auto`}>
                        {open ? 'Hide details' : 'Why this match'}
                        <ChevronDown className={`h-4 w-4 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
                    </button>
                )}
            </div>

            <AnimatePresence initial={false}>
                {open && hasDetails && (
                    <motion.div
                        id={detailsId}
                        initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.36, ease: EASE_PATIENT }}
                        className="overflow-hidden"
                    >
                        <div className="grid gap-4 pt-4 md:grid-cols-2">
                            {result.criteria.length > 0 && (
                                <div className={`${WELL} p-4 md:col-span-2`}>
                                    <p className={`${LABEL} mb-3`}>Score by criterion</p>
                                    <ul className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
                                        {result.criteria.map(c => <CriterionBar key={c.key} label={c.label} score={c.score} weight={c.weight} />)}
                                    </ul>
                                </div>
                            )}
                            {result.reasons.length > 0 && (
                                <div className="min-w-0">
                                    <p className={`${LABEL} mb-2`}>Why it fits</p>
                                    <ul className="space-y-2">
                                        {result.reasons.map((x, i) => (
                                            <li key={i} className="flex gap-2 text-sm text-text-primary">
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
                                            <li key={i} className="flex gap-2 text-sm text-text-primary">
                                                <CircleHelp className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
                                                <span className="min-w-0 break-words"><span className="sr-only">Check: </span>{x}</span>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </article>
    );
}
