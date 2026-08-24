import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';

/**
 * GET  /api/org-efficiency/measurements?goalId=   — a goal's time series
 * POST /api/org-efficiency/measurements           — record a period value
 */

export async function GET(request: NextRequest) {
    try {
        const supabase = await createClient();
        const { searchParams } = new URL(request.url);
        const goalId = searchParams.get('goalId');
        if (!goalId) return NextResponse.json({ error: 'goalId required' }, { status: 400 });

        const { data, error } = await supabase
            .from('oem_measurements')
            .select('*')
            .eq('goal_id', goalId)
            .order('period_end', { ascending: true });
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        return NextResponse.json({ measurements: data ?? [] });
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
        for (const f of ['organization_id', 'goal_id', 'period_start', 'period_end', 'value']) {
            if (body[f] === undefined || body[f] === null) {
                return NextResponse.json({ error: `${f} is required` }, { status: 400 });
            }
        }

        const { data, error } = await supabase
            .from('oem_measurements')
            .upsert(body, { onConflict: 'goal_id,period_start,period_end' })
            .select()
            .single();
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        return NextResponse.json({ measurement: data }, { status: 201 });
    } catch (e) {
        return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
}
