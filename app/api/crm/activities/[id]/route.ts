import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { resolveCrmAccess, isCrmAccessError, canAccessLead } from '@/backend/lib/crm/access';

// Resolve the activity → its lead → access check (anyone who can access the lead
// can edit/delete its timeline entries).
async function activityGuard(request: NextRequest, id: string) {
    const { data: activity } = await supabaseAdmin
        .from('crm_activity_log').select('id, lead_id').eq('id', id).maybeSingle();
    if (!activity) return { error: NextResponse.json({ error: 'Activity not found' }, { status: 404 }) };

    const { data: lead } = await supabaseAdmin
        .from('crm_leads')
        .select('id, organization_id, created_by, assigned_to, city')
        .eq('id', activity.lead_id)
        .maybeSingle();
    if (!lead) return { error: NextResponse.json({ error: 'Lead not found' }, { status: 404 }) };

    const access = await resolveCrmAccess(request, lead.organization_id);
    if (isCrmAccessError(access)) return { error: access };
    if (!canAccessLead(lead, access)) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
    return { access, activity };
}

// PATCH /api/crm/activities/[id] — edit a timeline entry's description.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const guard = await activityGuard(request, id);
    if (guard.error) return guard.error;

    const body = await request.json().catch(() => null);
    if (!body || typeof body.description !== 'string') {
        return NextResponse.json({ error: 'description is required' }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
        .from('crm_activity_log')
        .update({ description: body.description })
        .eq('id', id)
        .select('*, user_info:users(id, full_name, email)')
        .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ activity: data });
}

// DELETE /api/crm/activities/[id] — remove a timeline entry.
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const guard = await activityGuard(request, id);
    if (guard.error) return guard.error;

    const { error } = await supabaseAdmin.from('crm_activity_log').delete().eq('id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
}
