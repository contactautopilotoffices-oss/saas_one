'use client';

/**
 * SITE OWNERS BUILDER — who answers for which city, built from real properties.
 * -----------------------------------------------------------------------------
 * The textarea version asked the operator to TYPE property names from memory and
 * hope they matched. This shows the org's actual properties (from the same table
 * the scan reads), lets the operator click them onto an owner, and previews the
 * routing live using the SAME matcher the cron uses — so "SS Plaza → BLR" here is
 * "SS Plaza → BLR" at 11:00, not an approximation of it.
 *
 * STORAGE FORMAT IS UNCHANGED. This serialises to the exact map the backend
 * already reads:
 *
 *     { "BLR / Bengaluru / SS Plaza": ["Vidya <purchase@worksquare.in>"] }
 *
 * First segment = header label, rest = match aliases, values = owners. The raw
 * textarea stays available as "Advanced" for anyone who prefers it, and both
 * views edit the same draft.
 *
 * Doctrine: routing is configuration, never inference. Nothing here asks a
 * model who owns Mumbai. [BAA p.94] [BAA p.112]
 */

import { useEffect, useMemo, useState } from 'react';
import { Check, ChevronDown, ChevronUp, MapPin, Plus, X } from 'lucide-react';
import {
    parseOwner, parseSiteRules, ruleFor, siteKey, type SiteRule,
} from '@/backend/lib/ira/procurement/sites';

interface Property { id: string; name: string; city: string | null }

interface Owner { name: string; email: string }
interface Group { label: string; aliases: string[]; owners: Owner[] }

/** map -> editable groups. */
function fromMap(map: Record<string, string[]>): Group[] {
    return Object.entries(map).map(([key, vals]) => {
        const segs = key.split('/').map((s) => s.trim()).filter(Boolean);
        return {
            label: segs[0] ?? '',
            aliases: segs.slice(1),
            owners: (vals ?? []).map((v) => parseOwner(String(v))).filter((o): o is NonNullable<typeof o> => !!o)
                .map((o) => ({ name: o.name ?? '', email: o.email })),
        };
    });
}

/** editable groups -> the map the backend reads. Empty groups are dropped. */
function toMap(groups: Group[]): Record<string, string[]> {
    const out: Record<string, string[]> = {};
    for (const g of groups) {
        const label = g.label.trim();
        const owners = g.owners.filter((o) => o.email.trim().includes('@'))
            .map((o) => (o.name.trim() ? `${o.name.trim()} <${o.email.trim()}>` : o.email.trim()));
        if (!label || !owners.length) continue;
        const key = [label, ...g.aliases.map((a) => a.trim()).filter(Boolean)].join(' / ');
        out[key] = owners;
    }
    return out;
}

export default function SiteOwnersBuilder({
    orgId, value, onChange, defaultEmail,
}: {
    orgId: string;
    value: Record<string, string[]>;
    onChange: (next: Record<string, string[]>) => void;
    /** Pre-fills the owner address for a new city — the shared procurement box. */
    defaultEmail?: string;
}) {
    const [props, setProps] = useState<Property[] | null>(null);
    const [groups, setGroups] = useState<Group[]>(() => fromMap(value));
    const [active, setActive] = useState<number>(0);
    const [showAdvanced, setShowAdvanced] = useState(false);
    const [raw, setRaw] = useState('');

    // Re-seed only on a genuine change from outside (a fresh load, a save round-trip).
    const [lastSeen, setLastSeen] = useState(JSON.stringify(value));
    useEffect(() => {
        const incoming = JSON.stringify(value);
        if (incoming === lastSeen) return;
        setLastSeen(incoming);
        setGroups(fromMap(value));
    }, [value, lastSeen]);

    useEffect(() => {
        let alive = true;
        fetch(`/api/properties?organizationId=${encodeURIComponent(orgId)}`)
            .then((r) => r.json())
            .then((rows: unknown) => {
                if (!alive) return;
                const list = Array.isArray(rows) ? rows : [];
                setProps(list.map((p) => {
                    const r = p as { id: string; name: string; city?: string | null };
                    return { id: String(r.id), name: String(r.name ?? '').trim(), city: r.city ?? null };
                }).filter((p) => p.name));
            })
            .catch(() => { if (alive) setProps([]); });
        return () => { alive = false; };
    }, [orgId]);

    const commit = (next: Group[]) => {
        setGroups(next);
        const map = toMap(next);
        setLastSeen(JSON.stringify(map));
        onChange(map);
    };

    // The SAME rules the cron builds, from the SAME map, so the preview is the truth.
    const rules: SiteRule[] = useMemo(() => parseSiteRules(toMap(groups)), [groups]);
    const cityOf = useMemo(() => {
        const m = new Map<string, string>();
        for (const p of props ?? []) if (p.city) m.set(siteKey(p.name), p.city);
        return (name: string) => m.get(siteKey(name)) ?? null;
    }, [props]);

    const resolved = useMemo(() => {
        const out = new Map<string, string | null>();
        for (const p of props ?? []) out.set(p.id, ruleFor(p.name, rules, cityOf)?.label ?? null);
        return out;
    }, [props, rules, cityOf]);

    const assignedCount = [...resolved.values()].filter(Boolean).length;
    const total = props?.length ?? 0;

    const addGroup = () => {
        const next = [...groups, { label: '', aliases: [], owners: [{ name: '', email: defaultEmail ?? '' }] }];
        commit(next);
        setActive(next.length - 1);
    };
    const patch = (i: number, fn: (g: Group) => Group) => commit(groups.map((g, j) => (j === i ? fn(g) : g)));
    const remove = (i: number) => { commit(groups.filter((_, j) => j !== i)); setActive(0); };

    /** Clicking a property adds its name as an alias on the active city. */
    const assignProperty = (p: Property) => {
        if (!groups.length) return;
        const g = groups[active];
        const already = g.aliases.some((a) => siteKey(a) === siteKey(p.name)) || siteKey(g.label) === siteKey(p.name);
        if (already) return;
        patch(active, (x) => ({ ...x, aliases: [...x.aliases, p.name] }));
    };

    const chip = 'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11.5px] leading-5';
    const input = 'rounded-md border border-border bg-card px-2 py-1 text-[12px] focus:border-primary/40 focus:outline-none';

    return (
        <div className="flex flex-col gap-3">
            {/* ---- coverage line ------------------------------------------- */}
            <div className="flex flex-wrap items-center gap-2 text-[11.5px] text-text-secondary">
                <MapPin className="h-3.5 w-3.5 text-text-tertiary" />
                {props === null ? 'Loading your sites…'
                    : total === 0 ? 'No sites found for this organisation.'
                    : <>
                        <b className="text-foreground">{assignedCount}</b> of <b className="text-foreground">{total}</b> sites
                        have been added to a city
                        {total - assignedCount > 0 && (
                            <span className="rounded-full bg-amber-500/12 px-2 py-0.5 font-semibold text-amber-700">
                                {total - assignedCount} not added yet — these all arrive in one email
                            </span>
                        )}
                    </>}
            </div>

            {/* ---- cities / owners ------------------------------------------ */}
            <div className="grid gap-3 md:grid-cols-2">
                {groups.map((g, i) => {
                    const on = i === active;
                    return (
                        <div key={i}
                            onClick={() => setActive(i)}
                            className={`cursor-pointer rounded-xl border p-3 transition-colors ${on ? 'border-primary/50 bg-primary/4' : 'border-border bg-card'}`}>
                            <div className="mb-2 flex items-center gap-2">
                                <input className={`${input} w-24 font-bold uppercase tracking-wide`} placeholder="BLR"
                                    value={g.label} onChange={(e) => patch(i, (x) => ({ ...x, label: e.target.value }))} />
                                <span className="text-[11px] text-text-tertiary">shows in the header</span>
                                {on && <span className="ml-auto rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold text-white">assigning</span>}
                                <button type="button" onClick={(e) => { e.stopPropagation(); remove(i); }}
                                    className="ml-1 rounded p-0.5 text-text-tertiary hover:text-red-600" title="Remove this city">
                                    <X className="h-3.5 w-3.5" />
                                </button>
                            </div>

                            {g.owners.map((o, k) => (
                                <div key={k} className="mb-1.5 grid grid-cols-[1fr_1.4fr_auto] gap-1.5">
                                    <input className={input} placeholder="Vidya" value={o.name}
                                        onChange={(e) => patch(i, (x) => ({ ...x, owners: x.owners.map((y, m) => (m === k ? { ...y, name: e.target.value } : y)) }))} />
                                    <input className={input} placeholder="purchase@worksquare.in" value={o.email}
                                        onChange={(e) => patch(i, (x) => ({ ...x, owners: x.owners.map((y, m) => (m === k ? { ...y, email: e.target.value } : y)) }))} />
                                    <button type="button" title="Remove owner"
                                        onClick={(e) => { e.stopPropagation(); patch(i, (x) => ({ ...x, owners: x.owners.filter((_, m) => m !== k) })); }}
                                        className="rounded p-1 text-text-tertiary hover:text-red-600"><X className="h-3 w-3" /></button>
                                </div>
                            ))}
                            <button type="button"
                                onClick={(e) => { e.stopPropagation(); patch(i, (x) => ({ ...x, owners: [...x.owners, { name: '', email: defaultEmail ?? '' }] })); }}
                                className="mb-2 text-[11px] font-semibold text-primary underline decoration-dotted underline-offset-2">
                                + another owner
                            </button>

                            <div className="flex flex-wrap gap-1">
                                {g.aliases.map((a, k) => (
                                    <span key={k} className={`${chip} border-border bg-card-tint text-text-secondary`}>
                                        {a}
                                        <button type="button" onClick={(e) => { e.stopPropagation(); patch(i, (x) => ({ ...x, aliases: x.aliases.filter((_, m) => m !== k) })); }}
                                            className="text-text-tertiary hover:text-red-600"><X className="h-3 w-3" /></button>
                                    </span>
                                ))}
                                <AliasInput onAdd={(a) => patch(i, (x) => ({ ...x, aliases: [...x.aliases, a] }))} />
                            </div>
                            <p className="mt-1.5 text-[10.5px] text-text-tertiary">
                                Matches a property by name <i>or</i> city. Click properties below to add them here.
                            </p>
                        </div>
                    );
                })}

                <button type="button" onClick={addGroup}
                    className="flex min-h-[96px] items-center justify-center gap-1.5 rounded-xl border border-dashed border-border text-[12px] font-semibold text-text-secondary hover:border-primary/40 hover:text-foreground">
                    <Plus className="h-4 w-4" /> Add a city
                </button>
            </div>

            {/* ---- real properties ------------------------------------------ */}
            {props && props.length > 0 && (
                <div>
                    <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">
                        Your sites — click one to add it to the city you selected above
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                        {props.map((p) => {
                            const owner = resolved.get(p.id);
                            return (
                                <button key={p.id} type="button" onClick={() => assignProperty(p)}
                                    title={owner ? `Routes to ${owner}` : 'No owner yet — lands in the Unassigned mail'}
                                    className={`${chip} ${owner
                                        ? 'border-emerald-500/40 bg-emerald-500/8 text-emerald-800'
                                        : 'border-amber-500/40 bg-amber-500/8 text-amber-800'} hover:border-primary/50`}>
                                    {owner ? <Check className="h-3 w-3" /> : null}
                                    {p.name}
                                    {p.city && <span className="text-[10px] opacity-70">· {p.city}</span>}
                                    {owner && <span className="rounded bg-emerald-600/15 px-1 text-[10px] font-bold">{owner}</span>}
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* ---- advanced: the raw format ------------------------------- */}
            <button type="button" onClick={() => { setRaw(Object.entries(toMap(groups)).map(([k, v]) => `${k}: ${v.join(', ')}`).join('\n')); setShowAdvanced((v) => !v); }}
                className="flex items-center gap-1 self-start text-[11px] text-text-tertiary hover:text-foreground">
                {showAdvanced ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
Prefer to type it? Edit as text
            </button>
            {showAdvanced && (
                <textarea rows={4} value={raw} spellCheck={false}
                    className="w-full rounded-lg border border-border bg-card px-3 py-2 font-mono text-[11.5px] focus:border-primary/40 focus:outline-none"
                    onChange={(e) => setRaw(e.target.value)}
                    onBlur={() => {
                        const map: Record<string, string[]> = {};
                        for (const line of raw.split('\n')) {
                            const i = line.indexOf(':');
                            if (i < 1) continue;
                            const k = line.slice(0, i).trim();
                            const v = line.slice(i + 1).split(',').map((x) => x.trim()).filter(Boolean);
                            if (k && v.length) map[k] = v;
                        }
                        commit(fromMap(map));
                    }} />
            )}
        </div>
    );
}

function AliasInput({ onAdd }: { onAdd: (alias: string) => void }) {
    const [v, setV] = useState('');
    const submit = () => { const t = v.trim(); if (t) { onAdd(t); setV(''); } };
    return (
        <input value={v} placeholder="+ alias, e.g. Bangalore" onChange={(e) => setV(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }}
            onBlur={submit}
            className="w-36 rounded-md border border-dashed border-border bg-transparent px-2 py-0.5 text-[11.5px] focus:border-primary/40 focus:outline-none" />
    );
}
