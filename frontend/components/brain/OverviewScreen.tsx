'use client';

/** Overview: is the brain healthy? The mode and who it reaches, the headline numbers, and what needs a look. */
import React, { useState } from 'react';
import {
    Activity, ArrowRight, Check, Clock, Coins, Gauge, GraduationCap, Layers, ListChecks, Minus, OctagonAlert, Radar, ShieldCheck, TriangleAlert, Users, Wrench,
} from 'lucide-react';
import type { Overview, TurnView } from '@/backend/lib/aiLayer/brain/console/types';
import type { Days } from './api';
import { useBrain, useView } from './BrainContext';
import { BarList, BarSeries, Split } from './charts';
import {
    CHANNEL_LABEL, FLAG_LABEL, FLAG_SENTENCE, MODE_LABEL, OUTCOME_LABEL, ROLE_LABEL, bucketLabel, bucketLong, dateTimeIN, duration, int, outcomeTone,
    pct, plural, usd,
} from './labels';
import { Btn, Card, CardHead, Empty, ErrorState, FlagChips, LoadingScreen, PersonTag, Screen, Segmented, Stat, cx, s } from './ui';

const RANGES = [{ value: 1 as Days, label: '24 h' }, { value: 7 as Days, label: '7 d' }, { value: 30 as Days, label: '30 d' }];

export default function OverviewScreen() {
    const [days, setDays] = useState<Days>(7);
    const v = useView(api => api.overview(days), `overview:${days}`);
    const range = <Segmented label="Period" value={days} onChange={setDays} options={RANGES} />;

    return (
        <Screen title="Overview" sub="Is the brain healthy? What mode it is in, who it reaches, and what needs a human look." actions={range}>
            <StatusHero />
            {!v.res && <LoadingScreen label="Loading the overview" />}
            {v.error && <ErrorState what="the overview" message={v.error} onRetry={v.reload} />}
            {v.data && <Body o={v.data} busy={v.loading} />}
        </Screen>
    );
}

// ── The status hero: the one anchor of this screen ─────────────────────────────────────────────────────────────────

function StatusHero() {
    const { settings, status, go } = useBrain();
    const set = settings.view?.settings;
    const killed = !!status?.killSwitch;
    const mode = status?.mode ?? set?.mode ?? 'off';
    const word = killed ? 'Stopped' : MODE_LABEL[mode];
    const modeClass = killed ? s.modeKilled : mode === 'live' ? s.modeLive : mode === 'shadow' ? s.modeShadow : s.modeOff;
    const pilot = set?.pilotUserIds.length ?? 0;
    const who = set?.audience === 'everyone' ? 'everyone in the organisation' : `the ${plural(pilot, 'pilot person', 'pilot people')}`;
    const channels = set ? [set.channels.whatsapp && 'WhatsApp', set.channels.app_chat && 'in-app chat'].filter(Boolean) as string[] : [];
    const on = channels.length ? channels.join(' and ') : null;
    const sentence = !set ? 'Reading the switches…'
        : killed ? 'The platform kill switch has stopped the brain for every organisation. The bots that answer today handle every message.'
            : mode === 'off' ? 'Every message goes to the bots that answer today. Shadow lets the brain practise on real messages without sending anything.'
                : !on ? 'No channel is switched on, so the brain hears nothing yet.'
                    : mode === 'shadow' ? `The brain reads messages from ${who} on ${on} and records what it would have said. It sends nothing and changes nothing.`
                        : `The brain answers ${who} on ${on}. Everyone else still gets today’s bots.`;
    const chain = settings.view?.chain ?? [];

    return (
        <section aria-label="Brain status" className={cx(s.hero, modeClass, '@container p-[16px] @3xl:p-6')}>
            <div className="grid min-w-0 gap-[24px] @4xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] @4xl:items-center">
                <div className="flex min-w-0 flex-col gap-[12px]">
                    <span className={s.label}>The brain is</span>
                    <div className="flex items-center gap-[12px]">
                        <span aria-hidden="true" className={cx(s.lamp, modeClass, mode === 'live' && !killed && s.lampLive)} />
                        <span className={cx(s.numDisplay, 'text-(--bc-ink-1)')}>{word}</span>
                        {killed && <OctagonAlert className="h-6 w-6 text-(--bc-bad-text)" aria-label="Kill switch on" />}
                    </div>
                    <p className="max-w-xl text-[14px] leading-relaxed text-(--bc-ink-2)">{sentence}</p>
                    {set && (
                        <p className="flex flex-wrap items-center gap-x-[8px] gap-y-[2px] text-[12.5px] text-(--bc-ink-3)">
                            <GraduationCap className="h-3.5 w-3.5" />
                            <span>{set.learning.lessons ? `Lessons on, up to ${set.learning.maxLessons} per message` : 'Lessons off'}</span>
                            <span aria-hidden="true">·</span>
                            <button type="button" onClick={() => go('guidance')} className="rounded-sm font-semibold text-(--bc-accent-text) hover:underline">Guidance</button>
                        </p>
                    )}
                    <div><Btn size="sm" variant="quiet" onClick={() => go('switches')} className="-ml-2.5">Change the switches<ArrowRight className="h-3.5 w-3.5" /></Btn></div>
                </div>
                <dl className="grid min-w-0 grid-cols-2 gap-px overflow-hidden rounded-xl bg-(--bc-line) shadow-[inset_0_0_0_1px_var(--bc-line)]">
                    <HeroCell k="Channels">
                        {(['whatsapp', 'app_chat'] as const).map(c => {
                            const yes = !!set?.channels[c];
                            return <span key={c} className={cx('flex items-center gap-1.5', yes ? 'text-(--bc-ink-1)' : 'text-(--bc-ink-3)')}>{yes ? <Check className="h-3.5 w-3.5 text-(--bc-ok-text)" /> : <Minus className="h-3.5 w-3.5" />}{CHANNEL_LABEL[c]}<span className="sr-only">{yes ? ' on' : ' off'}</span></span>;
                        })}
                    </HeroCell>
                    <HeroCell k="Who gets it">
                        {set?.audience === 'everyone' ? <span>Everyone</span> : <span><span className={s.numMd}>{int(pilot)}</span> pilot {pilot === 1 ? 'person' : 'people'}</span>}
                    </HeroCell>
                    <HeroCell k="Kill switch">
                        {killed ? <span className="flex items-center gap-1.5 font-semibold text-(--bc-bad-text)"><OctagonAlert className="h-3.5 w-3.5" />On: stopped</span> : <span className="text-(--bc-ink-1)">Off</span>}
                    </HeroCell>
                    <HeroCell k="First model">
                        {chain.length ? <span className="min-w-0"><span className={cx(s.mono, 'block truncate text-(--bc-ink-1)')}>{chain[0]}</span><span className="text-[12px] text-(--bc-ink-3)">{chain.length > 1 ? `then ${plural(chain.length - 1, 'backup')}` : 'no backup'}</span></span> : <span className="text-(--bc-ink-3)">Not set</span>}
                    </HeroCell>
                </dl>
            </div>
        </section>
    );
}

function HeroCell({ k, children }: { k: string; children: React.ReactNode }) {
    return (
        <div className="flex min-w-0 flex-col gap-1.5 bg-(--bc-l1) p-[12px] @lg:p-4">
            <dt className={s.label}>{k}</dt>
            <dd className="flex min-w-0 flex-col gap-[4px] text-[13.5px]">{children}</dd>
        </div>
    );
}

// ── Numbers and charts ─────────────────────────────────────────────────────────────────────────────────────────────

function Body({ o, busy }: { o: Overview; busy: boolean }) {
    const { go } = useBrain();
    const [metric, setMetric] = useState<'turns' | 'cost'>('turns');
    const t = o.totals;
    const period = o.days === 1 ? 'the last 24 hours' : `the last ${o.days} days`;

    if (t.turns === 0) {
        return (
            <Card>
                <Empty icon={Radar} title={`No messages in ${period}`} action={<Btn size="sm" onClick={() => go('switches')}>Open the switches</Btn>}>
                    Numbers appear once the brain is in shadow or live for at least one pilot person, on a channel that is switched on, and someone writes to it.
                </Empty>
            </Card>
        );
    }

    const bars = o.series.map(p => ({ key: p.t, label: bucketLabel(p.t, o.bucket), long: bucketLong(p.t, o.bucket), value: metric === 'turns' ? p.turns : p.costUsd, flagged: metric === 'turns' ? p.flagged : undefined }));
    const flagShare = t.turns ? t.flagged / t.turns : 0;

    return (
        <div className={cx('flex flex-col gap-[24px] transition-opacity duration-300', busy && 'opacity-60')} aria-busy={busy}>
            {o.truncated && (
                <div className={cx(s.banner, s.bannerInfo)} role="note">
                    <Layers className="mt-0.5 h-4 w-4 shrink-0 text-(--bc-accent)" />
                    <p className="text-[13px] text-(--bc-ink-2)">More messages exist in {period} than were read. These numbers are for the newest ones.</p>
                </div>
            )}

            <div className="grid grid-cols-2 gap-[16px] @3xl:grid-cols-4">
                <Stat icon={Activity} label="Messages" value={int(t.turns)} sub={`${int(t.live)} live · ${int(t.shadow)} shadow`} />
                <Stat icon={Users} label="Conversations" value={int(t.people)} sub="One person, one day" />
                <Stat icon={ShieldCheck} label="Handled" value={pct(t.handledRate)} sub="Ended in an answer, a question or an action" />
                <Stat icon={TriangleAlert} label="Flagged" value={int(t.flagged)} tone={t.flagged > 0 ? 'warn' : undefined} sub={t.flagged > 0 ? `${pct(flagShare)} of messages need a look` : 'Nothing needs a look'} />
                <Stat icon={Coins} label="Spend" value={usd(t.costUsd)} sub={t.turnsWithoutCost > 0 ? `${plural(t.turnsWithoutCost, 'message')} not priced` : 'Measured from tokens'} />
                <Stat icon={Clock} label="Reply time" value={duration(t.medianLatencyMs)} sub={`Typical. 95% within ${duration(t.p95LatencyMs)}`} />
                <Stat icon={Gauge} label="From cache" value={pct(t.cacheHitRate)} sub="Share of prompt read from the cache" />
                <Stat icon={Wrench} label="Skills per message" value={t.toolCallsPerTurn.toFixed(1)} sub="Look-ups and actions per reply" />
            </div>

            <Card className="flex min-w-0 flex-col gap-[16px] p-[16px] @3xl:p-6">
                <CardHead label={o.bucket === 'hour' ? 'Activity by hour' : 'Activity by day'} hint="India time."
                    right={<Segmented size="sm" label="Show" value={metric} onChange={setMetric} options={[{ value: 'turns', label: 'Messages' }, { value: 'cost', label: 'Spend' }]} />} />
                <BarSeries bars={bars} height={220} title={metric === 'turns' ? `Messages per ${o.bucket}` : `Spend per ${o.bucket}`} unit={metric === 'turns' ? 'messages' : 'spend'}
                    tone={metric === 'turns' ? 'teal' : 'money'} format={metric === 'turns' ? (n => int(n)) : (n => (n === 0 ? '$0' : usd(n)))} />
            </Card>

            {/* Cards keep their own height (items-start): a short card never stretches into an empty box. */}
            <div className="grid min-w-0 items-start gap-[24px] @3xl:grid-cols-2 @5xl:grid-cols-3">
                <Card className="flex min-w-0 flex-col gap-[16px] p-[16px] @3xl:p-6">
                    <CardHead label="How messages ended" />
                    <BarList rows={o.outcomes.map(x => ({ key: x.outcome, label: OUTCOME_LABEL[x.outcome] ?? x.outcome, value: x.count, display: <>{int(x.count)} <span className="text-(--bc-ink-3)">· {pct(x.count / t.turns)}</span></>, tone: outcomeTone(x.outcome) === 'neutral' ? undefined : outcomeTone(x.outcome) }))} />
                </Card>
                <Card className="flex min-w-0 flex-col gap-[16px] p-[16px] @3xl:p-6">
                    <CardHead label="Skills used" hint="How often each look-up or action ran." />
                    <BarList empty="No skill was called in this period." rows={o.skills.slice(0, 8).map(k => ({
                        key: k.skillId, label: <span className={s.mono}>{k.skillId}</span>, value: k.calls, display: int(k.calls),
                        sub: k.failed > 0 ? <span className="flex items-center gap-[4px] text-(--bc-bad-text)"><TriangleAlert className="h-3 w-3" />{plural(k.failed, 'failure')}</span> : undefined,
                    }))} />
                </Card>
                <div className="flex min-w-0 flex-col gap-[24px] @3xl:col-span-2 @3xl:grid @3xl:grid-cols-2 @3xl:items-start @5xl:col-span-1 @5xl:flex @5xl:items-stretch">
                    <Card className="flex min-w-0 flex-col gap-[16px] p-[16px] @3xl:p-6">
                        <CardHead label="Models" hint="Which model wrote the replies." />
                        <BarList empty="No model answered in this period." rows={o.models.map(m => ({
                            key: m.model, label: <span className={s.mono} title={m.model}>{m.model}</span>, value: m.turns, display: <>{int(m.turns)} <span className="text-(--bc-ink-3)">replies</span></>, tone: 'accent' as const,
                            sub: <span className={s.tab}>{usd(m.costUsd)} spent · typical reply {duration(m.medianLatencyMs)}</span>,
                        }))} />
                    </Card>
                    <Card className="flex min-w-0 flex-col gap-[20px] p-[16px] @3xl:p-6">
                        <CardHead label="Who and where" />
                        <Split label="Live and shadow" parts={[{ key: 'l', label: 'Live', value: t.live, color: 'var(--bc-ok)' }, { key: 's', label: 'Shadow', value: t.shadow, color: 'var(--bc-info)' }]} />
                        <Split label="Channels" parts={o.channels.map((c, i) => ({ key: c.channel, label: CHANNEL_LABEL[c.channel], value: c.turns, color: i ? 'var(--bc-money)' : 'var(--bc-teal)' }))} />
                        <Split label="Kind of login" parts={o.roles.map((r, i) => ({ key: r.role, label: ROLE_LABEL[r.role], value: r.turns, color: ['var(--bc-teal)', 'var(--bc-money)', 'var(--bc-ink-3)', 'var(--bc-ink-4)'][i % 4] }))} />
                    </Card>
                </div>
            </div>

            <div className="grid min-w-0 items-start gap-[24px] @5xl:grid-cols-3">
                <Card className="flex min-w-0 flex-col gap-[16px] p-[16px] @3xl:p-6">
                    <CardHead label="Flags" hint="Reasons a message is worth a human look." />
                    {o.flags.length === 0 ? (
                        <p className="flex items-center gap-[8px] text-[13px] text-(--bc-ink-2)"><ShieldCheck className="h-4 w-4 text-(--bc-ok-text)" />No flags in {period}.</p>
                    ) : (
                        <ul className={s.rows}>
                            {o.flags.map(f => (
                                <li key={f.flag} className="flex gap-[12px] py-3 first:pt-1 last:pb-1">
                                    <span className={cx(s.numMd, 'w-8 shrink-0 text-right text-(--bc-warn-text)')}>{int(f.count)}</span>
                                    <span className="min-w-0">
                                        <span className="block text-[13px] font-semibold text-(--bc-ink-1)">{FLAG_LABEL[f.flag]}</span>
                                        <span className="block text-[12.5px] leading-snug text-(--bc-ink-3)">{FLAG_SENTENCE[f.flag]}</span>
                                    </span>
                                </li>
                            ))}
                        </ul>
                    )}
                </Card>
                <Card className="flex min-w-0 flex-col gap-[16px] p-[16px] @3xl:p-6 @5xl:col-span-2">
                    <CardHead label="Latest flagged, not yet judged" right={o.latestFlagged.length > 0 && <Btn size="sm" icon={ListChecks} onClick={() => go('review')}>Review them</Btn>} />
                    {o.latestFlagged.length === 0
                        ? <p className="flex items-center gap-[8px] text-[13px] text-(--bc-ink-2)"><ShieldCheck className="h-4 w-4 text-(--bc-ok-text)" />Nothing waiting. Flagged messages appear here until someone marks them right or wrong.</p>
                        : <ul className={s.rows}>{o.latestFlagged.map(turn => <FlaggedRow key={turn.id} turn={turn} />)}</ul>}
                </Card>
            </div>
        </div>
    );
}

function FlaggedRow({ turn }: { turn: TurnView }) {
    return (
        <li className="flex min-w-0 flex-col gap-[8px] py-3 first:pt-1 last:pb-1">
            <div className="flex flex-wrap items-center gap-[8px]">
                <PersonTag tag={turn.person} />
                <span className={cx(s.tab, 'text-[12px] text-(--bc-ink-3)')}>{dateTimeIN(turn.at)} · {CHANNEL_LABEL[turn.channel]}{turn.shadow ? ' · shadow' : ''}</span>
                <FlagChips flags={turn.flags} />
            </div>
            <p className="line-clamp-2 text-[13.5px] text-(--bc-ink-1)">{turn.userText ?? <span className="italic text-(--bc-ink-3)">No words recorded</span>}</p>
            {turn.replyText && <p className="line-clamp-2 border-l-2 border-(--bc-accent)/40 pl-3 text-[13px] text-(--bc-ink-2)">{turn.replyText}</p>}
        </li>
    );
}
