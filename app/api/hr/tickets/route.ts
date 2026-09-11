import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { NotificationService } from '@/backend/services/NotificationService';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const orgId = searchParams.get('orgId');
        const userId = searchParams.get('userId');
        const role = searchParams.get('role') || 'employee';
        const type = searchParams.get('type');
        const status = searchParams.get('status');

        const propertyId = searchParams.get('propertyId');

        let query = supabaseAdmin
            .from('hr_tickets')
            .select(`
                *,
                category:hr_ticket_categories(*),
                raised_by:users!raised_by_user_id(id, email, full_name),
                assigned_to:users!assigned_to_user_id(id, email, full_name)
            `)
            .order('created_at', { ascending: false });

        if (orgId) {
            query = query.eq('organization_id', orgId);
        }
        if (propertyId && propertyId !== 'all') {
            query = query.eq('employee_snapshot->>property_id', propertyId);
        }

        // Granular Role Scoping
        if (role === 'hr' || role === 'hr_head' || role === 'org_super_admin') {
            query = query.eq('is_confidential', false);
        } else if (role === 'manager' && userId) {
            const { data: reportees } = await supabaseAdmin
                .from('employee_profiles')
                .select('user_id')
                .eq('reporting_manager_id', userId)
                .not('user_id', 'is', null);

            const reporteeUserIds = (reportees || []).map(r => r.user_id).filter(Boolean);
            const allowedUserIds = Array.from(new Set([userId, ...reporteeUserIds]));

            query = query.or(`assigned_to_user_id.eq.${userId},raised_by_user_id.in.(${allowedUserIds.join(',')})`);
        } else if (role === 'director') {
            query = query.or('is_confidential.eq.true,is_anonymous.eq.true,current_level.eq.4');
        } else if (userId) {
            query = query.or(`raised_by_user_id.eq.${userId},assigned_to_user_id.eq.${userId}`);
        }

        if (type) query = query.eq('ticket_type', type);
        if (status) query = query.eq('status', status);

        const { data, error } = await query;
        if (error) throw error;

        // Mask identity for anonymous tickets
        const sanitized = (data || []).map(t => {
            if (t.is_anonymous) {
                return {
                    ...t,
                    raised_by_user_id: null,
                    raised_by: { id: null, email: 'anonymous@hidden.local', raw_user_meta_data: { full_name: 'Anonymous Employee' } },
                    employee_snapshot: { name: 'Anonymous Employee', department: 'Confidential', location: 'Hidden' }
                };
            }
            return t;
        });

        return NextResponse.json({ success: true, data: sanitized });
    } catch (err: any) {
        return NextResponse.json({ success: false, error: err.message }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const {
            organization_id,
            property_id,
            category_id,
            raised_by_user_id,
            subject,
            description,
            attachment_urls = [],
            is_confidential = false,
            is_anonymous = false,
            priority = 'medium'
        } = body;

        if (!category_id || !subject || !description) {
            return NextResponse.json({ success: false, error: 'Category, subject, and description are required' }, { status: 400 });
        }

        // 1. Fetch category details
        const { data: category, error: catErr } = await supabaseAdmin
            .from('hr_ticket_categories')
            .select('*')
            .eq('id', category_id)
            .single();

        if (catErr || !category) {
            return NextResponse.json({ success: false, error: 'Invalid category' }, { status: 404 });
        }

        // 2. Fetch employee profile & reporting manager
        let empProfile: any = null;
        if (raised_by_user_id) {
            const { data: profile } = await supabaseAdmin
                .from('employee_profiles')
                .select('*')
                .eq('user_id', raised_by_user_id)
                .maybeSingle();
            empProfile = profile;
        }

        const effectiveOrgId = organization_id || empProfile?.organization_id || '211e1330-ad83-446d-941f-dcea48396798';
        const empLocation = empProfile?.location || 'Lower Parel';

        // 3. Generate Format: HR + Org Initial + Property Initial + Year + Serial (e.g. HR-WS-LP-2026-00001)
        let ticketNumber = '';
        const { data: generatedNum, error: rpcErr } = await supabaseAdmin.rpc('generate_hr_ticket_number', {
            p_org_id: effectiveOrgId,
            p_property_id: property_id || null,
            p_location: empLocation
        });

        if (!rpcErr && generatedNum) {
            ticketNumber = generatedNum;
        } else {
            // Fallback: derive initials from location (e.g. "Lower Parel" -> "LP")
            const locInitials = empLocation.split(' ').map((w: string) => w[0]).join('').substring(0, 2).toUpperCase() || 'LP';
            const year = new Date().getFullYear();
            const { count } = await supabaseAdmin.from('hr_tickets').select('*', { count: 'exact', head: true });
            const seqStr = String((count || 0) + 1).padStart(5, '0');
            ticketNumber = `HR-WS-${locInitials}-${year}-${seqStr}`;
        }

        // 4. Determine Ticket Type & Owner Auto-Routing
        let ticketType = category.ticket_type;
        if (is_anonymous) ticketType = 'anonymous_feedback';
        else if (is_confidential) ticketType = 'confidential_feedback';

        let firstLevelOwnerId: string | null = null;

        if (ticketType === 'confidential_feedback' || ticketType === 'anonymous_feedback' || category.first_level_owner_type === 'director') {
            const { data: directors } = await supabaseAdmin
                .from('employee_profiles')
                .select('user_id')
                .eq('is_director_authority', true)
                .not('user_id', 'is', null)
                .limit(1);

            firstLevelOwnerId = directors?.[0]?.user_id || null;
        } else if (category.first_level_owner_type === 'hr') {
            firstLevelOwnerId = category.default_hr_owner_id;
            if (!firstLevelOwnerId) {
                const { data: hrStaff } = await supabaseAdmin
                    .from('employee_profiles')
                    .select('user_id')
                    .eq('is_hr_authority', true)
                    .not('user_id', 'is', null)
                    .limit(1);
                firstLevelOwnerId = hrStaff?.[0]?.user_id || null;
            }
        } else {
            firstLevelOwnerId = empProfile?.reporting_manager_id || empProfile?.alternate_manager_id;

            if (firstLevelOwnerId && firstLevelOwnerId === raised_by_user_id) {
                const { data: hrStaff } = await supabaseAdmin
                    .from('employee_profiles')
                    .select('user_id')
                    .eq('is_hr_authority', true)
                    .not('user_id', 'is', null)
                    .limit(1);
                firstLevelOwnerId = hrStaff?.[0]?.user_id || null;
            }
        }

        // 5. Calculate SLA target date
        const slaDays = category.l1_sla_days || 3;
        const slaDueAt = new Date();
        slaDueAt.setDate(slaDueAt.getDate() + slaDays);

        // 6. Employee Snapshot
        const snapshot = empProfile ? {
            name: `${empProfile.first_name} ${empProfile.last_name}`,
            code: empProfile.employee_code,
            department: empProfile.department,
            designation: empProfile.designation,
            location: empProfile.location,
            manager_code: empProfile.reporting_manager_code
        } : { name: 'Employee', department: 'General', location: 'Office' };

        // 7. Insert Ticket
        const { data: newTicket, error: createErr } = await supabaseAdmin
            .from('hr_tickets')
            .insert({
                organization_id: effectiveOrgId,
                ticket_number: ticketNumber,
                ticket_type: ticketType,
                category_id: category.id,
                raised_by_user_id: is_anonymous ? null : raised_by_user_id,
                anonymous_token: is_anonymous ? `anon_${Math.random().toString(36).substring(2, 10)}` : null,
                employee_snapshot: snapshot,
                subject,
                description,
                attachment_urls,
                current_level: 1,
                assigned_to_user_id: firstLevelOwnerId,
                status: 'new',
                priority,
                sla_due_at: slaDueAt.toISOString(),
                is_confidential: is_confidential || category.is_confidential,
                is_anonymous: is_anonymous || category.is_anonymous
            })
            .select()
            .single();

        if (createErr) throw createErr;

        // 8. Log initial audit entry
        await supabaseAdmin.from('hr_ticket_audit_logs').insert({
            ticket_id: newTicket.id,
            actor_user_id: raised_by_user_id,
            action: 'CREATED',
            new_values: { ticket_number: ticketNumber, status: 'new', assigned_to: firstLevelOwnerId }
        });

        // 9. Dispatch Omnichannel WhatsApp & In-App Notification
        NotificationService.afterHrTicketCreated(newTicket.id).catch(err => {
            console.error('Failed to trigger HR ticket created notification:', err);
        });

        return NextResponse.json({ success: true, data: newTicket });
    } catch (err: any) {
        return NextResponse.json({ success: false, error: err.message }, { status: 500 });
    }
}
