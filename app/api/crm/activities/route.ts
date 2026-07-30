import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { resolveCrmAccess, isCrmAccessError, canAccessLead } from '@/backend/lib/crm/access';

const ACTIVITY_TYPES = [
    'created', 'updated', 'call', 'meeting', 'site_visit', 'proposal_sent',
    'followup_scheduled', 'status_changed', 'assigned', 'note_added',
    'email_sent', 'archived', 'restored',
];

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

// GET /api/crm/activities?lead_id=
export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const leadId = searchParams.get('lead_id');
    if (!leadId) return NextResponse.json({ error: 'lead_id is required' }, { status: 400 });

    const guard = await leadGuard(request, leadId);
    if (guard.error) return guard.error;

    const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
    const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get('page_size') || '50')));
    const from = (page - 1) * pageSize;

    const { data, error, count } = await supabaseAdmin
        .from('crm_activity_log')
        .select('*, user_info:users(id, full_name, email)', { count: 'exact' })
        .eq('lead_id', leadId)
        .order('created_at', { ascending: false })
        .range(from, from + pageSize - 1);

    if (error) {
        console.error('CRM Activities GET error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ activities: data, pagination: { page, page_size: pageSize, total: count || 0 } });
}

// POST /api/crm/activities - log a manual activity (call/meeting/etc.)
export async function POST(request: NextRequest) {
    const body = await request.json().catch(() => null);
    if (!body?.lead_id || !body?.activity_type) {
        return NextResponse.json({ error: 'lead_id and activity_type are required' }, { status: 400 });
    }
    if (!ACTIVITY_TYPES.includes(body.activity_type)) {
        return NextResponse.json({ error: 'Invalid activity_type' }, { status: 400 });
    }

    const guard = await leadGuard(request, body.lead_id);
    if (guard.error) return guard.error;
    const access = guard.access!;

    const { data, error } = await supabaseAdmin
        .from('crm_activity_log')
        .insert({
            lead_id: body.lead_id,
            user_id: access.user.id,
            activity_type: body.activity_type,
            description: body.description ?? null,
            metadata: body.metadata || {},
        })
        .select('*, user_info:users(id, full_name, email)')
        .single();

    if (error) {
        console.error('CRM Activity CREATE error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (['call', 'meeting', 'site_visit', 'email_sent'].includes(body.activity_type)) {
        await supabaseAdmin
            .from('crm_leads')
            .update({ last_contacted: new Date().toISOString() })
            .eq('id', body.lead_id);
    }

    return NextResponse.json({ activity: data }, { status: 201 });
}
