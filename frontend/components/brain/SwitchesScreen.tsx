'use client';

/**
 * Switches: every brain setting, grouped. Edits stay local (the draft shared with Skills) until the "Review changes"
 * bar saves them. Names appear ONLY in the pilot picker here, and never next to a message.
 */
import React, { useId, useState } from 'react';
import { Compass, Contrast, Cpu, GraduationCap, History, KeyRound, Lock, Power, Radio, Search, UserPlus, Users } from 'lucide-react';
import type { BrainSettings } from '@/backend/lib/aiLayer/brain/config';
import type { KeyView, SettingsView } from '@/backend/lib/aiLayer/brain/console/types';
import { useBrain } from './BrainContext';
import { MODE_LABEL, MODE_SENTENCE, dateTimeIN, int, plural } from './labels';
import { MIN_OUTSIDE_PILOT } from './settingsDiff';
import { Btn, Card, CardHead, Chip, Empty, ErrorState, Field, LoadingScreen, NumberField, Screen, Segmented, Toggle, cx, s } from './ui';

type Edit = (fn: (d: BrainSettings) => BrainSettings) => void;

/** "was …" beside a value the draft has changed. */
function Was({ show, was }: { show: boolean; was: React.ReactNode }) {
    if (!show) return null;
    return <span className="ml-2 inline-flex items-center gap-[4px] align-middle text-[11.5px] font-medium text-(--bc-accent-text)"><span aria-hidden="true">●</span>was {was}</span>;
}

export default function SwitchesScreen() {
    const { settings: st } = useBrain();
    if (!st.res) return <Screen title="Switches"><LoadingScreen label="Loading the switches" /></Screen>;
    if (!st.res.ok || !st.view || !st.draft) return <Screen title="Switches"><ErrorState what="the switches" message={st.res.ok ? 'No settings came back.' : st.res.message} onRetry={st.reload} /></Screen>;
    const d = st.draft, v = st.view;

    return (
        <Screen title="Switches" sub="Everything the brain is allowed to do. Changes stay on this screen until you review and save them; the server checks them again.">
            <div className="grid min-w-0 items-start gap-[24px] @5xl:grid-cols-2">
                <div className="flex min-w-0 flex-col gap-[24px]">
                    <ModeCard d={d} saved={v.settings} edit={st.edit} />
                    <ChannelsCard d={d} saved={v.settings} edit={st.edit} />
                    <PilotCard d={d} saved={v.settings} edit={st.edit} people={v.people} />
                    <LearningCard d={d} saved={v.settings} edit={st.edit} />
                </div>
                <div className="flex min-w-0 flex-col gap-[24px]">
                    <LimitsCard d={d} saved={v.settings} edit={st.edit} ceilings={v.ceilings} />
                    <ModelCard d={d} saved={v.settings} edit={st.edit} chain={v.chain} />
                    <MemoryCard d={d} saved={v.settings} edit={st.edit} />
                    <KeysCard d={d} saved={v.settings} edit={st.edit} keys={v.keys} />
                    <RetentionCard d={d} saved={v.settings} edit={st.edit} />
                </div>
            </div>
            <HistoryCard history={v.history} />
        </Screen>
    );
}

interface CardProps { d: BrainSettings; saved: BrainSettings; edit: Edit }

function ModeCard({ d, saved, edit }: CardProps) {
    return (
        <Card as="section" className="@container flex flex-col gap-[20px] p-[16px] @3xl:p-6" aria-labelledby="sw-mode">
            <CardHead id="sw-mode" label="Mode and audience" />
            <div className="flex flex-col gap-[12px]">
                <span className="text-[13.5px] font-semibold">Mode<Was show={d.mode !== saved.mode} was={MODE_LABEL[saved.mode]} /></span>
                <Segmented label="Mode" value={d.mode} onChange={mode => edit(x => ({ ...x, mode }))} className="self-start"
                    options={[{ value: 'off', label: 'Off', icon: Power }, { value: 'shadow', label: 'Shadow', icon: Contrast }, { value: 'live', label: 'Live', icon: Radio }]} />
                <p className="text-[13px] leading-relaxed text-(--bc-ink-2)">{MODE_SENTENCE[d.mode]}</p>
            </div>
            <div className="flex flex-col gap-[12px] border-t border-(--bc-line) pt-5">
                <span className="text-[13.5px] font-semibold">Who gets it<Was show={d.audience !== saved.audience} was={saved.audience === 'pilot' ? 'pilot people' : 'everyone'} /></span>
                <Segmented label="Who gets it" value={d.audience} onChange={audience => edit(x => ({ ...x, audience }))} className="self-start"
                    options={[{ value: 'pilot', label: 'Pilot people', icon: Users }, { value: 'everyone', label: 'Everyone' }]} />
                <p className="text-[13px] leading-relaxed text-(--bc-ink-2)">
                    {d.audience === 'pilot'
                        ? `Only the ${plural(d.pilotUserIds.length, 'person', 'people')} chosen below. Everyone else keeps today’s bots.`
                        : 'Everyone with a login in this organisation who writes on a channel that is on.'}
                </p>
            </div>
        </Card>
    );
}

function ChannelsCard({ d, saved, edit }: CardProps) {
    const id = useId();
    return (
        <Card as="section" className="@container flex flex-col gap-[4px] p-[16px] @3xl:p-6" aria-labelledby="sw-channels">
            <CardHead id="sw-channels" label="Channels" hint="Where the brain listens. A channel that is off goes to today’s bots." />
            <div className={s.rows}>
                <Field htmlFor={`${id}w`} label={<>WhatsApp<Was show={d.channels.whatsapp !== saved.channels.whatsapp} was={saved.channels.whatsapp ? 'on' : 'off'} /></>} hint="Messages to the organisation’s WhatsApp number.">
                    <Toggle id={`${id}w`} label="WhatsApp" checked={d.channels.whatsapp} onChange={on => edit(x => ({ ...x, channels: { ...x.channels, whatsapp: on } }))} />
                </Field>
                <Field htmlFor={`${id}a`} label={<>In-app chat<Was show={d.channels.app_chat !== saved.channels.app_chat} was={saved.channels.app_chat ? 'on' : 'off'} /></>} hint="The chat inside the app.">
                    <Toggle id={`${id}a`} label="In-app chat" checked={d.channels.app_chat} onChange={on => edit(x => ({ ...x, channels: { ...x.channels, app_chat: on } }))} />
                </Field>
            </div>
        </Card>
    );
}

function PilotCard({ d, saved, edit, people }: CardProps & { people: SettingsView['people'] }) {
    const [q, setQ] = useState('');
    const id = useId();
    const chosen = new Set(d.pilotUserIds);
    const known = new Set(people.map(p => p.id));
    const unknown = d.pilotUserIds.filter(x => !known.has(x)).length;
    const tech = people.filter(p => p.isTech);
    const techMissing = tech.filter(p => !chosen.has(p.id));
    const needle = q.trim().toLowerCase();
    const shown = people
        .filter(p => !needle || p.name.toLowerCase().includes(needle) || p.role.toLowerCase().includes(needle))
        .sort((a, b) => Number(chosen.has(b.id)) - Number(chosen.has(a.id)) || a.name.localeCompare(b.name));
    const toggle = (pid: string, on: boolean) => edit(x => ({ ...x, pilotUserIds: on ? [...x.pilotUserIds, pid].slice(0, 500) : x.pilotUserIds.filter(y => y !== pid) }));
    const added = d.pilotUserIds.filter(x => !saved.pilotUserIds.includes(x)).length, removed = saved.pilotUserIds.filter(x => !d.pilotUserIds.includes(x)).length;
    // Owner 2026-11-14: nobody's messages may be traceable to them. The server refuses a pilot with one to four people
    // from outside the Tech team; this says so before the save is tried.
    const techIds = new Set(tech.map(p => p.id));
    const outside = d.pilotUserIds.filter(x => !techIds.has(x) && !d.blockedUserIds.includes(x)).length;
    const tooFew = d.mode !== 'off' && d.audience === 'pilot' && outside > 0 && outside < MIN_OUTSIDE_PILOT;

    return (
        <Card as="section" className="@container flex flex-col gap-[16px] p-[16px] @3xl:p-6" aria-labelledby="sw-pilot">
            <CardHead id="sw-pilot" label="Pilot people" hint="The only place names appear in this console. They are never shown next to a message."
                right={<Chip tone="accent"><span className={s.tab}>{int(d.pilotUserIds.length)}</span> chosen</Chip>} />
            {(added > 0 || removed > 0) && <p className="text-[12.5px] text-(--bc-accent-text)">● {[added && `${added} added`, removed && `${removed} removed`].filter(Boolean).join(', ')} since the last save</p>}
            {d.audience === 'everyone' && (
                <p className={cx(s.banner, s.bannerInfo, 'text-[12.5px] text-(--bc-ink-2)')}>Who gets it is set to Everyone, so this list is not used right now. It is kept for when you switch back to pilot people.</p>
            )}
            <div className="flex flex-col gap-[8px] @lg:flex-row">
                <label htmlFor={`${id}q`} className="sr-only">Search people</label>
                <div className="relative min-w-0 flex-1">
                    <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-(--bc-ink-3)" />
                    <input id={`${id}q`} type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Search by name or role" className={cx(s.input, 'pl-9!')} autoComplete="off" />
                </div>
                <Btn icon={UserPlus} disabled={techMissing.length === 0} onClick={() => edit(x => ({ ...x, pilotUserIds: [...new Set([...x.pilotUserIds, ...tech.map(p => p.id)])].slice(0, 500) }))}
                    title={techMissing.length === 0 ? 'Everyone in the Tech team is already in the pilot' : undefined}>
                    {techMissing.length === 0 ? 'Whole Tech team added' : `Add the whole Tech team (${techMissing.length})`}
                </Btn>
            </div>
            {people.length === 0 ? (
                <Empty icon={Users} title="No people to choose from">People with a login in this organisation appear here.</Empty>
            ) : (
                <fieldset className="min-w-0">
                    <legend className="sr-only">Pilot people</legend>
                    <ul className={cx(s.well, s.rows, 'max-h-80 overflow-y-auto px-3')}>
                        {shown.length === 0 && <li className="py-6 text-center text-[13px] text-(--bc-ink-3)">Nobody matches “{q}”.</li>}
                        {shown.map(p => {
                            const on = chosen.has(p.id);
                            return (
                                <li key={p.id}>
                                    <label className="flex cursor-pointer items-center gap-[12px] py-2.5">
                                        <input type="checkbox" checked={on} onChange={e => toggle(p.id, e.target.checked)} className="h-4 w-4 shrink-0 accent-(--bc-accent)" />
                                        <span className="min-w-0 flex-1">
                                            <span className={cx('block truncate text-[13.5px]', on ? 'text-(--bc-ink-1)' : 'text-(--bc-ink-2)')}>{p.name}</span>
                                            <span className="block truncate text-[12px] text-(--bc-ink-3)">{p.role}</span>
                                        </span>
                                        {p.isTech && <Chip>Tech</Chip>}
                                    </label>
                                </li>
                            );
                        })}
                    </ul>
                </fieldset>
            )}
            {tooFew ? (
                <p role="alert" className={cx(s.banner, s.bannerWarn, 'text-[12.5px] text-(--bc-ink-1)')}>
                    Only {outside} of the chosen {outside === 1 ? 'person is' : 'people are'} from outside the Tech team. With so few, their messages could be traced back to them, so this will not be saved. Choose at least {MIN_OUTSIDE_PILOT} people from outside the Tech team, or only Tech team members.
                </p>
            ) : (
                <p className="text-[12px] leading-snug text-(--bc-ink-3)">People from outside the Tech team join the pilot {MIN_OUTSIDE_PILOT} or more at a time, so no message can be traced to one of them.</p>
            )}
            {unknown > 0 && <p className="text-[12px] text-(--bc-ink-3)">{plural(unknown, 'chosen person is', 'chosen people are')} no longer in the list (for example, the login was removed). They stay chosen until you clear the pilot.</p>}
            {d.pilotUserIds.length > 0 && <div><Btn size="sm" variant="quiet" className="-ml-2.5" onClick={() => edit(x => ({ ...x, pilotUserIds: [] }))}>Clear the pilot</Btn></div>}
        </Card>
    );
}

/**
 * Learning: judged messages as lessons. Turning lessons on is one of the changes that need an explicit "I understand"
 * (riskyChanges in settingsDiff.ts), because judged messages then steer answers for everyone who gets the brain.
 */
function LearningCard({ d, saved, edit }: CardProps) {
    const { go } = useBrain();
    const id = useId();
    const L = d.learning, S = saved.learning;
    return (
        <Card as="section" className="@container flex flex-col gap-1 p-[16px] @3xl:p-6" aria-labelledby="sw-learning">
            <CardHead id="sw-learning" icon={GraduationCap} label="Learning" hint="What the brain takes from the Tech team’s judging on the Review screen." />
            <div className={s.rows}>
                <Field htmlFor={`${id}l`} label={<>Lessons from judged messages<Was show={L.lessons !== S.lessons} was={S.lessons ? 'on' : 'off'} /></>}
                    hint="When a message arrives that is like one the Tech team judged, from the same kind of login, the brain is shown the judged example. A lesson can only steer which of the person’s own skills is used; it cannot add a skill, skip a confirmation or change access.">
                    <Toggle id={`${id}l`} label="Lessons from judged messages" checked={L.lessons} onChange={lessons => edit(x => ({ ...x, learning: { ...x.learning, lessons } }))} />
                </Field>
                <Field htmlFor={`${id}n`} label={<>Lessons shown per message<Was show={L.maxLessons !== S.maxLessons} was={S.maxLessons} /></>} hint="From 1 to 6.">
                    <NumberField id={`${id}n`} value={L.maxLessons} min={1} max={6} width="w-20!" disabled={!L.lessons}
                        onChange={n => edit(x => ({ ...x, learning: { ...x.learning, maxLessons: n } }))} />
                </Field>
            </div>
            <p className="flex flex-wrap items-center gap-x-[8px] gap-y-[4px] pt-[8px] text-[12.5px] text-(--bc-ink-3)">
                Guidance, a short note the brain keeps in view for every reply, has its own screen.
                <Btn size="sm" variant="quiet" icon={Compass} onClick={() => go('guidance')}>Open Guidance</Btn>
            </p>
        </Card>
    );
}

function LimitsCard({ d, saved, edit, ceilings }: CardProps & { ceilings: SettingsView['ceilings'] }) {
    const id = useId();
    const L = d.limits, S = saved.limits;
    const set = (k: keyof BrainSettings['limits']) => (n: number) => edit(x => ({ ...x, limits: { ...x.limits, [k]: n } }));
    const over = (v: number, c: number) => (v > c ? <span className="text-(--bc-warn-text)"> Above the platform ceiling of {c}, so {c} is used.</span> : null);
    return (
        <Card as="section" className="@container flex flex-col gap-[4px] p-[16px] @3xl:p-6" aria-labelledby="sw-limits">
            <CardHead id="sw-limits" label="Limits" hint="Each person’s limits. The platform ceilings apply on top." />
            <div className={s.rows}>
                <Field htmlFor={`${id}1`} label={<>Messages per person per hour<Was show={L.perUserPerHour !== S.perUserPerHour} was={S.perUserPerHour} /></>} hint={<>Platform ceiling: {ceilings.perUserPerHour}.{over(L.perUserPerHour, ceilings.perUserPerHour)}</>}>
                    <NumberField id={`${id}1`} value={L.perUserPerHour} min={1} max={1000} onChange={set('perUserPerHour')} />
                </Field>
                <Field htmlFor={`${id}2`} label={<>Actions per person per day<Was show={L.actionsPerUserPerDay !== S.actionsPerUserPerDay} was={S.actionsPerUserPerDay} /></>} hint={<>Tickets raised, rooms booked and so on. Platform ceiling: {ceilings.actionsPerUserPerDay}.{over(L.actionsPerUserPerDay, ceilings.actionsPerUserPerDay)}</>}>
                    <NumberField id={`${id}2`} value={L.actionsPerUserPerDay} min={1} max={1000} onChange={set('actionsPerUserPerDay')} />
                </Field>
                <Field htmlFor={`${id}3`} label={<>Look-ups per message<Was show={L.maxToolCalls !== S.maxToolCalls} was={S.maxToolCalls} /></>} hint="How many look-ups the brain may make before it has to answer. 1 to 8.">
                    <NumberField id={`${id}3`} value={L.maxToolCalls} min={1} max={8} onChange={set('maxToolCalls')} width="w-20!" />
                </Field>
                <Field htmlFor={`${id}4`} label={<>Questions in a row<Was show={L.maxQuestionsInRow !== S.maxQuestionsInRow} was={S.maxQuestionsInRow} /></>} hint="After this many questions in a row, a person takes over. 1 to 5.">
                    <NumberField id={`${id}4`} value={L.maxQuestionsInRow} min={1} max={5} onChange={set('maxQuestionsInRow')} width="w-20!" />
                </Field>
            </div>
        </Card>
    );
}

function ModelCard({ d, saved, edit, chain }: CardProps & { chain: string[] }) {
    const { go } = useBrain();
    const id = useId();
    const M = d.model, S = saved.model;
    return (
        <Card as="section" className="@container flex flex-col gap-[4px] p-[16px] @3xl:p-6" aria-labelledby="sw-model">
            <CardHead id="sw-model" label="Model" />
            <div className={s.rows}>
                <Field label={<>Effort<Was show={M.effort !== S.effort} was={S.effort} /></>} hint="Higher effort thinks for longer: slower replies, higher cost.">
                    <Segmented size="sm" label="Effort" value={M.effort} onChange={effort => edit(x => ({ ...x, model: { ...x.model, effort } }))}
                        options={[{ value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' }]} />
                </Field>
                <Field htmlFor={`${id}t`} label={<>Longest reply<Was show={M.maxTokens !== S.maxTokens} was={int(S.maxTokens)} /></>} hint="In tokens (about ¾ of a word each). 300 to 8,000.">
                    <NumberField id={`${id}t`} value={M.maxTokens} min={300} max={8000} onChange={n => edit(x => ({ ...x, model: { ...x.model, maxTokens: n } }))} suffix="tokens" />
                </Field>
                <Field htmlFor={`${id}v`} label={<>Sees photos<Was show={M.vision !== S.vision} was={S.vision ? 'yes' : 'no'} /></>} hint="Shows a photo to the model on the turn it arrives. Claude models only.">
                    <Toggle id={`${id}v`} label="Sees photos" checked={M.vision} onChange={vision => edit(x => ({ ...x, model: { ...x.model, vision } }))} />
                </Field>
                <div className="flex flex-col gap-[8px] py-3">
                    <span className="flex items-center gap-[8px] text-[13.5px] font-semibold"><Lock className="h-3.5 w-3.5 text-(--bc-ink-3)" />Models tried, in order</span>
                    {chain.length === 0 ? <p className="text-[13px] text-(--bc-ink-3)">No models set.</p> : (
                        <ol className="flex flex-col gap-1.5">
                            {chain.map((m, i) => (
                                <li key={`${m}${i}`} className="flex min-w-0 items-center gap-2.5 text-[13px]">
                                    <span className={cx(s.kbd, 'shrink-0')}>{i + 1}</span>
                                    <span className={cx(s.mono, 'truncate text-(--bc-ink-1)')}>{m}</span>
                                    {i === 0 ? <Chip tone="accent">First</Chip> : <span className="text-[12px] text-(--bc-ink-3)">if the one above fails</span>}
                                </li>
                            ))}
                        </ol>
                    )}
                    <p className="flex flex-wrap items-center gap-x-[8px] text-[12.5px] text-(--bc-ink-3)">
                        Models are chosen on the AI models screen, under Unified brain.
                        <Btn size="sm" variant="quiet" icon={Cpu} onClick={() => go('models')}>Open AI models</Btn>
                    </p>
                </div>
            </div>
        </Card>
    );
}

function MemoryCard({ d, saved, edit }: CardProps) {
    const id = useId();
    const M = d.memory, S = saved.memory;
    return (
        <Card as="section" className="@container flex flex-col gap-[4px] p-[16px] @3xl:p-6" aria-labelledby="sw-memory">
            <CardHead id="sw-memory" label="Memory" />
            <div className={s.rows}>
                <Field htmlFor={`${id}m`} label={<>Memory<Was show={M.enabled !== S.enabled} was={S.enabled ? 'on' : 'off'} /></>} hint="The brain remembers facts people tell it, such as their usual building, and what it did for them.">
                    <Toggle id={`${id}m`} label="Memory" checked={M.enabled} onChange={enabled => edit(x => ({ ...x, memory: { ...x.memory, enabled } }))} />
                </Field>
                <Field htmlFor={`${id}p`} label={<>Remembered facts kept<Was show={M.profileDays !== S.profileDays} was={`${S.profileDays} days`} /></>} hint="7 to 730 days after the fact was last used.">
                    <NumberField id={`${id}p`} value={M.profileDays} min={7} max={730} onChange={n => edit(x => ({ ...x, memory: { ...x.memory, profileDays: n } }))} suffix="days" disabled={!M.enabled} />
                </Field>
                <Field htmlFor={`${id}e`} label={<>Past actions kept<Was show={M.episodeDays !== S.episodeDays} was={`${S.episodeDays} days`} /></>} hint="7 to 730 days.">
                    <NumberField id={`${id}e`} value={M.episodeDays} min={7} max={730} onChange={n => edit(x => ({ ...x, memory: { ...x.memory, episodeDays: n } }))} suffix="days" disabled={!M.enabled} />
                </Field>
            </div>
        </Card>
    );
}

const ORDERS: Array<{ value: string; label: string; order: Array<1 | 2> }> = [
    { value: '1,2', label: 'Key 1, then 2', order: [1, 2] },
    { value: '2,1', label: 'Key 2, then 1', order: [2, 1] },
    { value: '1', label: 'Only key 1', order: [1] },
    { value: '2', label: 'Only key 2', order: [2] },
];

function KeyState({ k }: { k: KeyView | undefined }) {
    if (!k) return <Chip>Unknown</Chip>;
    if (!k.set) return <Chip tone="warn">Not set</Chip>;
    if (k.resting) return <Chip tone="info" title={k.resting.why}>Resting · {k.resting.minutesLeft} min left</Chip>;
    return <Chip tone="ok">Set</Chip>;
}

function KeysCard({ d, saved, edit, keys }: CardProps & { keys: KeyView[] }) {
    const id = useId();
    const K = d.keys, S = saved.keys;
    const order = K.order.join(',');
    return (
        <Card as="section" className="@container flex flex-col gap-[4px] p-[16px] @3xl:p-6" aria-labelledby="sw-keys">
            <CardHead id="sw-keys" icon={KeyRound} label="Claude keys" hint="Which key is tried first, and when each plan’s monthly credit resets. Key values are never shown here." />
            <div className={s.rows}>
                <Field label={<>Order<Was show={order !== S.order.join(',')} was={S.order.join(' then ')} /></>} hint="The second key takes over when the first is resting or out of credit.">
                    <select aria-label="Key order" className={cx(s.input, 'w-auto!')} value={ORDERS.some(o => o.value === order) ? order : '1,2'}
                        onChange={e => { const o = ORDERS.find(x => x.value === e.target.value); if (o) edit(x => ({ ...x, keys: { ...x.keys, order: o.order } })); }}>
                        {ORDERS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                </Field>
                {([1, 2] as const).map(slot => {
                    const k = keys.find(x => x.slot === slot);
                    const ck = `k${slot}` as const;
                    return (
                        <div key={slot} className="flex flex-col gap-[12px] py-4">
                            <div className="flex flex-wrap items-center gap-[8px]">
                                <span className="text-[13.5px] font-semibold">Key {slot}</span>
                                {k && <span className={cx(s.mono, 'text-(--bc-ink-3)')}>{k.name}</span>}
                                <KeyState k={k} />
                            </div>
                            {k?.resting && <p className="text-[12.5px] text-(--bc-ink-3)">Resting because: {k.resting.why}</p>}
                            <div className="grid gap-[12px] @md:grid-cols-2">
                                <label className="flex min-w-0 flex-col gap-1.5">
                                    <span className="text-[12.5px] text-(--bc-ink-2)">Cycle ends<Was show={K.cycleEnd[ck] !== S.cycleEnd[ck]} was={S.cycleEnd[ck] ?? 'not set'} /></span>
                                    <span className="flex gap-[8px]">
                                        <input type="date" className={s.input} value={K.cycleEnd[ck] ?? ''} onChange={e => edit(x => ({ ...x, keys: { ...x.keys, cycleEnd: { ...x.keys.cycleEnd, [ck]: e.target.value || null } } }))} />
                                        {K.cycleEnd[ck] && <Btn size="sm" variant="quiet" onClick={() => edit(x => ({ ...x, keys: { ...x.keys, cycleEnd: { ...x.keys.cycleEnd, [ck]: null } } }))}>Clear</Btn>}
                                    </span>
                                    {!K.cycleEnd[ck] && <span className="text-[12px] text-(--bc-ink-3)">Not set: the calendar month is used.</span>}
                                </label>
                                <div className="flex min-w-0 flex-col gap-1.5">
                                    <label htmlFor={`${id}c${slot}`} className="text-[12.5px] text-(--bc-ink-2)">Monthly credit<Was show={K.monthlyCreditUsd[ck] !== S.monthlyCreditUsd[ck]} was={`$${S.monthlyCreditUsd[ck]}`} /></label>
                                    <NumberField id={`${id}c${slot}`} value={K.monthlyCreditUsd[ck]} min={0} max={100000} suffix="USD" width="w-28!"
                                        onChange={n => edit(x => ({ ...x, keys: { ...x.keys, monthlyCreditUsd: { ...x.keys.monthlyCreditUsd, [ck]: n } } }))} />
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </Card>
    );
}

function RetentionCard({ d, saved, edit }: CardProps) {
    const id = useId();
    return (
        <Card as="section" className="@container flex flex-col gap-[4px] p-[16px] @3xl:p-6" aria-labelledby="sw-retention">
            <CardHead id="sw-retention" label="Message words" />
            <Field htmlFor={`${id}r`} label={<>Keep the words for<Was show={d.textRetentionDays !== saved.textRetentionDays} was={`${saved.textRetentionDays} days`} /></>} hint="After this, the words of a conversation are deleted. Counts and right / wrong marks stay. 1 to 365 days.">
                <NumberField id={`${id}r`} value={d.textRetentionDays} min={1} max={365} onChange={n => edit(x => ({ ...x, textRetentionDays: n }))} suffix="days" />
            </Field>
        </Card>
    );
}

function HistoryCard({ history }: { history: SettingsView['history'] }) {
    return (
        <Card as="section" className="flex flex-col gap-[16px] p-[16px] @3xl:p-6" aria-labelledby="sw-history">
            <CardHead id="sw-history" icon={History} label="Change log" hint="Every saved change, newest first. People in the pilot are counted, never listed." />
            {history.length === 0 ? <p className="text-[13px] text-(--bc-ink-3)">No changes saved yet. Each save is written here with who made it.</p> : (
                <ol className={s.rows}>
                    {history.map((h, i) => (
                        <li key={`${h.at}${i}`} className="grid min-w-0 gap-[4px] py-3 first:pt-0 last:pb-0 @3xl:grid-cols-[200px_minmax(0,1fr)] @3xl:gap-6">
                            <div className="text-[12.5px]">
                                <span className={cx(s.tab, 'block text-(--bc-ink-1)')}>{dateTimeIN(h.at)}</span>
                                <span className="block text-(--bc-ink-3)">{h.by}</span>
                            </div>
                            <ul className="flex min-w-0 flex-col gap-0.5 text-[13px] text-(--bc-ink-2)">
                                {h.changes.map((c, j) => <li key={j} className="break-words">{c}</li>)}
                            </ul>
                        </li>
                    ))}
                </ol>
            )}
        </Card>
    );
}
