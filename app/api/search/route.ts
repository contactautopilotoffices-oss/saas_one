import { createClient } from '@/frontend/utils/supabase/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { NextRequest, NextResponse } from 'next/server';
import { resolveCaller, isCallerError } from '@/backend/lib/auth/callerAccess';
import { resolveCrmAccess, isCrmAccessError, scopeLeadsQuery, sanitizeSearchTerm } from '@/backend/lib/crm/access';

export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    // Characters with meaning in PostgREST filters are stripped, so the text cannot change the filter.
    const query = sanitizeSearchTerm(searchParams.get('q') || '');
    const orgId = searchParams.get('org_id');

    if (!query || query.length < 2) {
        return NextResponse.json({ results: [] });
    }

    // Signed-in users only. Tickets, users, properties and organisations below are read with the
    // caller's own session, so the database's row rules apply.
    const caller = await resolveCaller(request);
    if (isCallerError(caller)) return caller;

    const supabase = await createClient();

    try {
        const scope = searchParams.get('scope');

        // CRM leads follow the CRM's own rules: only people with CRM access, admins see their org,
        // reps see their own leads and markets. Anyone else simply gets no lead results.
        const crmAccess = await resolveCrmAccess(request, orgId);
        const leadsQuery = isCrmAccessError(crmAccess)
            ? Promise.resolve({ data: [] as Record<string, unknown>[] })
            : scopeLeadsQuery(
                supabaseAdmin
                    .from('crm_leads')
                    .select('id, company_name, contact_person, email, contact_number, location, organization_id')
                    .or(`company_name.ilike.%${query}%,contact_person.ilike.%${query}%,email.ilike.%${query}%,contact_number.ilike.%${query}%`),
                crmAccess,
            ).limit(10);

        const [
            ticketsRes,
            usersRes,
            propertiesRes,
            orgsRes,
            leadsRes
        ] = await Promise.all([
            scope === 'crm' ? { data: [] } : supabase
                .from('tickets')
                .select('id, title, ticket_number, status, priority, organization_id')
                .or(`title.ilike.%${query}%,description.ilike.%${query}%,ticket_number.ilike.%${query}%`)
                .limit(5),

            scope === 'crm' ? { data: [] } : supabase
                .from('users')
                .select('id, full_name, email')
                .or(`full_name.ilike.%${query}%,email.ilike.%${query}%`)
                .limit(5),

            scope === 'crm' ? { data: [] } : supabase
                .from('properties')
                .select('id, name, code, address, organization_id')
                .or(`name.ilike.%${query}%,code.ilike.%${query}%,address.ilike.%${query}%`)
                .limit(5),

            scope === 'crm' ? { data: [] } : supabase
                .from('organizations')
                .select('id, name, code')
                .or(`name.ilike.%${query}%,code.ilike.%${query}%`)
                .limit(5),

            leadsQuery
        ]);

        const results = [
            ...(leadsRes.data?.map((l: any) => ({ id: l.id, type: 'lead', label: l.contact_person || l.company_name || 'Lead', sublabel: l.contact_person ? l.company_name : l.email, organization_id: l.organization_id })) || []),
            ...(ticketsRes.data?.map((t: any) => ({ ...t, type: 'ticket', label: t.title, sublabel: `#${t.ticket_number}` })) || []),
            ...(usersRes.data?.map((u: any) => ({ ...u, type: 'user', label: u.full_name, sublabel: u.email })) || []),
            ...(propertiesRes.data?.map((p: any) => ({ ...p, type: 'property', label: p.name, sublabel: p.code })) || []),
            ...(orgsRes.data?.map((o: any) => ({ ...o, type: 'organization', label: o.name, sublabel: o.code })) || [])
        ];

        return NextResponse.json({ results });
    } catch (error) {
        console.error('Search API Error:', error);
        return NextResponse.json({ error: 'Search failed' }, { status: 500 });
    }
}
