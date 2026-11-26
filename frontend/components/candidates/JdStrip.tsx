'use client';

import React, { useState } from 'react';
import { ChevronDown, FileText, FolderPlus, MapPin, Star, TriangleAlert, X } from 'lucide-react';
import { keywordLabel, type ConflictChoice, type SearchFilters } from '@/backend/lib/candidates/filters';
import { formatCount } from './format';
import { BTN_GHOST, BTN_SECONDARY, CARD, LABEL, WELL } from './ui';

const CONFLICT_FIELD: Record<ConflictChoice['field'], string> = { experience: 'experience', location: 'location', salary: 'salary', notice: 'notice period' };

/**
 * "From the JD" (owner 2026-11-15): what a job description was read into, under the keyword bar. The must-haves ARE
 * the starred chips in the bar (one mechanism, shown twice): each says how many more candidates the search would
 * return without it, so loosening is a deliberate click. Nice-to-haves are the unstarred chips (order only). Where
 * the JD contradicts itself, the choices are here.
 */
export default function JdStrip({ filters, update, title, fileName, withoutCounts, conflicts, onResolveConflict, onSavePosition, savedAsPosition }: {
    filters: SearchFilters;
    update: (patch: Partial<SearchFilters>) => void;
    /** The position's title when the JD came from a saved position, else the file name or "the job description". */
    title: string;
    fileName: string;
    /** Per starred chip text: how many MORE candidates the search returns without that chip; null while counting. */
    withoutCounts: Record<string, number | null>;
    conflicts: ConflictChoice[];
    onResolveConflict: (index: number, option: ConflictChoice['options'][number] | null) => void;
    onSavePosition: () => void;
    savedAsPosition: boolean;
}) {
    const [open, setOpen] = useState(true);
    const must = filters.keywords.filter(k => k.required);
    const nice = filters.keywords.filter(k => !k.required);
    const unstar = (text: string) => update({ keywords: filters.keywords.map(k => (k.text === text ? { ...k, required: false } : k)) });
    const star = (text: string) => update({ keywords: filters.keywords.map(k => (k.text === text ? { ...k, required: true } : k)) });
    const remove = (text: string) => update({ keywords: filters.keywords.filter(k => k.text !== text) });

    return (
        <section className={`${CARD} px-4 py-3`} aria-label="From the job description">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <FileText className="h-4 w-4 shrink-0 text-primary-dark" aria-hidden />
                <p className="min-w-0 flex-1 text-sm font-semibold text-text-primary">
                    From the JD <span className="font-normal text-text-secondary">· {title}{fileName && fileName !== title ? ` · ${fileName}` : ''}</span>
                    {savedAsPosition && <span className="ml-2 rounded-full bg-info/10 px-2 py-0.5 text-xs font-semibold text-stone-800">Position</span>}
                </p>
                {!savedAsPosition && <button type="button" onClick={onSavePosition} className={`${BTN_GHOST} text-primary-dark`}><FolderPlus className="h-4 w-4" />Save as a position</button>}
                <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} className={BTN_GHOST}>{open ? 'Hide' : 'Show'}<ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} /></button>
            </div>

            {open && (
                <div className="mt-3 space-y-3">
                    {conflicts.length > 0 && (
                        <ul className="space-y-2" aria-label="The job description says two different things">
                            {conflicts.map((c, i) => (
                                <li key={`${c.field}-${i}`} className={`${WELL} flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5 ring-1 ring-inset ring-warning/40`}>
                                    <TriangleAlert className="h-4 w-4 shrink-0 text-warning" aria-hidden />
                                    <span className="min-w-0 flex-1 text-sm text-text-primary"><span className="font-semibold">The JD gives two values for {CONFLICT_FIELD[c.field]}.</span>{c.note ? ` ${c.note}` : ''} Pick one, or leave it out.</span>
                                    <span className="flex flex-wrap gap-1.5">
                                        {c.options.map(o => <button key={o.label} type="button" onClick={() => onResolveConflict(i, o)} className={`${BTN_SECONDARY} h-8 px-3 text-xs`}>{o.label}</button>)}
                                        <button type="button" onClick={() => onResolveConflict(i, null)} className={`${BTN_GHOST} h-8 text-xs`}>Leave it out</button>
                                    </span>
                                </li>
                            ))}
                        </ul>
                    )}

                    <div className="grid gap-x-6 gap-y-3 md:grid-cols-2">
                        <div>
                            <p className={LABEL}>Must have <span className="font-normal text-text-tertiary">· a candidate needs at least one of each group</span></p>
                            <ul className="mt-1.5 flex flex-wrap gap-1.5">
                                {must.map(k => {
                                    const n = withoutCounts[k.text];
                                    return (
                                        <li key={k.text} className="inline-flex max-w-full items-center gap-x-1 rounded-full bg-primary/15 py-0.5 pl-2 pr-1 text-[13px] font-semibold text-text-primary ring-1 ring-inset ring-primary/40">
                                            <Star className="h-3.5 w-3.5 shrink-0 fill-current text-primary-dark" aria-hidden />
                                            <span className="truncate">{keywordLabel(k)}</span>
                                            {n !== undefined && (
                                                <button type="button" onClick={() => unstar(k.text)} title={n === null ? 'Counting…' : `${formatCount(n)} more without this. Click to make it optional.`} className="ml-0.5 rounded-full px-1.5 text-xs font-medium tabular-nums text-text-secondary hover:bg-surface hover:text-text-primary">
                                                    {n === null ? '…' : `+${formatCount(n)} without`}
                                                </button>
                                            )}
                                            <button type="button" onClick={() => remove(k.text)} aria-label={`Remove ${keywordLabel(k)}`} className="inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full text-text-tertiary hover:text-text-primary"><X className="h-3 w-3" aria-hidden /></button>
                                        </li>
                                    );
                                })}
                                {filters.locations.length > 0 && (
                                    <li className="inline-flex items-center gap-x-1 rounded-full bg-muted py-0.5 pl-2 pr-2.5 text-[13px] font-semibold text-text-primary ring-1 ring-inset ring-border" title="Set in the Location filter">
                                        <MapPin className="h-3.5 w-3.5 text-text-tertiary" aria-hidden />{filters.locations.join(' / ')}{filters.relocate ? <span className="font-normal text-text-secondary"> · relocate</span> : null}
                                    </li>
                                )}
                                {must.length === 0 && filters.locations.length === 0 && <li className="text-sm text-text-tertiary">None: star a chip in the bar to make it compulsory.</li>}
                            </ul>
                        </div>
                        <div>
                            <p className={LABEL}>Nice to have <span className="font-normal text-text-tertiary">· only changes the order</span></p>
                            <ul className="mt-1.5 flex flex-wrap gap-1.5">
                                {nice.map(k => (
                                    <li key={k.text} className="inline-flex max-w-full items-center gap-x-0.5 rounded-full bg-muted py-0.5 pl-1 pr-1 text-[13px] font-semibold text-text-primary ring-1 ring-inset ring-border">
                                        <button type="button" onClick={() => star(k.text)} aria-label={`Make ${keywordLabel(k)} compulsory`} title="Make it a must-have" className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-text-tertiary hover:text-text-primary"><Star className="h-3.5 w-3.5" aria-hidden /></button>
                                        <span className="truncate">{keywordLabel(k)}</span>
                                        <button type="button" onClick={() => remove(k.text)} aria-label={`Remove ${keywordLabel(k)}`} className="inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full text-text-tertiary hover:text-text-primary"><X className="h-3 w-3" aria-hidden /></button>
                                    </li>
                                ))}
                                {nice.length === 0 && <li className="text-sm text-text-tertiary">None.</li>}
                            </ul>
                        </div>
                    </div>
                </div>
            )}
        </section>
    );
}
