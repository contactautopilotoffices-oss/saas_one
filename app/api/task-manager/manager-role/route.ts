import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { TaskDatabaseService } from '@/task-manager/TaskDatabaseService';
import { TaskMessagingService } from '@/task-manager/TaskMessagingService';
import { AiSensyService } from '@/backend/services/AiSensyService';

export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        // Fetch all active employees
        const { data: employees, error: empErr } = await supabaseAdmin
            .from('employee_profiles')
            .select(`
                id,
                user_id,
                first_name,
                last_name,
                email,
                phone,
                department,
                department_id,
                task_role,
                is_active
            `)
            .eq('is_active', true)
            .order('first_name', { ascending: true });

        if (empErr) throw empErr;

        // Fetch Tech department specific summary
        const techEmployees = (employees || []).filter(e => 
            (e.department && e.department.toLowerCase() === 'tech') ||
            e.department_id === '94a74961-2dd8-453d-9728-f6f2b9ade99b'
        );

        const techManager = techEmployees.find(e => e.task_role === 'reporting_manager') || null;

        return NextResponse.json({
            success: true,
            employees: employees || [],
            techSummary: {
                manager: techManager,
                members: techEmployees
            }
        });
    } catch (err: any) {
        console.error('[ManagerRoleAPI] GET error:', err);
        return NextResponse.json({ success: false, error: err?.message || 'Failed to load employees' }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json().catch(() => ({}));
        const { employeeId, action, sendKickoff = true } = body;

        if (!employeeId || !action) {
            return NextResponse.json({ success: false, error: 'Missing employeeId or action' }, { status: 400 });
        }

        // 1. Resolve employee
        const { data: profile, error: profileErr } = await supabaseAdmin
            .from('employee_profiles')
            .select('*')
            .or(`id.eq.${employeeId},user_id.eq.${employeeId}`)
            .maybeSingle();

        if (profileErr || !profile) {
            return NextResponse.json({ success: false, error: 'Employee profile not found' }, { status: 404 });
        }

        const fullName = [profile.first_name, profile.last_name].filter(Boolean).join(' ').trim() || profile.email;
        const phone = (profile.phone || '').trim();

        // ── Action A: Assign Reporting Manager Role ──────────────────────────────
        if (action === 'assign_manager') {
            const { error: updateErr } = await supabaseAdmin
                .from('employee_profiles')
                .update({
                    task_role: 'reporting_manager',
                    updated_at: new Date().toISOString()
                })
                .eq('id', profile.id);

            if (updateErr) throw updateErr;

            await TaskDatabaseService.logAudit({
                eventType: 'manager_role_assigned',
                actorId: profile.user_id || profile.id,
                targetEmployeeId: profile.id,
                details: { role: 'reporting_manager', department: profile.department }
            });

            // Fetch department team members for kickoff message
            let teamNames = '';
            if (profile.department_id) {
                const team = await TaskDatabaseService.getEmployeesByDepartment(profile.department_id);
                teamNames = team
                    .filter(m => m.id !== profile.user_id && m.profile_id !== profile.id)
                    .map(m => m.name.split(' ')[0])
                    .join(', ');
            }

            let whatsappSent = false;
            let whatsappDetails = '';

            const targetPhone = (body.overridePhone || phone || '').trim();

            if (sendKickoff && targetPhone) {
                const managerName = profile.first_name || fullName.split(' ')[0] || fullName;
                const deptName = profile.department || 'Tech';
                const teamMembersList = teamNames || 'Sahil, Harsh';

                // 1. Send Meta-approved Manager Kickoff campaign template (Opens 24h window when buttons tapped)
                const campaignName = process.env.AISENSY_MANAGER_CAMPAIGN_NAME || 'tm_manager_kickoff_v1';
                const templateRes = await AiSensyService.sendTemplate({
                    phone: targetPhone,
                    campaignName,
                    templateParams: [managerName, deptName, teamMembersList]
                });

                if (templateRes.success) {
                    whatsappSent = true;
                    whatsappDetails = `Meta template (${campaignName}) dispatched successfully with params [${managerName}, ${deptName}, ${teamMembersList}].`;
                } else {
                    whatsappDetails = `WhatsApp send error: ${templateRes.error || 'Failed to dispatch'}`;
                }
            }

            return NextResponse.json({
                success: true,
                message: `Successfully assigned ${fullName} as Reporting Manager.`,
                employee: { id: profile.id, name: fullName, role: 'reporting_manager', department: profile.department },
                whatsappSent,
                whatsappDetails
            });
        }

        // ── Action B: Remove / Revert to Standard Employee ───────────────────────
        if (action === 'remove_manager') {
            const { error: updateErr } = await supabaseAdmin
                .from('employee_profiles')
                .update({
                    task_role: 'employee',
                    updated_at: new Date().toISOString()
                })
                .eq('id', profile.id);

            if (updateErr) throw updateErr;

            await TaskDatabaseService.logAudit({
                eventType: 'manager_role_removed',
                actorId: profile.user_id || profile.id,
                targetEmployeeId: profile.id,
                details: { previousRole: 'reporting_manager', newRole: 'employee', department: profile.department }
            });

            return NextResponse.json({
                success: true,
                message: `Successfully removed Reporting Manager role for ${fullName}. Reverted to standard Employee.`,
                employee: { id: profile.id, name: fullName, role: 'employee', department: profile.department }
            });
        }

        // ── Action C: Send Employee Kickoff Template ────────────────────────────
        if (action === 'send_employee_kickoff') {
            const targetPhone = (body.overridePhone || phone || '').trim();
            if (!targetPhone) {
                return NextResponse.json({ success: false, error: 'Employee has no phone number registered' }, { status: 400 });
            }

            const empName = profile.first_name || fullName.split(' ')[0] || fullName;
            const deptName = profile.department || 'Tech';

            // Find reporting manager name for this department
            let managerName = 'Lohitaksha Ranganathan';
            if (profile.department_id) {
                const { data: managers } = await supabaseAdmin
                    .from('employee_profiles')
                    .select('first_name, last_name, user:users!employee_profiles_user_id_fkey(full_name)')
                    .eq('department_id', profile.department_id)
                    .eq('task_role', 'reporting_manager')
                    .limit(1);

                if (managers && managers.length > 0) {
                    const m = managers[0];
                    managerName = [m.first_name, m.last_name].filter(Boolean).join(' ').trim() || (m.user as any)?.full_name || managerName;
                }
            }

            const campaignName = process.env.AISENSY_EMPLOYEE_CAMPAIGN_NAME || 'tm_employee_kickoff_v1';
            const templateRes = await AiSensyService.sendTemplate({
                phone: targetPhone,
                campaignName,
                templateParams: [empName, deptName, managerName]
            });

            if (!templateRes.success) {
                return NextResponse.json({
                    success: false,
                    error: templateRes.error || 'Failed to dispatch employee kickoff template'
                }, { status: 500 });
            }

            await TaskDatabaseService.logAudit({
                eventType: 'employee_kickoff_sent',
                actorId: profile.user_id || profile.id,
                targetEmployeeId: profile.id,
                details: { campaignName, empName, deptName, managerName, targetPhone }
            });

            return NextResponse.json({
                success: true,
                message: `Employee kickoff template (${campaignName}) dispatched to ${fullName} (${targetPhone}).`,
                details: { empName, deptName, managerName, campaignName }
            });
        }

        return NextResponse.json({ success: false, error: `Invalid action: ${action}` }, { status: 400 });
    } catch (err: any) {
        console.error('[ManagerRoleAPI] POST error:', err);
        return NextResponse.json({ success: false, error: err?.message || 'Failed to update manager role' }, { status: 500 });
    }
}
