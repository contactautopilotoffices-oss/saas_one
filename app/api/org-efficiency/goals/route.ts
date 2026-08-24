import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';

/**
 * GET  /api/org-efficiency/goals?orgId=&level=&cadence=&owner=&department=&status=
 * POST /api/org-efficiency/goals   — create a goal (org super admin console)
 * PATCH /api/org-efficiency/goals  — update a goal by id
 */

export async function GET(request: NextRequest) {
    try {
        const supabase = await createClient();
        const { searchParams } = new URL(request.url);
        const orgId = searchParams.get('orgId');
        if (!orgId) return NextResponse.json({ error: 'orgId required' }, { status: 400 });

        let query = supabase
            .from('v_oem_goal_progress')
            .select('*')
            .eq('organization_id', orgId);

        const level = searchParams.get('level');
        const cadence = searchParams.get('cadence');
        const owner = searchParams.get('owner');
        const department = searchParams.get('department');
        const status = searchParams.get('status');
        if (level) query = query.eq('level', level);
        if (cadence) query = query.eq('cadence', cadence);
        if (owner) query = query.eq('owner_uid', owner);
        if (department) query = query.eq('department', department);
        if (status) query = query.eq('status', status);

        const { data, error } = await query.order('level').order('title');
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        return NextResponse.json({ goals: data ?? [] });
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
        const required = ['organization_id', 'level', 'title', 'metric_key', 'target_value'];
        for (const f of required) {
            if (body[f] === undefined || body[f] === null || body[f] === '') {
                return NextResponse.json({ error: `${f} is required` }, { status: 400 });
            }
        }

        const { data, error } = await supabase
            .from('oem_goals')
            .insert({ ...body, created_by: user.id })
            .select()
            .single();
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        return NextResponse.json({ goal: data }, { status: 201 });
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

        const { data, error } = await supabase
            .from('oem_goals')
            .update(updates)
            .eq('id', id)
            .select()
            .single();
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        return NextResponse.json({ goal: data });
    } catch (e) {
        return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
}
