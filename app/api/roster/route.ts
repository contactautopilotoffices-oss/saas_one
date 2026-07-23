import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';

export async function GET(request: NextRequest) {
    try {
        const searchParams = request.nextUrl.searchParams;
        const propertyId = searchParams.get('propertyId');
        const monthStr = searchParams.get('month'); // YYYY-MM

        if (!propertyId || !monthStr) {
            return NextResponse.json({ error: 'propertyId and month are required' }, { status: 400 });
        }

        // Calculate date range for the month
        const year = parseInt(monthStr.split('-')[0]);
        const month = parseInt(monthStr.split('-')[1]) - 1; // 0-indexed
        
        const startDate = new Date(year, month, 1).toISOString().split('T')[0];
        const endDate = new Date(year, month + 1, 0).toISOString().split('T')[0];

        const supabase = await createClient();

        // Fetch registered staff
        const { data: registeredStaff, error: staffError } = await supabase
            .from('property_memberships')
            .select(`
                user_id,
                role,
                custom_designation,
                users ( id, full_name )
            `)
            .eq('property_id', propertyId)
            .eq('is_active', true)
            .neq('role', 'vendor')
            .neq('role', 'tenant')
            .neq('role', 'super_tenant');

        if (staffError) {
            console.error('[GET /api/roster] Staff fetch error:', staffError);
            return NextResponse.json({ error: 'Failed to fetch staff' }, { status: 500 });
        }

        // Fetch offline staff
        const { data: offlineStaffData, error: offlineError } = await supabase
            .from('offline_roster_staff')
            .select('*')
            .eq('property_id', propertyId);

        if (offlineError) {
            console.error('[GET /api/roster] Offline staff fetch error:', offlineError);
            return NextResponse.json({ error: 'Failed to fetch offline staff' }, { status: 500 });
        }

        // Map offline staff to match the expected format
        const offlineStaffMapped = (offlineStaffData || []).map(os => ({
            user_id: os.id,
            role: 'offline', // Distinguishing flag, though not strictly required
            custom_designation: os.custom_designation,
            users: {
                id: os.id,
                full_name: os.full_name,
                designation: os.custom_designation || 'Unassigned'
            }
        }));

        const combinedStaff = [...(registeredStaff || []), ...offlineStaffMapped];

        // Fetch rosters
        const { data: rosters, error: rosterError } = await supabase
            .from('staff_rosters')
            .select(`
                id,
                user_id,
                roster_date,
                shift_id,
                is_reliever,
                relieving_user_id,
                updated_by,
                updater:users!staff_rosters_updated_by_fkey ( full_name )
            `)
            .eq('property_id', propertyId)
            .gte('roster_date', startDate)
            .lte('roster_date', endDate);

        if (rosterError) {
            console.error('[GET /api/roster] Roster fetch error:', rosterError);
            return NextResponse.json({ error: 'Failed to fetch rosters' }, { status: 500 });
        }

        return NextResponse.json({ 
            staff: combinedStaff,
            rosters: rosters || []
        });

    } catch (error) {
        console.error('[GET /api/roster] API error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
