import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { PersonalRulesService } from '@/task-manager/PersonalRulesService';
import { RulesError } from '@/task-manager/DepartmentRulesService';

export const dynamic = 'force-dynamic';

/**
 * A superuser's own Task Manager notifications (sent only to them).
 *   GET  /api/task-manager/personal-rules
 *   POST /api/task-manager/personal-rules  { action: 'save' | 'delete' | 'preview', ... }
 *
 * WHO is acting always comes from the signed-in session; the body can never name the person. Superusers only.
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
    console.error('[PersonalRulesAPI] error:', err);
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : 'Something went wrong' }, { status: 500 });
}

export async function GET() {
    try {
        const userId = await sessionUserId();
        if (!userId) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
        const data = await PersonalRulesService.list(userId);
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

        if (body.action === 'save') {
            const rule = await PersonalRulesService.save(userId, body.rule || {});
            return NextResponse.json({ success: true, rule });
        }
        if (body.action === 'delete') {
            await PersonalRulesService.remove(userId, String(body.ruleId || ''));
            return NextResponse.json({ success: true });
        }
        if (body.action === 'send_now') {
            const result = await PersonalRulesService.sendNow(userId, String(body.ruleId || ''));
            return NextResponse.json({ success: true, result });
        }
        if (body.action === 'preview') {
            const preview = await PersonalRulesService.preview(userId, body.rule || {});
            return NextResponse.json({ success: true, ...preview });
        }
        return NextResponse.json({ success: false, error: `Invalid action: ${body.action}` }, { status: 400 });
    } catch (err) {
        return fail(err);
    }
}
