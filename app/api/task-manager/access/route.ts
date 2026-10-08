import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { TaskAccessService, AccessNotProvisionedError } from '@/task-manager/TaskAccessService';
import { TaskDatabaseService } from '@/task-manager/TaskDatabaseService';
import { requireTaskManagerAdmin } from '../_shared/adminGuard';

export const dynamic = 'force-dynamic';

/**
 * Step 3 — Task Manager access control.
 *   GET  /api/task-manager/access?orgId=   → departments (ON/OFF) with each member's onboarding status
 *   POST /api/task-manager/access?orgId=   → { action: 'set_department' | 'record_kickoff' | 'remove_kickoff', ... }
 *
 * 'record_kickoff' is the MANUAL record ("I sent the kickoff outside the system"). It sends NOTHING.
 * Requires a signed-in organisation admin (or master admin).
 */
export async function GET(request: NextRequest) {
    try {
        const orgId = request.nextUrl.searchParams.get('orgId') || '';
        const guard = await requireTaskManagerAdmin(orgId);
        if (!guard.ok) return guard.response;

        const overview = await TaskAccessService.getOverview();
        const config = await TaskDatabaseService.getTestingConfig();
        return NextResponse.json({ success: true, ...overview, nlGatewayEnabled: config.nlGatewayEnabled === true });
    } catch (err) {
        console.error('[TaskAccessAPI] GET error:', err);
        return NextResponse.json({ success: false, error: err instanceof Error ? err.message : 'Failed to load access settings' }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        const orgId = request.nextUrl.searchParams.get('orgId') || '';
        const guard = await requireTaskManagerAdmin(orgId);
        if (!guard.ok) return guard.response;

        const body = await request.json().catch(() => ({}));

        if (body.action === 'set_department') {
            if (!body.departmentId || typeof body.enabled !== 'boolean') {
                return NextResponse.json({ success: false, error: 'Missing departmentId or enabled (true/false)' }, { status: 400 });
            }
            await TaskAccessService.setDepartmentEnabled(body.departmentId, body.enabled, guard.label);
            return NextResponse.json({
                success: true,
                message: body.enabled
                    ? 'Task Manager switched ON for this department. Only people with a recorded kickoff are unlocked.'
                    : 'Task Manager switched OFF for this department. Nobody in it can use it.'
            });
        }

        // Step 5: "team sharing" for a department (members see and assign each other's tasks)
        if (body.action === 'set_team_sharing') {
            if (!body.departmentId || typeof body.enabled !== 'boolean') {
                return NextResponse.json({ success: false, error: 'Missing departmentId or enabled (true/false)' }, { status: 400 });
            }
            await TaskAccessService.setPeerAssign(body.departmentId, body.enabled, guard.label);
            return NextResponse.json({
                success: true,
                message: body.enabled
                    ? 'Team sharing ON: members of this department can see and assign each other\'s tasks.'
                    : 'Team sharing OFF: only the reporting chain applies.'
            });
        }

        // Superuser role (Task Manager): make or remove a superuser. Admin-only; the last superuser cannot be removed.
        if (body.action === 'set_superuser') {
            if (!body.userId || typeof body.enabled !== 'boolean') {
                return NextResponse.json({ success: false, error: 'Missing userId or enabled (true/false)' }, { status: 400 });
            }
            await TaskAccessService.setSuperuser(body.userId, body.enabled, guard.label);
            return NextResponse.json({
                success: true,
                message: body.enabled
                    ? 'Now a superuser: can see and assign tasks across every department.'
                    : 'Back to a normal employee.'
            });
        }

        // Step 6: let a department manage its own notification schedule and wording
        if (body.action === 'set_notifications_delegated') {
            if (!body.departmentId || typeof body.enabled !== 'boolean') {
                return NextResponse.json({ success: false, error: 'Missing departmentId or enabled (true/false)' }, { status: 400 });
            }
            await TaskAccessService.setNotificationsDelegated(body.departmentId, body.enabled, guard.label);
            return NextResponse.json({
                success: true,
                message: body.enabled
                    ? 'This team can now manage its own notification schedule and wording.'
                    : 'Notification settings are back under your control only.'
            });
        }

        // Step 4: natural-language chat for unlocked people (OFF until switched on here)
        if (body.action === 'set_nl_gateway') {
            if (typeof body.enabled !== 'boolean') {
                return NextResponse.json({ success: false, error: 'Missing enabled (true/false)' }, { status: 400 });
            }
            await TaskDatabaseService.setNaturalLanguageGateway(body.enabled, guard.label);
            return NextResponse.json({
                success: true,
                message: body.enabled
                    ? 'Natural-language chat is ON for everyone who is unlocked for the Task Manager.'
                    : 'Natural-language chat is OFF. The bot behaves as before.'
            });
        }

        // Task Import: let a department's people send a task list (Excel / image / text) on WhatsApp
        if (body.action === 'set_task_import') {
            if (!body.departmentId || typeof body.enabled !== 'boolean') {
                return NextResponse.json({ success: false, error: 'Missing departmentId or enabled (true/false)' }, { status: 400 });
            }
            await TaskAccessService.setTaskImportEnabled(body.departmentId, body.enabled, guard.label);
            return NextResponse.json({
                success: true,
                message: body.enabled
                    ? 'People in this team can now send a task list on WhatsApp (preview first, saved only after YES).'
                    : 'Task import is OFF for this team. Files and images are handled exactly as before.'
            });
        }

        if (body.action === 'record_kickoff') {
            if (!body.userId) {
                return NextResponse.json({ success: false, error: 'Missing userId' }, { status: 400 });
            }
            const { data: profile } = await supabaseAdmin
                .from('employee_profiles')
                .select('department_id, task_role')
                .eq('user_id', body.userId)
                .eq('is_active', true)
                .limit(1)
                .maybeSingle();
            if (!profile) {
                return NextResponse.json({ success: false, error: 'Active employee with a user account not found' }, { status: 404 });
            }
            await TaskAccessService.recordKickoff({
                userId: body.userId,
                departmentId: profile.department_id,
                kickoffType: profile.task_role === 'reporting_manager' ? 'manager' : 'employee',
                source: 'manual',
                actor: guard.label
            });
            return NextResponse.json({ success: true, message: 'Kickoff recorded as sent (manual). No WhatsApp message was sent.' });
        }

        if (body.action === 'remove_kickoff') {
            if (!body.userId) {
                return NextResponse.json({ success: false, error: 'Missing userId' }, { status: 400 });
            }
            await TaskAccessService.removeKickoff(body.userId, guard.label);
            return NextResponse.json({ success: true, message: 'Kickoff record removed. This person is locked again.' });
        }

        return NextResponse.json({ success: false, error: `Invalid action: ${body.action}` }, { status: 400 });
    } catch (err) {
        if (err instanceof AccessNotProvisionedError) {
            return NextResponse.json({ success: false, code: 'NOT_PROVISIONED', error: err.message }, { status: 409 });
        }
        console.error('[TaskAccessAPI] POST error:', err);
        return NextResponse.json({ success: false, error: err instanceof Error ? err.message : 'Failed to update access settings' }, { status: 500 });
    }
}
