/**
 * PO LINE-ITEM SYNC — the second half of the purchase-order record.
 * -----------------------------------------------------------------------------
 * zohoBooksSync.ts calls Zoho's purchase-order LIST endpoint, which returns
 * headers: vendor, total, status, dates, branch, reference number, billed flag.
 * It does not return line items. So the app held 5,493 purchase orders and not
 * one description, quantity, unit or rate — and every question worth asking of
 * a purchase order is asked of those:
 *
 *   · a quarterly AMC and an annual AMC from the same start date overlap in
 *     the line DESCRIPTION ("Period - 01.04.2026 to 31.06.2026");
 *   · "14 machines became 30" is a QUANTITY;
 *   · a vendor handover repricing the same work compares only per UNIT;
 *   · the one duplicate here where cash actually moved is a line reading
 *     "scaffolding Ns032, 10 @ ₹3,520" — the recoverable amount is item_total.
 *
 * ── HOW IT RUNS ─────────────────────────────────────────────────────────────
 * One API call per order, so it is BUDGETED and RESUMABLE rather than a sweep:
 * each pass takes `budget` orders, newest-first among those never fetched, then
 * anything Zoho has modified since we last read it. Progress is the
 * detail_synced_at column; a pass that dies mid-way loses only its own work.
 *
 * Priority is deliberate. A pending order is one somebody is deciding on today;
 * an order under an open finding is one we are already asking about. Those go
 * first, so the checks that matter have their lines within a run or two rather
 * than after the whole backfill.
 *
 * ── WHAT IT MUST NOT DO ─────────────────────────────────────────────────────
 * Exhaust the org's daily API quota. Zoho reports remaining calls on every
 * response; the pass stops early when that runs low, and says so.
 */

import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { ZohoService } from './zohoService';

export interface DetailSyncResult {
    orgId: string;
    /** Orders whose detail was read this pass. */
    fetched: number;
    /** Line-item rows written. */
    lines: number;
    /** Orders Zoho would not return — 404s and the like, skipped not retried forever. */
    failed: Array<{ po: string; why: string }>;
    /** Orders still holding a header only, after this pass. */
    remaining: number;
    /** Zoho's own count of calls left in the org's day, as of the last response. */
    quotaRemaining?: number | null;
    stoppedEarly?: string;
    error?: string;
}

/** Orders per pass. 200 × the quarter-hourly cron clears 5,493 in about four hours. */
const DEFAULT_BUDGET = 200;

/** Below this many calls left in Zoho's daily quota, stop and leave the rest for other jobs. */
const QUOTA_FLOOR = 500;

/** Zoho's per-minute ceiling is ~100; this keeps a comfortable distance from it. */
const PAUSE_MS = 120;

const num = (v: unknown): number | null => {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
};

interface PoTarget { id: string; zoho_po_id: string; po_number: string }

/**
 * The orders to read next, most useful first:
 *   1. never read, and pending someone's approval right now;
 *   2. never read, and named by a finding nobody has answered;
 *   3. never read, newest first;
 *   4. read, but changed in Zoho since.
 */
async function pickTargets(orgId: string, budget: number): Promise<PoTarget[]> {
    const picked = new Map<string, PoTarget>();
    const take = (rows: Array<Record<string, unknown>> | null) => {
        for (const r of rows ?? []) {
            if (picked.size >= budget) return;
            const zohoId = String(r.zoho_po_id ?? '');
            if (!zohoId || picked.has(zohoId)) continue;
            picked.set(zohoId, { id: String(r.id), zoho_po_id: zohoId, po_number: String(r.po_number ?? '') });
        }
    };

    const cols = 'id, zoho_po_id, po_number';

    // 1. Pending approval — a decision is waiting on these today.
    const { data: pending } = await supabaseAdmin
        .from('zoho_purchase_orders').select(cols)
        .eq('organization_id', orgId).is('detail_synced_at', null)
        .eq('status', 'pending_approval').not('zoho_po_id', 'is', null)
        .limit(budget);
    take(pending);

    // 2. Named by an open finding — we are already asking about these.
    if (picked.size < budget) {
        const { data: findings } = await supabaseAdmin
            .from('oem_agent_findings').select('refs')
            .eq('organization_id', orgId).is('disposition', null).limit(100);
        const labels = [...new Set((findings ?? [])
            .flatMap((f) => ((f.refs ?? []) as Array<{ label?: string }>).map((r) => String(r?.label ?? '')))
            .filter(Boolean))];
        if (labels.length) {
            const { data: cited } = await supabaseAdmin
                .from('zoho_purchase_orders').select(cols)
                .eq('organization_id', orgId).is('detail_synced_at', null)
                .in('po_number', labels.slice(0, 200)).not('zoho_po_id', 'is', null)
                .limit(budget);
            take(cited);
        }
    }

    // 3. Everything else that has never been read, newest first.
    if (picked.size < budget) {
        const { data: fresh } = await supabaseAdmin
            .from('zoho_purchase_orders').select(cols)
            .eq('organization_id', orgId).is('detail_synced_at', null)
            .not('zoho_po_id', 'is', null)
            .order('po_date', { ascending: false })
            .limit(budget);
        take(fresh);
    }

    // 4. Re-read what Zoho has changed since we last looked. Cheap to ask,
    //    and a revised order is exactly the thing a scan should notice.
    if (picked.size < budget) {
        const { data: stale } = await supabaseAdmin
            .from('zoho_purchase_orders').select(`${cols}, detail_synced_at, raw`)
            .eq('organization_id', orgId).not('detail_synced_at', 'is', null)
            .not('zoho_po_id', 'is', null)
            .order('detail_synced_at', { ascending: true })
            .limit(budget * 3);
        const changed = (stale ?? []).filter((r) => {
            const modified = (r.raw as { last_modified_time?: string } | null)?.last_modified_time;
            if (!modified) return false;
            return Date.parse(modified) > Date.parse(String(r.detail_synced_at));
        });
        take(changed);
    }

    return [...picked.values()];
}

/** One Zoho line item -> one row, with the fields findings are built on promoted. */
function lineRow(orgId: string, po: PoTarget, li: Record<string, unknown>) {
    return {
        organization_id: orgId,
        po_id: po.id,
        zoho_po_id: po.zoho_po_id,
        line_item_id: String(li.line_item_id ?? ''),
        item_id: li.item_id ? String(li.item_id) : null,
        item_order: num(li.item_order),
        name: li.name ? String(li.name) : null,
        description: li.description ? String(li.description) : null,
        hsn_or_sac: li.hsn_or_sac ? String(li.hsn_or_sac) : null,
        unit: li.unit ? String(li.unit) : null,
        quantity: num(li.quantity),
        quantity_billed: num(li.quantity_billed),
        quantity_received: num(li.quantity_received),
        rate: num(li.rate),
        item_total: num(li.item_total),
        tax_percentage: num(li.tax_percentage),
        account_name: li.account_name ? String(li.account_name) : null,
        raw: li,
        synced_at: new Date().toISOString(),
    };
}

/**
 * Read the detail of up to `budget` purchase orders for one org and store their
 * lines. Never throws: a sync that takes down its cron is worse than a sync
 * that reports it got nowhere.
 */
export async function syncPoDetailsForOrg(
    orgId: string,
    opts?: { budget?: number },
): Promise<DetailSyncResult> {
    const budget = opts?.budget ?? DEFAULT_BUDGET;
    const out: DetailSyncResult = { orgId, fetched: 0, lines: 0, failed: [], remaining: 0 };

    const { data: cfg } = await supabaseAdmin
        .from('accounts_zoho_config').select('zoho_organization_id, is_active')
        .eq('organization_id', orgId).maybeSingle();
    if (!cfg?.zoho_organization_id || cfg.is_active === false) {
        return { ...out, error: 'Zoho Books is not configured for this organization' };
    }

    let auth: { token: string; apiDomain: string };
    try {
        auth = await ZohoService.getAccessToken();
    } catch (e) {
        return { ...out, error: `Zoho auth failed: ${e instanceof Error ? e.message : e}` };
    }

    const targets = await pickTargets(orgId, budget);

    for (const po of targets) {
        const res = await ZohoService.getPurchaseOrderDetail(cfg.zoho_organization_id, po.zoho_po_id, auth);

        // Leave the org's day enough calls for the sync, the mailbox and the
        // console. A backfill is never the most important thing running.
        out.quotaRemaining = res.remaining ?? out.quotaRemaining;
        const quotaSpent = res.remaining !== null && res.remaining < QUOTA_FLOOR;
        if (quotaSpent) {
            out.stoppedEarly = `Zoho daily quota down to ${res.remaining} calls — stopping, the rest resumes next pass`;
        }

        if (!res.ok) {
            // 401 means the token died mid-pass; everything after it would fail
            // the same way, so stop rather than burn the budget on it.
            if (res.status === 401) { out.stoppedEarly = 'Zoho rejected the token mid-pass'; break; }
            out.failed.push({ po: po.po_number, why: `${res.status}: ${res.message}`.slice(0, 120) });
            if (quotaSpent) break;
            continue;
        }

        const { line_items: lineItems, ...header } = res.po as { line_items?: Array<Record<string, unknown>> } & Record<string, unknown>;
        const rows = (lineItems ?? [])
            .filter((li) => li?.line_item_id)
            .map((li) => lineRow(orgId, po, li));

        if (rows.length) {
            const { error } = await supabaseAdmin
                .from('zoho_po_line_items')
                .upsert(rows, { onConflict: 'organization_id,zoho_po_id,line_item_id', ignoreDuplicates: false });
            if (error) { out.failed.push({ po: po.po_number, why: `store: ${error.message}`.slice(0, 120) }); continue; }
            out.lines += rows.length;
        }

        // The header WITHOUT line items — they are rows now, and storing both
        // doubles the table for nothing.
        const { error: upErr } = await supabaseAdmin
            .from('zoho_purchase_orders')
            .update({ detail: header, detail_synced_at: new Date().toISOString() })
            .eq('id', po.id);
        if (upErr) { out.failed.push({ po: po.po_number, why: `mark: ${upErr.message}`.slice(0, 120) }); continue; }

        out.fetched++;
        if (quotaSpent) break;
        await new Promise((r) => setTimeout(r, PAUSE_MS));
    }

    const { count } = await supabaseAdmin
        .from('zoho_purchase_orders').select('*', { count: 'exact', head: true })
        .eq('organization_id', orgId).is('detail_synced_at', null).not('zoho_po_id', 'is', null);
    out.remaining = count ?? 0;

    return out;
}

export { DEFAULT_BUDGET as PO_DETAIL_BUDGET, QUOTA_FLOOR };
