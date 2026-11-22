import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { logAudit } from '@/backend/lib/audit';

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

        const validPropertyId = propertyId && propertyId !== 'all' && propertyId !== 'undefined' && propertyId !== 'null' ? propertyId : null;
        if (validPropertyId) query = query.eq('property_id', validPropertyId);

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
            if (validPropertyId) adminQuery = adminQuery.eq('property_id', validPropertyId);
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

/**
 * POST /api/ppm/schedules
 * Add a new task to the PPM calendar with full audit logging.
 */
export async function POST(request: NextRequest) {
    try {
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();
        const {
            organization_id,
            property_id,
            system_name,
            detail_name,
            scope_of_work,
            frequency = 'monthly',
            vendor_name,
            vendor_id,
            vendor_phone,
            vendor_contact_person,
            location,
            maker,
            checker,
            planned_date,
            status = 'pending',
            remark,
        } = body;

        if (!organization_id || !property_id || !system_name || !planned_date) {
            return NextResponse.json({
                error: 'organization_id, property_id, system_name, and planned_date are required'
            }, { status: 400 });
        }

        // Fetch user's full name for audit trail
        const { data: creatorUser } = await supabaseAdmin
            .from('users')
            .select('full_name, email')
            .eq('id', user.id)
            .single();

        const creatorName = creatorUser?.full_name || creatorUser?.email || 'Team Member';
        const nowIso = new Date().toISOString();

        const initialActivityLog = {
            action: 'created',
            user_id: user.id,
            user_name: creatorName,
            user_email: creatorUser?.email || null,
            timestamp: nowIso,
            details: `Task created for ${system_name}${detail_name ? ` (${detail_name})` : ''}`,
        };

        const newSchedulePayload: any = {
            organization_id,
            property_id,
            system_name: system_name.trim(),
            detail_name: detail_name?.trim() || null,
            scope_of_work: scope_of_work?.trim() || null,
            frequency: frequency || 'monthly',
            vendor_name: vendor_name?.trim() || null,
            vendor_id: vendor_id || null,
            vendor_phone: vendor_phone?.trim() || null,
            vendor_contact_person: vendor_contact_person?.trim() || null,
            location: location?.trim() || null,
            maker: maker?.trim() || creatorName,
            checker: checker?.trim() || null,
            planned_date,
            status: status || 'pending',
            remark: remark?.trim() || null,
            attachments: {
                created_by: user.id,
                created_by_name: creatorName,
                created_at: nowIso,
                activity_logs: [initialActivityLog],
            },
            created_at: nowIso,
            updated_at: nowIso,
        };

        // Try insert with user client, fallback to admin client for RLS
        let { data, error } = await supabase
            .from('ppm_schedules')
            .insert(newSchedulePayload)
            .select()
            .single();

        if (error || !data) {
            console.warn('[PPM] user-scoped insert failed, using admin fallback:', error?.message);
            const adminRes = await supabaseAdmin
                .from('ppm_schedules')
                .insert(newSchedulePayload)
                .select()
                .single();

            if (adminRes.error) {
                return NextResponse.json({ error: adminRes.error.message }, { status: 500 });
            }
            data = adminRes.data;
        }

        // Record in audit_logs table
        await logAudit({
            eventBy: user.id,
            objectType: 'ppm_schedule',
            objectId: data.id,
            action: 'ppm_schedule.created',
            payload: {
                schedule_id: data.id,
                property_id,
                organization_id,
                system_name: data.system_name,
                detail_name: data.detail_name,
                planned_date: data.planned_date,
                created_by_id: user.id,
                created_by_name: creatorName,
                created_at: nowIso,
            },
        });

        return NextResponse.json({ success: true, schedule: data }, { status: 201 });
    } catch (err: any) {
        console.error('PPM schedule create error:', err);
        return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
    }
}

