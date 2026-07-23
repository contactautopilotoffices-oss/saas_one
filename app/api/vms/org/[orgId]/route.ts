import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { getISTDateBounds } from '@/backend/utils/timezone';

/**
 * GET /api/vms/org/[orgId]
 * Returns all visitor logs across all properties in an organization.
 * Intended for org_super_admin.
 */
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ orgId: string }> }
) {
    const { orgId } = await params;
    const { searchParams } = new URL(request.url);

    const status = searchParams.get('status') || 'all';
    const date = searchParams.get('date') || 'today';
    const customDate = searchParams.get('customDate') || '';
    const search = searchParams.get('search') || '';
    const propertyId = searchParams.get('propertyId') || '';

    let query = supabaseAdmin
        .from('visitor_logs')
        .select('*, properties(id, name)')
        .eq('organization_id', orgId)
        .order('checkin_time', { ascending: false });

    // Status filter
    if (status !== 'all') {
        query = query.eq('status', status);
    }

    // Property filter
    if (propertyId) {
        query = query.eq('property_id', propertyId);
    }

    // Date filter
    if (date && date !== 'all') {
        let filterType = date;
        let customStr = undefined;
        if (!['today', 'yesterday', 'week', 'month'].includes(date)) {
            filterType = 'custom';
            customStr = customDate;
        }
        const bounds = getISTDateBounds(filterType as any, customStr);
        query = query.gte('checkin_time', bounds.start).lte('checkin_time', bounds.end);
    }

    // Search filter
    if (search) {
        query = query.or(`visitor_id.ilike.%${search}%,name.ilike.%${search}%,mobile.ilike.%${search}%`);
    }

    const { data, error } = await query.limit(200);

    if (error) {
        console.error('[VMS Org] Error fetching visitors:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Stats that respect the same date filter as the visitor list
    let statsStart: string | null = null;
    let statsEnd: string | null = null;

    if (date && date !== 'all') {
        let filterType = date;
        let customStr = undefined;
        if (!['today', 'yesterday', 'week', 'month'].includes(date)) {
            filterType = 'custom';
            customStr = customDate;
        }
        const bounds = getISTDateBounds(filterType as any, customStr);
        statsStart = bounds.start;
        statsEnd = bounds.end;
    }

    const buildStatsQuery = (baseQuery: any) => {
        let q = baseQuery;
        if (propertyId) q = q.eq('property_id', propertyId);
        if (statsStart) q = q.gte('checkin_time', statsStart);
        if (statsEnd) q = q.lte('checkin_time', statsEnd);
        return q;
    };

    const [{ count: totalVisitors }, { count: checkedIn }, { count: checkedOut }] = await Promise.all([
        buildStatsQuery(supabaseAdmin.from('visitor_logs').select('*', { count: 'exact', head: true }).eq('organization_id', orgId)),
        buildStatsQuery(supabaseAdmin.from('visitor_logs').select('*', { count: 'exact', head: true }).eq('organization_id', orgId).eq('status', 'checked_in')),
        buildStatsQuery(supabaseAdmin.from('visitor_logs').select('*', { count: 'exact', head: true }).eq('organization_id', orgId).eq('status', 'checked_out')),
    ]);

    // Fetch all properties in this org for filter dropdown
    const { data: properties } = await supabaseAdmin
        .from('properties')
        .select('id, name')
        .eq('organization_id', orgId)
        .eq('is_active', true)
        .order('name');

    return NextResponse.json({
        visitors: data || [],
        stats: {
            total_visitors: totalVisitors || 0,
            checked_in: checkedIn || 0,
            checked_out: checkedOut || 0,
        },
        properties: properties || [],
    });
}
