import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { resolveAccountsAccess, isAccountsAccessError, readOrgId } from '@/backend/lib/accounts/access';
import type { VendorBackfillResponse } from '@/backend/lib/accounts/trackerTypes';

/**
 * POST /api/accounts/vendor-profiles/backfill — seed vendor_profiles from the POs already
 * in the tracker, so the compliance list is not an empty screen on day one.
 *
 * IDEMPOTENT. Re-running creates nothing new: existing (organization_id, zoho_vendor_id)
 * pairs are read first and skipped, and the insert additionally rides the
 * vendor_profiles_zoho_key unique constraint with ignoreDuplicates, which closes the race
 * between two people pressing the button at once.
 *
 * ONLY STUBS ARE CREATED — name and Zoho id, compliance_status left at its 'unverified'
 * default. Nothing invents a GSTIN or a bank account: an unverified blank profile is an
 * honest to-do, a plausible-looking one is a trap.
 */

const PAGE = 1000;
const MAX_ROWS = 100000;
const INSERT_CHUNK = 500;
const UNDEFINED_TABLE = '42P01';

interface PoVendor { vendor_id: string | null; vendor_name: string | null }

export async function POST(request: NextRequest) {
    const body = await request.json().catch(() => ({}));
    const access = await resolveAccountsAccess(request, readOrgId(request, body));
    if (isAccountsAccessError(access)) return access;
    // A bulk write that creates org-wide master data. Kept at the accounts/admin bar rather
    // than the general tracker-write bar — this is not a per-PO edit.
    if (!access.canComplete && !access.isAdmin) {
        return NextResponse.json({ error: 'Forbidden: only accounts or an org admin may backfill vendor profiles' }, { status: 403 });
    }

    // --- every PO's (vendor_id, vendor_name) ------------------------------------
    // Paged explicitly: 5,265 POs against PostgREST's 1000-row cap means an unpaged read
    // would seed profiles for roughly a fifth of the suppliers and report success.
    const rows: PoVendor[] = [];
    try {
        for (let from = 0; from < MAX_ROWS; from += PAGE) {
            const { data, error } = await supabaseAdmin
                .from('zoho_purchase_orders')
                .select('vendor_id, vendor_name')
                .eq('organization_id', access.organizationId)
                .order('id', { ascending: true })
                .range(from, from + PAGE - 1);
            if (error) throw error;
            rows.push(...((data || []) as PoVendor[]));
            if ((data || []).length < PAGE) break;
        }
    } catch (e: any) {
        console.error('Vendor backfill scan error:', e);
        return NextResponse.json({ error: 'Failed to scan purchase orders' }, { status: 500 });
    }

    // Distinct by Zoho vendor id. First non-empty name wins; later POs for the same vendor
    // often carry a truncated or differently-cased name and there is no basis for choosing
    // one over another, so the first is kept and the profile is editable afterwards.
    const distinct = new Map<string, string>();
    let withoutVendorId = 0;
    for (const r of rows) {
        const zid = (r.vendor_id || '').trim();
        if (!zid) {
            // No join key. vendor_profiles.zoho_vendor_id is the ONLY link back to a PO
            // (there is no uuid path — see 20260805000001's header), and a NULL one is
            // distinct from every other NULL in the unique constraint, so seeding these
            // would create unmatchable duplicates on every run.
            withoutVendorId += 1;
            continue;
        }
        if (!distinct.has(zid)) distinct.set(zid, (r.vendor_name || '').trim() || `Vendor ${zid}`);
    }

    // --- what already exists ----------------------------------------------------
    const existing = new Set<string>();
    try {
        for (let from = 0; from < MAX_ROWS; from += PAGE) {
            const { data, error } = await supabaseAdmin
                .from('vendor_profiles')
                .select('zoho_vendor_id')
                .eq('organization_id', access.organizationId)
                .not('zoho_vendor_id', 'is', null)
                .order('zoho_vendor_id', { ascending: true })
                .range(from, from + PAGE - 1);
            if (error) throw error;
            for (const p of (data || []) as { zoho_vendor_id: string }[]) existing.add(p.zoho_vendor_id);
            if ((data || []).length < PAGE) break;
        }
    } catch (e: any) {
        if (e?.code === UNDEFINED_TABLE) {
            return NextResponse.json(
                { error: 'Vendor compliance requires a pending database migration (20260805000001). Apply migrations and retry.' },
                { status: 503 },
            );
        }
        console.error('Vendor backfill existing-profile read error:', e);
        return NextResponse.json({ error: 'Failed to read vendor profiles' }, { status: 500 });
    }

    const toInsert = [...distinct.entries()]
        .filter(([zid]) => !existing.has(zid))
        .map(([zid, name]) => ({
            organization_id: access.organizationId,
            zoho_vendor_id: zid,
            vendor_name: name,
            created_by: access.user.id,
        }));

    let created = 0;
    for (let i = 0; i < toInsert.length; i += INSERT_CHUNK) {
        const chunk = toInsert.slice(i, i + INSERT_CHUNK);
        const { data, error } = await supabaseAdmin
            .from('vendor_profiles')
            // The unique constraint is the real idempotency guarantee; the `existing` set
            // above is just an optimisation that keeps the insert small.
            .upsert(chunk, { onConflict: 'organization_id,zoho_vendor_id', ignoreDuplicates: true })
            .select('id');
        if (error) {
            console.error('Vendor backfill insert error:', error);
            return NextResponse.json({ error: 'Failed to create vendor profiles' }, { status: 500 });
        }
        created += (data || []).length;
    }

    const responseBody: VendorBackfillResponse = {
        organization_id: access.organizationId,
        distinct_vendors: distinct.size,
        created,
        already_present: distinct.size - toInsert.length,
        pos_without_vendor_id: withoutVendorId,
        scanned_pos: rows.length,
    };
    return NextResponse.json(responseBody, { status: 201 });
}
