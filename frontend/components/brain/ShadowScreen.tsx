'use client';

/**
 * Shadow: for messages today's bots answered, what the brain would have said and done instead. Nothing here was sent.
 */
import React, { useState } from 'react';
import { Bot, Contrast } from 'lucide-react';
import type { ShadowView, TurnLabel, TurnView } from '@/backend/lib/aiLayer/brain/console/types';
import type { Days } from './api';
import { useBrain, useView } from './BrainContext';
import { CHANNEL_LABEL, dateTimeIN, int, pct, plural } from './labels';
import { Exchange, LabelControl, TraceToggle, TurnMeta } from './TurnParts';
import { Btn, Card, Empty, ErrorState, LoadingScreen, PersonTag, RoleChip, Screen, Segmented, Stat, cx, s } from './ui';

const RANGES = [{ value: 1 as Days, label: '24 h' }, { value: 7 as Days, label: '7 d' }, { value: 30 as Days, label: '30 d' }];

export default function ShadowScreen() {
    const { go } = useBrain();
    const [days, setDays] = useState<Days>(7);
    const [only, setOnly] = useState<'all' | 'unlabelled'>('all');
    const v = useView(api => api.shadow(days), `shadow:${days}`);
    const setLabel = (id: string, label: TurnLabel) => v.mutate(d => relabel(d, id, label));

    return (
        <Screen title="Shadow" sub="For messages today’s bots answered: what the brain would have said and done instead. Nothing here was sent to anyone."
            actions={<Segmented label="Period" value={days} onChange={setDays} options={RANGES} />}>
            {!v.res && <LoadingScreen label="Loading shadow results" />}
            {v.error && <ErrorState what="shadow results" message={v.error} onRetry={v.reload} />}
            {v.data && (v.data.totals.turns === 0 ? (
                <Card>
                    <Empty icon={Contrast} title="Nothing in shadow yet" action={<Btn size="sm" onClick={() => go('switches')}>Open the switches</Btn>}>
                        When the mode is Shadow, the brain reads the same messages as today’s bots, for the pilot people on the channels that are on. What it would have said appears here.
                    </Empty>
                </Card>
            ) : (
                <div className={cx('flex flex-col gap-[24px] transition-opacity duration-300', v.loading && 'opacity-60')}>
                    <Totals t={v.data.totals} />
                    <div className="flex flex-wrap items-center justify-between gap-[12px]">
                        <h3 className={s.label}>Messages, newest first</h3>
                        <Segmented size="sm" label="Show" value={only} onChange={setOnly} options={[{ value: 'all', label: 'All' }, { value: 'unlabelled', label: 'Not judged yet' }]} />
                    </div>
                    <ul className="flex min-w-0 flex-col gap-[16px]">
                        {v.data.turns.filter(t => only === 'all' || !t.label).map(t => <ShadowTurn key={t.id} turn={t} onLabelled={l => setLabel(t.id, l)} />)}
                    </ul>
                </div>
            ))}
        </Screen>
    );
}

/** A label changes the right / wrong / unlabelled counts too, so the totals stay true without a reload. */
function relabel(d: ShadowView, id: string, label: TurnLabel): ShadowView {
    const before = d.turns.find(t => t.id === id)?.label ?? null;
    const totals = { ...d.totals };
    if (before) totals[before.verdict]--; else totals.unlabelled--;
    totals[label.verdict]++;
    return { ...d, totals, turns: d.turns.map(t => (t.id === id ? { ...t, label } : t)) };
}

function Totals({ t }: { t: ShadowView['totals'] }) {
    const judged = t.right + t.wrong;
    return (
        <div className="grid grid-cols-2 gap-[16px] @3xl:grid-cols-4">
            <Stat label="Messages" value={int(t.turns)} sub={`${plural(t.wouldAnswer, 'answer')} · ${plural(t.wouldAct, 'action')} · ${int(t.wouldHandOff)} to a person`} />
            <Stat label="Judged right" value={judged ? pct(t.right / judged) : '—'} tone={judged ? 'ok' : undefined} sub={`${int(t.right)} of ${int(judged)} judged`} />
            <Stat label="Judged wrong" value={int(t.wrong)} tone={t.wrong > 0 ? 'bad' : undefined} sub="Each one became a test case" />
            <Stat label="Not judged yet" value={int(t.unlabelled)} sub="Mark them below or in Review" />
        </div>
    );
}

function ShadowTurn({ turn, onLabelled }: { turn: TurnView; onLabelled: (l: TurnLabel) => void }) {
    return (
        <Card as="li" className="@container flex min-w-0 flex-col gap-[16px] p-[16px] @3xl:p-6">
            <div className="flex min-w-0 flex-wrap items-center gap-[8px]">
                <PersonTag tag={turn.person} />
                <RoleChip role={turn.role} />
                <span className={cx(s.tab, 'text-[12px] text-(--bc-ink-3)')}>{dateTimeIN(turn.at)} · {CHANNEL_LABEL[turn.channel]}</span>
            </div>
            <p className="flex items-center gap-[8px] text-[12.5px] text-(--bc-ink-2)">
                <Bot className="h-3.5 w-3.5 text-(--bc-ink-3)" />
                Answered by today’s bot: {turn.answeredBy ? <b className="font-semibold text-(--bc-ink-1)">{turn.answeredBy}</b> : <span className="text-(--bc-ink-3)">Not recorded</span>}
            </p>
            <Exchange turn={turn} replyLabel="The brain" />
            <TurnMeta turn={turn} />
            <TraceToggle turn={turn} />
            <LabelControl turn={turn} onLabelled={onLabelled} />
        </Card>
    );
}
