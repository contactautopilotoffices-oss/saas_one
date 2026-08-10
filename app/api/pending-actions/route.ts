import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { isMissingRelation } from '@/backend/lib/aop/access';

/**
 * GET /api/pending-actions — the calling user's open pending actions, newest first.
 * Powers the PendingActionsBell header badge; the realtime badge itself subscribes to
 * the pending_actions table (RLS: recipient_id = auth.uid()) and uses this only for the
 * initial load.
 *
 * PATCH — act on one of your own rows: { id, action, status? }. `action` is recorded as
 * resolved_action (the verb the user picked, e.g. 'respond', 'approve', 'reject');
 * status defaults to 'done' and may be 'dismissed'. Domain side effects (e.g. accepting
 * a dispute) belong to the domain's own routes — this table is just the inbox, so any
 * authenticated user may use it but strictly only on rows where they are the recipient.
 */

export const dynamic = 'force-dynamic';

async function authenticate(request: NextRequest): Promise<{ id: string } | null> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (user) return { id: user.id };

    const authHeader = request.headers.get('authorization') || '';
    const token = authHeader.toLowerCase().startsWith('bearer ') ? authHeader.slice(7) : null;
    if (token) {
        const { data: { user: tokenUser } } = await supabaseAdmin.auth.getUser(token);
        if (tokenUser) return { id: tokenUser.id };
    }
    return null;
}

export async function GET(request: NextRequest) {
    const user = await authenticate(request);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data, error } = await supabaseAdmin
        .from('pending_actions')
        .select('*')
        .eq('recipient_id', user.id)
        .eq('status', 'open')
        .order('created_at', { ascending: false })
        .range(0, 499);

    if (error) {
        if (isMissingRelation(error)) return NextResponse.json({ provisioned: false, actions: [] });
        console.error('[pending-actions]', error.message);
        return NextResponse.json({ error: 'Could not load pending actions' }, { status: 500 });
    }
    return NextResponse.json({ provisioned: true, actions: data || [] });
}

export async function PATCH(request: NextRequest) {
    const user = await authenticate(request);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    let body: { id?: string; action?: string; status?: string };
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const status = body.status ?? 'done';
    if (!body.id || (status !== 'done' && status !== 'dismissed')) {
        return NextResponse.json({ error: 'id and status (done|dismissed) are required' }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
        .from('pending_actions')
        .update({
            status,
            resolved_at: new Date().toISOString(),
            resolved_action: body.action ?? null,
        })
        .eq('id', body.id)
        .eq('recipient_id', user.id) // strictly your own rows — RLS says the same in SQL
        .eq('status', 'open')
        .select('*')
        .maybeSingle();

    if (error) {
        if (isMissingRelation(error)) return NextResponse.json({ provisioned: false });
        console.error('[pending-actions act]', error.message);
        return NextResponse.json({ error: 'Could not update pending action' }, { status: 500 });
    }
    if (!data) return NextResponse.json({ error: 'Pending action not found or already resolved' }, { status: 404 });

    return NextResponse.json({ action: data });
}
