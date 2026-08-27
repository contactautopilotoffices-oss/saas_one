import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { resolveAccountsAccess, isAccountsAccessError, readOrgId } from '@/backend/lib/accounts/access';
import { logPoActivityForPos } from '@/backend/lib/accounts/activity';
import type { VendorProfile, VendorProfileResponse, ComplianceStatus, MsmeCategory } from '@/backend/lib/accounts/trackerTypes';

/**
 * PATCH /api/accounts/vendor-profiles/[id] — statutory identity, banking and compliance.
 *
 * Fields are transcribed by humans from certificates, so nothing here is regex-validated —
 * a rejected paste is worse than a value flagged for review, which is exactly what
 * compliance_status is for (the same reasoning as the migration's own comment).
 * The two enum columns ARE validated, because a bad value there is a constraint violation
 * the caller would only ever see as a 500.
 */

const UNDEFINED_TABLE = '42P01';

/** Free-text columns any tracker user may correct. */
const TEXT_FIELDS = [
    'vendor_name', 'gstin', 'pan', 'udyam_number', 'cin',
    'bank_account_name', 'bank_account_number', 'bank_ifsc',
    'contact_name', 'contact_email', 'contact_phone', 'address', 'notes',
] as const;

const MSME_CATEGORIES: MsmeCategory[] = ['micro', 'small', 'medium', 'not_registered'];
const COMPLIANCE_STATUSES: ComplianceStatus[] = ['unverified', 'in_review', 'verified', 'rejected', 'expired'];
// Saying "this vendor is verified" (or rejecting them) decides whether money may move, so
// it sits at the same bar as completing a payment: accounts + org admins.
const RESTRICTED_STATUSES: ComplianceStatus[] = ['verified', 'rejected'];

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const body = await request.json().catch(() => null);
    if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });

    const access = await resolveAccountsAccess(request, readOrgId(request, body));
    if (isAccountsAccessError(access)) return access;
    if (!access.canAlign) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const { data: existing, error: readErr } = await supabaseAdmin
        .from('vendor_profiles').select('*')
        .eq('id', id).eq('organization_id', access.organizationId).maybeSingle();
    if (readErr) {
        if (readErr.code === UNDEFINED_TABLE) {
            return NextResponse.json(
                { error: 'Vendor compliance requires a pending database migration (20260805000001). Apply migrations and retry.' },
                { status: 503 },
            );
        }
        console.error('Vendor profile read error:', readErr);
        return NextResponse.json({ error: 'Failed to read the vendor profile' }, { status: 500 });
    }
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const now = new Date().toISOString();
    // Only the keys the caller actually sent are written — seeding a payload from the
    // existing row turns every partial PATCH into a full-row overwrite, which is how two
    // people editing different fields silently revert each other
    // (the same defect fixed in app/api/accounts/pos/[id]/route.ts).
    const patch: Record<string, unknown> = { updated_at: now };

    for (const f of TEXT_FIELDS) {
        if (body[f] === undefined) continue;
        const v = body[f];
        // '' means "clear it". Storing an empty string would make a blank field look filled.
        patch[f] = v === null || String(v).trim() === '' ? null : String(v).trim();
    }
    if (patch.vendor_name === null) {
        return NextResponse.json({ error: 'vendor_name cannot be empty' }, { status: 400 });
    }

    if (body.msme_category !== undefined) {
        const v = body.msme_category;
        if (v === null || v === '') patch.msme_category = null;
        else if (!MSME_CATEGORIES.includes(v)) {
            return NextResponse.json({ error: `msme_category must be one of: ${MSME_CATEGORIES.join(', ')}` }, { status: 400 });
        } else patch.msme_category = v;
    }

    if (body.is_active !== undefined) patch.is_active = !!body.is_active;

    let statusChanged = false;
    if (body.compliance_status !== undefined) {
        const next = body.compliance_status as ComplianceStatus;
        if (!COMPLIANCE_STATUSES.includes(next)) {
            return NextResponse.json({ error: `compliance_status must be one of: ${COMPLIANCE_STATUSES.join(', ')}` }, { status: 400 });
        }
        if (RESTRICTED_STATUSES.includes(next) && !(access.canComplete || access.isAdmin)) {
            return NextResponse.json(
                { error: 'Forbidden: only accounts or an org admin may verify or reject a vendor' },
                { status: 403 },
            );
        }
        statusChanged = next !== existing.compliance_status;
        patch.compliance_status = next;
        if (next === 'verified') {
            patch.verified_by = access.user.id;
            patch.verified_at = now;
        } else {
            // Leaving 'verified' must drop the attestation with it: a stale verified_by on a
            // rejected or expired vendor reads as an approval that never happened.
            patch.verified_by = null;
            patch.verified_at = null;
        }
    }

    if (Object.keys(patch).length === 1) {
        return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
    }

    const { data: updated, error } = await supabaseAdmin
        .from('vendor_profiles').update(patch)
        .eq('id', id).eq('organization_id', access.organizationId)
        .select('*').single();
    if (error) {
        console.error('Vendor profile PATCH error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Timeline. po_activity_log.po_id is NOT NULL, so a vendor-level event can only be
    // recorded against POs. Only a COMPLIANCE change is logged, and only onto POs with a
    // live tranche: those are the ones where "this vendor just became payable / stopped
    // being payable" changes what somebody should do next. Field corrections (a phone
    // number) would be pure noise on 300 timelines.
    if (statusChanged && updated.zoho_vendor_id) {
        const { data: pos } = await supabaseAdmin
            .from('zoho_purchase_orders').select('id')
            .eq('organization_id', access.organizationId)
            .eq('vendor_id', updated.zoho_vendor_id)
            .range(0, 199);
        const poIds = (pos || []).map((p: { id: string }) => p.id);
        if (poIds.length) {
            const { data: live } = await supabaseAdmin
                .from('po_payments').select('po_id')
                .eq('organization_id', access.organizationId)
                .in('po_id', poIds)
                .in('status', ['to_align', 'aligned'])
                .range(0, 999);
            await logPoActivityForPos(
                (live || []).map((p: { po_id: string }) => p.po_id),
                {
                    organizationId: access.organizationId,
                    action: 'vendor_updated',
                    fromStatus: existing.compliance_status,
                    toStatus: updated.compliance_status,
                    actorId: access.user.id,
                    note: `Vendor compliance: ${existing.compliance_status} → ${updated.compliance_status}`,
                    detail: { vendor_profile_id: updated.id, vendor_name: updated.vendor_name },
                },
            );
        }
    }

    const responseBody: VendorProfileResponse = { vendor_profile: updated as VendorProfile };
    return NextResponse.json(responseBody);
}
