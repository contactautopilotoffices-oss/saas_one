import { NextRequest, NextResponse } from 'next/server';
import { PermissionService, PermissionDeniedError } from '@/task-manager/PermissionService';
import { TaskProgressService } from '@/task-manager/TaskProgressService';
import { requireActor } from '../_shared/adminGuard';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const auth = await requireActor(searchParams.get('actorId'));
        if (!auth.ok) return auth.response;
        const actorId = auth.userId; // always the logged-in person
        const level = parseInt(searchParams.get('level') || '0', 10);
        const date = searchParams.get('date') || new Date().toISOString().slice(0, 10);
        const departmentId = searchParams.get('departmentId');
        const employeeId = searchParams.get('employeeId');

        if (!actorId) {
            return NextResponse.json({ success: false, error: 'Missing actorId parameter' }, { status: 400 });
        }

        const actor = await PermissionService.getActor(actorId);

        // ── Level 1: Employee Progress ────────────────────────────────────────
        if (level === 1 || employeeId) {
            const targetEmpId = employeeId || actor.id;
            // Permission check: employee can only see own; manager can only see dept staff
            if (actor.role === 'employee' && targetEmpId !== actor.id) {
                return NextResponse.json({ success: false, error: 'Cannot view other employees progress' }, { status: 403 });
            }
            if (actor.role === 'reporting_manager' && targetEmpId !== actor.id) {
                const targetEmp = await PermissionService.getActor(targetEmpId);
                if (targetEmp.department_id !== actor.department_id) {
                    return NextResponse.json({ success: false, error: 'Cannot view employee outside your department' }, { status: 403 });
                }
            }

            const data = await TaskProgressService.getEmployeeProgress(targetEmpId, date);
            return NextResponse.json({ success: true, level: 1, data });
        }

        // ── Level 2: Department Progress ──────────────────────────────────────
        if (level === 2 || (actor.role === 'reporting_manager' && !departmentId)) {
            const targetDeptId = departmentId || actor.department_id;
            if (!targetDeptId) {
                return NextResponse.json({ success: false, error: 'Department ID required for Level 2' }, { status: 400 });
            }

            if (actor.role === 'reporting_manager' && targetDeptId !== actor.department_id) {
                return NextResponse.json({ success: false, error: 'Cannot view other department progress' }, { status: 403 });
            }

            const data = await TaskProgressService.getDepartmentProgress(targetDeptId, date);
            return NextResponse.json({ success: true, level: 2, data });
        }

        // ── Level 3: Organisation Progress ────────────────────────────────────
        if (level === 3 || actor.role === 'superuser') {
            if (actor.role !== 'superuser') {
                return NextResponse.json({ success: false, error: 'Only superusers can view organization-wide progress' }, { status: 403 });
            }

            const data = await TaskProgressService.getOrganisationProgress(date);
            return NextResponse.json({ success: true, level: 3, data });
        }

        // Fallback for employee
        const defaultData = await TaskProgressService.getEmployeeProgress(actor.id, date);
        return NextResponse.json({ success: true, level: 1, data: defaultData });

    } catch (err: any) {
        if (err instanceof PermissionDeniedError) {
            return NextResponse.json({ success: false, error: err.message }, { status: 403 });
        }
        console.error('[TaskProgressAPI] Error:', err);
        return NextResponse.json({ success: false, error: err.message || 'Internal server error' }, { status: 500 });
    }
}
