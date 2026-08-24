import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';

/**
 * GET   /api/org-efficiency/tasks?orgId=&from=&to=&owner=&goalId=&status=
 *       — the task calendar feed (from/to are dates)
 * POST  /api/org-efficiency/tasks  — create a task
 * PATCH /api/org-efficiency/tasks  — update (complete with proof, block, etc.)
 */

export async function GET(request: NextRequest) {
    try {
        const supabase = await createClient();
        const { searchParams } = new URL(request.url);
        const orgId = searchParams.get('orgId');
        if (!orgId) return NextResponse.json({ error: 'orgId required' }, { status: 400 });

        let query = supabase
            .from('oem_tasks')
            .select('*, goal:oem_goals(id, title, level, metric_key)')
            .eq('organization_id', orgId);

        const from = searchParams.get('from');
        const to = searchParams.get('to');
        const owner = searchParams.get('owner');
        const goalId = searchParams.get('goalId');
        const status = searchParams.get('status');
        if (from) query = query.gte('scheduled_on', from);
        if (to) query = query.lte('scheduled_on', to);
        if (owner) query = query.eq('owner_uid', owner);
        if (goalId) query = query.eq('goal_id', goalId);
        if (status) query = query.eq('status', status);

        const { data, error } = await query.order('scheduled_on').order('due_at', { nullsFirst: false });
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        return NextResponse.json({ tasks: data ?? [] });
    } catch (e) {
        return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const body = await request.json();
        for (const f of ['organization_id', 'goal_id', 'title']) {
            if (!body[f]) return NextResponse.json({ error: `${f} is required` }, { status: 400 });
        }

        const { data, error } = await supabase.from('oem_tasks').insert(body).select().single();
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        return NextResponse.json({ task: data }, { status: 201 });
    } catch (e) {
        return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
}

export async function PATCH(request: NextRequest) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const body = await request.json();
        const { id, ...updates } = body;
        if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

        // Completing a task stamps completed_at; a 'done' without proof stays
        // visible as claim-only so the meter can discount it.
        if (updates.status === 'done' && !updates.completed_at) {
            updates.completed_at = new Date().toISOString();
        }

        const { data, error } = await supabase
            .from('oem_tasks')
            .update(updates)
            .eq('id', id)
            .select()
            .single();
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        return NextResponse.json({ task: data });
    } catch (e) {
        return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
}
