/**
 * LIVE DETECTOR — load the data once, ask every registered question of it.
 * -----------------------------------------------------------------------------
 * Per docs/IRA_ARCHITECTURE_DECISION.md the deterministic layer owns the
 * numbers. Every figure comes from SQL. No model is called anywhere below.
 *
 * This file used to be the checks as well as the loader: four of them inline in
 * one function, sharing local variables and a single stats object. They now live
 * one per file under ./checks, behind a contract, and this is what it was always
 * pretending to be — the thing that reads the data and hands it to them.
 *
 * WHAT MOVED, AND WHY IT MATTERS
 *   · a check is now listable, so the scan can report what it COVERED and not
 *     only what it found — "32 vendors swept, zero survivors" is a sentence the
 *     old shape could not produce;
 *   · a check that cannot see its data is SKIPPED WITH A REASON instead of
 *     quietly finding nothing, which is the difference between "all clear" and
 *     "I did not look";
 *   · adding the fifth check meant reading four. It now means writing one file.
 *
 * The finding keys are unchanged, deliberately. A key is what carries a human's
 * answer forward — change one and every open line is orphaned and re-raised at
 * whoever already closed it.
 */

import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { zohoBooksPoUrl, type Finding, type EntityRef } from './types';
import { type CadenceWindow } from './cadence';
import { runChecks, type ScanCoverage } from './checks';
import type { CheckContext, PoLine, PoRow } from './checks/contract';

const DEAD_STATUSES = new Set(['cancelled', 'rejected', 'draft']);

/** Re-exported: several callers and tests import these from here. */
export { looksLikeInvoiceRef, normaliseVendor } from './checks/duplicateInvoiceRef';

export interface LiveScanResult {
    findings: Finding[];
    /** What the scan looked at, and what each check did with it. */
    coverage: ScanCoverage;
    /** Headline counts, kept flat because the run log renders them as a row. */
    stats: {
        totalPos: number;
        livePos: number;
        propertiesResolved: number;
        /** Purchase orders whose line items are available to line-level checks. */
        posWithLines: number;
        checksRan: number;
        checksSkipped: number;
        checksFailed: number;
        findings: number;
    };
}

/**
 * Scan an org's purchase orders as at `asOf`.
 *
 * `asOf` bounds the window so a scan is reproducible: re-running "5 Sep 2026"
 * next month must give the same answer, or nothing downstream can be trusted.
 */
export async function scanPurchaseOrders(
    orgId: string,
    asOf: Date,
    /**
     * Restrict to findings that CAME INTO EXISTENCE in this window. Omit for a
     * full-corpus sweep (the monthly/quarterly baseline). A daily must always
     * pass one, or it re-reports the entire backlog every morning.
     */
    window?: CadenceWindow,
    /**
     * STRICTLY THE WINDOW. There is no carry-forward parameter and there must
     * not be one: a finding raised outside the last 24 hours is not today's
     * news, however long it has gone unanswered. Chasing open lines is a
     * different report with different dates on it.
     */
): Promise<LiveScanResult> {
    // --- purchase orders ------------------------------------------------------
    const pos: PoRow[] = [];
    for (let from = 0; ; from += 1000) {
        const { data, error } = await supabaseAdmin
            .from('zoho_purchase_orders')
            .select('id, created_at, synced_at, po_number, vendor_name, po_amount, status, po_date, property_id, raw')
            .eq('organization_id', orgId)
            .lte('po_date', asOf.toISOString().slice(0, 10))
            .range(from, from + 999);
        if (error || !data?.length) break;
        pos.push(...(data as PoRow[]));
        if (data.length < 1000) break;
    }

    const live = pos.filter((r) => !DEAD_STATUSES.has(String(r.status ?? '')));

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

    // --- property names, so findings read in English --------------------------
    const propIds = [...new Set(live.map((r) => r.property_id).filter(Boolean))] as string[];
    const propName = new Map<string, string>();
    if (propIds.length) {
        const { data } = await supabaseAdmin
            .from('properties').select('id, name').in('id', propIds.slice(0, 500));
        for (const p of data ?? []) propName.set(String(p.id), String(p.name ?? ''));
    }

    // --- line items, when the detail sync has them ----------------------------
    //
    // An EMPTY map is a real state, not a failure: the backfill runs over hours,
    // and before the migration lands the table does not exist at all. Either way
    // the checks that need lines skip WITH A REASON rather than reporting clear.
    const lines = await loadLines(orgId);

    const ctx: CheckContext = {
        orgId,
        asOf,
        window,
        pos,
        live,
        lines,
        propName,
        poRef,
    };

    const { findings, coverage } = await runChecks(ctx);

    return {
        findings,
        coverage,
        stats: {
            totalPos: pos.length,
            livePos: live.length,
            propertiesResolved: propName.size,
            posWithLines: lines.size,
            checksRan: coverage.ran,
            checksSkipped: coverage.skipped,
            checksFailed: coverage.failed,
            findings: findings.length,
        },
    };
}

/**
 * Every stored line item for the org, keyed by Zoho purchase-order id.
 *
 * Returns an empty map — never throws — when the table is absent, which is the
 * state on any deployment where 20260907000004_po_line_items has not been
 * applied. The checks that need it treat empty as "not synced", so a missing
 * migration degrades to fewer checks rather than a failed scan.
 */
async function loadLines(orgId: string): Promise<Map<string, PoLine[]>> {
    const byPo = new Map<string, PoLine[]>();
    try {
        for (let from = 0; ; from += 1000) {
            const { data, error } = await supabaseAdmin
                .from('zoho_po_line_items')
                .select('zoho_po_id, line_item_id, item_id, name, description, unit, quantity, quantity_billed, rate, item_total')
                .eq('organization_id', orgId)
                .range(from, from + 999);
            if (error || !data?.length) break;
            for (const l of data as PoLine[]) {
                byPo.set(l.zoho_po_id, [...(byPo.get(l.zoho_po_id) ?? []), l]);
            }
            if (data.length < 1000) break;
        }
    } catch {
        // Table not there yet. An empty map is the honest answer.
    }
    return byPo;
}
