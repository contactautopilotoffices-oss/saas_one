'use client';

/** Cost and keys: spend per Claude key in its credit cycle, spend over time, by model and by skill. */
import React from 'react';
import { Coins, Info, KeyRound } from 'lucide-react';
import type { KeyCost } from '@/backend/lib/aiLayer/brain/console/types';
import { useView } from './BrainContext';
import { BarList, BarSeries, Gauge, OverBudget } from './charts';
import { dateYearIN, dayLabel, dayShort, int, plural, usd } from './labels';
import { Card, CardHead, Chip, Empty, ErrorState, LoadingScreen, Num, Screen, Stat, cx, s } from './ui';

export default function CostScreen() {
    const v = useView(api => api.cost(), 'cost');
    const d = v.data;
    return (
        <Screen title="Cost and keys" sub="What the brain spent, per Claude key and over the last 30 days.">
            <div className={cx(s.banner, s.bannerInfo)} role="note">
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-(--bc-accent)" />
                <p className="text-[13px] text-(--bc-ink-2)">These figures are what the brain measured from token counts. The Claude Console is the bill of record.</p>
            </div>
            {!v.res && <LoadingScreen label="Loading cost" />}
            {v.error && <ErrorState what="cost" message={v.error} onRetry={v.reload} />}
            {d && (
                <>
                    <div className="grid min-w-0 gap-[24px] @4xl:grid-cols-2">
                        {d.keys.length === 0 ? <Card><Empty icon={KeyRound} title="No Claude keys">Keys appear once they are set in the server’s environment.</Empty></Card> : d.keys.map(k => <KeyCard key={k.slot} k={k} />)}
                    </div>
                    {d.last30.turns === 0 ? (
                        <Card><Empty icon={Coins} title="No spend in the last 30 days">Spend appears once the brain answers in shadow or live.</Empty></Card>
                    ) : (
                        <>
                            <div className="grid grid-cols-2 gap-[16px] @3xl:grid-cols-4">
                                <Stat label="Spend, 30 days" value={usd(d.last30.costUsd)} />
                                <Stat label="Messages" value={int(d.last30.turns)} />
                                <Stat label="Per message" value={d.last30.perTurnUsd === null ? '—' : usd(d.last30.perTurnUsd, { tiny: true })} sub="Average" />
                                <Stat label="Not priced" value={int(d.last30.turnsWithoutCost)} sub={d.last30.turnsWithoutCost ? 'A model with no price on file' : 'Every message has a price'} tone={d.last30.turnsWithoutCost ? 'warn' : undefined} />
                            </div>
                            <Card className="flex min-w-0 flex-col gap-[16px] p-[16px] @3xl:p-6">
                                <CardHead label="Spend by day" hint="India time." />
                                <BarSeries tone="money" unit="spend" title="Spend by day, last 30 days" format={n => (n === 0 ? '$0' : usd(n))}
                                    bars={d.byDay.map(x => ({ key: x.day, label: dayShort(x.day), long: `${dayLabel(x.day)} · ${plural(x.turns, 'message')}`, value: x.costUsd }))} />
                            </Card>
                            <div className="grid min-w-0 gap-[24px] @4xl:grid-cols-2">
                                <Card className="flex min-w-0 flex-col gap-[16px] p-[16px] @3xl:p-6">
                                    <CardHead label="By model" />
                                    <BarList empty="No spend by model." rows={d.byModel.map(x => ({ key: x.model, label: <span className={s.mono}>{x.model}</span>, value: x.costUsd, display: usd(x.costUsd), sub: <span className={s.tab}>{plural(x.turns, 'message')} · {x.turns ? usd(x.costUsd / x.turns, { tiny: true }) : '—'} each</span>, color: 'var(--bc-money)' }))} />
                                </Card>
                                <Card className="flex min-w-0 flex-col gap-[16px] p-[16px] @3xl:p-6">
                                    <CardHead label="By skill" hint="The skill the message ended with; “none” is a plain answer." />
                                    <BarList empty="No spend by skill." rows={d.bySkill.map(x => ({ key: x.skillId, label: <span className={s.mono}>{x.skillId || 'none'}</span>, value: x.costUsd, display: usd(x.costUsd), sub: <span className={s.tab}>{plural(x.turns, 'message')}</span>, color: 'var(--bc-money)' }))} />
                                </Card>
                            </div>
                        </>
                    )}
                </>
            )}
        </Screen>
    );
}

function KeyCard({ k }: { k: KeyCost }) {
    const over = k.creditUsd > 0 && k.projectedUsd > k.creditUsd;
    const used = k.creditUsd > 0 ? k.spentUsd / k.creditUsd : 0;
    const label = `Key ${k.slot}: ${usd(k.spentUsd)} spent of ${usd(k.creditUsd)} credit this cycle; ${usd(k.projectedUsd)} expected by ${dateYearIN(k.cycleEnd)}.`;
    return (
        <Card as="section" className="@container flex min-w-0 flex-col gap-[16px] p-[16px] @3xl:p-6" aria-label={`Key ${k.slot}`}>
            <div className="flex flex-wrap items-center gap-[8px]">
                <KeyRound className="h-4 w-4 text-(--bc-ink-3)" />
                <span className={s.h2}>Key {k.slot}</span>
                <span className={cx(s.mono, 'text-(--bc-ink-3)')}>{k.name}</span>
                <span className="ml-auto">
                    {!k.set ? <Chip tone="warn">Not set</Chip> : k.resting ? <Chip tone="info" title={k.resting.why}>Resting · {k.resting.minutesLeft} min left</Chip> : <Chip tone="ok">In use</Chip>}
                </span>
            </div>
            <div className="grid min-w-0 items-center gap-[16px] @lg:grid-cols-[minmax(0,240px)_minmax(0,1fr)]">
                <div className="relative mx-auto w-full max-w-[240px]">
                    <Gauge spent={k.spentUsd} credit={k.creditUsd} projected={k.projectedUsd} label={label} />
                    <div className="absolute inset-x-0 bottom-0 flex flex-col items-center">
                        <Num tone={used >= 1 ? 'bad' : used >= 0.9 ? 'warn' : undefined}>{usd(k.spentUsd)}</Num>
                        <span className="text-[12px] text-(--bc-ink-3)">of {usd(k.creditUsd)} credit</span>
                    </div>
                </div>
                <dl className="grid min-w-0 grid-cols-2 gap-x-4 gap-y-3 text-[12.5px]">
                    <div><dt className={s.label}>Expected by cycle end</dt><dd className={cx(s.numMd, 'mt-1', over ? 'text-(--bc-bad-text)' : 'text-(--bc-ink-1)')}>{usd(k.projectedUsd)}</dd></div>
                    <div><dt className={s.label}>Messages</dt><dd className={cx(s.numMd, 'mt-1 text-(--bc-ink-1)')}>{int(k.turns)}</dd></div>
                    <div className="col-span-2"><dt className={s.label}>This cycle</dt><dd className={cx(s.tab, 'mt-1 text-(--bc-ink-1)')}>{dateYearIN(k.cycleStart)} to {dateYearIN(k.cycleEnd)}</dd>
                        {!k.cycleKnown && <dd className="mt-0.5 text-(--bc-ink-3)">No cycle date saved, so the calendar month is used. Set it in Switches → Claude keys.</dd>}</div>
                </dl>
            </div>
            {over && <OverBudget>At the current daily rate this key will pass its credit before {dateYearIN(k.cycleEnd)}. The other key takes over when it runs out.</OverBudget>}
            {k.resting && <p className="text-[12.5px] text-(--bc-ink-3)">Resting because: {k.resting.why}</p>}
            <p className="text-[12px] text-(--bc-ink-3)">Solid arc: spent so far. Dashed arc: expected by the end of the cycle.</p>
        </Card>
    );
}
