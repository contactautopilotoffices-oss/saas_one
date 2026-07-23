import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { createClient } from '@/frontend/utils/supabase/server';

/**
 * GET /api/meeting-room-credits?propertyId=&userId=
 * - Tenant: get their own credits for a property
 * - Admin: get all tenant credits for a property
 */
export async function GET(request: NextRequest) {
    try {
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const { searchParams } = request.nextUrl;
        const propertyId = searchParams.get('propertyId');
        const userId = searchParams.get('userId'); // admin querying specific tenant
        const companyId = searchParams.get('companyId');

        if (!propertyId) return NextResponse.json({ error: 'propertyId required' }, { status: 400 });

        // 1. Check Property Level
        const { data: membership } = await supabaseAdmin
            .from('property_memberships')
            .select('role')
            .eq('property_id', propertyId)
            .eq('user_id', user.id)
            .maybeSingle();

        let isAdmin = ['property_admin', 'staff', 'org_admin'].includes(membership?.role || '');

        // 2. Check System/Org Level if not property admin
        if (!isAdmin) {
            const [profileRes, propertyRes] = await Promise.all([
                supabaseAdmin.from('users').select('is_master_admin').eq('id', user.id).single(),
                supabaseAdmin.from('properties').select('organization_id').eq('id', propertyId).single()
            ]);

            if (profileRes.data?.is_master_admin) {
                isAdmin = true;
            } else if (propertyRes.data?.organization_id) {
                const { data: orgMember } = await supabaseAdmin
                    .from('organization_memberships')
                    .select('role')
                    .eq('organization_id', propertyRes.data.organization_id)
                    .eq('user_id', user.id)
                    .maybeSingle();
                
                if (['org_super_admin', 'org_admin'].includes(orgMember?.role || '')) {
                    isAdmin = true;
                }
            }
        }

        if (isAdmin) {
            // Admin: fetch all tenant/company credits with info
            let query = supabaseAdmin
                .from('meeting_room_credits')
                .select('*, tenant:users!user_id(id, full_name, email), company:companies!company_id(id, name, logo_url), assigned_by_user:users!assigned_by(full_name)')
                .eq('property_id', propertyId)
                .order('updated_at', { ascending: false });

            if (userId) query = query.eq('user_id', userId);
            if (companyId) query = query.eq('company_id', companyId);

            const { data: credits, error } = await query;
            if (error) return NextResponse.json({ error: error.message }, { status: 500 });
            return NextResponse.json({ credits: credits || [] });
        } else {
            // Tenant: Check if they belong to a company
            const { data: companyMember } = await supabaseAdmin
                .from('company_members')
                .select('company_id, company:companies(name, logo_url)')
                .eq('user_id', user.id)
                .maybeSingle();

            let query = supabaseAdmin
                .from('meeting_room_credits')
                .select('*')
                .eq('property_id', propertyId);

            if (companyMember?.company_id) {
                query = query.eq('company_id', companyMember.company_id);
            } else {
                query = query.eq('user_id', user.id);
            }

            const { data: credit, error } = await query.maybeSingle();

            if (error && error.code !== 'PGRST116') {
                return NextResponse.json({ error: error.message }, { status: 500 });
            }
            return NextResponse.json({ 
                credit: credit || null,
                company: companyMember?.company || null 
            });
        }
    } catch (err) {
        console.error('[Credits GET]', err);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

/**
 * POST /api/meeting-room-credits
 * Admin assigns or updates credit hours for a tenant
 * Body: { propertyId, userId, monthlyHours }
 */
export async function POST(request: NextRequest) {
    try {
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const body = await request.json();
        const { propertyId, userId, companyId, monthlyHours, remainingHours } = body;

        if (!propertyId || (!userId && !companyId) || (monthlyHours == null && remainingHours == null)) {
            return NextResponse.json({ error: 'propertyId, (userId or companyId), and at least one of monthlyHours/remainingHours required' }, { status: 400 });
        }

        // 1. Check Property Level
        const { data: membership } = await supabaseAdmin
            .from('property_memberships')
            .select('role')
            .eq('property_id', propertyId)
            .eq('user_id', user.id)
            .maybeSingle();

        let canWrite = ['property_admin', 'staff', 'org_admin'].includes(membership?.role || '');

        // 2. Check System/Org Level if not property admin
        if (!canWrite) {
            const [profileRes, propertyRes] = await Promise.all([
                supabaseAdmin.from('users').select('is_master_admin').eq('id', user.id).single(),
                supabaseAdmin.from('properties').select('organization_id').eq('id', propertyId).single()
            ]);

            if (profileRes.data?.is_master_admin) {
                canWrite = true;
            } else if (propertyRes.data?.organization_id) {
                const { data: orgMember } = await supabaseAdmin
                    .from('organization_memberships')
                    .select('role')
                    .eq('organization_id', propertyRes.data.organization_id)
                    .eq('user_id', user.id)
                    .maybeSingle();
                
                if (['org_super_admin', 'org_admin'].includes(orgMember?.role || '')) {
                    canWrite = true;
                }
            }
        }

        if (!canWrite) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const hours = monthlyHours != null ? parseFloat(monthlyHours) : 0;
        if (isNaN(hours) || hours < 0) {
            return NextResponse.json({ error: 'Invalid monthlyHours value' }, { status: 400 });
        }

        // Upsert credit record
        const nextReset = new Date();
        nextReset.setMonth(nextReset.getMonth() + 1);
        nextReset.setDate(1);
        nextReset.setHours(0, 0, 0, 0);

        let query = supabaseAdmin
            .from('meeting_room_credits')
            .select('id, remaining_hours, monthly_hours, next_reset_at, last_reset_at')
            .eq('property_id', propertyId);
        
        if (userId) query = query.eq('user_id', userId);
        else query = query.eq('company_id', companyId);

        const { data: existingRaw, error: fetchError } = await query.maybeSingle();
        if (fetchError) {
            return NextResponse.json({ error: fetchError.message }, { status: 500 });
        }
        const existing = existingRaw as any;

        // Fetch organization_id for the property
        const { data: property, error: propError } = await supabaseAdmin
            .from('properties')
            .select('organization_id')
            .eq('id', propertyId)
            .single();

        if (propError) {
            return NextResponse.json({ error: propError.message }, { status: 500 });
        }

        const organizationId = property?.organization_id;

        let credit;
        if (existing) {
            // Determine new values
            const newMonthly = monthlyHours != null ? parseFloat(monthlyHours) : existing.monthly_hours;
            let newRemaining = existing.remaining_hours;
            let nextResetAt = existing.next_reset_at;
            let lastResetAt = existing.last_reset_at;

            if (remainingHours != null) {
                // Manual balance override (top-up)
                newRemaining = parseFloat(remainingHours);
            } else if (monthlyHours != null) {
                // Proportional adjustment based on monthly quota change
                const diff = newMonthly - existing.monthly_hours;
                newRemaining = Math.max(0, existing.remaining_hours + diff);
                // Reset the monthly cycle when quota is explicitly changed
                const nextReset = new Date();
                nextReset.setMonth(nextReset.getMonth() + 1);
                nextReset.setDate(1);
                nextReset.setHours(0, 0, 0, 0);
                nextResetAt = nextReset.toISOString();
                lastResetAt = new Date().toISOString();
            }

            const { data, error } = await supabaseAdmin
                .from('meeting_room_credits')
                .update({
                    monthly_hours: newMonthly,
                    remaining_hours: newRemaining,
                    organization_id: organizationId,
                    assigned_by: user.id,
                    last_reset_at: lastResetAt,
                    next_reset_at: nextResetAt,
                    updated_at: new Date().toISOString(),
                })
                .eq('id', existing.id)
                .select()
                .single();
            if (error) return NextResponse.json({ error: error.message }, { status: 500 });
            credit = data;

            // Log
            await supabaseAdmin.from('meeting_room_credit_log').insert({
                credit_id: existing.id,
                user_id: userId || null,
                company_id: companyId || null,
                organization_id: organizationId,
                action: 'assigned',
                hours_changed: newRemaining - existing.remaining_hours,
                hours_after: newRemaining,
                performed_by: user.id,
                notes: `Manual update: Quota=${newMonthly}h, Balance=${newRemaining}h`,
            });
        } else {
            const initialMonthly = monthlyHours != null ? parseFloat(monthlyHours) : 0;
            const initialRemaining = remainingHours != null ? parseFloat(remainingHours) : initialMonthly;

            const { data, error } = await supabaseAdmin
                .from('meeting_room_credits')
                .insert({
                    property_id: propertyId,
                    organization_id: organizationId,
                    user_id: userId || null,
                    company_id: companyId || null,
                    assigned_by: user.id,
                    monthly_hours: initialMonthly,
                    remaining_hours: initialRemaining,
                    last_reset_at: new Date().toISOString(),
                    next_reset_at: nextReset.toISOString(),
                })
                .select()
                .single();
            if (error) return NextResponse.json({ error: error.message }, { status: 500 });
            credit = data;

            // Log
            await supabaseAdmin.from('meeting_room_credit_log').insert({
                credit_id: credit.id,
                user_id: userId || null,
                company_id: companyId || null,
                organization_id: organizationId,
                action: 'assigned',
                hours_changed: initialRemaining,
                hours_after: initialRemaining,
                performed_by: user.id,
                notes: `Initial allocation: Quota=${initialMonthly}h, Balance=${initialRemaining}h`,
            });
        }

        return NextResponse.json({ success: true, credit }, { status: 200 });
    } catch (err: any) {
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
