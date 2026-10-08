import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { WhatsAppService } from '@/backend/services/WhatsAppService';
import { requireTaskManagerAdmin } from '../_shared/adminGuard';

export const dynamic = 'force-dynamic';

const CORPORATE_DEPARTMENTS = [
    'Tech',
    'Operations',
    'Procurement',
    'Business Development & Growth',
    'Human Resources',
    'Accounts',
    'Legal',
    'Design',
    'IT',
    'Marketing',
    'Management',
    'Infrastructure'
];

export async function GET(request: NextRequest) {
    try {
        const guard = await requireTaskManagerAdmin();
        if (!guard.ok) return guard.response;

        const { searchParams } = new URL(request.url);
        const department = searchParams.get('department') || '';
        const status = searchParams.get('status') || '';
        const search = searchParams.get('search') || '';
        const date = searchParams.get('date') || new Date().toISOString().slice(0, 10);

        // Construct task query with filters
        let taskQuery = supabaseAdmin.from('tm_tasks').select(`
            *,
            employee:employee_id (
                id,
                full_name,
                phone
            )
        `).order('created_at', { ascending: false });

        if (department) {
            taskQuery = taskQuery.eq('department', department);
        }
        if (status) {
            taskQuery = taskQuery.eq('status', status);
        }
        if (search) {
            taskQuery = taskQuery.ilike('title', `%${search}%`);
        }

        // Run all 3 queries concurrently in parallel with Promise.all for maximum speed
        const [memberRes, taskRes, reportRes] = await Promise.all([
            supabaseAdmin.from('tm_members').select('*').order('full_name', { ascending: true }),
            taskQuery.limit(100),
            supabaseAdmin.from('tm_daily_reports').select(`
                *,
                user:user_id (
                    id,
                    full_name,
                    phone
                )
            `).eq('report_date', date).order('created_at', { ascending: false })
        ]);

        let members = memberRes.data || [];
        const allTasks = taskRes.data || [];
        const allReports = reportRes.data || [];

        // 3. Department breakdown
        const deptMetrics: Record<string, { total: number; completed: number; inProgress: number; pending: number }> = {};
        CORPORATE_DEPARTMENTS.forEach(dept => {
            deptMetrics[dept] = { total: 0, completed: 0, inProgress: 0, pending: 0 };
        });

        allTasks.forEach(task => {
            const d = task.department || 'Other';
            if (!deptMetrics[d]) {
                deptMetrics[d] = { total: 0, completed: 0, inProgress: 0, pending: 0 };
            }
            deptMetrics[d].total += 1;
            if (task.status === 'completed') deptMetrics[d].completed += 1;
            else if (task.status === 'in_progress') deptMetrics[d].inProgress += 1;
            else if (task.status === 'pending') deptMetrics[d].pending += 1;
        });

        // 5. Calculate missing daily reports
        const reportedUserIds = new Set(allReports.map(r => r.user_id));
        const missingReports = members
            .filter(m => m.is_active && !reportedUserIds.has(m.user_id))
            .map(m => ({
                userId: m.user_id,
                name: m.full_name,
                department: m.department,
                phone: m.phone,
                designation: m.designation
            }));

        // 6. Overall Metrics
        const totalTasks = allTasks.length;
        const completedTasks = allTasks.filter(t => t.status === 'completed').length;
        const inProgressTasks = allTasks.filter(t => t.status === 'in_progress').length;
        const pendingTasks = allTasks.filter(t => t.status === 'pending').length;
        const blockedTasks = allTasks.filter(t => t.status === 'blocked').length;

        return NextResponse.json({
            success: true,
            date,
            metrics: {
                totalTasks,
                completedTasks,
                inProgressTasks,
                pendingTasks,
                blockedTasks,
                reportsSubmittedToday: allReports.length,
                missingReportsCount: missingReports.length,
                totalEnrolledMembers: members.length
            },
            departments: CORPORATE_DEPARTMENTS.map(d => ({
                name: d,
                ...deptMetrics[d]
            })),
            tasks: allTasks,
            dailyReports: allReports,
            missingReports,
            members
        });
    } catch (err: any) {
        console.error('[TaskManagerAPI] Unexpected error in GET:', err);
        return NextResponse.json({ success: false, error: err.message }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        const guard = await requireTaskManagerAdmin();
        if (!guard.ok) return guard.response;

        const body = await request.json();
        const { action } = body;

        // 1. Create a task
        if (action === 'create_task') {
            const { title, description, employeeId, department, priority, dueDate } = body;
            if (!title || !employeeId) {
                return NextResponse.json({ success: false, error: 'Missing title or employeeId' }, { status: 400 });
            }

            const { data: newTask, error } = await supabaseAdmin
                .from('tm_tasks')
                .insert({
                    title: title.trim(),
                    description: description?.trim() || null,
                    employee_id: employeeId,
                    department: department || 'General',
                    priority: priority || 'medium',
                    status: 'pending',
                    progress_percentage: 0,
                    due_date: dueDate || null
                })
                .select('*')
                .single();

            if (error) throw error;
            return NextResponse.json({ success: true, task: newTask });
        }

        // 2. Update task progress or status
        if (action === 'update_task') {
            const { taskId, progress, status, remark, userId } = body;
            if (!taskId) {
                return NextResponse.json({ success: false, error: 'Missing taskId' }, { status: 400 });
            }

            const updatePayload: any = { updated_at: new Date().toISOString() };
            if (typeof progress === 'number') {
                updatePayload.progress_percentage = Math.max(0, Math.min(100, Math.round(progress)));
                if (updatePayload.progress_percentage >= 100) {
                    updatePayload.status = 'completed';
                    updatePayload.completed_at = new Date().toISOString();
                } else if (updatePayload.progress_percentage > 0) {
                    updatePayload.status = 'in_progress';
                }
            }
            if (status) {
                updatePayload.status = status;
                if (status === 'completed') {
                    updatePayload.progress_percentage = 100;
                    updatePayload.completed_at = new Date().toISOString();
                }
            }

            const { data: updated, error } = await supabaseAdmin
                .from('tm_tasks')
                .update(updatePayload)
                .eq('id', taskId)
                .select('*')
                .single();

            if (error) throw error;

            // Log update row if userId provided
            if (userId) {
                await supabaseAdmin.from('tm_task_updates').insert({
                    task_id: taskId,
                    user_id: userId,
                    update_text: remark || `Updated by leadership`,
                    progress_percentage: updated.progress_percentage,
                    status: updated.status
                });
            }

            return NextResponse.json({ success: true, task: updated });
        }

        // 3. Enroll or update member in tm_members
        if (action === 'enroll_member') {
            const { userId, phone, fullName, department, designation, isSuperuser } = body;
            if (!phone || !fullName || !department) {
                return NextResponse.json({ success: false, error: 'Missing phone, name or department' }, { status: 400 });
            }

            const cleanPhone = phone.trim();
            const cleanName = fullName.trim();
            const cleanDept = department.trim();

            const { data: member, error } = await supabaseAdmin
                .from('tm_members')
                .upsert({
                    user_id: userId || null,
                    phone: cleanPhone,
                    full_name: cleanName,
                    department: cleanDept,
                    designation: designation?.trim() || null,
                    is_superuser: !!isSuperuser,
                    is_active: true,
                    updated_at: new Date().toISOString()
                }, {
                    onConflict: 'phone'
                })
                .select('*')
                .single();

            if (error) throw error;

            // Send instant WhatsApp welcome notification
            try {
                const welcomeMessage = [
                    `👋 Hi *${cleanName}*! Welcome to AutoPilot Task Manager for *${cleanDept}*.`,
                    ``,
                    `You can chat with me here naturally throughout your day—no special commands needed:`,
                    `• *Morning:* Just text what you'll be working on (e.g. _"Today I will be working on project deployment"_)`,
                    `• *Updates:* Let me know when something is finished (e.g. _"Finished project deployment"_)`,
                    `• *Evening:* Share your daily summary or recap`,
                    `• Text *"tasks"* anytime to see your active list.`,
                    ``,
                    `Have a productive day! 🚀`
                ].join('\n');

                await WhatsAppService.sendAsync(cleanPhone, {
                    message: welcomeMessage,
                    templateName: process.env.AISENSY_TASK_CAMPAIGN_NAME || undefined,
                    templateParams: process.env.AISENSY_TASK_CAMPAIGN_NAME ? [welcomeMessage] : undefined,
                });
            } catch (notifyErr) {
                console.warn('[TaskManagerAPI] Failed to send welcome WhatsApp message:', notifyErr);
            }

            return NextResponse.json({ success: true, member });
        }

        // 4. Toggle superuser
        if (action === 'toggle_superuser') {
            const { memberId, isSuperuser } = body;
            const { data: member, error } = await supabaseAdmin
                .from('tm_members')
                .update({ is_superuser: isSuperuser, updated_at: new Date().toISOString() })
                .eq('id', memberId)
                .select('*')
                .single();

            if (error) throw error;
            return NextResponse.json({ success: true, member });
        }

        return NextResponse.json({ success: false, error: 'Invalid action' }, { status: 400 });
    } catch (err: any) {
        console.error('[TaskManagerAPI] Unexpected error in POST:', err);
        return NextResponse.json({ success: false, error: err.message }, { status: 500 });
    }
}
