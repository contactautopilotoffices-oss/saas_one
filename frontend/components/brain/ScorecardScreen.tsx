'use client';

/**
 * Scorecard: how each model does on the test set. "Unsafe" must be 0; any other value is impossible to miss (red rule,
 * octagon icon, the word UNSAFE, and its own banner at the top).
 */
import React, { useState } from 'react';
import { ClipboardCheck, FlaskConical, OctagonAlert, ShieldCheck } from 'lucide-react';
import type { ScoreModel, ScorecardView } from '@/backend/lib/aiLayer/brain/console/types';
import { useView } from './BrainContext';
import { QualityMeter } from './charts';
import { ROLE_LABEL, dateTimeIN, duration, int, pct, plural, usd } from './labels';
import { Card, CardHead, Chip, Empty, ErrorState, LoadingScreen, Num, Screen, cx, s } from './ui';

export default function ScorecardScreen() {
    const v = useView(api => api.scorecard(), 'scorecard');
    const d = v.data;
    return (
        <Screen title="Scorecard" sub="Each model against the same test messages: did it pick the right skill, answer well, and never do anything unsafe.">
            {!v.res && <LoadingScreen label="Loading the scorecard" />}
            {v.error && <ErrorState what="the scorecard" message={v.error} onRetry={v.reload} />}
            {d && (d.ranAt === null ? (
                <>
                    <Card>
                        <Empty icon={FlaskConical} title="The test set has not been run yet">
                            Results appear here after the test messages below are run against the models. Each run scores every model on the same messages.
                        </Empty>
                    </Card>
                    <Golden golden={d.golden} />
                </>
            ) : <Results d={d} />)}
        </Screen>
    );
}

function Results({ d }: { d: ScorecardView }) {
    const unsafe = d.models.filter(m => m.unsafe > 0);
    return (
        <>
            {unsafe.length > 0 && (
                <div role="alert" className={cx(s.banner, s.bannerBad, 'p-4!')}>
                    <OctagonAlert className="mt-0.5 h-6 w-6 shrink-0 text-(--bc-bad-text)" />
                    <div className="flex flex-col gap-[4px]">
                        <p className="text-[15px] font-bold tracking-wide text-(--bc-bad-text)">UNSAFE RESULTS</p>
                        {unsafe.map(m => (
                            <p key={m.model} className="text-[13.5px] text-(--bc-ink-1)">
                                <span className={s.mono}>{m.model}</span> did or showed something it must never do in {plural(m.unsafe, 'case')}. Do not put it first in the chain until this is 0.
                            </p>
                        ))}
                    </div>
                </div>
            )}
            <p className={cx(s.tab, 'text-[12.5px] text-(--bc-ink-3)')}>
                Run {dateTimeIN(d.ranAt)} · {plural(d.golden.length, 'test message')}
                {d.grader && <> · graded by <span className={s.mono}>{d.grader.model}</span>, {d.grader.audited ? `a person checked ${int(d.grader.audited)} grades and agreed with ${pct(d.grader.auditedAgree / d.grader.audited)}` : 'no grade has been checked by a person yet'}</>}
            </p>
            {d.models.length === 0 ? <Card><Empty icon={ClipboardCheck} title="No model results">The last run did not score any model.</Empty></Card> : (
                <div className="grid min-w-0 gap-[24px] @5xl:grid-cols-2">
                    {d.models.map(m => <ModelCard key={m.model} m={m} />)}
                </div>
            )}
            <Golden golden={d.golden} />
        </>
    );
}

function Metric({ k, children, sub }: { k: string; children: React.ReactNode; sub?: React.ReactNode }) {
    return (
        <div className="flex min-w-0 flex-col gap-[4px]">
            <span className={s.label}>{k}</span>
            <span className="min-w-0">{children}</span>
            {sub && <span className="text-[12px] text-(--bc-ink-3)">{sub}</span>}
        </div>
    );
}

function ModelCard({ m }: { m: ScoreModel }) {
    const [allFailed, setAllFailed] = useState(false);
    const passRate = m.cases ? m.passed / m.cases : 0;
    const bad = m.unsafe > 0;
    const failed = allFailed ? m.failed : m.failed.slice(0, 4);
    return (
        <Card as="section" aria-label={`Results for ${m.model}`} className="@container flex min-w-0 flex-col gap-[20px] p-[16px] @3xl:p-6"
            style={bad ? { boxShadow: 'var(--bc-e3), inset 0 0 0 2px var(--bc-bad)' } : undefined}>
            <div className="flex min-w-0 flex-wrap items-center gap-[8px]">
                <span className={cx(s.mono, 'min-w-0 truncate text-[14px] font-semibold text-(--bc-ink-1)')}>{m.model}</span>
                {bad ? <Chip tone="bad" icon={OctagonAlert}>UNSAFE · {m.unsafe}</Chip> : <Chip tone="ok" icon={ShieldCheck}>0 unsafe</Chip>}
            </div>

            {bad && (
                <div className="flex items-center gap-[12px] rounded-xl bg-[color-mix(in_srgb,var(--bc-bad)_8%,var(--bc-l1))] p-[12px] shadow-[inset_0_0_0_1px_var(--bc-bad)]">
                    <OctagonAlert className="h-8 w-8 shrink-0 text-(--bc-bad-text)" />
                    <div>
                        <Num tone="bad">{int(m.unsafe)} unsafe</Num>
                        <p className="text-[12.5px] text-(--bc-ink-1)">Cases where it did or showed something it must never do. This must be 0.</p>
                    </div>
                </div>
            )}

            <div className="flex min-w-0 flex-col gap-[8px]">
                <div className="flex items-baseline justify-between gap-[12px]">
                    <span className={s.label}>Passed</span>
                    <span className={cx(s.tab, 'text-[12.5px] text-(--bc-ink-3)')}>{int(m.passed)} of {int(m.cases)}</span>
                </div>
                <Num size="display">{pct(passRate)}</Num>
                <div className={s.barTrack} role="img" aria-label={`Passed ${m.passed} of ${m.cases}`}><div className={s.barFill} style={{ width: `${passRate * 100}%`, background: 'var(--bc-accent)' }} /></div>
            </div>

            <div className="grid grid-cols-2 gap-x-4 gap-y-4 @xl:grid-cols-3">
                <Metric k="Right skill, right details"><span className={cx(s.numMd, 'text-(--bc-ink-1)')}>{pct(m.toolChoice)}</span></Metric>
                <Metric k="Answer quality"><QualityMeter value={m.quality} /></Metric>
                <Metric k="Cost per message"><span className={cx(s.numMd, 'text-(--bc-ink-1)')}>{m.avgCostUsd === null ? '—' : usd(m.avgCostUsd, { tiny: true })}</span></Metric>
                <Metric k="Typical reply time"><span className={cx(s.numMd, 'text-(--bc-ink-1)')}>{duration(m.medianLatencyMs)}</span></Metric>
                <Metric k="Skills per message"><span className={cx(s.numMd, 'text-(--bc-ink-1)')}>{m.avgToolCalls.toFixed(1)}</span></Metric>
            </div>

            {m.groups.length > 0 && (
                <div className="flex min-w-0 flex-col gap-[8px]">
                    <span className={s.label}>By group</span>
                    <ul className={s.rows}>
                        {m.groups.map(g => {
                            const r = g.total ? g.passed / g.total : 0;
                            return (
                                <li key={g.group} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 py-2.5 first:pt-0.5">
                                    <span className="truncate text-[13px] text-(--bc-ink-1)">{g.group}</span>
                                    <span className={cx(s.numSm, r < 0.8 ? 'text-(--bc-warn-text)' : 'text-(--bc-ink-1)')}>{g.passed}/{g.total}</span>
                                    <div className={cx(s.barTrack, 'col-span-2')}><div className={s.barFill} style={{ width: `${r * 100}%`, background: r < 0.8 ? 'var(--bc-warn)' : 'var(--bc-teal)' }} /></div>
                                </li>
                            );
                        })}
                    </ul>
                </div>
            )}

            {m.failed.length > 0 && (
                <div className="flex min-w-0 flex-col gap-[8px]">
                    <span className={s.label}>Failed cases</span>
                    <ul className="flex flex-col gap-1.5">
                        {failed.map(f => (
                            <li key={f.id} className="flex min-w-0 gap-[8px] text-[12.5px]">
                                <span className={cx(s.mono, 'shrink-0 text-(--bc-ink-3)')}>{f.id}</span>
                                <span className="min-w-0 break-words text-(--bc-ink-2)">{f.why}</span>
                            </li>
                        ))}
                    </ul>
                    {m.failed.length > 4 && <button type="button" onClick={() => setAllFailed(a => !a)} className="self-start rounded-md text-[12.5px] font-semibold text-(--bc-ink-2) hover:text-(--bc-ink-1)">{allFailed ? 'Show fewer' : `Show all ${m.failed.length}`}</button>}
                </div>
            )}
        </Card>
    );
}

function Golden({ golden }: { golden: ScorecardView['golden'] }) {
    const groups = [...new Set(golden.map(g => g.group))];
    const [group, setGroup] = useState<string>('all');
    const shown = golden.filter(g => group === 'all' || g.group === group);
    return (
        <Card as="section" className="@container flex min-w-0 flex-col gap-[16px] p-[16px] @3xl:p-6" aria-labelledby="golden-h">
            <CardHead id="golden-h" label="Test messages" hint="What each model is asked, and what a right answer looks like."
                right={groups.length > 1 && (
                    <select aria-label="Group" className={cx(s.input, 'w-auto! min-h-[30px]! py-1! text-[12.5px]!')} value={group} onChange={e => setGroup(e.target.value)}>
                        <option value="all">All groups ({golden.length})</option>
                        {groups.map(g => <option key={g} value={g}>{g} ({golden.filter(x => x.group === g).length})</option>)}
                    </select>
                )} />
            {golden.length === 0 ? <p className="text-[13px] text-(--bc-ink-3)">No test messages yet. Messages marked in Review are added to the test set.</p> : (
                <ul className={cx(s.rows, 'max-h-[480px] overflow-y-auto pr-1')}>
                    {shown.map(g => (
                        <li key={g.id} className="grid min-w-0 gap-[4px] py-3 first:pt-0 @3xl:grid-cols-[110px_minmax(0,1fr)_minmax(0,1fr)] @3xl:gap-4">
                            <span className="flex flex-wrap items-center gap-1.5 @3xl:flex-col @3xl:items-start">
                                <span className={cx(s.mono, 'text-(--bc-ink-3)')}>{g.id}</span>
                                <span className="text-[12px] text-(--bc-ink-3)">{g.group} · {ROLE_LABEL[g.role]}</span>
                            </span>
                            <span className="min-w-0 text-[13.5px] break-words text-(--bc-ink-1)">“{g.text}”</span>
                            <span className="min-w-0 text-[12.5px] break-words text-(--bc-ink-2)"><span className="text-(--bc-ink-3)">Right answer: </span>{g.expect}</span>
                        </li>
                    ))}
                </ul>
            )}
        </Card>
    );
}
