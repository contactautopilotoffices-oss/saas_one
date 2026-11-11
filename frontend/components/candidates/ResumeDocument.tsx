'use client';

import React, { useMemo, useState } from 'react';
import { Mail, MapPin, Phone } from 'lucide-react';
import { EDUCATION_TYPES, NO_QUALIFICATION } from '@/backend/lib/candidates/filters';
import { formatMonth, formatResume, type ResumeBlock } from '@/backend/lib/candidates/resume-format';
import { markKeywords } from '@/backend/lib/candidates/snippet';
import type { CandidateRecord } from '@/backend/lib/candidates/types';
import { Marked } from './ui';

/**
 * The resume as the candidate's workspace shows it (owner 2026-11-11: "structured properly for readability and
 * consistency with proper bold headers"). Two parts on one page:
 *
 *   1. The profile: the same sections in the same order for every candidate (summary, experience with dates,
 *      education, skills), built from what the details reader took out of the resume. This is the consistent part.
 *   2. The resume's own text, laid out by rule (resume-format.ts): headings set apart, broken lines joined, bullets
 *      and skill lists kept. A file made from a two-column template can come out of the reader with its lines out of
 *      order; nothing here can reorder them, which is why the profile comes first and "Open original" stays one click
 *      away. "Plain text" shows the text exactly as it was read.
 *
 * The search's keywords are marked in both parts.
 */

const SECTION = 'mt-7 border-b border-border pb-1.5 font-display text-base font-bold text-text-primary first:mt-0';
const BODY = 'text-[13.5px] leading-[1.65] text-text-primary';

function Text({ value, keywords }: { value: string; keywords: string[] }) {
    return <Marked parts={markKeywords(value, keywords)} />;
}

function Block({ block, keywords }: { block: ResumeBlock; keywords: string[] }) {
    switch (block.kind) {
        case 'heading':
            return <h4 className="mt-6 border-b border-border-subtle pb-1 font-display text-sm font-bold text-primary-dark first:mt-0">{block.text}</h4>;
        case 'role':
            return <p className={`${BODY} mt-3 font-bold`}><Text value={block.text} keywords={keywords} /></p>;
        case 'paragraph':
            return <p className={`${BODY} mt-2`}><Text value={block.text} keywords={keywords} /></p>;
        case 'lines':
            return <div className={`${BODY} mt-2`}>{block.items.map((item, i) => <p key={i}><Text value={item} keywords={keywords} /></p>)}</div>;
        case 'bullets':
            return <ul className={`${BODY} mt-2 list-disc space-y-1 pl-5 marker:text-text-tertiary`}>{block.items.map((item, i) => <li key={i}><Text value={item} keywords={keywords} /></li>)}</ul>;
        case 'tags':
            return (
                <ul className="mt-2 flex flex-wrap gap-1.5">
                    {block.items.map((item, i) => <li key={i} className="rounded-lg bg-surface-elevated px-2 py-0.5 text-xs font-medium text-text-primary ring-1 ring-inset ring-border-subtle"><Text value={item} keywords={keywords} /></li>)}
                </ul>
            );
        default:
            return null;
    }
}

/** Whether the profile part has anything to show for this candidate. */
export function hasProfile(record: CandidateRecord): boolean {
    const x = record.extras;
    return !!x && (!!x.resumeSummary || x.skills.length > 0 || x.pastCompanies.length > 0 || !!x.ugQualification || !!x.pgQualification || !!x.ppgQualification);
}

export default function ResumeDocument({ record: r, text, keywords }: {
    record: CandidateRecord;
    /** The file's text as read; empty when there is no file or its text could not be read. */
    text: string;
    keywords: string[];
}) {
    const x = r.extras;
    const [plain, setPlain] = useState(false);
    const blocks = useMemo(() => formatResume(text), [text]);
    const degrees = x ? ([['Post-doctorate', x.ppgQualification], ['Post graduation', x.pgQualification], ['Graduation', x.ugQualification]] as const).filter(([, q]) => q && q.toLowerCase() !== NO_QUALIFICATION) : [];
    const educationNote = x ? [x.institute, x.degreeYear, EDUCATION_TYPES.find(t => t.id === x.educationType)?.label].filter(Boolean).join(' · ') : '';
    const role = [r.currentDesignation, r.currentOrganization].filter(Boolean).join(' at ');
    const profile = hasProfile(r);

    return (
        <article className="mx-auto max-w-[860px] break-words rounded-xl bg-surface px-5 py-6 shadow-[var(--w-shadow)] sm:px-10 sm:py-9">
            {/* Who */}
            <header className="border-b-2 border-primary/40 pb-4">
                <h3 className="font-display text-2xl font-bold leading-tight text-text-primary">{r.fullName}</h3>
                {role && <p className="mt-1 text-[15px] font-medium text-text-primary">{role}</p>}
                {(r.email || r.phone || r.location) && (
                    <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-text-secondary">
                        {r.phone && <span className="inline-flex items-center gap-1.5 tabular-nums"><Phone className="h-3.5 w-3.5" aria-hidden />{r.phone}</span>}
                        {r.email && <span className="inline-flex min-w-0 items-center gap-1.5"><Mail className="h-3.5 w-3.5 shrink-0" aria-hidden /><span className="truncate">{r.email}</span></span>}
                        {r.location && <span className="inline-flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5" aria-hidden />{r.location}</span>}
                    </p>
                )}
            </header>

            {profile && x && (
                <div className="mt-6">
                    {x.resumeSummary && (
                        <>
                            <h4 className={SECTION}>Summary</h4>
                            <p className={`${BODY} mt-2.5`}><Text value={x.resumeSummary} keywords={keywords} /></p>
                        </>
                    )}

                    {x.pastCompanies.length > 0 && (
                        <>
                            <h4 className={SECTION}>Experience</h4>
                            <ol className="mt-2.5 space-y-3">
                                {x.pastCompanies.map((job, i) => {
                                    const from = formatMonth(job.from);
                                    const to = formatMonth(job.to);
                                    const dates = from || to ? `${from ?? 'Start not stated'} – ${to ?? (from ? 'Present' : 'End not stated')}` : null;
                                    return (
                                        <li key={`${job.company}-${i}`} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
                                            <div className="min-w-0">
                                                <p className="text-sm font-bold text-text-primary"><Text value={job.designation ?? job.company} keywords={keywords} /></p>
                                                {job.designation && <p className="text-[13.5px] text-text-primary"><Text value={job.company} keywords={keywords} /></p>}
                                            </div>
                                            {dates && <p className="shrink-0 text-[13px] font-medium tabular-nums text-text-secondary">{dates}</p>}
                                        </li>
                                    );
                                })}
                            </ol>
                        </>
                    )}

                    {(degrees.length > 0 || educationNote) && (
                        <>
                            <h4 className={SECTION}>Education</h4>
                            <div className="mt-2.5 space-y-1">
                                {degrees.map(([level, degree]) => (
                                    <p key={level} className="flex flex-wrap items-baseline justify-between gap-x-4 text-sm">
                                        <span className="font-bold text-text-primary">{degree}</span>
                                        <span className="text-[13px] text-text-secondary">{level}</span>
                                    </p>
                                ))}
                                {educationNote && <p className="text-[13.5px] text-text-primary">{educationNote}</p>}
                            </div>
                        </>
                    )}

                    {x.skills.length > 0 && (
                        <>
                            <h4 className={SECTION}>Skills</h4>
                            <ul className="mt-2.5 flex flex-wrap gap-1.5">
                                {x.skills.map(skill => <li key={skill} className="rounded-lg bg-surface-elevated px-2.5 py-1 text-[13px] font-medium text-text-primary ring-1 ring-inset ring-border-subtle"><Text value={skill} keywords={keywords} /></li>)}
                            </ul>
                        </>
                    )}

                    {(x.industry || x.preferredLocations.length > 0) && (
                        <>
                            <h4 className={SECTION}>Other details</h4>
                            <dl className="mt-2.5 space-y-1 text-[13.5px] text-text-primary">
                                {x.industry && <div className="flex gap-x-2"><dt className="w-32 shrink-0 text-text-secondary">Industry</dt><dd>{x.industry}</dd></div>}
                                {x.preferredLocations.length > 0 && <div className="flex gap-x-2"><dt className="w-32 shrink-0 text-text-secondary">Would move to</dt><dd>{x.preferredLocations.join(', ')}</dd></div>}
                            </dl>
                        </>
                    )}
                    <p className="mt-4 text-xs text-text-secondary">This profile was read from the resume by AI and is laid out the same way for every candidate. Use Edit details to correct it.</p>
                </div>
            )}

            {/* The file's own words */}
            {text && (
                <section className={profile ? 'mt-8 border-t-2 border-border pt-6' : 'mt-6'} aria-label="The resume's own text">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                        <h4 className="font-display text-base font-bold text-text-primary">The resume in full</h4>
                        <div role="group" aria-label="How to show the resume's text" className="inline-grid grid-cols-2 gap-x-0.5 rounded-lg bg-surface-elevated px-0.5 py-0.5 ring-1 ring-inset ring-border-subtle">
                            {([[false, 'Formatted'], [true, 'Plain text']] as const).map(([value, label]) => (
                                <button key={label} type="button" onClick={() => setPlain(value)} aria-pressed={plain === value}
                                    className={`h-7 rounded-md px-2.5 text-xs font-semibold transition-colors ${plain === value ? 'bg-surface text-text-primary shadow-[var(--w-shadow)]' : 'text-text-secondary hover:text-text-primary'}`}>
                                    {label}
                                </button>
                            ))}
                        </div>
                    </div>
                    {plain
                        ? <div className={`${BODY} whitespace-pre-wrap`}><Text value={text} keywords={keywords} /></div>
                        : <div>{blocks.map((block, i) => <Block key={i} block={block} keywords={keywords} />)}</div>}
                    <p className="mt-5 text-xs text-text-secondary">
                        This is the text taken out of the file, tidied by rule. A resume made from a design template can come out with its lines in a different order: Open original shows the file as the candidate made it.
                    </p>
                </section>
            )}
        </article>
    );
}
