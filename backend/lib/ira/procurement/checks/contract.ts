/**
 * THE CHECK CONTRACT — one question, asked the same way every time.
 * -----------------------------------------------------------------------------
 * Four checks used to live inline in one 456-line function, sharing local
 * variables and a single `stats` object. Adding a fifth meant reading all four,
 * and nothing about a check was inspectable from outside it: you could not list
 * what the agent looks for, say why one did not run, or report what it looked at
 * and cleared. The scan could only ever say what it FOUND, never what it
 * COVERED — so a quiet mail was indistinguishable from a broken one.
 *
 * A check is now a file. It declares the question it asks, the data it needs and
 * whether it is an event or a standing condition, and it returns findings
 * ALONGSIDE what it cleared and what it deliberately did not raise.
 *
 * ── THE TEMPLATE ────────────────────────────────────────────────────────────
 * Every check answers the same six things:
 *
 *   id        stable, and the prefix of every finding key it emits
 *   question  the sentence it answers, in the present tense
 *   nature    'event'      — true at a moment, belongs to a window
 *             'structural' — true every day, so only slower cadences report it
 *   needs     the data without which it must not run at all
 *   run()     findings, plus what was looked at, plus what was rejected and why
 *   spec      the doctrine block, cited (docs/AGENT_DOCTRINE.md §3)
 *
 * ── WHY 'cleared' IS NOT OPTIONAL POLITENESS ────────────────────────────────
 * The scan a person writes ends with "honest negatives — where not to look":
 * 32 vendors swept, zero survivors; ETPL ran the same comparison and came back
 * the other way. That section is what makes the positives believable, and it
 * cannot be written unless each check reports its own coverage. So `cleared` is
 * part of the return type, not a nicety.
 *
 * ── WHAT A CHECK MAY NOT DO ─────────────────────────────────────────────────
 *   - call a model. Every figure is SQL. [BAA p.94] and
 *     docs/IRA_ARCHITECTURE_DECISION.md both forbid an LLM re-deriving numbers.
 *   - read the mailbox, send anything, or write a finding row. It returns data.
 *   - throw. A check that fails is reported as failed and the scan continues;
 *     one broken check must not take the morning's mail down with it.
 */

import type { CadenceWindow } from '../cadence';
import type { EntityRef, Finding } from '../types';

/** A purchase order as the scan holds it. Mirrors zoho_purchase_orders. */
export interface PoRow {
    id: string;
    created_at: string | null;
    synced_at: string | null;
    po_number: string | null;
    vendor_name: string | null;
    po_amount: number | string | null;
    status: string | null;
    po_date: string | null;
    property_id: string | null;
    /** Zoho's free-text site (cf_site), stored by the sync. property_id is
     *  rarely populated, so this carries site identity for most rows. */
    project_name: string | null;
    raw: Record<string, unknown> | null;
}

/** One purchase-order line, as stored by the line-item sync. */
export interface PoLine {
    zoho_po_id: string;
    line_item_id: string;
    item_id: string | null;
    name: string | null;
    description: string | null;
    unit: string | null;
    quantity: number | null;
    quantity_billed: number | null;
    rate: number | null;
    item_total: number | null;
}

/**
 * Everything a check is given. Pulled ONCE per scan and shared, so twelve checks
 * cost one read of the purchase-order table rather than twelve.
 */
export interface CheckContext {
    orgId: string;
    /** The scan is reproducible as at this instant. */
    asOf: Date;
    /** Absent for a full-corpus sweep. Present for every scheduled cadence. */
    window?: CadenceWindow;
    /** Every purchase order as at asOf. */
    pos: PoRow[];
    /** Those not cancelled, rejected or draft. What most checks want. */
    live: PoRow[];
    /**
     * Line items keyed by Zoho purchase-order id.
     *
     * EMPTY IS A REAL STATE, not an error: the line-item sync backfills over
     * hours, and before it has run this map is empty. A check that needs lines
     * declares `needs: ['lines']` and is SKIPPED WITH A REASON rather than
     * silently finding nothing — a check that cannot see its data must never
     * report "all clear".
     */
    lines: Map<string, PoLine[]>;
    /** property_id -> the site's name. */
    propName: Map<string, string>;
    /** Builds a verified, linkable reference to a purchase order. */
    poRef: (r: PoRow) => EntityRef;
}

/**
 * The site a PO belongs to, best available. property_id resolves to the
 * property's real name, but the sync never sets it, so most rows fall back
 * to Zoho's own site text (project_name, then raw.cf_site). Null only when
 * the order carries no site in any form.
 */
export function siteName(ctx: CheckContext, po: PoRow): string | null {
    if (po.property_id) {
        const named = ctx.propName.get(po.property_id);
        if (named) return named;
    }

    /**
     * THE FALLBACK LABEL DECIDES WHO GETS MAILED, so it has to be a site we
     * actually know.
     *
     * `property` is not only printed — routing reads it. splitBySite matches it
     * against the console's site rules, and a matched rule REPLACES the role
     * list rather than narrowing it (sites.ts). So handing back raw Zoho free
     * text would quietly re-address findings that used to go to the CEO and
     * procurement: this org's rules point every site at one shared mailbox, and
     * ruleFor matches on substrings in both directions, so "Arcil Sky Mark -
     * Noida" catches the "Noida" rule and Saniel stops seeing the line.
     *
     * Nobody asked for that, and a silent change of recipient is the worst kind.
     * So the fallback is accepted only when it names a property this org
     * actually has — then the label is as trustworthy as the id-resolved one.
     * Anything else stays null, exactly as it was before, and the finding goes
     * to the role list.
     */
    const text = (po.project_name ?? (po.raw?.cf_site ? String(po.raw.cf_site) : null) ?? '').trim();
    if (!text) return null;
    const key = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, '');
    const wanted = key(text);
    if (!wanted) return null;
    for (const name of ctx.propName.values()) {
        const k = key(name);
        if (k && (k === wanted || wanted.includes(k))) return name;
    }
    return null;
}

/** What a check looked at and found nothing wrong with. */
export interface Cleared {
    /** How many things were examined. */
    looked: number;
    /** What they were: 'vendors', 'reference groups', 'contract lines'. */
    unit: string;
    /** One line a reader can weigh. "zero survivors across 32 vendors" */
    note?: string;
}

export interface CheckOutcome {
    findings: Finding[];
    /** Null when the check raised something and coverage is not the story. */
    cleared?: Cleared | null;
    /** Set when the check did not run. The reason is REPORTED, never swallowed. */
    skipped?: string;
    /** What it saw and deliberately did not raise, by reason. */
    rejected?: Record<string, number>;
}

export interface Check {
    /** Stable. Also the prefix of every finding key this check emits. */
    id: string;
    /** The question it answers, present tense, one line. */
    question: string;
    /**
     * 'event'      — comes into being at a moment (a second PO is raised).
     *                Belongs to the window it happened in.
     * 'structural' — true every day until someone fixes it (a naming mess).
     *                Reporting it daily is nagging, so daily cadences skip it,
     *                and it is eligible to be CLOSED when it stops being true.
     */
    nature: 'event' | 'structural';
    /** Data without which this check must be skipped, not run empty. */
    needs: Array<'pos' | 'lines' | 'workflow'>;
    run(ctx: CheckContext): Promise<CheckOutcome> | CheckOutcome;
}

/* --------------------------------------------------------------------------
 * Small shared helpers. Every check formats money and reads amounts the same
 * way, so they live here rather than being re-typed per file.
 * ------------------------------------------------------------------------ */

export function num(v: unknown): number {
    const n = typeof v === 'number' ? v : Number(v ?? 0);
    return Number.isFinite(n) ? n : 0;
}

export function inr(n: number): string {
    return `₹${Math.round(n).toLocaleString('en-IN')}`;
}

export function shortDate(iso: string | null | undefined): string {
    if (!iso) return 'undated';
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return 'undated';
    return new Date(t).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' });
}

/** Zoho's own word for whether a bill exists against the order. */
export function isBilled(r: PoRow): boolean {
    return String(r.raw?.billed_status ?? r.status ?? '').toLowerCase().includes('billed');
}

/**
 * WHEN THE BUSINESS RAISED THIS ORDER. Not when we happened to store it.
 *
 * This one line put purchase orders from MAY 2025 into a scan headed "new
 * today", in front of a team, as though they were something that had just
 * happened. The window test read `created_at` — which is OUR row's insert
 * timestamp, not Zoho's. 5,265 of this org's 5,493 orders carry
 * created_at = 2026-07-31, the day of the backfill, so on that day every order
 * ever raised looked less than 24 hours old, and any pair among them stayed
 * eligible forever after.
 *
 * Zoho's `created_time` is the authoritative moment and was in the stored
 * payload the whole time. `po_date` is the fallback — a business date somebody
 * typed, which can be back-dated, so it is second choice and not first.
 *
 * OUR OWN created_at IS NEVER USED HERE. It measures our sync, and a scan that
 * dates findings by when we ingested them is reporting on itself.
 */
export function raisedAt(r: PoRow): string | null {
    const zoho = r.raw?.created_time;
    if (zoho && !Number.isNaN(Date.parse(String(zoho)))) return String(zoho);
    if (r.po_date && !Number.isNaN(Date.parse(String(r.po_date)))) return String(r.po_date);
    return null;
}

/** The most recent moment among these orders, by when they were RAISED. */
export function newestRaisedAt(rows: ReadonlyArray<PoRow>): string | null {
    let best: string | null = null;
    for (const r of rows) {
        const at = raisedAt(r);
        if (!at) continue;
        if (!best || Date.parse(at) > Date.parse(best)) best = at;
    }
    return best;
}
