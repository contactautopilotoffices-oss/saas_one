/**
 * MEETINGS — building the agenda for the PO-approvals topic.
 *
 * First topic: purchase orders stuck at "pending approval" in Zoho. Every fact
 * Ira may say aloud is computed HERE and frozen on the item — vendor, amount
 * already written the way it should be spoken, property and days waiting. She
 * is told to quote nothing else, so a number in the room can always be traced
 * to a row.
 *
 * Nothing from the purchase@ mailbox goes on the agenda. Accounts, org admins
 * and ops super admins may join a meeting but may not read that mailbox
 * (backend/lib/mailbox/access.ts), and everyone in the room hears what Ira reads.
 *
 * Sorted by value: the most money first. Days waiting is shown on every item,
 * so the oldest are easy to spot without being allowed to crowd out the large.
 */

import { supabaseAdmin } from '@/backend/lib/supabase/admin';

export interface PoFacts {
    po_number: string;
    vendor: string;
    amount: number;
    amount_spoken: string;
    property: string | null;
    po_date: string;
    days_waiting: number;
    department: string | null;
    category: string | null;
}

export interface AgendaDraft {
    ref_id: string;
    label: string;
    facts: PoFacts;
}

/** ₹45,000 · ₹2.1 lakh · ₹1.3 crore — the way people in the room say it. */
export function spokenAmount(n: number): string {
    if (!Number.isFinite(n) || n <= 0) return 'amount not recorded';
    if (n >= 1e7) return `₹${trim(n / 1e7)} crore`;
    if (n >= 1e5) return `₹${trim(n / 1e5)} lakh`;
    return `₹${Math.round(n).toLocaleString('en-IN')}`;
}
const trim = (x: number) => (Math.round(x * 10) / 10).toString();

export async function buildPoApprovalAgenda(
    orgId: string, opts: { minDays: number; limit: number },
): Promise<AgendaDraft[]> {
    const cutoff = new Date(Date.now() - opts.minDays * 86_400_000).toISOString().slice(0, 10);
    const { data, error } = await supabaseAdmin
        .from('zoho_purchase_orders')
        .select('id, po_number, vendor_name, po_amount, po_date, property_id, department, category')
        .eq('organization_id', orgId)
        // Zoho sync writes 'pending_approval'; CSV imports keep the sheet's own wording.
        // Same rule as the Payment Tracker view: pending approval in any spelling, or submitted.
        // ('_' is a single-character wildcard in ilike, so this also matches "Pending Approval".)
        .or('status.ilike.pending_approval,status.ilike.submitted')
        .lte('po_date', cutoff)
        .order('po_amount', { ascending: false })
        .range(0, 999);
    if (error) throw new Error(`Could not read purchase orders: ${error.message}`);

    // One row per PO number: a resync can leave two rows for one PO.
    const seen = new Set<string>();
    const rows = (data ?? []).filter((r) => {
        const k = String(r.po_number ?? '').trim();
        if (!k || seen.has(k)) return false;
        seen.add(k);
        return true;
    }).slice(0, opts.limit);
    if (!rows.length) return [];

    const propIds = [...new Set(rows.map((r) => r.property_id).filter(Boolean))] as string[];
    const names = new Map<string, string>();
    if (propIds.length) {
        const { data: props } = await supabaseAdmin.from('properties').select('id, name').in('id', propIds);
        for (const p of props ?? []) names.set(String(p.id), String(p.name ?? '').replace(/[\s,]+$/, ''));
    }

    return rows.map((r) => {
        const po = String(r.po_number).trim();
        const amount = Number(r.po_amount ?? 0);
        return {
            ref_id: String(r.id),
            label: po,
            facts: {
                po_number: po,
                vendor: String(r.vendor_name ?? 'vendor not recorded'),
                amount,
                amount_spoken: spokenAmount(amount),
                property: r.property_id ? names.get(String(r.property_id)) ?? null : null,
                po_date: String(r.po_date),
                days_waiting: Math.max(0, Math.floor((Date.now() - Date.parse(String(r.po_date))) / 86_400_000)),
                department: r.department ?? null,
                category: r.category ?? null,
            },
        };
    });
}
