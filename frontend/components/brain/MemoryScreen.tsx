'use client';

/** Memory: totals only. Nobody's memory is shown; a person can ask the brain what it remembers and tell it to forget. */
import React from 'react';
import { Archive, BookMarked, EyeOff, Users } from 'lucide-react';
import { useBrain, useView } from './BrainContext';
import { BarList } from './charts';
import { int, plural } from './labels';
import { Btn, Card, CardHead, ErrorState, LoadingScreen, Screen, Stat, cx, s } from './ui';

export default function MemoryScreen() {
    const { go } = useBrain();
    const v = useView(api => api.memory(), 'memory');
    const d = v.data;
    const facts = d ? d.facts.reduce((n, f) => n + f.count, 0) : 0;

    return (
        <Screen title="Memory" sub="What the brain keeps between conversations, as totals.">
            <div className={cx(s.banner, s.bannerInfo, 'items-start p-4!')} role="note">
                <EyeOff className="mt-0.5 h-5 w-5 shrink-0 text-(--bc-accent)" />
                <div className="flex flex-col gap-[4px]">
                    <p className="text-[14px] font-semibold text-(--bc-ink-1)">Nobody’s memory is shown here.</p>
                    <p className="text-[13px] leading-relaxed text-(--bc-ink-2)">
                        This screen counts what is kept; it never shows what is kept about anyone. A person can ask the brain “what do you remember about me?”, and tell it “forget that” or “forget everything”.
                    </p>
                </div>
            </div>
            {!v.res && <LoadingScreen label="Loading memory totals" />}
            {v.error && <ErrorState what="memory totals" message={v.error} onRetry={v.reload} />}
            {d && (
                <>
                    <div className="grid grid-cols-2 gap-[16px] @3xl:grid-cols-4">
                        <Stat label="Memory" value={d.enabled ? 'On' : 'Off'} tone={d.enabled ? undefined : 'warn'} sub={d.enabled ? 'The brain keeps facts and past actions' : 'Nothing new is remembered'} />
                        <Stat icon={Users} label="People with memory" value={int(d.people)} sub="At least one remembered fact" />
                        <Stat icon={BookMarked} label="Facts remembered" value={int(facts)} sub={`Kept ${d.profileDays} days after last use`} />
                        <Stat icon={Archive} label="Past actions" value={int(d.episodes.total)} sub={`${int(d.episodes.last7Days)} in the last 7 days · kept ${d.episodeDays} days`} />
                    </div>
                    {d.people === 0 && d.episodes.total === 0 ? (
                        <Card className="p-[16px] @3xl:p-6">
                            <p className="text-[13.5px] text-(--bc-ink-2)">Nothing is remembered yet. Facts appear when people tell the brain things worth keeping, such as their usual building; past actions appear when it raises a ticket or books a room for someone.</p>
                        </Card>
                    ) : (
                        <div className="grid min-w-0 gap-[24px] @4xl:grid-cols-2">
                            <Card className="flex min-w-0 flex-col gap-[16px] p-[16px] @3xl:p-6">
                                <CardHead label="Kinds of fact" hint="How many facts of each kind are kept, across everyone." />
                                <BarList empty="No facts kept." rows={d.facts.map(f => ({ key: f.key, label: f.label, value: f.count, display: int(f.count) }))} />
                            </Card>
                            <Card className="flex min-w-0 flex-col gap-[16px] p-[16px] @3xl:p-6">
                                <CardHead label="Past actions, by skill" hint="What the brain did for people, so it can recall it later." />
                                <BarList empty="No past actions kept." rows={d.episodes.bySkill.map(k => ({ key: k.skillId, label: <span className={s.mono}>{k.skillId}</span>, value: k.count, display: int(k.count), tone: 'accent' as const }))} />
                            </Card>
                        </div>
                    )}
                    <p className="flex flex-wrap items-center gap-[8px] text-[12.5px] text-(--bc-ink-3)">
                        Facts are kept {plural(d.profileDays, 'day')} after they were last used, past actions {plural(d.episodeDays, 'day')}.
                        <Btn size="sm" variant="quiet" onClick={() => go('switches')}>Change in Switches</Btn>
                    </p>
                </>
            )}
        </Screen>
    );
}
