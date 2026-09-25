import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { resolveAssetAccess, isAssetAccessError, readOrgId, canAccessProperty } from '@/backend/lib/assets/access';
import { recordAssetEvent } from '@/backend/lib/assets/enrich';

/**
 * POST /api/assets/[id]/events — log a lifecycle event directly against an asset
 * (a note, a cost, an AMC/warranty update, a manual status note). Ticket-work
 * events are logged via /api/tickets/[id]/assets instead, where ticket
 * assignment is the authorization check.
 *
 * A 'cost' event with cost_head='rnm' also decrements the property's R&M
 * procurement budget; if that budget doesn't exist yet the event still saves
 * — budget_synced stays false and budget_sync_error explains why, rather than
 * losing the spend record over a missing envelope.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const body = await request.json();
    const access = await resolveAssetAccess(request, readOrgId(request, body));
    if (isAssetAccessError(access)) return access;

    const { data: asset } = await supabaseAdmin.from('assets').select('id, organization_id, property_id').eq('id', id).eq('organization_id', access.organizationId).maybeSingle();
    if (!asset) return NextResponse.json({ error: 'Asset not found' }, { status: 404 });
    if (!canAccessProperty(access, asset.property_id)) return NextResponse.json({ error: 'Forbidden: no access to this property' }, { status: 403 });

    const { event_type, title, description, amount, cost_head, amc_contract_id, photo_urls, occurred_at } = body;
    const allowedTypes = ['note', 'cost', 'amc', 'warranty', 'status_change'];
    if (!event_type || !allowedTypes.includes(event_type)) {
        return NextResponse.json({ error: `event_type must be one of ${allowedTypes.join(', ')}` }, { status: 400 });
    }
    if (!title) return NextResponse.json({ error: 'title is required' }, { status: 400 });
    if (event_type === 'cost' && !access.canManage) {
        return NextResponse.json({ error: 'Forbidden: only managers can log a cost against an asset' }, { status: 403 });
    }
    if (event_type === 'cost' && (amount === undefined || amount === null || Number(amount) <= 0)) {
        return NextResponse.json({ error: 'amount is required for a cost event' }, { status: 400 });
    }

    const created = await recordAssetEvent({
        asset_id: id,
        organization_id: access.organizationId,
        property_id: asset.property_id,
        event_type,
        title,
        description: description || null,
        amount: event_type === 'cost' ? Number(amount) : null,
        cost_head: event_type === 'cost' ? (cost_head || 'rnm') : null,
        amc_contract_id: amc_contract_id || null,
        photo_urls: photo_urls || [],
        occurred_at: occurred_at || undefined,
        created_by: access.user.id,
    });
    if (!created) return NextResponse.json({ error: 'Failed to log event' }, { status: 500 });

    let budgetSynced = false;
    let budgetError: string | null = null;
    if (event_type === 'cost' && (cost_head || 'rnm') === 'rnm') {
        const { error: rpcError } = await supabaseAdmin.rpc('decrement_procurement_budget', {
            p_property_id: asset.property_id,
            p_budget_type: 'rnm',
            p_amount: Number(amount),
        });
        if (rpcError) {
            budgetError = rpcError.message;
            console.error('[assets] R&M budget sync failed:', rpcError.message);
        } else {
            budgetSynced = true;
        }
        await supabaseAdmin.from('asset_events').update({ budget_synced: budgetSynced, budget_sync_error: budgetError }).eq('id', created.id);
    }

    return NextResponse.json({ event: { id: created.id }, budget_synced: budgetSynced, budget_sync_error: budgetError }, { status: 201 });
}
