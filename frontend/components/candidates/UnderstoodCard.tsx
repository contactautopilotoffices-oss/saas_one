'use client';

import React from 'react';
import { Lock, Star, Tag, TriangleAlert, X } from 'lucide-react';
import { describeFilters, filterChips, keywordLabel, type ConflictChoice, type PreferredItem, type SearchFilters } from '@/backend/lib/candidates/filters';
import type { ChipKind } from '@/backend/lib/candidates/types';
import { formatCount } from './format';
import { BTN_GHOST, BTN_SECONDARY, CARD, LABEL, WELL } from './ui';

const CONFLICT_FIELD: Record<ConflictChoice['field'], string> = { experience: 'experience', location: 'location', salary: 'salary', notice: 'notice period' };

const CHIP_STYLE: Record<ChipKind, { cls: string; icon: React.ComponentType<{ className?: string }> }> = {
    // Hard filter: the one solid fill. Preference: outline. Keyword: neutral. Shape differs, not only colour.
    must: { cls: 'bg-primary-dark text-white', icon: Lock },
    prefer: { cls: 'bg-surface text-primary-dark ring-1 ring-inset ring-primary/60', icon: Star },
    keyword: { cls: 'bg-surface-elevated text-text-secondary ring-1 ring-inset ring-border', icon: Tag },
};

interface Chip { id: string; label: string; onRemove: () => void }

function ChipRow({ title, kind, chips }: { title: string; kind: ChipKind; chips: Chip[] }) {
    if (!chips.length) return null;
    const { cls, icon: Icon } = CHIP_STYLE[kind];
    return (
        <div className="flex flex-col gap-x-2 gap-y-2 sm:flex-row sm:items-start sm:gap-3">
            <span className="w-24 shrink-0 pt-1 text-xs font-semibold text-text-secondary">{title}</span>
            <ul className="flex min-w-0 flex-wrap gap-1.5">
                {chips.map(c => (
                    <li key={c.id} className={`inline-flex max-w-full items-center gap-1.5 rounded-full py-0.5 pl-2.5 pr-1 text-xs font-semibold ${cls}`}>
                        <Icon className="h-3 w-3 shrink-0" aria-hidden />
                        <span className="break-words">{c.label}</span>
                        <button type="button" onClick={c.onRemove} aria-label={`Remove ${c.label}`} className="inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full opacity-80 hover:opacity-100">
                            <X className="h-3 w-3" aria-hidden />
                        </button>
                    </li>
                ))}
            </ul>
        </div>
    );
}

const Num = ({ children }: { children: React.ReactNode }) => <span className="font-semibold tabular-nums text-text-primary">{children}</span>;

/** "What the search understood": everything in force, in words, each removable with one click. */
export default function UnderstoodCard({ filters, update, preferred, onRemovePreferred, conflicts = [], onResolveConflict, total, shown, comparedCount }: {
    filters: SearchFilters;
    update: (patch: Partial<SearchFilters>) => void;
    preferred: PreferredItem[];
    onRemovePreferred: (key: PreferredItem['key']) => void;
    /** Owner 2026-11-15: where the job description contradicted itself; each is settled by one click. */
    conflicts?: ConflictChoice[];
    onResolveConflict?: (index: number, option: ConflictChoice['options'][number] | null) => void;
    total: number;
    shown: number;
    /** Set once AI has ranked. */
    comparedCount: number | null;
}) {
    const must: Chip[] = [
        ...filters.keywords.filter(k => k.required).map(k => ({ id: `kw-${k.text}`, label: keywordLabel(k), onRemove: () => update({ keywords: filters.keywords.filter(x => x !== k) }) })),
        ...filterChips(filters).map(c => ({ id: c.id, label: c.label, onRemove: () => update(c.clear) })),
        ...filters.excludes.map(e => ({ id: `ex-${e}`, label: `Not: ${e}`, onRemove: () => update({ excludes: filters.excludes.filter(x => x !== e) }) })),
    ];
    const prefer: Chip[] = preferred.map(p => ({ id: p.key, label: p.label, onRemove: () => onRemovePreferred(p.key) }));
    const terms: Chip[] = filters.keywords.filter(k => !k.required).map(k => ({ id: k.text, label: keywordLabel(k), onRemove: () => update({ keywords: filters.keywords.filter(x => x !== k) }) }));

    return (
        <section aria-label="What the search understood" className={`${CARD} px-4 py-3`}>
            {/* Redesign (owner 2026-11-11): one compact block, so the first results stay on the first screen. */}
            <p className="text-sm leading-relaxed text-text-primary"><span className={`${LABEL} mr-2`}>What the search understood</span>{describeFilters(filters)}</p>
            {conflicts.length > 0 && onResolveConflict && (
                <ul className="mt-2.5 space-y-2" aria-label="The job description says two different things">
                    {conflicts.map((c, i) => (
                        <li key={`${c.field}-${i}`} className={`${WELL} flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5 ring-1 ring-inset ring-warning/40`}>
                            <TriangleAlert className="h-4 w-4 shrink-0 text-warning" aria-hidden />
                            <span className="min-w-0 flex-1 text-sm text-text-primary">
                                <span className="font-semibold">The JD gives two values for {CONFLICT_FIELD[c.field]}.</span>{c.note ? ` ${c.note}` : ''} Pick one, or leave it out.
                            </span>
                            <span className="flex flex-wrap gap-1.5">
                                {c.options.map(o => <button key={o.label} type="button" onClick={() => onResolveConflict(i, o)} className={`${BTN_SECONDARY} h-8 px-3 text-xs`}>{o.label}</button>)}
                                <button type="button" onClick={() => onResolveConflict(i, null)} className={`${BTN_GHOST} h-8 text-xs`}>Leave it out</button>
                            </span>
                        </li>
                    ))}
                </ul>
            )}
            <div className="mt-2.5 space-y-2">
                <ChipRow title="Must have" kind="must" chips={must} />
                <ChipRow title="Preferred" kind="prefer" chips={prefer} />
                <ChipRow title="Search terms" kind="keyword" chips={terms} />
            </div>
            {/* The count of an unranked list is the heading above it; this line says what AI did with it. */}
            {comparedCount !== null && (
                <p className="mt-3 border-t border-border-subtle pt-2.5 text-xs text-text-secondary">
                    <Num>{formatCount(total)}</Num> {total === 1 ? 'record' : 'records'} matched the must-haves
                    {' · '}AI compared <Num>{formatCount(comparedCount)}</Num>
                    {' · '}showing top <Num>{formatCount(shown)}</Num>
                </p>
            )}
        </section>
    );
}
