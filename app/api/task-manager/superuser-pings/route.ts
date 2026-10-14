import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { PingError, SuperuserPingService } from '@/task-manager/SuperuserPingService';

export const dynamic = 'force-dynamic';

/**
 * Working with a superuser — the Tasks tab's "superuser" view.
 *   GET  /api/task-manager/superuser-pings[?recipientId=]   → his tasks from this team, my open tasks, pings, the team's reminder
 *   POST /api/task-manager/superuser-pings  { action: 'send' | 'cancel' | 'save_reminder', ... }
 *
 * WHO is acting always comes from the signed-in session; the body can never name the actor. Every rule (the team's switch, which
 * tasks may be sent, duplicates, timing) is enforced in SuperuserPingService.
 */
async function sessionUserId(): Promise<string | null> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    return user?.id || null;
}

function fail(err: unknown) {
    if (err instanceof PingError) return NextResponse.json({ success: false, error: err.message, code: err.code }, { status: err.status });
    console.error('[SuperuserPingsAPI] error:', err);
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : 'Something went wrong' }, { status: 500 });
}

export async function GET(request: NextRequest) {
    try {
        const userId = await sessionUserId();
        if (!userId) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
        const panel = await SuperuserPingService.panel(userId, request.nextUrl.searchParams.get('recipientId'));
        return NextResponse.json({ success: true, panel });
    } catch (err) {
        return fail(err);
    }
}

export async function POST(request: NextRequest) {
    try {
        const userId = await sessionUserId();
        if (!userId) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
        const body = await request.json().catch(() => ({}));

        if (body.action === 'send') {
            const result = await SuperuserPingService.send(userId, {
                taskIds: Array.isArray(body.taskIds) ? body.taskIds : [], recipientId: body.recipientId, fromLabel: body.fromLabel,
                note: body.note, sendAt: body.sendAt || null, force: body.force === true,
            });
            return NextResponse.json({ success: true, ...result });
        }
        if (body.action === 'cancel') {
            await SuperuserPingService.cancel(userId, String(body.pingId || ''));
            return NextResponse.json({ success: true });
        }
        if (body.action === 'save_reminder') {
            const reminder = await SuperuserPingService.saveReminder(userId, {
                enabled: body.enabled === true, time: String(body.time || ''), days: Array.isArray(body.days) ? body.days : [], recipientId: body.recipientId,
            });
            return NextResponse.json({ success: true, reminder });
        }
        return NextResponse.json({ success: false, error: `Invalid action: ${body.action}` }, { status: 400 });
    } catch (err) {
        return fail(err);
    }
}
