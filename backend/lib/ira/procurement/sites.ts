/**
 * SITE OWNERSHIP — who answers for which city, on one shared mailbox.
 * -----------------------------------------------------------------------------
 * The problem this solves: procurement is ONE inbox (purchase@worksquare.in) but
 * THREE people. Vidya owns Bengaluru, Sahil owns Mumbai, Priyanka owns Noida.
 * A single 12-finding email to that inbox is nobody's job, so nobody works it.
 *
 * So we do not change the address — we change the unit of delivery. One email
 * per site, each stamped in its own header:
 *
 *     06 SEP PO SCAN — BLR
 *     Assigned to Vidya
 *
 * Three mails land in the same inbox, and each one is unambiguously one person's.
 *
 * CONFIG FORMAT (Agent Console → Delivery → Site owners), one line per site:
 *
 *     BLR / Bengaluru / Bangalore / SS Plaza: Vidya <purchase@worksquare.in>
 *     ^display  ^------ match aliases ------^   ^name    ^address
 *
 * The FIRST segment is what the header shows; every segment is matched against
 * the finding's property name and its city. Aliases are explicit on purpose:
 * "Byculla" is a Mumbai site and no amount of string cleverness knows that.
 *
 * Doctrine: this is routing, therefore deterministic and model-free.
 * [BAA p.94] tools/routing return data, never throw. [BAA p.112] split work by
 * context — the owner IS the context boundary here. A model is never asked who
 * owns a site, because a hallucinated owner is an unanswered finding.
 */

import type { Finding } from './types';
import type { RecipientBundle, RoutedFinding } from './router';
import { ORDER_BY_PRIORITY, countsFor } from './router';

/** One named human on a site. `name` is null for a bare address. */
export interface SiteOwner {
    name: string | null;
    email: string;
}

/** A configured site: what to display, what to match on, who owns it. */
export interface SiteRule {
    /** Shown in the email header, e.g. "BLR". First segment of the key. */
    label: string;
    /** Lowercased, punctuation-stripped match terms — every segment of the key. */
    aliases: string[];
    owners: SiteOwner[];
}

/** Case- and punctuation-insensitive key, so "SS Plaza" matches "ss-plaza". */
export function siteKey(s: string): string {
    return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Parse `Vidya <purchase@worksquare.in>` or a bare `purchase@worksquare.in`.
 * Returns null for anything without an address — a name with no mailbox is not
 * a recipient, and silently inventing one would be worse than dropping the line.
 */
export function parseOwner(entry: string): SiteOwner | null {
    const s = entry.trim();
    if (!s) return null;
    const angled = /^(.*?)\s*<\s*([^<>\s]+@[^<>\s]+)\s*>$/.exec(s);
    if (angled) {
        const name = angled[1].trim().replace(/^["']|["']$/g, '');
        return { name: name || null, email: angled[2].trim() };
    }
    if (s.includes('@') && !/\s/.test(s)) return { name: null, email: s };
    return null;
}

/** Build match rules from `recipients.sites`. Unparseable lines are dropped. */
export function parseSiteRules(sites: Record<string, string[]> | undefined): SiteRule[] {
    if (!sites) return [];
    const rules: SiteRule[] = [];
    for (const [key, value] of Object.entries(sites)) {
        const segments = key.split('/').map((x) => x.trim()).filter(Boolean);
        if (!segments.length) continue;
        const owners = (Array.isArray(value) ? value : [value])
            .map((v) => parseOwner(String(v)))
            .filter((o): o is SiteOwner => o !== null);
        if (!owners.length) continue;
        rules.push({
            label: segments[0],
            aliases: Array.from(new Set(segments.map(siteKey).filter(Boolean))),
            owners,
        });
    }
    return rules;
}

/**
 * Which site a finding belongs to.
 *
 * Matched against the property name AND its city — `cityOf` supplies the city
 * for a property whose name gives nothing away ("SS Plaza" is Bangalore, and
 * only the properties table knows that). Longest alias wins, so a specific
 * building beats a city when both are configured.
 */
export function ruleFor(
    property: string | null,
    rules: ReadonlyArray<SiteRule>,
    cityOf: (property: string) => string | null = () => null,
): SiteRule | null {
    if (!property || !rules.length) return null;
    const name = siteKey(property);
    const city = siteKey(cityOf(property) ?? '');

    let best: SiteRule | null = null;
    let bestLen = 0;
    for (const rule of rules) {
        for (const alias of rule.aliases) {
            const hit =
                name === alias || name.includes(alias) || alias.includes(name) ||
                (city !== '' && (city === alias || city.includes(alias) || alias.includes(city)));
            if (hit && alias.length > bestLen) { best = rule; bestLen = alias.length; }
        }
    }
    return best;
}

/** One site's slice of a recipient's bundle — its own email. */
export interface SiteSlice {
    /** Null when no site rule matched: the catch-all mail. */
    rule: SiteRule | null;
    /** Header label. "Unassigned" for the catch-all. */
    label: string;
    /** Names for the "Assigned to …" line. Empty for the catch-all. */
    ownerNames: string[];
    /** Where this slice is actually mailed. Falls back to the role list. */
    to: string[];
    bundle: RecipientBundle;
}

const UNASSIGNED = 'Unassigned';

/**
 * Split one recipient's bundle into one slice per site.
 *
 * With no rules configured this returns a SINGLE slice carrying the bundle
 * unchanged — so an org that never sets site owners keeps exactly today's
 * behaviour, one email, no header tag. Adding owners is purely additive.
 */
export function splitBySite(
    bundle: RecipientBundle,
    rules: ReadonlyArray<SiteRule>,
    roleFallback: ReadonlyArray<string>,
    cityOf: (property: string) => string | null = () => null,
): SiteSlice[] {
    if (!rules.length) {
        return [{ rule: null, label: '', ownerNames: [], to: [...roleFallback], bundle }];
    }

    const groups = new Map<string, { rule: SiteRule | null; findings: RoutedFinding[] }>();
    for (const f of bundle.findings) {
        const rule = ruleFor(f.property, rules, cityOf);
        const id = rule ? rule.label : UNASSIGNED;
        const g = groups.get(id) ?? { rule, findings: [] };
        g.findings.push(f);
        groups.set(id, g);
    }

    const slices: SiteSlice[] = [];
    for (const [label, g] of groups) {
        const findings = [...g.findings].sort(ORDER_BY_PRIORITY);
        const owners = g.rule?.owners ?? [];
        const to = owners.length
            ? Array.from(new Set(owners.map((o) => o.email)))
            : [...roleFallback];
        // A slice with nowhere to go is dropped by the caller, not mailed blind.
        slices.push({
            rule: g.rule,
            label,
            ownerNames: owners.map((o) => o.name).filter((n): n is string => Boolean(n)),
            to,
            bundle: { recipient: bundle.recipient, findings, counts: countsFor(findings) },
        });
    }

    // Named sites first, alphabetically; the catch-all last so it reads as a remainder.
    slices.sort((a, b) =>
        (a.label === UNASSIGNED ? 1 : 0) - (b.label === UNASSIGNED ? 1 : 0) ||
        a.label.localeCompare(b.label));
    return slices;
}

/** Property name -> city, for the whole org, as a lookup usable by `ruleFor`. */
export function cityLookup(rows: ReadonlyArray<{ name: string | null; city: string | null }>) {
    const map = new Map<string, string>();
    for (const r of rows) {
        if (r.name && r.city) map.set(siteKey(r.name), r.city);
    }
    return (property: string): string | null => map.get(siteKey(property)) ?? null;
}

/** Findings whose property matched nothing — surfaced so config gaps are visible. */
export function unmatchedProperties(
    findings: ReadonlyArray<Finding>,
    rules: ReadonlyArray<SiteRule>,
    cityOf: (property: string) => string | null = () => null,
): string[] {
    if (!rules.length) return [];
    const out = new Set<string>();
    for (const f of findings) {
        if (f.property && !ruleFor(f.property, rules, cityOf)) out.add(f.property);
    }
    return Array.from(out).sort();
}
