import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { DepartmentRulesService, RulesError } from '@/task-manager/DepartmentRulesService';

export const dynamic = 'force-dynamic';

/**
 * Step 6 — a team manages its own Task Manager notifications.
 *   GET  /api/task-manager/department-rules[?department=Procurement]
 *   POST /api/task-manager/department-rules  { action: 'save' | 'delete' | 'preview', ... }
 *
 * WHO is acting always comes from the signed-in session; the body can never name the actor or the department
 * (only a superuser may name a department by label). A person can only ever reach rules of their OWN department.
 * Nothing here sends a message: 'preview' is a simulation that writes nothing.
 */
async function sessionUserId(): Promise<string | null> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    return user?.id || null;
}

function fail(err: unknown) {
    if (err instanceof RulesError) {
        return NextResponse.json({ success: false, error: err.message, code: err.code }, { status: err.status });
    }
    console.error('[DepartmentRulesAPI] error:', err);
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : 'Something went wrong' }, { status: 500 });
}

export async function GET(request: NextRequest) {
    try {
        const userId = await sessionUserId();
        if (!userId) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
        const data = await DepartmentRulesService.list(userId, request.nextUrl.searchParams.get('department') || undefined);
        return NextResponse.json({ success: true, ...data });
    } catch (err) {
        return fail(err);
    }
}

export async function POST(request: NextRequest) {
    try {
        const userId = await sessionUserId();
        if (!userId) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

        const body = await request.json().catch(() => ({}));
        const department = typeof body.department === 'string' ? body.department : undefined;

        if (body.action === 'save') {
            const rule = await DepartmentRulesService.save(userId, body.rule || {}, department);
            return NextResponse.json({ success: true, rule });
        }
        if (body.action === 'delete') {
            await DepartmentRulesService.remove(userId, String(body.ruleId || ''), department);
            return NextResponse.json({ success: true });
        }
        if (body.action === 'preview') {
            const preview = await DepartmentRulesService.preview(userId, body.rule || {}, department);
            return NextResponse.json({ success: true, ...preview });
        }
        return NextResponse.json({ success: false, error: `Invalid action: ${body.action}` }, { status: 400 });
    } catch (err) {
        return fail(err);
    }
}
