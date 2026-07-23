import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';

/**
 * GET /api/properties/[propertyId]/vms-summary
 * Property-level visitor summary. Uses supabaseAdmin to bypass visitor_logs RLS.
 * Query params: period = 'today' | 'month' | 'all'
 */
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ propertyId: string }> }
) {
    const { propertyId } = await params;

    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
        console.error('[VMS API] Auth error:', authError?.message || 'No user found');
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const period = searchParams.get('period') || 'today';

    // Build date filter
    let startDate: Date | null = null;
    if (period === 'today') {
        startDate = new Date();
        startDate.setHours(0, 0, 0, 0);
    } else if (period === 'month') {
        startDate = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
        startDate.setHours(0, 0, 0, 0);
    }
    const periodFilter = startDate ? startDate.toISOString() : null;

    // --- Optimized Aggregation using SQL-side counts ---
    const [totalStatsRes, checkedInRes, checkedOutRes] = await Promise.all([
        supabaseAdmin.from('visitor_logs').select('id', { count: 'exact', head: true }).eq('property_id', propertyId).gte('checkin_time', periodFilter || '1970-01-01'),
        supabaseAdmin.from('visitor_logs').select('id', { count: 'exact', head: true }).eq('property_id', propertyId).gte('checkin_time', periodFilter || '1970-01-01').is('checkout_time', null),
        supabaseAdmin.from('visitor_logs').select('id', { count: 'exact', head: true }).eq('property_id', propertyId).gte('checkin_time', periodFilter || '1970-01-01').not('checkout_time', 'is', null),
    ]);

    return NextResponse.json({
        property_id: propertyId,
        period,
        total_visitors: totalStatsRes.count || 0,
        checked_in: checkedInRes.count || 0,
        checked_out: checkedOutRes.count || 0,
    });
}
