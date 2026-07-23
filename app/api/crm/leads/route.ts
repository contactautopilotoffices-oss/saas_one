import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import {
    resolveCrmAccess,
    isCrmAccessError,
    readOrgId,
    scopeLeadsQuery,
    sanitizeSearchTerm,
} from '@/backend/lib/crm/access';
import { NotificationService } from '@/backend/services/NotificationService';
import { cityFilterOr } from '@/backend/lib/crm/cityGroups';

const LEAD_SELECT = `
    *,
    status_info:crm_lead_statuses(id, name, color, sort_order, is_won, is_lost, is_terminal),
    source_info:crm_lead_sources(id, name),
    assigned_user:users!crm_leads_assigned_to_fkey(id, full_name, email),
    creator:users!crm_leads_created_by_fkey(id, full_name, email),
    property_info:properties(id, name)
`;

const SORTABLE = new Set([
    'created_at', 'updated_at', 'deal_value', 'next_followup_date',
    'last_contacted', 'company_name', 'priority', 'status', 'closed_at',
]);

function isValidEmail(v: string) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

// GET /api/crm/leads - List leads (org + market scoped)
export async function GET(request: NextRequest) {
    const access = await resolveCrmAccess(request, readOrgId(request));
    if (isCrmAccessError(access)) return access;

    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
    const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get('page_size') || '20')));
    const search = sanitizeSearchTerm(searchParams.get('search') || '');
    const statuses = searchParams.getAll('status');
    const priorities = searchParams.getAll('priority');
    const assignedTo = searchParams.getAll('assigned_to');
    const properties = searchParams.getAll('property_interest');
    const sources = searchParams.getAll('lead_source');
    const campaigns = searchParams.getAll('campaign');
    const cities = searchParams.getAll('city');
    const dateFrom = searchParams.get('date_from');
    const dateTo = searchParams.get('date_to');
    const seatsRange = searchParams.get('seats_range');
    const isArchived = searchParams.get('is_archived') === 'true';
    const sortByRaw = searchParams.get('sort_by') || 'created_at';
    const sortBy = SORTABLE.has(sortByRaw) ? sortByRaw : 'created_at';
    const sortOrder = searchParams.get('sort_order') === 'asc';

    let query = supabaseAdmin.from('crm_leads').select(LEAD_SELECT, { count: 'exact' });
    query = scopeLeadsQuery(query, access);

    if (search) {
        query = query.or(
            `company_name.ilike.%${search}%,contact_person.ilike.%${search}%,email.ilike.%${search}%,contact_number.ilike.%${search}%`
        );
    }
    if (statuses.length) query = query.in('status', statuses);
    if (priorities.length) query = query.in('priority', priorities);
    if (assignedTo.length) query = query.in('assigned_to', assignedTo);
    if (properties.length) query = query.in('property_interest', properties);
    if (sources.length) query = query.in('lead_source', sources);
    if (campaigns.length) query = query.in('campaign', campaigns);
    // City filter rolls a parent metro (e.g. Mumbai) up to its sub-locations
    // (Lower Parel, Andheri, …) so neighbourhood-tagged leads aren't dropped.
    if (cities.length) {
        const cityOr = cityFilterOr(cities);
        if (cityOr) query = query.or(cityOr);
    }
    if (dateFrom) query = query.gte('created_at', dateFrom);
    if (dateTo) query = query.lte('created_at', `${dateTo}T23:59:59.999Z`);
    // Seat-range filter on the numeric `seats` column.
    if (seatsRange === 'lt25') query = query.lt('seats', 25);
    else if (seatsRange === '25to50') query = query.gte('seats', 25).lte('seats', 50);
    else if (seatsRange === '50to100') query = query.gte('seats', 50).lte('seats', 100);
    else if (seatsRange === 'gt100') query = query.gt('seats', 100);
    query = query.eq('is_archived', isArchived);
    query = query.order(sortBy, { ascending: sortOrder });

    const from = (page - 1) * pageSize;
    query = query.range(from, from + pageSize - 1);

    const { data, error, count } = await query;
    if (error) {
        console.error('CRM Leads GET error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
        leads: data,
        pagination: {
            page,
            page_size: pageSize,
            total: count || 0,
            total_pages: Math.ceil((count || 0) / pageSize),
        },
    });
}

// POST /api/crm/leads - Create a lead
export async function POST(request: NextRequest) {
    const body = await request.json().catch(() => null);
    if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });

    const access = await resolveCrmAccess(request, readOrgId(request, body));
    if (isCrmAccessError(access)) return access;

    // Require at least one identifying field.
    if (!body.company_name && !body.contact_person && !body.email && !body.contact_number) {
        return NextResponse.json(
            { error: 'At least one of company_name, contact_person, email, or contact_number is required' },
            { status: 400 }
        );
    }
    if (body.email && !isValidEmail(String(body.email))) {
        return NextResponse.json({ error: 'Invalid email format' }, { status: 400 });
    }
    if (body.deal_value != null && (isNaN(Number(body.deal_value)) || Number(body.deal_value) < 0)) {
        return NextResponse.json({ error: 'deal_value must be a non-negative number' }, { status: 400 });
    }
    if (body.priority && !['Low', 'Medium', 'High', 'Urgent'].includes(body.priority)) {
        return NextResponse.json({ error: 'Invalid priority' }, { status: 400 });
    }

    // Resolve status: explicit -> org default -> global default.
    let statusId = body.status;
    if (statusId) {
        const { data: st } = await supabaseAdmin
            .from('crm_lead_statuses')
            .select('id, organization_id')
            .eq('id', statusId)
            .maybeSingle();
        if (!st || (st.organization_id && st.organization_id !== access.organizationId)) {
            return NextResponse.json({ error: 'Invalid status for this organization' }, { status: 400 });
        }
    } else {
        const { data: def } = await supabaseAdmin
            .from('crm_lead_statuses')
            .select('id, organization_id')
            .eq('is_default', true)
            .or(`organization_id.eq.${access.organizationId},organization_id.is.null`)
            .order('organization_id', { ascending: false, nullsFirst: false })
            .limit(1)
            .maybeSingle();
        statusId = def?.id;
    }
    if (!statusId) {
        return NextResponse.json({ error: 'No default lead status configured' }, { status: 500 });
    }

    // Only admins may assign to other users; a rep's lead defaults to themselves.
    const assignedTo = access.isAdmin ? (body.assigned_to ?? null) : access.user.id;

    const leadData = {
        organization_id: access.organizationId,
        created_by: access.user.id,
        assigned_to: assignedTo,
        company_name: body.company_name ?? null,
        contact_person: body.contact_person ?? null,
        contact_number: body.contact_number ?? null,
        secondary_contact_number: body.secondary_contact_number ?? null,
        email: body.email ?? null,
        location: body.location ?? null,
        city: body.city ?? body.location ?? null,
        requirement: body.requirement ?? null,
        seats: body.seats != null && !isNaN(Number(body.seats)) ? Number(body.seats) : null,
        move_in_timeline: body.move_in_timeline ?? null,
        property_interest: body.property_interest ?? null,
        lead_source: body.lead_source ?? null,
        deal_value: body.deal_value ?? 0,
        status: statusId,
        priority: body.priority || 'Medium',
        next_followup_date: body.next_followup_date ?? null,
        followup_notes: body.followup_notes ?? null,
        remarks: body.remarks ?? null,
    };

    const { data, error } = await supabaseAdmin
        .from('crm_leads')
        .insert(leadData)
        .select(LEAD_SELECT)
        .single();

    if (error) {
        console.error('CRM Lead CREATE error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (data?.id) {
        NotificationService.afterLeadCreated(data.id).catch(e => console.error('[CRM Lead CREATE] WA error:', e));
    }

    // The 'created' activity is written by the crm_auto_activity DB trigger.
    return NextResponse.json({ lead: data }, { status: 201 });
}
