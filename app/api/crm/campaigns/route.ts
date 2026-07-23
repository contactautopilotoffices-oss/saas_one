import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { resolveCrmAccess, isCrmAccessError, readOrgId, scopeLeadsQuery } from '@/backend/lib/crm/access';

const DAY_MS = 24 * 60 * 60 * 1000;

// GET /api/crm/campaigns - list campaigns for the org
export async function GET(request: NextRequest) {
    const access = await resolveCrmAccess(request, readOrgId(request));
    if (isCrmAccessError(access)) return access;

    const { data, error } = await supabaseAdmin
        .from('crm_campaigns')
        .select('*')
        .eq('organization_id', access.organizationId)
        .order('created_at', { ascending: false });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ campaigns: data });
}

/**
 * POST /api/crm/campaigns - create a WhatsApp campaign and build its recipient
 * list from a lead audience filter. Recipients are dispatched by
 * /api/crm/campaigns/dispatch (cron) via the existing WhatsAppService.
 *
 * Body:
 *   name, campaign_type ('broadcast'|'drip'),
 *   message (broadcast) | steps:[{day_offset,message}] (drip),
 *   scheduled_at?  (ISO; broadcast/drip base time, defaults to now),
 *   audience: { status?, priority?, city?, assigned_to?, lead_source? }
 */
export async function POST(request: NextRequest) {
    const body = await request.json().catch(() => null);
    if (!body?.name?.trim()) return NextResponse.json({ error: 'name is required' }, { status: 400 });

    const access = await resolveCrmAccess(request, readOrgId(request, body));
    if (isCrmAccessError(access)) return access;
    if (!access.isAdmin) return NextResponse.json({ error: 'Forbidden: admin only' }, { status: 403 });

    const campaignType = body.campaign_type === 'drip' ? 'drip' : 'broadcast';
    const baseTime = body.scheduled_at ? new Date(body.scheduled_at) : new Date();
    if (isNaN(baseTime.getTime())) return NextResponse.json({ error: 'Invalid scheduled_at' }, { status: 400 });

    // Validate message content per type.
    let steps: { day_offset: number; message: string }[] = [];
    if (campaignType === 'broadcast') {
        if (!body.message?.trim()) return NextResponse.json({ error: 'message is required for a broadcast' }, { status: 400 });
        steps = [{ day_offset: 0, message: body.message.trim() }];
    } else {
        if (!Array.isArray(body.steps) || body.steps.length === 0) {
            return NextResponse.json({ error: 'drip campaign requires at least one step' }, { status: 400 });
        }
        steps = body.steps.map((s: any) => ({ day_offset: Math.max(0, parseInt(s.day_offset) || 0), message: String(s.message || '').trim() }));
        if (steps.some((s) => !s.message)) return NextResponse.json({ error: 'every drip step needs a message' }, { status: 400 });
    }

    // Build the audience from leads the caller can see.
    const audience = body.audience || {};
    let leadQ = supabaseAdmin
        .from('crm_leads')
        .select('id, contact_number, company_name, contact_person')
        .eq('is_archived', false)
        .not('contact_number', 'is', null);
    leadQ = scopeLeadsQuery(leadQ, access);
    if (Array.isArray(audience.status) && audience.status.length) leadQ = leadQ.in('status', audience.status);
    if (Array.isArray(audience.priority) && audience.priority.length) leadQ = leadQ.in('priority', audience.priority);
    if (Array.isArray(audience.assigned_to) && audience.assigned_to.length) leadQ = leadQ.in('assigned_to', audience.assigned_to);
    if (Array.isArray(audience.lead_source) && audience.lead_source.length) leadQ = leadQ.in('lead_source', audience.lead_source);
    if (Array.isArray(audience.city) && audience.city.length) leadQ = leadQ.in('city', audience.city);

    const { data: leads, error: leadErr } = await leadQ;
    if (leadErr) return NextResponse.json({ error: leadErr.message }, { status: 500 });

    const recipientLeads = (leads || []).filter((l) => (l.contact_number || '').trim());
    if (recipientLeads.length === 0) {
        return NextResponse.json({ error: 'Audience is empty (no leads with a phone number match the filter)' }, { status: 400 });
    }

    const scheduledNow = !body.scheduled_at || baseTime <= new Date();
    const status = scheduledNow ? 'running' : 'scheduled';

    // Create the campaign.
    const { data: campaign, error: campErr } = await supabaseAdmin
        .from('crm_campaigns')
        .insert({
            organization_id: access.organizationId,
            created_by: access.user.id,
            name: body.name.trim(),
            campaign_type: campaignType,
            message: campaignType === 'broadcast' ? steps[0].message : null,
            steps,
            audience_filter: audience,
            status,
            scheduled_at: baseTime.toISOString(),
            total_recipients: recipientLeads.length,
        })
        .select()
        .single();
    if (campErr) return NextResponse.json({ error: campErr.message }, { status: 500 });

    // Materialize recipient rows (one per lead per step).
    const personalize = (msg: string, l: any) =>
        msg.replace(/\{\{\s*name\s*\}\}/gi, l.contact_person || l.company_name || 'there')
           .replace(/\{\{\s*company\s*\}\}/gi, l.company_name || '');

    const rows: any[] = [];
    for (const l of recipientLeads) {
        steps.forEach((step, idx) => {
            rows.push({
                campaign_id: campaign.id,
                lead_id: l.id,
                phone: (l.contact_number || '').trim(),
                step_index: idx,
                message: personalize(step.message, l),
                status: 'pending',
                scheduled_at: new Date(baseTime.getTime() + step.day_offset * DAY_MS).toISOString(),
            });
        });
    }
    // Insert in chunks to stay well under payload limits.
    for (let i = 0; i < rows.length; i += 500) {
        const { error } = await supabaseAdmin.from('crm_campaign_recipients').insert(rows.slice(i, i + 500));
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ campaign, recipients: rows.length }, { status: 201 });
}
