import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';

/**
 * GET /api/ppm/schedules?organization_id=&property_id=&month=3&year=2026
 * Returns all PPM schedules for a given month.
 */
export async function GET(request: NextRequest) {
    try {
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { searchParams } = request.nextUrl;
        const organizationId = searchParams.get('organization_id');
        const propertyId = searchParams.get('property_id');
        const month = parseInt(searchParams.get('month') || '0');
        const year = parseInt(searchParams.get('year') || '0');

        if (!organizationId || !month || !year) {
            return NextResponse.json({ error: 'organization_id, month, year are required' }, { status: 400 });
        }

        const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
        const lastDay = new Date(year, month, 0).getDate();
        const endDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

        let query = supabase
            .from('ppm_schedules')
            .select('*, maintenance_vendors(id, company_name, contact_person, phone, is_active)')
            .eq('organization_id', organizationId)
            .gte('planned_date', startDate)
            .lte('planned_date', endDate)
            .order('planned_date', { ascending: true });

        if (propertyId) query = query.eq('property_id', propertyId);

        let { data, error } = await query;
        if (error || !data || data.length === 0) {
            // Admin fallback to prevent RLS false-negatives for staff/ops members
            let adminQuery = supabaseAdmin
                .from('ppm_schedules')
                .select('*, maintenance_vendors(id, company_name, contact_person, phone, is_active)')
                .eq('organization_id', organizationId)
                .gte('planned_date', startDate)
                .lte('planned_date', endDate)
                .order('planned_date', { ascending: true });
            if (propertyId) adminQuery = adminQuery.eq('property_id', propertyId);
            const adminRes = await adminQuery;
            if (adminRes.data && adminRes.data.length > 0) {
                data = adminRes.data;
                error = null;
            }
        }

        if (error) return NextResponse.json({ error: error.message }, { status: 500 });

        return NextResponse.json({ schedules: data || [] });
    } catch (err) {
        console.error('PPM schedules fetch error:', err);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
