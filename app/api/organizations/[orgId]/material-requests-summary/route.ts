import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';

/**
 * GET /api/organizations/[orgId]/material-requests-summary
 *
 * "How many material requests are stuck, and how long have they been stuck."
 *
 * WHY THIS EXISTS rather than reusing GET /api/procurement/requests: that route returns
 * every raw row with five nested joins AND awaits canUserSeePrices() once per request
 * inside a Promise.all map — an N+1 against organization/property memberships. It is built
 * for the procurement worklist, where the user needs every field. A dashboard tile needs
 * six numbers, so this aggregates in four fixed queries regardless of row count.
 *
 * MONEY IS DELIBERATELY ABSENT. Every material_requests.total_amount and every
 * material_request_items.total_price in this database is 0 — prices are settled later, in
 * the comparative quotes. Rendering "Rs 0 pending" would be a confident lie, so the tile
 * counts requests and measures waiting time instead.
 */

export const dynamic = 'force-dynamic';

// Reading the tile is open to anyone who belongs to the org; a material request is
// ordinary operational traffic, not commercial data. The membership check below is what
// stops it being an org enumeration endpoint.
const HARD_LIMIT = 2000;
const QUEUE_SIZE = 8;
const TOP_N = 5;

/** Waiting on procurement to price it. */
const NEEDS_QUOTE = ['pending_quotation', 'pending', 'requested'];
/** Priced, waiting on a human decision. */
const NEEDS_DECISION = ['pending_approval', 'quoted', 'negotiating'];
/** Decided, money committed, not yet on site. */
const IN_FLIGHT = ['approved', 'ordered'];
/** Terminal. */
const CLOSED = ['delivered', 'rejected', 'cancelled'];

const OPEN = [...NEEDS_QUOTE, ...NEEDS_DECISION, ...IN_FLIGHT];

interface Row {
    id: string;
    ticket_id: string | null;
    property_id: string | null;
    status: string | null;
    created_at: string | null;
    assignee_uid: string | null;
    budget_type: string | null;
}

const days = (iso: string | null): number =>
    iso ? Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)) : 0;

export async function GET(
    _request: NextRequest,
    { params }: { params: Promise<{ orgId: string }> },
) {
    const { orgId } = await params;

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // Membership gate. Master admins bypass, mirroring every other org-scoped route here.
    const { data: profile } = await supabaseAdmin
        .from('users').select('is_master_admin').eq('id', user.id).maybeSingle();

    if (!profile?.is_master_admin) {
        const [orgRes, propRes] = await Promise.all([
            supabaseAdmin.from('organization_memberships')
                .select('id').eq('user_id', user.id).eq('organization_id', orgId)
                .eq('is_active', true).limit(1),
            supabaseAdmin.from('property_memberships')
                .select('id').eq('user_id', user.id).eq('organization_id', orgId)
                .eq('is_active', true).limit(1),
        ]);
        if (!(orgRes.data?.length || propRes.data?.length)) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }
    }

    const { data, error } = await supabaseAdmin
        .from('material_requests')
        .select('id, ticket_id, property_id, status, created_at, assignee_uid, budget_type')
        .eq('organization_id', orgId)
        .order('created_at', { ascending: false })
        .range(0, HARD_LIMIT - 1);

    if (error) {
        // Table absent = the procurement schema was never applied on this environment.
        // Report it as "not provisioned" so the tile can render a setup hint, not a 500.
        if (error.code === '42P01' || error.code === 'PGRST205') {
            return NextResponse.json({ provisioned: false, totals: null, by_status: [], by_property: [], oldest: [] });
        }
        console.error('[material-requests-summary]', error.message);
        return NextResponse.json({ error: 'Could not load the material request summary' }, { status: 500 });
    }

    const rows = (data || []) as Row[];
    const open = rows.filter(r => OPEN.includes(String(r.status || '')));

    const bucketOf = (status: string): 'needs_quote' | 'needs_decision' | 'in_flight' | 'closed' | 'other' =>
        NEEDS_QUOTE.includes(status) ? 'needs_quote'
            : NEEDS_DECISION.includes(status) ? 'needs_decision'
                : IN_FLIGHT.includes(status) ? 'in_flight'
                    : CLOSED.includes(status) ? 'closed' : 'other';

    const count = (b: string) => open.filter(r => bucketOf(String(r.status || '')) === b).length;

    // Names are resolved only for the rows actually returned — three lookups, not N.
    const oldestOpen = [...open]
        .sort((a, b) => new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime())
        .slice(0, QUEUE_SIZE);

    const propIds = [...new Set(rows.map(r => r.property_id).filter(Boolean))] as string[];
    const ticketIds = [...new Set(oldestOpen.map(r => r.ticket_id).filter(Boolean))] as string[];
    const userIds = [...new Set(oldestOpen.map(r => r.assignee_uid).filter(Boolean))] as string[];
    const openIds = open.map(r => r.id);

    const [propsRes, ticketsRes, usersRes, itemsRes] = await Promise.all([
        propIds.length
            ? supabaseAdmin.from('properties').select('id, name').in('id', propIds)
            : Promise.resolve({ data: [] as { id: string; name: string | null }[] }),
        ticketIds.length
            ? supabaseAdmin.from('tickets').select('id, ticket_number, title').in('id', ticketIds)
            : Promise.resolve({ data: [] as { id: string; ticket_number: string | null; title: string | null }[] }),
        userIds.length
            ? supabaseAdmin.from('users').select('id, full_name').in('id', userIds)
            : Promise.resolve({ data: [] as { id: string; full_name: string | null }[] }),
        openIds.length
            ? supabaseAdmin.from('material_request_items').select('request_id').in('request_id', openIds)
            : Promise.resolve({ data: [] as { request_id: string }[] }),
    ]);

    const propName = new Map((propsRes.data || []).map(p => [p.id, p.name || 'Unnamed site']));
    const ticket = new Map((ticketsRes.data || []).map(t => [t.id, t]));
    const userName = new Map((usersRes.data || []).map(u => [u.id, u.full_name || '']));

    const itemCount = new Map<string, number>();
    for (const it of itemsRes.data || []) {
        itemCount.set(it.request_id, (itemCount.get(it.request_id) || 0) + 1);
    }

    // Ranked sites — where the backlog actually sits.
    const byProperty = new Map<string, { property_id: string; property_name: string; open: number; oldest_days: number }>();
    for (const r of open) {
        const id = r.property_id || 'unknown';
        const g = byProperty.get(id) || {
            property_id: id, property_name: propName.get(id) || 'Unassigned site', open: 0, oldest_days: 0,
        };
        g.open += 1;
        g.oldest_days = Math.max(g.oldest_days, days(r.created_at));
        byProperty.set(id, g);
    }

    const statusCounts = new Map<string, number>();
    for (const r of open) {
        const s = String(r.status || 'unknown');
        statusCounts.set(s, (statusCounts.get(s) || 0) + 1);
    }

    const waits = open.map(r => days(r.created_at)).sort((a, b) => a - b);
    const median = waits.length ? waits[Math.floor(waits.length / 2)] : 0;

    return NextResponse.json({
        provisioned: true,
        organization_id: orgId,
        totals: {
            requests: rows.length,
            open: open.length,
            needs_quote: count('needs_quote'),
            needs_decision: count('needs_decision'),
            in_flight: count('in_flight'),
            closed: rows.filter(r => bucketOf(String(r.status || '')) === 'closed').length,
            oldest_days: waits.length ? waits[waits.length - 1] : 0,
            median_wait_days: median,
        },
        by_status: [...statusCounts.entries()]
            .map(([status, n]) => ({ status, count: n, bucket: bucketOf(status) }))
            .sort((a, b) => b.count - a.count),
        by_property: [...byProperty.values()]
            .sort((a, b) => b.open - a.open || b.oldest_days - a.oldest_days)
            .slice(0, TOP_N),
        oldest: oldestOpen.map(r => ({
            id: r.id,
            status: r.status,
            bucket: bucketOf(String(r.status || '')),
            age_days: days(r.created_at),
            property_name: r.property_id ? (propName.get(r.property_id) || 'Unassigned site') : 'Unassigned site',
            ticket_number: (r.ticket_id && ticket.get(r.ticket_id)?.ticket_number) || null,
            ticket_title: (r.ticket_id && ticket.get(r.ticket_id)?.title) || null,
            assignee_name: (r.assignee_uid && userName.get(r.assignee_uid)) || null,
            item_count: itemCount.get(r.id) || 0,
        })),
        truncated: rows.length >= HARD_LIMIT,
        generated_at: new Date().toISOString(),
    });
}
