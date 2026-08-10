import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { resolveAccountsAccess, isAccountsAccessError, readOrgId } from '@/backend/lib/accounts/access';
import { logPoActivity } from '@/backend/lib/accounts/activity';

// PATCH /api/accounts/pos/[id] — per-PO workflow state (critical flag, SPOC).
//
// Lives on po_workflow_state, never on zoho_purchase_orders: the Zoho Books sync
// overwrites PO rows wholesale every 2 hours and would clobber anything written there.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const body = await request.json().catch(() => null);
    if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });

    const access = await resolveAccountsAccess(request, readOrgId(request, body));
    if (isAccountsAccessError(access)) return access;
    if (!access.canAlign && !access.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    // The PO must belong to the caller's organization before we write anything against it.
    const { data: po } = await supabaseAdmin
        .from('zoho_purchase_orders')
        .select('id, po_number, organization_id')
        .eq('id', id)
        .eq('organization_id', access.organizationId)
        .maybeSingle();
    if (!po) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const wantsCritical = body.is_critical !== undefined;
    const wantsSpoc = body.assigned_spoc !== undefined;
    if (!wantsCritical && !wantsSpoc && body.critical_reason === undefined)
        return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });

    const { data: existing } = await supabaseAdmin
        .from('po_workflow_state')
        .select('*')
        .eq('organization_id', access.organizationId)
        .eq('po_id', id)
        .maybeSingle();

    const now = new Date().toISOString();
    // Only the fields the caller actually sent are written. Seeding the payload from the
    // `existing` snapshot turned every partial PATCH into a full-row overwrite, so two
    // concurrent requests touching different columns silently reverted each other
    // (A sets assigned_spoc while B sets is_critical -> whichever lands second wins
    // outright). `existing` is still read, but only to decide the raised_by/at re-stamp.
    const row: Record<string, unknown> = {
        organization_id: access.organizationId,
        po_id: id,
        updated_at: now,
    };

    if (wantsCritical) {
        const isCritical = !!body.is_critical;
        row.is_critical = isCritical;
        if (isCritical) {
            row.critical_reason = body.critical_reason ? String(body.critical_reason).trim() : (existing?.critical_reason ?? null);
            // Re-stamp the raiser only on a fresh flip so the original timestamp survives edits.
            row.critical_raised_by = existing?.is_critical ? existing.critical_raised_by : access.user.id;
            row.critical_raised_at = existing?.is_critical ? existing.critical_raised_at : now;
        } else {
            row.critical_reason = null;
            row.critical_raised_by = null;
            row.critical_raised_at = null;
        }
    } else if (body.critical_reason !== undefined) {
        row.critical_reason = body.critical_reason ? String(body.critical_reason).trim() : null;
    }

    if (wantsSpoc) {
        // A SPOC decides who gets paged for procurement and payment work, so authoring one
        // is org-admin only — the same restriction app/api/workflows/spoc/route.ts enforces
        // on the SPOC matrix. Without this, any canAlign role (purchase_executive included)
        // had a second, less-privileged way to set the same kind of state.
        if (!access.isAdmin) {
            return NextResponse.json({ error: 'Forbidden: only org admins may assign a SPOC' }, { status: 403 });
        }
        const spoc = body.assigned_spoc ? String(body.assigned_spoc) : null;
        if (spoc) {
            // Both membership tables, because an accounts/procurement role legitimately
            // lives on either one — see backend/lib/accounts/access.ts:82,85.
            const [orgM, propM] = await Promise.all([
                supabaseAdmin.from('organization_memberships').select('user_id')
                    .eq('user_id', spoc).eq('organization_id', access.organizationId).eq('is_active', true).limit(1),
                supabaseAdmin.from('property_memberships').select('user_id')
                    .eq('user_id', spoc).eq('organization_id', access.organizationId).eq('is_active', true).limit(1),
            ]);
            if (!(orgM.data || []).length && !(propM.data || []).length) {
                return NextResponse.json({ error: 'SPOC is not an active member of this organization' }, { status: 400 });
            }
        }
        row.assigned_spoc = spoc;
    }

    const { data: updated, error } = await supabaseAdmin
        .from('po_workflow_state')
        .upsert(row, { onConflict: 'organization_id,po_id' })
        .select('*')
        .single();
    if (error) {
        console.error('PO workflow PATCH error:', error);
        return NextResponse.json({ error: 'Failed to update PO workflow state' }, { status: 500 });
    }

    // Timeline. Only a genuine FLIP is recorded — re-saving a PO that was already critical
    // would otherwise fill the timeline with events where nothing changed.
    if (wantsCritical && !!body.is_critical !== !!existing?.is_critical) {
        await logPoActivity({
            organizationId: access.organizationId,
            poId: id,
            action: body.is_critical ? 'critical_raised' : 'critical_cleared',
            actorId: access.user.id,
            note: body.is_critical ? (updated.critical_reason ?? null) : 'Critical flag cleared',
            detail: { po_number: po.po_number },
        });
    }
    if (wantsSpoc && (body.assigned_spoc ?? null) !== (existing?.assigned_spoc ?? null)) {
        await logPoActivity({
            organizationId: access.organizationId,
            poId: id,
            action: 'comment',
            actorId: access.user.id,
            note: body.assigned_spoc ? 'SPOC assigned' : 'SPOC cleared',
            detail: { assigned_spoc: updated.assigned_spoc ?? null },
        });
    }

    return NextResponse.json({ workflow: updated });
}
