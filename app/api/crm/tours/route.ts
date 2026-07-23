import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';

export async function GET() {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data } = await supabase
        .from('crm_tour_completions')
        .select('tour_id, completed_at')
        .eq('user_id', user.id);

    return NextResponse.json({ completions: data || [] });
}

export async function POST(req: NextRequest) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { tour_id } = await req.json();
    if (!tour_id) return NextResponse.json({ error: 'tour_id required' }, { status: 400 });

    const { error } = await supabase
        .from('crm_tour_completions')
        .upsert({ user_id: user.id, tour_id, completed_at: new Date().toISOString() }, { onConflict: 'user_id,tour_id' });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { tour_id } = await req.json();

    if (tour_id) {
        await supabase.from('crm_tour_completions').delete().eq('user_id', user.id).eq('tour_id', tour_id);
    } else {
        await supabase.from('crm_tour_completions').delete().eq('user_id', user.id);
    }

    return NextResponse.json({ ok: true });
}
