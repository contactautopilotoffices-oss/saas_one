'use client';

/**
 * Categories & SLAs (owner 2026-11-19): the ticket categories the AI sorts into, the team each one goes to, its usual
 * priority, its SLA (one time, or one per priority) and the properties it is on (all, or chosen ones). Tech team only.
 * "Suggest categories" asks the AI only when pressed (owner: "i dont want it automatic. it must be manual"); nothing
 * changes until a person accepts a suggestion. Server: backend/lib/ticketing/categoryConfig.ts.
 */
import React, { useEffect, useId, useState } from 'react';
import { ChevronDown, Lightbulb, Pencil, Plus, Power, RefreshCw, Sparkles, Tags, X } from 'lucide-react';
import type { CategoriesView, CategoryView, SuggestionView } from '@/backend/lib/ticketing/categoryConfig';
import type { CategoriesReply, CategoryBody, Plain } from './api';
import { useBrain } from './BrainContext';
import { plural } from './labels';
import { Btn, Card, CardHead, Chip, Dialog, Empty, ErrorState, Field, LoadingScreen, Screen, Segmented, cx, s } from './ui';

// Kept here (not imported) so no server code reaches the browser.
const TEAMS = [['technical', 'Technical'], ['plumbing', 'Plumbing'], ['soft_services', 'Soft services'], ['vendor', 'Vendor'], ['it', 'IT']] as const;
const PRIORITIES = [['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['urgent', 'Urgent']] as const;
const teamName = (t: string | null | undefined) => TEAMS.find(x => x[0] === t)?.[1] ?? 'No team';
const prioName = (p: string | null | undefined) => PRIORITIES.find(x => x[0] === p)?.[1] ?? 'Not set';
const hrs = (n: number | null | undefined) => (n == null ? 'not set' : `${n} h`);
const codeFrom = (name: string) => name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);

const ACTION_LABEL: Record<string, string> = { created: 'added', edited: 'changed', switched_off: 'switched off', switched_on: 'switched on', merged: 'merged into' };

export default function CategoriesScreen() {
    const { api, report } = useBrain();
    const [nonce, setNonce] = useState(0);
    const [state, setState] = useState<{ n: number; res: Plain<CategoriesReply> } | null>(null);
    useEffect(() => {
        let live = true;
        api.categories().then(res => {
            if (!live) return;
            if (!res.ok) report(res);
            setState({ n: nonce, res });
        });
        return () => { live = false; };
    }, [api, nonce, report]);
    const loading = !state || state.n !== nonce;
    const reload = () => setNonce(n => n + 1);
    return (
        <Screen title="Categories & SLAs"
            sub="The categories the AI sorts tickets into: which team each goes to, its usual priority, how many hours the team has (the SLA) and which properties it is on. A change applies to new tickets at once; open tickets keep their SLA."
            actions={<Btn size="sm" icon={RefreshCw} disabled={loading} onClick={reload}>{loading && state ? 'Refreshing…' : 'Refresh'}</Btn>}>
            {!state && <LoadingScreen label="Loading the categories" />}
            {state && !state.res.ok && <ErrorState what="the categories" message={state.res.message} onRetry={reload} />}
            {state?.res.ok && <Body initial={state.res.data.data} />}
        </Screen>
    );
}

/** What the editor holds. suggestionId: the suggestion this came from, marked accepted on save. */
interface Draft {
    isNew: boolean; code: string; codeTouched: boolean; name: string; team: string; priority: string;
    slaMode: 'one' | 'by_priority'; slaHours: string; by: Record<string, string>; hint: string;
    scope: 'all' | 'selected'; propertyIds: string[]; suggestionId?: string;
}

function draftFrom(c: CategoryView | null, view: CategoriesView): Draft {
    const plan = c?.slaByPriority;
    const one = String(c?.slaHours ?? 24);
    return {
        isNew: !c, code: c?.code ?? '', codeTouched: false, name: c?.name ?? '', team: c?.team ?? 'technical', priority: c?.priority ?? 'medium',
        slaMode: c?.slaMode ?? 'one', slaHours: one,
        by: { low: String(plan?.low ?? one), medium: String(plan?.medium ?? one), high: String(plan?.high ?? one), urgent: String(plan?.urgent ?? one) },
        hint: c?.hint ?? '', scope: !c || c.scope === 'all' || c.scope === 'off' ? 'all' : 'selected',
        propertyIds: c && c.scope === 'selected' ? c.propertyIds : view.properties.map(p => p.id),
    };
}

function Body({ initial }: { initial: CategoriesView }) {
    const { api, toast } = useBrain();
    const [view, setView] = useState(initial);
    const [busy, setBusy] = useState<string | null>(null);
    const [draft, setDraft] = useState<Draft | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [confirm, setConfirm] = useState<{ title: string; text: string; body: CategoryBody } | null>(null);
    const [showOff, setShowOff] = useState(false);
    // Owner 2026-11-20: all AI suggestions sit in one box that stays closed until opened, so the page stays short.
    const [suggestOpen, setSuggestOpen] = useState(false);
    const suggestId = useId();
    useEffect(() => { setView(initial); }, [initial]);

    const send = async (body: CategoryBody, key: string): Promise<boolean> => {
        setBusy(key);
        const res = await api.postCategories(body);
        setBusy(null);
        if (!res.ok) { toast(res.message, 'bad'); return false; }
        setView(res.data.data);
        if (res.data.message) toast(res.data.message);
        return true;
    };

    const save = async () => {
        if (!draft) return;
        setError(null);
        const num = (x: string) => Number(String(x).replace(',', '.'));
        const body: CategoryBody = {
            action: 'save', isNew: draft.isNew, code: draft.isNew ? (draft.code || codeFrom(draft.name)) : draft.code, name: draft.name, team: draft.team,
            priority: draft.priority, slaMode: draft.slaMode, slaHours: num(draft.slaHours),
            slaByPriority: draft.slaMode === 'by_priority' ? Object.fromEntries(Object.entries(draft.by).map(([k, v]) => [k, num(v)])) : undefined,
            hint: draft.hint, scope: draft.scope, propertyIds: draft.scope === 'selected' ? draft.propertyIds : undefined, suggestionId: draft.suggestionId,
        };
        setBusy('save');
        const res = await api.postCategories(body);
        setBusy(null);
        if (!res.ok) { setError(res.message); return; }
        setView(res.data.data);
        setDraft(null);
        if (res.data.message) toast(res.data.message);
    };

    const takeSuggestion = (sg: SuggestionView) => {
        const p = sg.payload as Record<string, unknown>;
        if (sg.kind === 'new') {
            const d = draftFrom(null, view);
            setDraft({ ...d, code: String(p.code ?? ''), codeTouched: true, name: String(p.name ?? ''), team: String(p.team ?? 'technical'), priority: String(p.priority ?? 'medium'), slaHours: String(p.sla_hours ?? 24), hint: String(p.hint ?? ''), suggestionId: sg.id });
        } else {
            const c = view.categories.find(x => x.code === p.code);
            if (!c) { toast('That category is no longer here.', 'bad'); return; }
            const d = draftFrom(c, view);
            setDraft({ ...d, ...(sg.kind === 'rename' ? { name: String(p.name ?? d.name) } : { hint: String(p.hint ?? d.hint) }), suggestionId: sg.id });
        }
        setError(null);
    };

    const on = view.categories.filter(c => c.scope !== 'off');
    const off = view.categories.filter(c => c.scope === 'off');
    const total = view.properties.length;

    return (
        <div className="flex flex-col gap-[20px]">
            {view.columnsMissing && (
                <div className={cx(s.banner, s.bannerWarn)} role="note">
                    Some parts need migration 20261119000006 to be applied: a time per priority, the &quot;what belongs here&quot; line, AI suggestions and the change history. Adding and editing categories with one SLA time works now.
                </div>
            )}

            <Card>
                <CardHead label={view.suggestions.length ? `AI suggestions (${view.suggestions.length})` : 'AI suggestions'} icon={Sparkles}
                    hint="The AI reads the last 90 days of tickets that fit the categories badly (no category, a guess, or corrected in Review) and suggests what to add, merge or rename. It runs only when you press the button."
                    right={<Btn size="sm" variant="primary" icon={Lightbulb} disabled={!!busy || view.columnsMissing} onClick={async () => { if (await send({ action: 'suggest' }, 'suggest')) setSuggestOpen(true); }}>{busy === 'suggest' ? 'Reading tickets…' : 'Suggest categories'}</Btn>} />
                {view.suggestions.length === 0
                    ? <p className="px-5 pb-5 text-[13px] text-(--bc-ink-3)">No suggestions waiting. Press &quot;Suggest categories&quot; when you want some.</p>
                    : <>
                        <button
                            type="button"
                            aria-expanded={suggestOpen}
                            aria-controls={suggestId}
                            onClick={() => setSuggestOpen(o => !o)}
                            className="mx-5 mb-4 flex min-h-[44px] items-center justify-between gap-3 rounded-full border border-(--bc-line) px-4 text-left text-[13.5px] font-semibold text-(--bc-ink-1) hover:bg-(--bc-line)/30"
                        >
                            <span>{suggestOpen ? 'Hide' : 'Show'} {plural(view.suggestions.length, 'suggestion', 'suggestions')}</span>
                            <ChevronDown aria-hidden="true" className={`h-4 w-4 shrink-0 transition-transform ${suggestOpen ? 'rotate-180' : ''}`} />
                        </button>
                        {suggestOpen && (
                            <ul id={suggestId} className="flex flex-col divide-y divide-(--bc-line) border-t border-(--bc-line)">{view.suggestions.map(sg => (
                                <SuggestionRow key={sg.id} sg={sg} view={view} busy={busy}
                                    onUse={() => takeSuggestion(sg)}
                                    onMerge={() => setConfirm({ title: 'Merge these categories?', text: mergeText(sg, view), body: { action: 'merge', id: sg.id } })}
                                    onDismiss={() => send({ action: 'dismiss', id: sg.id }, `dismiss:${sg.id}`)} />
                            ))}</ul>
                        )}
                    </>}
            </Card>

            <Card>
                <CardHead label={`Categories in use (${on.length})`} icon={Tags}
                    hint={`Across ${plural(total, 'property', 'properties')}. Nothing is ever deleted: a category you switch off stays on its old tickets.`}
                    right={<Btn size="sm" variant="primary" icon={Plus} disabled={!!busy} onClick={() => { setDraft(draftFrom(null, view)); setError(null); }}>Add category</Btn>} />
                {on.length === 0 ? <Empty icon={Tags} title="No categories yet">Add the first one.</Empty> : (
                    <ul className="flex flex-col divide-y divide-(--bc-line)">
                        {on.map(c => <CategoryRow key={c.code} c={c} total={total} busy={busy}
                            onEdit={() => { setDraft(draftFrom(c, view)); setError(null); }}
                            onToggle={() => setConfirm({ title: `Switch off ${c.name}?`, text: 'New tickets will not get this category at any property. Old tickets keep it. You can switch it on again later.', body: { action: 'switch_off', code: c.code } })} />)}
                    </ul>
                )}
                {off.length > 0 && (
                    <div className="border-t border-(--bc-line) px-5 py-3">
                        <Btn size="sm" onClick={() => setShowOff(v => !v)}>{showOff ? 'Hide' : 'Show'} switched off ({off.length})</Btn>
                        {showOff && <ul className="mt-2 flex flex-col divide-y divide-(--bc-line)">
                            {off.map(c => <CategoryRow key={c.code} c={c} total={total} busy={busy} onEdit={() => { setDraft(draftFrom(c, view)); setError(null); }} onToggle={() => send({ action: 'switch_on', code: c.code }, `on:${c.code}`)} />)}
                        </ul>}
                    </div>
                )}
            </Card>

            {view.changes.length > 0 && (
                <Card>
                    <CardHead label="Latest changes" />
                    <ul className="flex flex-col gap-1 px-5 pb-5 text-[13px] text-(--bc-ink-2)">
                        {view.changes.map((ch, i) => (
                            <li key={i}><span className={s.mono}>{ch.code}</span> {ACTION_LABEL[ch.action] ?? ch.action}{ch.properties ? ` (${plural(ch.properties, 'property', 'properties')})` : ''} · {new Date(ch.at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</li>
                        ))}
                    </ul>
                </Card>
            )}

            <Editor draft={draft} setDraft={setDraft} view={view} busy={busy === 'save'} error={error} onSave={save} />

            <Dialog open={!!confirm} onClose={() => setConfirm(null)} title={confirm?.title ?? ''}
                footer={<><Btn onClick={() => setConfirm(null)}>Cancel</Btn><Btn variant="primary" disabled={!!busy} onClick={async () => { if (confirm && await send(confirm.body, 'confirm')) setConfirm(null); }}>{busy === 'confirm' ? 'Working…' : 'Yes, go ahead'}</Btn></>}>
                <p className="text-[13.5px] text-(--bc-ink-2)">{confirm?.text}</p>
            </Dialog>
        </div>
    );
}

function slaText(c: CategoryView): string {
    if (c.slaMode === 'by_priority' && c.slaByPriority) return PRIORITIES.map(([k, l]) => `${l} ${c.slaByPriority![k]} h`).join(' · ');
    return hrs(c.slaHours);
}

function CategoryRow({ c, total, busy, onEdit, onToggle }: { c: CategoryView; total: number; busy: string | null; onEdit: () => void; onToggle: () => void }) {
    const where = c.scope === 'all' ? 'All properties' : c.scope === 'off' ? 'Switched off' : `${c.propertyIds.length} of ${total} properties`;
    return (
        <li className="flex flex-wrap items-start justify-between gap-3 px-5 py-3">
            <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[14px] font-semibold text-(--bc-ink-1)">{c.name}</span>
                    <span className={cx(s.mono, 'text-[12px] text-(--bc-ink-3)')}>{c.code}</span>
                    {c.builtIn && <Chip title="Only the shared default is used. Saving it makes your own copy.">Default</Chip>}
                    {c.issues.map(i => <Chip key={i} tone="warn">{i}</Chip>)}
                </div>
                <p className="mt-1 text-[12.5px] text-(--bc-ink-2)">
                    {c.team ? `${teamName(c.team)} team` : 'No team set'} · usually {prioName(c.priority)} · SLA {slaText(c)} · {where} · {plural(c.tickets30, 'ticket', 'tickets')} in 30 days
                </p>
                {c.hint && <p className="mt-0.5 text-[12.5px] text-(--bc-ink-3)">For: {c.hint}</p>}
            </div>
            <div className="flex shrink-0 gap-2">
                <Btn size="sm" icon={Pencil} disabled={!!busy} onClick={onEdit}>Edit</Btn>
                <Btn size="sm" icon={Power} disabled={!!busy} onClick={onToggle}>{c.scope === 'off' ? 'Switch on' : 'Switch off'}</Btn>
            </div>
        </li>
    );
}

const KIND_LABEL: Record<SuggestionView['kind'], string> = { new: 'New category', merge: 'Merge', rename: 'Rename', hint: 'Better description' };

function mergeText(sg: SuggestionView, view: CategoriesView): string {
    const p = sg.payload as { keep?: string; drop?: string[] };
    const nm = (code?: string) => view.categories.find(c => c.code === code)?.name ?? code ?? '';
    return `${(p.drop ?? []).map(nm).join(', ')} will be switched off at every property. New tickets like these go to ${nm(p.keep)}. Old tickets keep their category.`;
}

function SuggestionRow({ sg, view, busy, onUse, onMerge, onDismiss }: { sg: SuggestionView; view: CategoriesView; busy: string | null; onUse: () => void; onMerge: () => void; onDismiss: () => void }) {
    const p = sg.payload as Record<string, unknown>;
    const nm = (code: unknown) => view.categories.find(c => c.code === code)?.name ?? String(code ?? '');
    const title = sg.kind === 'new' ? `${String(p.name)} → ${teamName(String(p.team))} team, usually ${prioName(String(p.priority))}, SLA ${String(p.sla_hours)} h`
        : sg.kind === 'merge' ? `Keep ${nm(p.keep)}, switch off ${(Array.isArray(p.drop) ? p.drop : []).map(nm).join(', ')}`
            : sg.kind === 'rename' ? `Rename ${nm(p.code)} to "${String(p.name)}"`
                : `${nm(p.code)}: "${String(p.hint)}"`;
    return (
        <li className="flex flex-col gap-2 px-5 py-4">
            <div className="flex flex-wrap items-center gap-2">
                <Chip tone="accent">{KIND_LABEL[sg.kind]}</Chip>
                <span className="text-[13.5px] font-semibold text-(--bc-ink-1)">{title}</span>
            </div>
            {sg.kind === 'new' && typeof p.hint === 'string' && p.hint && <p className="text-[12.5px] text-(--bc-ink-2)">For: {p.hint}</p>}
            {sg.why && <p className="text-[12.5px] text-(--bc-ink-2)">Why: {sg.why}</p>}
            {sg.examples.length > 0 && (
                <ul className="flex flex-col gap-0.5 text-[12.5px] text-(--bc-ink-3)">
                    {sg.examples.map((e, i) => <li key={i} className={s.quote}>&quot;{e.text}&quot;{e.code ? ` (was ${nm(e.code)})` : ' (no category)'}</li>)}
                </ul>
            )}
            <div className="flex flex-wrap gap-2">
                {sg.kind === 'merge'
                    ? <Btn size="sm" variant="primary" disabled={!!busy} onClick={onMerge}>Merge</Btn>
                    : <Btn size="sm" variant="primary" disabled={!!busy} onClick={onUse}>Review and add</Btn>}
                <Btn size="sm" icon={X} disabled={!!busy} onClick={onDismiss}>{busy === `dismiss:${sg.id}` ? 'Dismissing…' : 'Dismiss'}</Btn>
            </div>
        </li>
    );
}

function Editor({ draft, setDraft, view, busy, error, onSave }: { draft: Draft | null; setDraft: (d: Draft | null) => void; view: CategoriesView; busy: boolean; error: string | null; onSave: () => void }) {
    const ids = useId();
    const d = draft;
    const set = (patch: Partial<Draft>) => d && setDraft({ ...d, ...patch });
    return (
        <Dialog open={!!d} onClose={() => setDraft(null)} wide title={d?.isNew ? 'Add a category' : `Edit ${d?.name ?? ''}`}
            footer={<><Btn onClick={() => setDraft(null)}>Cancel</Btn><Btn variant="primary" disabled={busy} onClick={onSave}>{busy ? 'Saving…' : 'Save'}</Btn></>}>
            {d && (
                <div className="flex flex-col divide-y divide-(--bc-line)">
                    <Field label="Name" htmlFor={`${ids}name`} hint="What people see, for example Switch / Socket.">
                        <input id={`${ids}name`} data-autofocus className={cx(s.input, 'w-64!')} maxLength={60} value={d.name}
                            onChange={e => set({ name: e.target.value, ...(d.isNew && !d.codeTouched ? { code: codeFrom(e.target.value) } : {}) })} />
                    </Field>
                    <Field label="Code" htmlFor={`${ids}code`} hint={d.isNew ? 'Made from the name. It cannot be changed later.' : 'Fixed: old tickets and reports use it.'}>
                        <input id={`${ids}code`} className={cx(s.input, s.mono, 'w-64!')} maxLength={40} value={d.code} disabled={!d.isNew}
                            onChange={e => set({ code: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''), codeTouched: true })} />
                    </Field>
                    <Field label="Team" htmlFor={`${ids}team`} hint="Tickets in this category are assigned to this team at each property.">
                        <select id={`${ids}team`} className={cx(s.input, 'w-48!')} value={d.team} onChange={e => set({ team: e.target.value })}>
                            {TEAMS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                        </select>
                    </Field>
                    <Field label="Usual priority" htmlFor={`${ids}prio`} hint="Used when the ticket does not say how urgent it is.">
                        <select id={`${ids}prio`} className={cx(s.input, 'w-48!')} value={d.priority} onChange={e => set({ priority: e.target.value })}>
                            {PRIORITIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                        </select>
                    </Field>
                    <Field label="SLA" hint="Hours the team has to finish the ticket. One time for every ticket, or a different time for each priority.">
                        <Segmented size="sm" label="SLA type" value={d.slaMode} onChange={v => set({ slaMode: v })}
                            options={[{ value: 'one', label: 'One time' }, { value: 'by_priority', label: 'Per priority', disabled: view.columnsMissing, title: view.columnsMissing ? 'Needs migration 20261119000006' : undefined }]} />
                    </Field>
                    <div className="flex flex-wrap gap-4 py-3">
                        {d.slaMode === 'one'
                            ? <HoursBox id={`${ids}h`} label="Hours" value={d.slaHours} onChange={v => set({ slaHours: v })} />
                            : PRIORITIES.map(([k, l]) => <HoursBox key={k} id={`${ids}h${k}`} label={l} value={d.by[k]} onChange={v => set({ by: { ...d.by, [k]: v } })} />)}
                    </div>
                    <div className="flex flex-col gap-2 py-3">
                        <label htmlFor={`${ids}hint`} className="text-[13.5px] font-semibold text-(--bc-ink-1)">What belongs here</label>
                        <p className="text-[12.5px] text-(--bc-ink-3)">One line for the AI that sorts tickets, for example: electrical switch boards, plug points, sockets.</p>
                        <textarea id={`${ids}hint`} className={s.input} rows={2} maxLength={300} value={d.hint} disabled={view.columnsMissing} onChange={e => set({ hint: e.target.value })} />
                    </div>
                    <Field label="Where" hint="On every property, or only on the ones you choose. It is switched off on the others.">
                        <Segmented size="sm" label="Properties" value={d.scope} onChange={v => set({ scope: v })}
                            options={[{ value: 'all', label: 'All properties' }, { value: 'selected', label: 'Choose properties' }]} />
                    </Field>
                    {d.scope === 'selected' && (
                        <div className="flex max-h-56 flex-col gap-1 overflow-auto py-3">
                            {view.properties.map(p => (
                                <label key={p.id} className="flex items-center gap-2 text-[13px] text-(--bc-ink-1)">
                                    <input type="checkbox" checked={d.propertyIds.includes(p.id)}
                                        onChange={e => set({ propertyIds: e.target.checked ? [...d.propertyIds, p.id] : d.propertyIds.filter(x => x !== p.id) })} />
                                    {p.name}
                                </label>
                            ))}
                        </div>
                    )}
                    {error && <p className="pt-3 text-[13px] text-(--bc-bad-text)" role="alert">{error}</p>}
                </div>
            )}
        </Dialog>
    );
}

function HoursBox({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (v: string) => void }) {
    return (
        <span className="flex items-center gap-2">
            <label htmlFor={id} className="text-[12.5px] text-(--bc-ink-2)">{label}</label>
            <input id={id} inputMode="decimal" className={cx(s.input, s.tab, 'w-20! text-right')} value={value} onChange={e => onChange(e.target.value.replace(/[^\d.,]/g, ''))} />
            <span className="text-[12.5px] text-(--bc-ink-3)">h</span>
        </span>
    );
}
