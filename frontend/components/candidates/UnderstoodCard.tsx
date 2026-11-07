'use client';

import React from 'react';
import { Lock, Star, Tag, X } from 'lucide-react';
import { describeFilters, filterChips, type PreferredItem, type SearchFilters } from '@/backend/lib/candidates/filters';
import type { ChipKind } from '@/backend/lib/candidates/types';
import { formatCount } from './format';
import { CARD, LABEL } from './ui';

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
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-3">
            <span className="w-28 shrink-0 pt-1 text-xs font-semibold text-text-secondary">{title}</span>
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
export default function UnderstoodCard({ filters, update, preferred, onRemovePreferred, total, shown, comparedCount }: {
    filters: SearchFilters;
    update: (patch: Partial<SearchFilters>) => void;
    preferred: PreferredItem[];
    onRemovePreferred: (key: PreferredItem['key']) => void;
    total: number;
    shown: number;
    /** Set once AI has ranked. */
    comparedCount: number | null;
}) {
    const must: Chip[] = [
        ...filters.keywords.filter(k => k.required).map(k => ({ id: `kw-${k.text}`, label: k.text, onRemove: () => update({ keywords: filters.keywords.filter(x => x !== k) }) })),
        ...filterChips(filters).map(c => ({ id: c.id, label: c.label, onRemove: () => update(c.clear) })),
        ...filters.excludes.map(e => ({ id: `ex-${e}`, label: `Not: ${e}`, onRemove: () => update({ excludes: filters.excludes.filter(x => x !== e) }) })),
    ];
    const prefer: Chip[] = preferred.map(p => ({ id: p.key, label: p.label, onRemove: () => onRemovePreferred(p.key) }));
    const terms: Chip[] = filters.keywords.filter(k => !k.required).map(k => ({ id: k.text, label: k.text, onRemove: () => update({ keywords: filters.keywords.filter(x => x !== k) }) }));

    return (
        <section aria-label="What the search understood" className={`${CARD} p-4 sm:p-6`}>
            <p className={LABEL}>What the search understood</p>
            <p className="mt-2 text-sm leading-relaxed text-text-primary">{describeFilters(filters)}</p>
            <div className="mt-4 space-y-3">
                <ChipRow title="Must have" kind="must" chips={must} />
                <ChipRow title="Preferred" kind="prefer" chips={prefer} />
                <ChipRow title="Search terms" kind="keyword" chips={terms} />
            </div>
            <p className="mt-4 border-t border-border-subtle pt-3 text-xs text-text-secondary">
                <Num>{formatCount(total)}</Num> {total === 1 ? 'record' : 'records'} matched the must-haves
                {comparedCount !== null && <>{' · '}AI compared <Num>{formatCount(comparedCount)}</Num></>}
                {' · '}{comparedCount !== null ? 'showing top' : 'showing'} <Num>{formatCount(shown)}</Num>
            </p>
        </section>
    );
}
