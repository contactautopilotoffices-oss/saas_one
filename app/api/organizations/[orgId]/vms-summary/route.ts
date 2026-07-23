import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';

// GET: Organization-wide VMS summary (Super Admin)
// HIGH PERFORMANCE: Uses SQL-side count queries instead of fetching all rows.
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ orgId: string }> }
) {
    const { orgId } = await params;
    const supabase = await createClient();
    const { searchParams } = new URL(request.url);

    const period = searchParams.get('period') || 'today';

    // Fetch all properties in the org
    const { data: properties, error: propError } = await supabase
        .from('properties')
        .select('id, name, code')
        .eq('organization_id', orgId);

    if (propError) {
        return NextResponse.json({ error: propError.message }, { status: 500 });
    }

    const propertyIds = properties?.map((p: any) => p.id) || [];

    if (propertyIds.length === 0) {
        return NextResponse.json({
            organization_id: orgId,
            period,
            total_visitors: 0,
            total_checked_in: 0,
            total_checked_out: 0,
            properties: [],
        });
    }

    // Calculate date range
    let startDate: Date | null = null;
    if (period === 'today') {
        startDate = new Date();
        startDate.setHours(0, 0, 0, 0);
    } else if (period === 'week') {
        startDate = new Date();
        startDate.setDate(startDate.getDate() - 7);
    } else if (period === 'month') {
        startDate = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
        startDate.setHours(0, 0, 0, 0);
    }

    const periodFilter = startDate ? startDate.toISOString() : null;
    const todayISO = new Date().toISOString().split('T')[0];

    // --- Optimized Aggregation using SQL-side counts ---
    // 1. Total Stats for the Org
    const [totalStatsRes, checkedInRes, checkedOutRes, todayStatsRes] = await Promise.all([
        supabase.from('visitor_logs').select('id', { count: 'exact', head: true }).in('property_id', propertyIds).gte('checkin_time', periodFilter || '1970-01-01'),
        supabase.from('visitor_logs').select('id', { count: 'exact', head: true }).in('property_id', propertyIds).gte('checkin_time', periodFilter || '1970-01-01').is('checkout_time', null),
        supabase.from('visitor_logs').select('id', { count: 'exact', head: true }).in('property_id', propertyIds).gte('checkin_time', periodFilter || '1970-01-01').not('checkout_time', 'is', null),
        supabase.from('visitor_logs').select('id', { count: 'exact', head: true }).in('property_id', propertyIds).gte('checkin_time', todayISO),
    ]);

    // 2. Property breakdown
    const propertyBreakdown = await Promise.all(propertyIds.map(async (id) => {
        const [pTotal, pToday, pIn, pOut] = await Promise.all([
            supabase.from('visitor_logs').select('id', { count: 'exact', head: true }).eq('property_id', id).gte('checkin_time', periodFilter || '1970-01-01'),
            supabase.from('visitor_logs').select('id', { count: 'exact', head: true }).eq('property_id', id).gte('checkin_time', todayISO),
            supabase.from('visitor_logs').select('id', { count: 'exact', head: true }).eq('property_id', id).gte('checkin_time', periodFilter || '1970-01-01').is('checkout_time', null),
            supabase.from('visitor_logs').select('id', { count: 'exact', head: true }).eq('property_id', id).gte('checkin_time', periodFilter || '1970-01-01').not('checkout_time', 'is', null),
        ]);
        const prop = properties?.find(p => p.id === id);
        return {
            property_id: id,
            property_name: prop?.name,
            property_code: prop?.code,
            total: pTotal.count || 0,
            today: pToday.count || 0,
            checked_in: pIn.count || 0,
            checked_out: pOut.count || 0
        };
    }));

    return NextResponse.json({
        organization_id: orgId,
        period,
        total_visitors: totalStatsRes.count || 0,
        total_checked_in: checkedInRes.count || 0,
        total_checked_out: checkedOutRes.count || 0,
        total_today: todayStatsRes.count || 0,
        properties: propertyBreakdown
    });
}
