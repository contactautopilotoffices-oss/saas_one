import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { resolveCrmAccess, isCrmAccessError, canAccessLead } from '@/backend/lib/crm/access';

async function leadGuard(request: NextRequest, leadId: string) {
    const { data: lead } = await supabaseAdmin
        .from('crm_leads')
        .select('id, organization_id, created_by, assigned_to, city, location, campaign')
        .eq('id', leadId)
        .maybeSingle();
    if (!lead) return { error: NextResponse.json({ error: 'Lead not found' }, { status: 404 }) };
    const access = await resolveCrmAccess(request, lead.organization_id);
    if (isCrmAccessError(access)) return { error: access };
    if (!canAccessLead(lead, access)) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
    return { access };
}

// GET /api/crm/notes?lead_id=
export async function GET(request: NextRequest) {
    const leadId = new URL(request.url).searchParams.get('lead_id');
    if (!leadId) return NextResponse.json({ error: 'lead_id is required' }, { status: 400 });

    const guard = await leadGuard(request, leadId);
    if (guard.error) return guard.error;

    const { data, error } = await supabaseAdmin
        .from('crm_notes')
        .select('*, user_info:users(id, full_name, email)')
        .eq('lead_id', leadId)
        .order('created_at', { ascending: false });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ notes: data });
}

// POST /api/crm/notes
export async function POST(request: NextRequest) {
    const body = await request.json().catch(() => null);
    if (!body?.lead_id || !body?.note?.trim()) {
        return NextResponse.json({ error: 'lead_id and note are required' }, { status: 400 });
    }

    const guard = await leadGuard(request, body.lead_id);
    if (guard.error) return guard.error;
    const access = guard.access!;

    const { data, error } = await supabaseAdmin
        .from('crm_notes')
        .insert({ lead_id: body.lead_id, user_id: access.user.id, note: body.note.trim() })
        .select('*, user_info:users(id, full_name, email)')
        .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    await supabaseAdmin.from('crm_activity_log').insert({
        lead_id: body.lead_id,
        user_id: access.user.id,
        activity_type: 'note_added',
        description: 'Note added',
        metadata: { note_id: data.id },
    });

    return NextResponse.json({ note: data }, { status: 201 });
}

// PATCH /api/crm/notes (lead member or admin)
export async function PATCH(request: NextRequest) {
    const body = await request.json().catch(() => null);
    if (!body?.id || !body?.note?.trim()) {
        return NextResponse.json({ error: 'id and note text are required' }, { status: 400 });
    }

    const { data: note } = await supabaseAdmin
        .from('crm_notes')
        .select('id, user_id, lead_id')
        .eq('id', body.id)
        .maybeSingle();
    if (!note) return NextResponse.json({ error: 'Note not found' }, { status: 404 });

    const guard = await leadGuard(request, note.lead_id);
    if (guard.error) return guard.error;

    const { data: updatedNote, error } = await supabaseAdmin
        .from('crm_notes')
        .update({ note: body.note.trim() })
        .eq('id', body.id)
        .select('*, user_info:users(id, full_name, email)')
        .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ note: updatedNote });
}

// DELETE /api/crm/notes?id= (lead member or admin)
export async function DELETE(request: NextRequest) {
    const noteId = new URL(request.url).searchParams.get('id');
    if (!noteId) return NextResponse.json({ error: 'Note id is required' }, { status: 400 });

    const { data: note } = await supabaseAdmin
        .from('crm_notes')
        .select('id, user_id, lead_id')
        .eq('id', noteId)
        .maybeSingle();
    if (!note) return NextResponse.json({ error: 'Note not found' }, { status: 404 });

    const guard = await leadGuard(request, note.lead_id);
    if (guard.error) return guard.error;

    const { error } = await supabaseAdmin.from('crm_notes').delete().eq('id', noteId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
}
