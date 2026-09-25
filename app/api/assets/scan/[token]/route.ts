import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { ASSET_SELECT, enrichAssets, type AssetRow } from '@/backend/lib/assets/enrich';

interface LinkedTicket {
    id: string;
    ticket_number: string;
    title: string;
    status: string;
    priority: string;
    created_at: string;
    resolved_at: string | null;
}

/**
 * GET /api/assets/scan/[token] — public asset profile for a scanned QR token.
 *
 * The qr_token printed on the label acts as a capability secret: anyone who
 * physically scans the label can view the asset's full profile (details, health,
 * AMC, PPM schedules, linked tickets, and lifecycle events). No login required.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
    const { token } = await params;

    const { data: asset, error } = await supabaseAdmin
        .from('assets')
        .select(ASSET_SELECT)
        .eq('qr_token', token)
        .is('deleted_at', null)
        .maybeSingle();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!asset) return NextResponse.json({ error: 'This QR code does not match any asset' }, { status: 404 });

    const typedAsset = asset as unknown as AssetRow;
    const [enriched] = await enrichAssets([typedAsset]);
    const assetId = typedAsset.id;
    const organizationId = typedAsset.organization_id;
    const propertyId = typedAsset.property_id;

    const [{ data: events }, { data: ppmRows }, { data: ticketLinks }] = await Promise.all([
        supabaseAdmin
            .from('asset_events')
            .select(`
                id, event_type, title, description, amount, cost_head, occurred_at,
                ticket:tickets(id, ticket_number, title, status),
                created_by_user:users!asset_events_created_by_fkey(id, full_name)
            `)
            .eq('asset_id', assetId)
            .order('occurred_at', { ascending: false })
            .limit(50),
        supabaseAdmin
            .from('ppm_schedules')
            .select(`
                id, planned_date, completion_date, status, frequency, scope,
                vendor:maintenance_vendors(id, company_name, contact_person, phone)
            `)
            .eq('asset_id', assetId)
            .order('planned_date', { ascending: false })
            .limit(50),
        supabaseAdmin
            .from('asset_events')
            .select(`
                ticket_id,
                ticket:tickets(id, ticket_number, title, status, priority, created_at, resolved_at)
            `)
            .eq('asset_id', assetId)
            .not('ticket_id', 'is', null)
            .order('occurred_at', { ascending: false })
            .limit(200),
    ]);

    // Distinct tickets ordered newest first.
    const seen = new Set<string>();
    const tickets = (ticketLinks || [])
        .map((row: unknown) => {
            const r = row as { ticket_id: string; ticket: LinkedTicket | LinkedTicket[] | null };
            const t = Array.isArray(r.ticket) ? r.ticket[0] : r.ticket;
            return t;
        })
        .filter((t): t is LinkedTicket => {
            if (!t) return false;
            if (seen.has(t.id)) return false;
            seen.add(t.id);
            return true;
        });

    await supabaseAdmin.from('asset_events').insert({
        asset_id: assetId,
        organization_id: organizationId,
        property_id: propertyId,
        event_type: 'scan',
        title: 'QR scanned',
        metadata: { via: 'qr', anonymous: true },
    });

    return NextResponse.json({
        asset: enriched,
        events: events || [],
        ppm_schedules: ppmRows || [],
        tickets,
        can_log_work: false,
    });
}
