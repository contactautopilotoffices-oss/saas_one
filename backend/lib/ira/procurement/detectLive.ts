/**
 * LIVE DETECTOR — findings derived from zoho_purchase_orders, not a fixture.
 * -----------------------------------------------------------------------------
 * Per docs/IRA_ARCHITECTURE_DECISION.md the deterministic layer owns the numbers.
 * Every figure here comes from SQL. No model is called.
 *
 * ── WHY THE GATING IS THE INTERESTING PART ──────────────────────────────────
 * A naive "same vendor + same reference_number" sweep over this org returns 149
 * groups. Almost all are noise, and shipping them would train the team to ignore
 * Ira within a week:
 *
 *   · reference_number is free text in Zoho, and people type dates into it.
 *     "Date;- 30.05.2025" appears on four unrelated POs. That is a data-entry
 *     habit, not a duplicate payment.
 *   · Frontier Furniture has one reference across POs of Rs 1,11,274 and
 *     Rs 1,17,79,044. Same invoice, wildly different values = part-billing
 *     against one order, which is normal.
 *
 * So a duplicate is only raised when ALL of these hold:
 *   1. the reference looks like an invoice number, not a date or a bare word,
 *   2. the amounts match within AMOUNT_TOLERANCE,
 *   3. both POs are live (not cancelled / rejected / draft).
 *
 * Everything filtered out is COUNTED and reported, so suppression is visible
 * rather than silent.
 */

import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { zohoBooksPoUrl, type Finding, type EntityRef } from './types';
import { inWindow, type CadenceWindow } from './cadence';

/** Two POs are the same money if their amounts differ by less than this. */
const AMOUNT_TOLERANCE = 0.01; // 1%

/** Below this, a duplicate is not worth an executive's attention. */
const MIN_DUPLICATE_INR = 10_000;

interface PoRow {
    id: string;
    created_at: string | null;
    synced_at: string | null;
    po_number: string | null;
    vendor_name: string | null;
    po_amount: number | string | null;
    status: string | null;
    po_date: string | null;
    property_id: string | null;
    raw: Record<string, unknown> | null;
}

const DEAD_STATUSES = new Set(['cancelled', 'rejected', 'draft']);

/**
 * True when a reference_number is plausibly an invoice identifier.
 *
 * Rejects: anything that is mostly a date, anything with no digits, and anything
 * under 4 characters. This single predicate removes the large majority of the
 * false positives, because the dominant noise pattern is a typed-in date.
 */
export function looksLikeInvoiceRef(raw: string): boolean {
    const s = raw.trim();
    if (s.length < 4) return false;
    if (!/\d/.test(s)) return false;

    // "Date - 31.01.2025", "Date;- 30.05.2025", "Dt. 22 June 2023"
    if (/^\s*(date|dt|dated)\b/i.test(s)) return false;

    // A bare date in any common separator form.
    if (/^\d{1,4}[-/.]\d{1,2}[-/.]\d{2,4}$/.test(s)) return false;

    // Strip digits and separators; an invoice number keeps some alphabetic or
    // structural identity, a date does not.
    const skeleton = s.replace(/[\d\s.\-/:;,]/g, '');
    if (skeleton.length === 0 && !/[/-]/.test(s)) return false;

    return true;
}

/** Amounts equal within tolerance — a true duplicate, not a part-bill. */
function sameMoney(a: number, b: number): boolean {
    if (a <= 0 || b <= 0) return false;
    return Math.abs(a - b) / Math.max(a, b) <= AMOUNT_TOLERANCE;
}

function num(v: unknown): number {
    const n = typeof v === 'number' ? v : Number(v ?? 0);
    return Number.isFinite(n) ? n : 0;
}

/** Normalised vendor identity, for spotting the same supplier spelled two ways. */
export function normaliseVendor(name: string): string {
    return name
        .toLowerCase()
        .replace(/\b(pvt|private|limited|ltd|llp|inc|co|company|the|and)\b/g, '')
        .replace(/[^a-z0-9]/g, '');
}

export interface LiveScanResult {
    findings: Finding[];
    /** What the scan looked at and what it deliberately did not raise. */
    stats: {
        totalPos: number;
        livePos: number;
        refGroups: number;
        rejectedRefShape: number;
        rejectedAmountMismatch: number;
        rejectedBelowFloor: number;
        /** Real findings that belong to an earlier scan's window. */
        rejectedOutsideWindow: number;
        propertiesResolved: number;
    };
}

/**
 * Scan an org's purchase orders as at `asOf`.
 *
 * `asOf` bounds the window so a scan is reproducible: re-running "5 Sep 2026"
 * next month must give the same answer, or nothing downstream can be trusted.
 */
/**
 * When a PO entered OUR system. `created_at`, not `po_date` — a PO can carry a
 * back-dated business date, and a daily scan is about what appeared since the
 * last one, not about what someone typed in the date field.
 */
function enteredAt(r: PoRow): string | null {
    return r.created_at ?? r.po_date;
}

export async function scanPurchaseOrders(
    orgId: string,
    asOf: Date,
    /**
     * Restrict to findings that CAME INTO EXISTENCE in this window. Omit for a
     * full-corpus sweep (the monthly/quarterly baseline). A daily must always
     * pass one, or it re-reports the entire backlog every morning.
     */
    window?: CadenceWindow,
): Promise<LiveScanResult> {
    // --- pull ---------------------------------------------------------------
    const rows: PoRow[] = [];
    for (let from = 0; ; from += 1000) {
        const { data, error } = await supabaseAdmin
            .from('zoho_purchase_orders')
            .select('id, created_at, synced_at, po_number, vendor_name, po_amount, status, po_date, property_id, raw')
            .eq('organization_id', orgId)
            .lte('po_date', asOf.toISOString().slice(0, 10))
            .range(from, from + 999);
        if (error || !data?.length) break;
        rows.push(...(data as PoRow[]));
        if (data.length < 1000) break;
    }

    const live = rows.filter((r) => !DEAD_STATUSES.has(String(r.status ?? '')));

    // --- the org's Zoho Books id, so every PO reference can link straight to
    //     the order (and its comment box, which is where things actually move).
    //     One query per scan; a missing config simply means no links.
    let zohoOrgId: string | null = null;
    try {
        const { data } = await supabaseAdmin
            .from('accounts_zoho_config').select('zoho_organization_id')
            .eq('organization_id', orgId).maybeSingle();
        zohoOrgId = data?.zoho_organization_id ? String(data.zoho_organization_id) : null;
    } catch { /* no links, rather than a failed scan */ }
    const booksDc = process.env.ZOHO_BOOKS_DC || 'com';
    const poRef = (r: PoRow): EntityRef => ({
        kind: 'po',
        label: r.po_number ?? r.id,
        id: r.id,
        url: zohoBooksPoUrl(zohoOrgId, r.raw?.purchaseorder_id ? String(r.raw.purchaseorder_id) : null, booksDc),
    });

    // --- property names, so findings read in English ------------------------
    const propIds = [...new Set(live.map((r) => r.property_id).filter(Boolean))] as string[];
    const propName = new Map<string, string>();
    if (propIds.length) {
        const { data } = await supabaseAdmin
            .from('properties').select('id, name').in('id', propIds.slice(0, 500));
        for (const p of data ?? []) propName.set(String(p.id), String(p.name ?? ''));
    }

    const findings: Finding[] = [];

    /* ---------------------------------------------------------------------
     * 0. IS THE FEED EVEN ALIVE?
     *
     * This runs FIRST and, when it fires, it is the only thing that matters.
     *
     * A daily scan over a dead feed reports "nothing new" — which reads as good
     * news and is the single most dangerous output this agent can produce. An
     * empty inbox because nothing went wrong and an empty inbox because the sync
     * stopped 25 days ago look identical to a reader, so the difference has to be
     * asserted rather than left to inference.
     * ------------------------------------------------------------------- */
    const lastSync = rows
        .map((r) => r.synced_at ?? r.created_at)
        .filter(Boolean)
        .sort()
        .pop() as string | undefined;

    if (window && lastSync && new Date(lastSync) < window.from) {
        const days = Math.floor((window.to.getTime() - new Date(lastSync).getTime()) / 86_400_000);
        findings.push({
            key: 'po-feed-stale',
            priority: 'critical',
            title: `Purchase-order sync has not run for ${days} days`,
            vendor: null,
            property: null,
            amount: null,
            problem:
                `The newest purchase order in this system arrived on ` +
                `${new Date(lastSync).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' })}. ` +
                `Nothing has synced from Zoho since.

` +
                `Every other check in this scan ran against data that is ${days} days old. ` +
                `Treat an otherwise-empty scan as UNKNOWN, not as all-clear — any PO raised in ` +
                `the last ${days} days is invisible to this agent, including duplicates.`,
            refs: [],
            stats: [
                { label: 'Last sync', value: new Date(lastSync).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short' }) },
                { label: 'Days stale', value: String(days) },
                { label: 'POs held', value: rows.length.toLocaleString('en-IN') },
            ],
            actions: [
                { recipient: 'technical', action: 'Check the Zoho Books PO sync — the cron, the refresh token, and the last error. Nothing has landed since the date above.', deadline: 'Today' },
                { recipient: 'procurement', action: 'Until the sync is restored, do not treat a quiet Ira scan as confirmation that nothing needs attention.', deadline: 'Today' },
            ],
        });
    }
    const stats = {
        totalPos: rows.length, livePos: live.length, refGroups: 0,
        rejectedRefShape: 0, rejectedAmountMismatch: 0, rejectedBelowFloor: 0,
        rejectedOutsideWindow: 0,
        propertiesResolved: propName.size,
    };

    // --- 1. duplicate invoice reference, gated ------------------------------
    const byRef = new Map<string, PoRow[]>();
    for (const r of live) {
        const ref = String(r.raw?.reference_number ?? '').trim();
        if (!ref) continue;
        if (!looksLikeInvoiceRef(ref)) { stats.rejectedRefShape++; continue; }
        const key = `${normaliseVendor(r.vendor_name ?? '')}||${ref.toLowerCase()}`;
        byRef.set(key, [...(byRef.get(key) ?? []), r]);
    }

    for (const [, group] of byRef) {
        if (group.length < 2) continue;
        stats.refGroups++;
        // Only the pairs whose money actually matches.
        const sorted = [...group].sort((a, b) => num(b.po_amount) - num(a.po_amount));
        const matched: PoRow[] = [];
        for (const r of sorted) {
            if (!matched.length || sameMoney(num(matched[0].po_amount), num(r.po_amount))) matched.push(r);
        }
        if (matched.length < 2) { stats.rejectedAmountMismatch++; continue; }

        const dupValue = matched.slice(1).reduce((s, r) => s + num(r.po_amount), 0);
        if (dupValue < MIN_DUPLICATE_INR) { stats.rejectedBelowFloor++; continue; }

        // A duplicate PAIR comes into being when the SECOND PO is raised. So the
        // finding belongs to that moment's window, however old the first PO is —
        // which is what stops September's daily re-reporting April's duplicates.
        if (window) {
            const newest = matched
                .map(enteredAt).filter(Boolean)
                .sort()
                .pop() as string | undefined;
            if (!inWindow(window, newest)) { stats.rejectedOutsideWindow++; continue; }
        }

        const ref = String(matched[0].raw?.reference_number ?? '');
        const vendor = matched[0].vendor_name ?? 'Unknown vendor';
        const site = matched[0].property_id ? propName.get(matched[0].property_id) ?? null : null;

        findings.push({
            // Stable across scans: derived from the problem, never from a date or
            // row order, so a closed line stays closed next week.
            key: `dup-ref:${normaliseVendor(vendor)}:${ref.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 40)}`,
            priority: dupValue >= 100_000 ? 'critical' : 'action',
            title: `${vendor} — same invoice on ${matched.length} live POs`,
            vendor,
            property: site,
            amount: dupValue,
            problem:
                `Invoice reference "${ref}" appears on ${matched.length} purchase orders that are all still live, ` +
                `each for effectively the same amount. If more than one has been paid, the excess is recoverable.`,
            refs: matched.slice(0, 6).map<EntityRef>(poRef),
            stats: [
                { label: 'POs', value: String(matched.length) },
                { label: 'Each', value: `₹${Math.round(num(matched[0].po_amount)).toLocaleString('en-IN')}` },
                { label: 'Statuses', value: [...new Set(matched.map((r) => r.status))].join(', ') },
            ],
            actions: [
                { recipient: 'ceo', action: `Confirm whether more than one of these was paid. If so, approve recovery of ₹${Math.round(dupValue).toLocaleString('en-IN')}.`, deadline: 'This week' },
                { recipient: 'procurement', action: `Check the payment status of each PO against ${vendor}, and obtain a credit note for any duplicate settled.`, deadline: 'This week' },
            ],
        });
    }

    // --- 2. same supplier under more than one name --------------------------
    const byVendor = new Map<string, Set<string>>();
    const vendorSpend = new Map<string, number>();
    for (const r of live) {
        const n = normaliseVendor(r.vendor_name ?? '');
        if (!n) continue;
        byVendor.set(n, (byVendor.get(n) ?? new Set()).add(r.vendor_name ?? ''));
        vendorSpend.set(n, (vendorSpend.get(n) ?? 0) + num(r.po_amount));
    }
    // STRUCTURAL findings — a naming mess, a missing control — are not events.
    // They are true every day, so reporting them daily is nagging. They belong to
    // the weekly and slower cadences, where "still true" is the point.
    const structural = !window || window.cadence !== 'daily';

    const variants = [...byVendor.entries()].filter(([, names]) => names.size > 1);
    if (structural && variants.length) {
        const worst = variants.sort((a, b) => (vendorSpend.get(b[0]) ?? 0) - (vendorSpend.get(a[0]) ?? 0));
        findings.push({
            key: 'vendor-name-variants',
            priority: 'action',
            title: `${variants.length} suppliers are recorded under more than one name`,
            vendor: null,
            property: null,
            amount: worst.reduce((s, [n]) => s + (vendorSpend.get(n) ?? 0), 0),
            problem:
                `The same supplier appears under multiple spellings, so spend is split across records. ` +
                `Rate comparison, credit limits and duplicate detection all under-count as a result.\n\n` +
                worst.slice(0, 6).map(([, names]) => `· ${[...names].join('  /  ')}`).join('\n'),
            refs: [],
            stats: [
                { label: 'Suppliers', value: String(variants.length) },
                { label: 'Spend affected', value: `₹${Math.round(worst.reduce((s, [n]) => s + (vendorSpend.get(n) ?? 0), 0) / 100000)}L` },
            ],
            actions: [
                { recipient: 'procurement', action: 'Merge the duplicate vendor records in Zoho so spend consolidates under one supplier.', deadline: 'This month' },
                { recipient: 'technical', action: 'Add a normalised-name uniqueness check on vendor creation so new variants cannot be added.', deadline: 'This sprint' },
            ],
        });
    }

    // --- 3. approved spend with no approval trail ---------------------------
    const approved = live.filter((r) => String(r.status) === 'approved');
    if (structural && approved.length) {
        const { count } = await supabaseAdmin
            .from('po_workflow_state')
            .select('*', { count: 'exact', head: true })
            .eq('organization_id', orgId);
        const tracked = count ?? 0;
        const untracked = approved.length - tracked;
        if (untracked > 0) {
            const value = approved.reduce((s, r) => s + num(r.po_amount), 0);
            findings.push({
                key: 'approved-without-workflow-state',
                priority: 'critical',
                title: `${untracked.toLocaleString('en-IN')} approved POs have no recorded approval trail`,
                vendor: null,
                property: null,
                amount: value,
                problem:
                    `${approved.length.toLocaleString('en-IN')} POs are marked approved, but only ${tracked} have a row in po_workflow_state. ` +
                    `For the rest there is no record of who approved them or when — the approval exists in Zoho's status field and nowhere auditable.`,
                refs: [],
                stats: [
                    { label: 'Approved POs', value: approved.length.toLocaleString('en-IN') },
                    { label: 'With a trail', value: String(tracked) },
                    { label: 'Value', value: `₹${(value / 10000000).toFixed(2)}Cr` },
                ],
                actions: [
                    { recipient: 'ceo', action: 'Decide whether historic POs need a back-filled approval record, or whether the trail starts from today.', deadline: 'This week' },
                    { recipient: 'technical', action: 'Write po_workflow_state on every approval path, including the Zoho sync, so the trail cannot be skipped.', deadline: 'This sprint' },
                ],
            });
        }
    }

    findings.sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0));
    return { findings, stats };
}
