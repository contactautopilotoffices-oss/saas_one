import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { resolveCrmAccess, isCrmAccessError, readOrgId, canAccessLead } from '@/backend/lib/crm/access';

const LEAD_SELECT = `
    *,
    status_info:crm_lead_statuses(id, name, color, sort_order, is_won, is_lost, is_terminal),
    source_info:crm_lead_sources(id, name),
    assigned_user:users!crm_leads_assigned_to_fkey(id, full_name, email, phone),
    creator:users!crm_leads_created_by_fkey(id, full_name, email),
    property_info:properties(id, name)
`;

// Fields any CRM user may edit on a lead they can access.
const BASE_FIELDS = [
    'company_name', 'contact_person', 'contact_number', 'secondary_contact_number', 'email',
    'location', 'city', 'requirement', 'property_interest', 'lead_source',
    'status', 'priority', 'next_followup_date', 'last_contacted', 'followup_notes', 'remarks',
    'lost_reason', 'lost_reason_notes', 'seats', 'move_in_timeline',
    // Reassignment is allowed for reps AND admins (validated against org members below).
    'assigned_to',
];
// Fields restricted to admins (archival / commercial value).
const ADMIN_FIELDS = ['is_archived', 'deal_value'];

async function loadLead(id: string) {
    const { data } = await supabaseAdmin
        .from('crm_leads')
        .select('id, organization_id, created_by, assigned_to, city')
        .eq('id', id)
        .maybeSingle();
    return data;
}

// GET /api/crm/leads/[id]
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const lead0 = await loadLead(id);
    if (!lead0) return NextResponse.json({ error: 'Lead not found' }, { status: 404 });

    const access = await resolveCrmAccess(request, lead0.organization_id);
    if (isCrmAccessError(access)) return access;
    if (!canAccessLead(lead0, access)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const [{ data: lead }, { data: activities }, { data: notes }, { data: events }, { data: metaRow }] = await Promise.all([
        supabaseAdmin.from('crm_leads').select(LEAD_SELECT).eq('id', id).single(),
        supabaseAdmin.from('crm_activity_log').select('*, user_info:users(id, full_name, email)').eq('lead_id', id).order('created_at', { ascending: false }),
        supabaseAdmin.from('crm_notes').select('*, user_info:users(id, full_name, email)').eq('lead_id', id).order('created_at', { ascending: false }),
        supabaseAdmin.from('crm_events').select('*').eq('lead_id', id).order('start_datetime', { ascending: true }),
        supabaseAdmin.from('crm_meta_leads').select('payload').eq('processed_lead_id', id).maybeSingle(),
    ]);

    // Surface the original ad-form Q&A (Meta) so the UI shows EVERY field the
    // prospect submitted. Prefer the raw field_data; fall back to the lead's
    // parsed columns (webhook leads don't store raw field_data).
    let formResponses = extractFormResponses((metaRow as any)?.payload);
    if (formResponses.length === 0 && lead) formResponses = responsesFromLead(lead);

    return NextResponse.json({ lead, activities: activities || [], notes: notes || [], events: events || [], form_responses: formResponses });
}

/** Turn a Meta lead payload's field_data into humanized {question, answer} pairs. */
function extractFormResponses(payload: any): { question: string; answer: string }[] {
    const fd: any[] = payload?.field_data || [];
    const humanize = (s: string) => (s || '')
        .replace(/[_?]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/\b\w/g, (c) => c.toUpperCase());
    return fd
        .map((f) => ({
            question: humanize(f.name || ''),
            answer: Array.isArray(f.values) ? f.values.join(', ').replace(/_/g, ' ') : String(f.values ?? ''),
        }))
        .filter((x) => x.question && x.answer);
}

/** Fallback: reconstruct the key form fields from a lead's parsed columns. */
function responsesFromLead(lead: any): { question: string; answer: string }[] {
    // Pull move-in / seats out of requirement if present.
    const req: string = lead.requirement || '';
    const moveIn = lead.move_in_timeline || (req.match(/Move-?in:\s*([^|]+)/i)?.[1]?.trim());
    const seats = lead.seats != null ? String(lead.seats) : (req.match(/Seats:\s*([^|]+)/i)?.[1]?.trim());
    const company = lead.company_name || (req.match(/Company:\s*([^|]+)/i)?.[1]?.trim());
    const title = req.match(/Title:\s*([^|]+)/i)?.[1]?.trim();
    const pairs: [string, any][] = [
        ['Move-in Timeline', moveIn],
        ['Seat Requirement', seats],
        ['Name', lead.contact_person],
        ['Work Email', lead.email],
        ['Phone', lead.contact_number],
        ['Company Name', company],
        ['Job Title', title],
        ['City', lead.city || lead.location],
    ];
    return pairs.filter(([, v]) => v != null && String(v).trim()).map(([q, v]) => ({ question: q, answer: String(v).trim() }));
}

// PATCH /api/crm/leads/[id]
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const body = await request.json().catch(() => null);
    if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });

    const lead0 = await loadLead(id);
    if (!lead0) return NextResponse.json({ error: 'Lead not found' }, { status: 404 });

    const access = await resolveCrmAccess(request, lead0.organization_id);
    if (isCrmAccessError(access)) return access;
    if (!canAccessLead(lead0, access)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const updateData: Record<string, any> = {};
    for (const f of BASE_FIELDS) if (body[f] !== undefined) updateData[f] = body[f];

    // Validate reassignment target: must be an active BD member of this org (or null).
    if (body.assigned_to !== undefined && body.assigned_to !== null) {
        const [{ data: om }, { data: pm }] = await Promise.all([
            supabaseAdmin.from('organization_memberships').select('user_id')
                .eq('organization_id', lead0.organization_id).eq('user_id', body.assigned_to).eq('is_active', true).maybeSingle(),
            supabaseAdmin.from('property_memberships').select('user_id')
                .eq('organization_id', lead0.organization_id).eq('user_id', body.assigned_to).eq('is_active', true).maybeSingle(),
        ]);
        if (!om && !pm) {
            return NextResponse.json({ error: 'Cannot assign to a user outside this organization' }, { status: 400 });
        }
    }

    // Restricted fields only for admins. Reps attempting them are rejected (not silently dropped).
    const attemptedAdmin = ADMIN_FIELDS.filter((f) => body[f] !== undefined);
    if (attemptedAdmin.length) {
        if (!access.isAdmin) {
            return NextResponse.json(
                { error: `Only admins can change: ${attemptedAdmin.join(', ')}` },
                { status: 403 }
            );
        }
        for (const f of attemptedAdmin) updateData[f] = body[f];
    }

    if (updateData.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(updateData.email))) {
        return NextResponse.json({ error: 'Invalid email format' }, { status: 400 });
    }
    if (updateData.deal_value != null && (isNaN(Number(updateData.deal_value)) || Number(updateData.deal_value) < 0)) {
        return NextResponse.json({ error: 'deal_value must be a non-negative number' }, { status: 400 });
    }
    if (updateData.status) {
        const { data: st } = await supabaseAdmin
            .from('crm_lead_statuses').select('id, organization_id').eq('id', updateData.status).maybeSingle();
        if (!st || (st.organization_id && st.organization_id !== access.organizationId)) {
            return NextResponse.json({ error: 'Invalid status for this organization' }, { status: 400 });
        }
    }
    if (Object.keys(updateData).length === 0) {
        return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
        .from('crm_leads')
        .update(updateData)
        .eq('id', id)
        .select(LEAD_SELECT)
        .single();

    if (error) {
        console.error('CRM Lead UPDATE error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
    // status_changed / assigned activity is written by the DB trigger; no manual insert.
    return NextResponse.json({ lead: data });
}

// DELETE /api/crm/leads/[id] - soft-archive by default; ?hard=true purges (admin only)
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const lead0 = await loadLead(id);
    if (!lead0) return NextResponse.json({ error: 'Lead not found' }, { status: 404 });

    const access = await resolveCrmAccess(request, lead0.organization_id);
    if (isCrmAccessError(access)) return access;

    const hard = new URL(request.url).searchParams.get('hard') === 'true';

    if (hard) {
        if (!access.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        const { error } = await supabaseAdmin.from('crm_leads').delete().eq('id', id);
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        return NextResponse.json({ success: true, deleted: 'hard' });
    }

    // Soft delete: archive, preserving timeline/notes.
    if (!canAccessLead(lead0, access)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const { error } = await supabaseAdmin.from('crm_leads').update({ is_archived: true }).eq('id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    await supabaseAdmin.from('crm_activity_log').insert({
        lead_id: id, user_id: access.user.id, activity_type: 'archived', description: 'Lead archived',
    });
    return NextResponse.json({ success: true, deleted: 'soft' });
}
