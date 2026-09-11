import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

// Standard 36 pre-defined HR categories from the 19-point plan
const DEFAULT_SEED_CATEGORIES = [
    // 1. Employee Grievances (9 categories - L1 Owner: Reporting Manager / HOD)
    { ticket_type: 'grievance', category_name: 'Work conditions / work environment', first_level_owner_type: 'reporting_manager', l1_sla_days: 3, l2_sla_days: 7, l3_sla_days: 10, l4_sla_days: 12 },
    { ticket_type: 'grievance', category_name: 'Role clarity', first_level_owner_type: 'reporting_manager', l1_sla_days: 3, l2_sla_days: 7, l3_sla_days: 10, l4_sla_days: 12 },
    { ticket_type: 'grievance', category_name: 'Workload', first_level_owner_type: 'reporting_manager', l1_sla_days: 3, l2_sla_days: 7, l3_sla_days: 10, l4_sla_days: 12 },
    { ticket_type: 'grievance', category_name: 'Reporting structure', first_level_owner_type: 'reporting_manager', l1_sla_days: 3, l2_sla_days: 7, l3_sla_days: 10, l4_sla_days: 12 },
    { ticket_type: 'grievance', category_name: 'Interpersonal conflicts', first_level_owner_type: 'reporting_manager', l1_sla_days: 3, l2_sla_days: 7, l3_sla_days: 10, l4_sla_days: 12 },
    { ticket_type: 'grievance', category_name: 'Workplace behaviour', first_level_owner_type: 'reporting_manager', l1_sla_days: 3, l2_sla_days: 7, l3_sla_days: 10, l4_sla_days: 12 },
    { ticket_type: 'grievance', category_name: 'Team-related concerns', first_level_owner_type: 'reporting_manager', l1_sla_days: 3, l2_sla_days: 7, l3_sla_days: 10, l4_sla_days: 12 },
    { ticket_type: 'grievance', category_name: 'Managerial concerns', first_level_owner_type: 'reporting_manager', l1_sla_days: 3, l2_sla_days: 7, l3_sla_days: 10, l4_sla_days: 12 },
    { ticket_type: 'grievance', category_name: 'Other work-related dissatisfaction', first_level_owner_type: 'reporting_manager', l1_sla_days: 3, l2_sla_days: 7, l3_sla_days: 10, l4_sla_days: 12 },

    // 2. HR-Related Queries (21 categories - L1 Owner: HR Department)
    { ticket_type: 'hr_query', category_name: 'Attendance', first_level_owner_type: 'hr', l1_sla_days: 3, l2_sla_days: 7, l3_sla_days: 10, l4_sla_days: 12 },
    { ticket_type: 'hr_query', category_name: 'Leave', first_level_owner_type: 'hr', l1_sla_days: 3, l2_sla_days: 7, l3_sla_days: 10, l4_sla_days: 12 },
    { ticket_type: 'hr_query', category_name: 'Payroll / Salary', first_level_owner_type: 'hr', l1_sla_days: 3, l2_sla_days: 7, l3_sla_days: 10, l4_sla_days: 12 },
    { ticket_type: 'hr_query', category_name: 'Payslip', first_level_owner_type: 'hr', l1_sla_days: 3, l2_sla_days: 7, l3_sla_days: 10, l4_sla_days: 12 },
    { ticket_type: 'hr_query', category_name: 'Salary Difference', first_level_owner_type: 'hr', l1_sla_days: 3, l2_sla_days: 7, l3_sla_days: 10, l4_sla_days: 12 },
    { ticket_type: 'hr_query', category_name: 'PF / ESIC / PT', first_level_owner_type: 'hr', l1_sla_days: 3, l2_sla_days: 7, l3_sla_days: 10, l4_sla_days: 12 },
    { ticket_type: 'hr_query', category_name: 'Reimbursements', first_level_owner_type: 'hr', l1_sla_days: 3, l2_sla_days: 7, l3_sla_days: 10, l4_sla_days: 12 },
    { ticket_type: 'hr_query', category_name: 'HRMS Issues', first_level_owner_type: 'hr', l1_sla_days: 3, l2_sla_days: 7, l3_sla_days: 10, l4_sla_days: 12 },
    { ticket_type: 'hr_query', category_name: 'Employee Letters', first_level_owner_type: 'hr', l1_sla_days: 3, l2_sla_days: 7, l3_sla_days: 10, l4_sla_days: 12 },
    { ticket_type: 'hr_query', category_name: 'Employment Documents', first_level_owner_type: 'hr', l1_sla_days: 3, l2_sla_days: 7, l3_sla_days: 10, l4_sla_days: 12 },
    { ticket_type: 'hr_query', category_name: 'Insurance / Mediclaim', first_level_owner_type: 'hr', l1_sla_days: 3, l2_sla_days: 7, l3_sla_days: 10, l4_sla_days: 12 },
    { ticket_type: 'hr_query', category_name: 'Plum', first_level_owner_type: 'hr', l1_sla_days: 3, l2_sla_days: 7, l3_sla_days: 10, l4_sla_days: 12 },
    { ticket_type: 'hr_query', category_name: 'Joining / Onboarding', first_level_owner_type: 'hr', l1_sla_days: 3, l2_sla_days: 7, l3_sla_days: 10, l4_sla_days: 12 },
    { ticket_type: 'hr_query', category_name: 'Exit Process', first_level_owner_type: 'hr', l1_sla_days: 3, l2_sla_days: 7, l3_sla_days: 10, l4_sla_days: 12 },
    { ticket_type: 'hr_query', category_name: 'Full & Final Settlement', first_level_owner_type: 'hr', l1_sla_days: 3, l2_sla_days: 7, l3_sla_days: 10, l4_sla_days: 12 },
    { ticket_type: 'hr_query', category_name: 'Policies', first_level_owner_type: 'hr', l1_sla_days: 3, l2_sla_days: 7, l3_sla_days: 10, l4_sla_days: 12 },
    { ticket_type: 'hr_query', category_name: 'Employee Benefits', first_level_owner_type: 'hr', l1_sla_days: 3, l2_sla_days: 7, l3_sla_days: 10, l4_sla_days: 12 },
    { ticket_type: 'hr_query', category_name: 'Performance / Appraisal', first_level_owner_type: 'hr', l1_sla_days: 3, l2_sla_days: 7, l3_sla_days: 10, l4_sla_days: 12 },
    { ticket_type: 'hr_query', category_name: 'Training', first_level_owner_type: 'hr', l1_sla_days: 3, l2_sla_days: 7, l3_sla_days: 10, l4_sla_days: 12 },
    { ticket_type: 'hr_query', category_name: 'Employee Data Changes', first_level_owner_type: 'hr', l1_sla_days: 3, l2_sla_days: 7, l3_sla_days: 10, l4_sla_days: 12 },
    { ticket_type: 'hr_query', category_name: 'General HR Support', first_level_owner_type: 'hr', l1_sla_days: 3, l2_sla_days: 7, l3_sla_days: 10, l4_sla_days: 12 },

    // 3. Confidential & Anonymous Feedback (6 categories - L1 Owner: Director)
    { ticket_type: 'confidential_feedback', category_name: 'Sensitive workplace concerns', first_level_owner_type: 'director', is_confidential: true, l1_sla_days: 3, l2_sla_days: 7, l3_sla_days: 10, l4_sla_days: 12 },
    { ticket_type: 'confidential_feedback', category_name: 'Concerns regarding senior management', first_level_owner_type: 'director', is_confidential: true, l1_sla_days: 3, l2_sla_days: 7, l3_sla_days: 10, l4_sla_days: 12 },
    { ticket_type: 'confidential_feedback', category_name: 'Fear of retaliation', first_level_owner_type: 'director', is_confidential: true, l1_sla_days: 3, l2_sla_days: 7, l3_sla_days: 10, l4_sla_days: 12 },
    { ticket_type: 'confidential_feedback', category_name: 'Sensitive behavioural concerns', first_level_owner_type: 'director', is_confidential: true, l1_sla_days: 3, l2_sla_days: 7, l3_sla_days: 10, l4_sla_days: 12 },
    { ticket_type: 'confidential_feedback', category_name: 'Serious workplace issues', first_level_owner_type: 'director', is_confidential: true, l1_sla_days: 3, l2_sla_days: 7, l3_sla_days: 10, l4_sla_days: 12 },
    { ticket_type: 'anonymous_feedback', category_name: 'Anonymous Feedback', first_level_owner_type: 'director', is_anonymous: true, l1_sla_days: 3, l2_sla_days: 7, l3_sla_days: 10, l4_sla_days: 12 }
];

export async function GET() {
    try {
        let { data, error } = await supabaseAdmin
            .from('hr_ticket_categories')
            .select(`
                *,
                default_hr_owner:users!default_hr_owner_id(id, email, full_name)
            `)
            .order('ticket_type', { ascending: true })
            .order('category_name', { ascending: true });

        if (error) throw error;

        // Auto-seed default categories if empty or incomplete
        if (!data || data.length < 10) {
            const seedRows = DEFAULT_SEED_CATEGORIES.map(c => ({
                ticket_type: c.ticket_type,
                category_name: c.category_name,
                first_level_owner_type: c.first_level_owner_type,
                l1_sla_days: c.l1_sla_days,
                l2_sla_days: c.l2_sla_days,
                l3_sla_days: c.l3_sla_days,
                l4_sla_days: c.l4_sla_days,
                is_confidential: (c as any).is_confidential || false,
                is_anonymous: (c as any).is_anonymous || false,
                is_active: true
            }));

            await supabaseAdmin.from('hr_ticket_categories').upsert(seedRows, { onConflict: 'ticket_type,category_name' as any });

            // Fetch newly seeded list
            const res = await supabaseAdmin
                .from('hr_ticket_categories')
                .select(`
                    *,
                    default_hr_owner:users!default_hr_owner_id(id, email, full_name)
                `)
                .order('ticket_type', { ascending: true })
                .order('category_name', { ascending: true });
            
            data = res.data || [];
        }

        return NextResponse.json({ success: true, data });
    } catch (err: any) {
        return NextResponse.json({ success: false, error: err.message }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const {
            organization_id,
            ticket_type,
            category_name,
            sub_category_name,
            first_level_owner_type = 'reporting_manager',
            default_hr_owner_id,
            l1_sla_days = 3,
            l2_sla_days = 7,
            l3_sla_days = 10,
            l4_sla_days = 12,
            is_confidential = false,
            is_anonymous = false
        } = body;

        if (!ticket_type || !category_name) {
            return NextResponse.json({ success: false, error: 'ticket_type and category_name are required' }, { status: 400 });
        }

        const { data, error } = await supabaseAdmin
            .from('hr_ticket_categories')
            .insert({
                organization_id: organization_id || null,
                ticket_type,
                category_name,
                sub_category_name: sub_category_name || null,
                first_level_owner_type,
                default_hr_owner_id: default_hr_owner_id || null,
                l1_sla_days,
                l2_sla_days,
                l3_sla_days,
                l4_sla_days,
                is_confidential,
                is_anonymous,
                is_active: true
            })
            .select()
            .single();

        if (error) throw error;

        return NextResponse.json({ success: true, data });
    } catch (err: any) {
        return NextResponse.json({ success: false, error: err.message }, { status: 500 });
    }
}

export async function PATCH(request: Request) {
    try {
        const body = await request.json();
        const { id, actor_user_id, ...updates } = body;

        if (!id) {
            return NextResponse.json({ success: false, error: 'Category ID is required' }, { status: 400 });
        }

        // Fetch existing category before updating for SLA change logging
        const { data: existingCat } = await supabaseAdmin
            .from('hr_ticket_categories')
            .select('*')
            .eq('id', id)
            .single();

        updates.updated_at = new Date().toISOString();

        const { data, error } = await supabaseAdmin
            .from('hr_ticket_categories')
            .update(updates)
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;

        // Log SLA Config Audit Trail (who changed SLA, when, old vs new values)
        if (existingCat && actor_user_id) {
            const oldSla = `L1:${existingCat.l1_sla_days}d, L2:${existingCat.l2_sla_days}d, L3:${existingCat.l3_sla_days}d, L4:${existingCat.l4_sla_days}d`;
            const newSla = `L1:${data.l1_sla_days}d, L2:${data.l2_sla_days}d, L3:${data.l3_sla_days}d, L4:${data.l4_sla_days}d`;
            const noteText = `Category "${data.category_name}" SLA updated by user (${actor_user_id}). Previous SLA: [${oldSla}], New SLA: [${newSla}]`;

            // Write to system audit log
            try {
                await supabaseAdmin.from('hr_ticket_audit_trail').insert({
                    action: 'sla_config_updated',
                    performed_by_user_id: actor_user_id,
                    old_state: { l1: existingCat.l1_sla_days, l2: existingCat.l2_sla_days, l3: existingCat.l3_sla_days, l4: existingCat.l4_sla_days },
                    new_state: { l1: data.l1_sla_days, l2: data.l2_sla_days, l3: data.l3_sla_days, l4: data.l4_sla_days },
                    notes: noteText
                });
            } catch (auditErr: any) {
                console.warn('Audit trail write exception:', auditErr.message);
            }
        }

        return NextResponse.json({ success: true, data });
    } catch (err: any) {
        return NextResponse.json({ success: false, error: err.message }, { status: 500 });
    }
}

export async function DELETE(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const id = searchParams.get('id');

        if (!id) {
            return NextResponse.json({ success: false, error: 'Category ID is required' }, { status: 400 });
        }

        const { error } = await supabaseAdmin
            .from('hr_ticket_categories')
            .delete()
            .eq('id', id);

        if (error) throw error;

        return NextResponse.json({ success: true, message: 'Category deleted successfully' });
    } catch (err: any) {
        return NextResponse.json({ success: false, error: err.message }, { status: 500 });
    }
}
