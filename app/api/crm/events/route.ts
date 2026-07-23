import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import {
    resolveCrmAccess, isCrmAccessError, readOrgId, scopeLeadsQuery, canAccessLead,
} from '@/backend/lib/crm/access';

const EVENT_TYPES = ['call', 'meeting', 'site_visit', 'followup'];
const EVENT_STATUSES = ['scheduled', 'completed', 'cancelled', 'rescheduled'];
const EVENT_SELECT = `*, lead_info:crm_leads(id, company_name, contact_person, contact_number), user_info:users(id, full_name, email)`;

// GET /api/crm/events - calendar feed (org + ownership/market scoped)
export async function GET(request: NextRequest) {
    const access = await resolveCrmAccess(request, readOrgId(request));
    if (isCrmAccessError(access)) return access;

    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get('start_date');
    const endDate = searchParams.get('end_date');
    const leadId = searchParams.get('lead_id');
    const eventType = searchParams.get('event_type');

    let query = supabaseAdmin.from('crm_events').select(EVENT_SELECT).eq('organization_id', access.organizationId);

    if (!access.isAdmin) {
        // Reps: own events OR events attached to a lead they can access.
        let idQ = supabaseAdmin.from('crm_leads').select('id');
        idQ = scopeLeadsQuery(idQ, access);
        const { data: leadIds } = await idQ;
        const ids = (leadIds || []).map((l: any) => l.id);
        const ors = [`user_id.eq.${access.user.id}`];
        if (ids.length) ors.push(`lead_id.in.(${ids.join(',')})`);
        query = query.or(ors.join(','));
    }

    if (startDate) query = query.gte('start_datetime', startDate);
    if (endDate) query = query.lte('start_datetime', endDate);
    if (leadId) query = query.eq('lead_id', leadId);
    if (eventType) query = query.eq('event_type', eventType);
    query = query.order('start_datetime', { ascending: true });

    const { data, error } = await query;
    if (error) {
        console.error('CRM Events GET error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ events: data });
}

// POST /api/crm/events
export async function POST(request: NextRequest) {
    const body = await request.json().catch(() => null);
    if (!body?.title || !body?.start_datetime || !body?.event_type) {
        return NextResponse.json({ error: 'title, start_datetime, and event_type are required' }, { status: 400 });
    }
    if (!EVENT_TYPES.includes(body.event_type)) {
        return NextResponse.json({ error: 'Invalid event_type' }, { status: 400 });
    }

    const access = await resolveCrmAccess(request, readOrgId(request, body));
    if (isCrmAccessError(access)) return access;

    // If attached to a lead, verify access and org match.
    if (body.lead_id) {
        const { data: lead } = await supabaseAdmin
            .from('crm_leads').select('id, organization_id, created_by, assigned_to, city').eq('id', body.lead_id).maybeSingle();
        if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
        if (!canAccessLead(lead, access)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { data, error } = await supabaseAdmin
        .from('crm_events')
        .insert({
            organization_id: access.organizationId,
            user_id: access.user.id,
            lead_id: body.lead_id ?? null,
            title: body.title,
            description: body.description ?? null,
            start_datetime: body.start_datetime,
            end_datetime: body.end_datetime ?? null,
            event_type: body.event_type,
            status: 'scheduled',
        })
        .select(EVENT_SELECT)
        .single();

    if (error) {
        console.error('CRM Event CREATE error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (body.lead_id) {
        const activityType =
            body.event_type === 'followup' ? 'followup_scheduled'
            : body.event_type === 'meeting' ? 'meeting'
            : body.event_type === 'site_visit' ? 'site_visit' : 'call';
        await supabaseAdmin.from('crm_activity_log').insert({
            lead_id: body.lead_id,
            user_id: access.user.id,
            activity_type: activityType,
            description: `${body.event_type} scheduled: ${body.title}`,
            metadata: { event_id: data.id },
        });
    }

    return NextResponse.json({ event: data }, { status: 201 });
}

// PATCH /api/crm/events
export async function PATCH(request: NextRequest) {
    const body = await request.json().catch(() => null);
    if (!body?.id) return NextResponse.json({ error: 'Event id is required' }, { status: 400 });

    const { data: ev } = await supabaseAdmin
        .from('crm_events').select('id, organization_id, user_id').eq('id', body.id).maybeSingle();
    if (!ev) return NextResponse.json({ error: 'Event not found' }, { status: 404 });

    const access = await resolveCrmAccess(request, ev.organization_id);
    if (isCrmAccessError(access)) return access;
    if (ev.user_id !== access.user.id && !access.isAdmin) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (body.status && !EVENT_STATUSES.includes(body.status)) {
        return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
    }

    const updateData: Record<string, any> = {};
    for (const f of ['title', 'description', 'start_datetime', 'end_datetime', 'status', 'event_type']) {
        if (body[f] !== undefined) updateData[f] = body[f];
    }
    if (Object.keys(updateData).length === 0) {
        return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
        .from('crm_events').update(updateData).eq('id', body.id).select(EVENT_SELECT).single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    if (body.status && data.lead_id) {
        await supabaseAdmin.from('crm_activity_log').insert({
            lead_id: data.lead_id,
            user_id: access.user.id,
            activity_type: 'updated',
            description: `Event ${body.status}: ${data.title}`,
            metadata: { event_id: data.id, status: body.status },
        });
    }
    return NextResponse.json({ event: data });
}

// DELETE /api/crm/events?id=
export async function DELETE(request: NextRequest) {
    const eventId = new URL(request.url).searchParams.get('id');
    if (!eventId) return NextResponse.json({ error: 'Event id is required' }, { status: 400 });

    const { data: ev } = await supabaseAdmin
        .from('crm_events').select('id, organization_id, user_id').eq('id', eventId).maybeSingle();
    if (!ev) return NextResponse.json({ error: 'Event not found' }, { status: 404 });

    const access = await resolveCrmAccess(request, ev.organization_id);
    if (isCrmAccessError(access)) return access;
    if (ev.user_id !== access.user.id && !access.isAdmin) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { error } = await supabaseAdmin.from('crm_events').delete().eq('id', eventId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
}
