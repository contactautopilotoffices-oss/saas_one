'use client';

/**
 * Conversations: one person's messages on one day, as a transcript, with what the brain did on each turn. The person
 * is a tag (same person, same day → same tag); nobody is named.
 */
import React, { useState } from 'react';
import { ArrowLeft, ChevronRight, MessagesSquare, TriangleAlert } from 'lucide-react';
import type { ConversationSummary, TurnLabel } from '@/backend/lib/aiLayer/brain/console/types';
import type { Days, Track } from './api';
import { useView } from './BrainContext';
import { CHANNEL_LABEL, dayLabel, int, outcomeLabel, plural, timeIN, usd } from './labels';
import { Exchange, LabelControl, TraceToggle, TurnMeta } from './TurnParts';
import { Btn, Card, Chip, Empty, ErrorState, LoadingScreen, PersonTag, RoleChip, Screen, Segmented, Skeleton, Toggle, cx, s } from './ui';

type Sel = { person: string; day: string; track: Track };
const RANGES = [{ value: 1 as Days, label: '24 h' }, { value: 7 as Days, label: '7 d' }, { value: 30 as Days, label: '30 d' }];

export default function ConversationsScreen() {
    const [days, setDays] = useState<Days>(7);
    const [track, setTrack] = useState<Track>('live');
    const [flagged, setFlagged] = useState(false);
    const [sel, setSel] = useState<Sel | null>(null);
    const list = useView(api => api.conversations({ days, track, only: flagged ? 'flagged' : 'all' }), `conv:${days}:${track}:${flagged}`);
    const rows = list.data ?? [];
    const isSel = (c: ConversationSummary) => !!sel && sel.person === c.person && sel.day === c.day && sel.track === (c.shadow ? 'shadow' : 'live');

    const filters = (
        <>
            <Segmented label="Which conversations" value={track} onChange={t => { setTrack(t); setSel(null); }} options={[{ value: 'live', label: 'Live' }, { value: 'shadow', label: 'Shadow' }]} />
            <Segmented label="Period" value={days} onChange={setDays} options={RANGES} />
            <label className="flex items-center gap-[8px] text-[13px] text-(--bc-ink-2)">
                <Toggle label="Flagged only" checked={flagged} onChange={setFlagged} />Flagged only
            </label>
        </>
    );

    return (
        <Screen title="Conversations" sub="What people asked and how the brain replied. People are shown as a tag that changes every day, never by name." actions={filters}>
            {!list.res && <LoadingScreen label="Loading conversations" />}
            {list.error && <ErrorState what="conversations" message={list.error} onRetry={list.reload} />}
            {list.data && (
                rows.length === 0 ? (
                    <Card>
                        <Empty icon={MessagesSquare} title={flagged ? 'No flagged conversations' : 'No conversations yet'}>
                            {flagged
                                ? 'Nothing in this period was flagged. Switch off “Flagged only” to see every conversation.'
                                : track === 'live'
                                    ? 'Live conversations appear once the brain is live for a pilot person and they write to it.'
                                    : 'Shadow conversations appear once the brain is in shadow for a pilot person and they write to the usual bots.'}
                        </Empty>
                    </Card>
                ) : (
                    <div className={cx('grid min-w-0 items-start gap-[24px]', sel && '@5xl:grid-cols-[minmax(300px,380px)_minmax(0,1fr)]')}>
                        <ul aria-label="Conversations" className={cx('flex min-w-0 flex-col gap-[8px] transition-opacity duration-300', list.loading && 'opacity-60', sel && 'hidden @5xl:flex')}>
                            {rows.map(c => <Row key={`${c.person}|${c.day}|${c.shadow}`} c={c} on={isSel(c)} compact={!!sel} onOpen={() => setSel({ person: c.person, day: c.day, track: c.shadow ? 'shadow' : 'live' })} />)}
                        </ul>
                        {sel && <Thread key={`${sel.person}|${sel.day}|${sel.track}`} sel={sel} summary={rows.find(isSel) ?? null} onBack={() => setSel(null)} />}
                    </div>
                )
            )}
        </Screen>
    );
}

function Row({ c, on, compact, onOpen }: { c: ConversationSummary; on: boolean; compact: boolean; onOpen: () => void }) {
    return (
        <li>
            <button type="button" onClick={onOpen} aria-current={on ? 'true' : undefined}
                style={on ? { boxShadow: 'var(--bc-e3), inset 0 0 0 1px var(--bc-accent)' } : undefined}
                className={cx(s.card, s.cardHover, '@container flex w-full min-w-0 flex-col gap-[8px] p-[16px] text-left')}>
                <div className="flex w-full min-w-0 flex-wrap items-center gap-[8px]">
                    <PersonTag tag={c.person} />
                    <RoleChip role={c.role} />
                    {c.flagged > 0 && <Chip tone="warn" icon={TriangleAlert}>{c.flagged} flagged</Chip>}
                    <span className={cx(s.tab, 'ml-auto text-[12px] text-(--bc-ink-3)')}>{dayLabel(c.day)}</span>
                </div>
                <p className={cx('min-w-0 text-[13.5px] text-(--bc-ink-1)', compact ? 'line-clamp-1' : 'line-clamp-2')}>{c.preview ?? <span className="italic text-(--bc-ink-3)">No words recorded</span>}</p>
                <div className={cx(s.tab, 'flex w-full min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-(--bc-ink-3)')}>
                    <span>{timeIN(c.firstAt)}–{timeIN(c.lastAt)}</span>
                    <span>{plural(c.turns, 'message')}</span>
                    <span>{c.channels.map(ch => CHANNEL_LABEL[ch]).join(', ')}</span>
                    {!compact && <span>Last: {outcomeLabel(c.lastOutcome)}</span>}
                    <span className="ml-auto flex items-center gap-[4px]">{usd(c.costUsd, { tiny: true })}<ChevronRight className="h-3.5 w-3.5" /></span>
                </div>
            </button>
        </li>
    );
}

function Thread({ sel, summary, onBack }: { sel: Sel; summary: ConversationSummary | null; onBack: () => void }) {
    const v = useView(api => api.conversation(sel), `thread:${sel.person}:${sel.day}:${sel.track}`);
    const turns = [...(v.data ?? [])].sort((a, b) => a.at.localeCompare(b.at));
    const setLabel = (id: string, label: TurnLabel) => v.mutate(list => list.map(t => (t.id === id ? { ...t, label } : t)));
    const cost = turns.reduce((n, t) => n + (t.costUsd ?? 0), 0);

    return (
        <Card as="article" className="@container flex min-w-0 flex-col" aria-label={`Conversation with person ${sel.person}`}>
            <header className="flex flex-wrap items-center gap-[8px] border-b border-(--bc-line) p-[16px] @3xl:px-6">
                <Btn size="sm" variant="quiet" icon={ArrowLeft} onClick={onBack} className="-ml-2" aria-label="Back to all conversations">
                    <span className="@5xl:hidden">All</span>
                </Btn>
                <PersonTag tag={sel.person} />
                {summary && <RoleChip role={summary.role} />}
                <Chip tone={sel.track === 'live' ? 'ok' : 'info'}>{sel.track === 'live' ? 'Live' : 'Shadow'}</Chip>
                <span className={cx(s.tab, 'text-[12.5px] text-(--bc-ink-3)')}>{dayLabel(sel.day)}</span>
                {v.data && <span className={cx(s.tab, 'ml-auto text-[12.5px] text-(--bc-ink-3)')}>{plural(turns.length, 'message')} · {usd(cost, { tiny: true })}</span>}
            </header>
            <div className="flex min-w-0 flex-col gap-0 p-[16px] @3xl:p-6">
                {!v.res && <div className="flex flex-col gap-[16px]" role="status"><span className="sr-only">Loading the conversation…</span><Skeleton className="h-16 w-3/4" /><Skeleton className="ml-auto h-20 w-2/3" /><Skeleton className="h-16 w-1/2" /></div>}
                {v.error && <ErrorState what="this conversation" message={v.error} onRetry={v.reload} />}
                {v.data && turns.length === 0 && <Empty icon={MessagesSquare} title="Nothing left in this conversation">Its words may have been cleared after the keep period.</Empty>}
                {turns.length > 0 && (
                    <ol className={s.rows}>
                        {turns.map((t, i) => (
                            <li key={t.id} className="flex min-w-0 flex-col gap-[12px] py-5 first:pt-0 last:pb-0" aria-label={`Message ${i + 1} of ${turns.length}`}>
                                <Exchange turn={t} />
                                <div className="flex min-w-0 flex-col gap-[12px] @3xl:flex-row @3xl:items-start @3xl:justify-between">
                                    <TurnMeta turn={t} />
                                    <span className={cx(s.tab, 'shrink-0 text-[12px] text-(--bc-ink-3)')}>{t.costUsd === null ? 'not priced' : usd(t.costUsd, { tiny: true })} · {int(t.tokensIn + t.tokensOut)} tokens</span>
                                </div>
                                <TraceToggle turn={t} defaultOpen={t.flags.length > 0 && turns.length <= 3} />
                                <LabelControl turn={t} onLabelled={l => setLabel(t.id, l)} />
                            </li>
                        ))}
                    </ol>
                )}
            </div>
        </Card>
    );
}
