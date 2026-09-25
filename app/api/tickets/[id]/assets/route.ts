import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { recordAssetEvent } from '@/backend/lib/assets/enrich';

/**
 * GET /api/tickets/[id]/assets — assets logged against this ticket (for the
 * "Asset worked on" card in the ticket detail view — every role can read it).
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id: ticketId } = await params;
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: events, error } = await supabaseAdmin
        .from('asset_events')
        .select(`
            id, title, description, occurred_at,
            created_by_user:users!asset_events_created_by_fkey(id, full_name),
            asset:assets(id, asset_code, name, qr_token, floor, location,
                category:asset_categories(name, color))
        `)
        .eq('ticket_id', ticketId)
        .eq('event_type', 'ticket_work')
        .order('occurred_at', { ascending: false });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ events: events || [] });
}

/**
 * POST /api/tickets/[id]/assets — the MST flow: scan an asset's QR, write what
 * was fixed. Authorization mirrors the ticket route's own rule: only the
 * person the ticket is assigned to (or an admin) may log work on it, and the
 * asset must belong to the ticket's own property.
 *
 * Body: { asset_id? , qr_token?, note }  — one of asset_id/qr_token is required.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id: ticketId } = await params;
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json();
    const { asset_id, qr_token, note } = body;
    if (!asset_id && !qr_token) return NextResponse.json({ error: 'asset_id or qr_token is required' }, { status: 400 });
    if (!note || !String(note).trim()) return NextResponse.json({ error: 'A short note on what was fixed is required' }, { status: 400 });

    const { data: ticket } = await supabaseAdmin
        .from('tickets')
        .select('id, assigned_to, property_id, organization_id, ticket_number, title')
        .eq('id', ticketId)
        .maybeSingle();
    if (!ticket) return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });

    const { data: profile } = await supabaseAdmin.from('users').select('is_master_admin').eq('id', user.id).maybeSingle();
    const { data: orgAdminRow } = await supabaseAdmin
        .from('organization_memberships')
        .select('role')
        .eq('user_id', user.id).eq('organization_id', ticket.organization_id).eq('is_active', true)
        .in('role', ['org_super_admin', 'org_admin', 'master_admin', 'ops_super_admin', 'owner'])
        .maybeSingle();
    const isAdmin = !!profile?.is_master_admin || !!orgAdminRow;
    if (!isAdmin && ticket.assigned_to !== user.id) {
        return NextResponse.json({ error: 'You must be assigned to this ticket to log asset work on it' }, { status: 403 });
    }

    let asset;
    if (asset_id) {
        const { data } = await supabaseAdmin.from('assets').select('id, organization_id, property_id, name, asset_code').eq('id', asset_id).is('deleted_at', null).maybeSingle();
        asset = data;
    } else {
        const { data } = await supabaseAdmin.from('assets').select('id, organization_id, property_id, name, asset_code').eq('qr_token', qr_token).is('deleted_at', null).maybeSingle();
        asset = data;
    }
    if (!asset) return NextResponse.json({ error: 'That QR code does not match a known asset' }, { status: 404 });
    if (asset.property_id !== ticket.property_id) {
        return NextResponse.json({ error: 'This asset belongs to a different property than the ticket' }, { status: 409 });
    }

    const created = await recordAssetEvent({
        asset_id: asset.id,
        organization_id: asset.organization_id,
        property_id: asset.property_id,
        event_type: 'ticket_work',
        title: `Worked on via ticket ${ticket.ticket_number}`,
        description: String(note).trim(),
        ticket_id: ticketId,
        created_by: user.id,
    });
    if (!created) return NextResponse.json({ error: 'Failed to log asset work' }, { status: 500 });

    await supabaseAdmin.from('ticket_activity_log').insert({
        ticket_id: ticketId,
        user_id: user.id,
        action: 'asset_worked_on',
        old_value: asset.asset_code,
        new_value: String(note).trim(),
    });

    return NextResponse.json({
        event: { id: created.id },
        asset: { id: asset.id, asset_code: asset.asset_code, name: asset.name },
    }, { status: 201 });
}
