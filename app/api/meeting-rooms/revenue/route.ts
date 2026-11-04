import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { canViewAllBookings } from '@/backend/lib/meetingRooms/bookingVisibility';
import { isCreditFreeBookingRole } from '@/frontend/lib/meetingRooms/creditFreeRoles';
import { buildRevenueReport, monthRange, type RevenueBooking, type RevenueCredit, type RevenueRoom, type RevenueView } from '@/backend/lib/meetingRooms/revenue';
import { buildRevenueWorkbook } from '@/backend/lib/meetingRooms/revenueWorkbook';

/**
 * GET /api/meeting-rooms/revenue?propertyId=&month=YYYY-MM[&view=clients|internal|all][&format=xlsx]
 *
 * Meeting room revenue for one property and one month: per client (credit hours vs
 * exceeded hours) and per room. JSON by default, an Excel workbook with format=xlsx.
 * The split rules live in backend/lib/meetingRooms/revenue.ts.
 *
 * Access: the same people who can see every booking at the property
 * (property admin, ops super admin, org super admin, master admin).
 */

export const dynamic = 'force-dynamic';

const PAGE = 1000;
const VIEWS: RevenueView[] = ['clients', 'internal', 'all'];
// A booker with one of these roles is a client even without a company.
const TENANT_ROLES = ['tenant', 'super_tenant'];
// Ids per .in() call, so the request URL stays well under PostgREST and proxy limits.
const IN_CHUNK = 200;

type QueryResult<T> = PromiseLike<{ data: T[] | null; error: unknown }>;

/** Reads every row of a query page by page. Throws on the first error. */
async function fetchAllPages<T>(page: (from: number, to: number) => QueryResult<T>): Promise<T[]> {
    const rows: T[] = [];
    for (let from = 0; ; from += PAGE) {
        const { data, error } = await page(from, from + PAGE - 1);
        if (error) throw error;
        rows.push(...(data || []));
        if (!data || data.length < PAGE) return rows;
    }
}

/** Runs an .in() lookup in chunks of ids and joins the results. Throws on the first error. */
async function fetchInChunks<T>(ids: string[], query: (chunk: string[]) => QueryResult<T>): Promise<T[]> {
    const rows: T[] = [];
    for (let i = 0; i < ids.length; i += IN_CHUNK) {
        const { data, error } = await query(ids.slice(i, i + IN_CHUNK));
        if (error) throw error;
        rows.push(...(data || []));
    }
    return rows;
}

export async function GET(request: NextRequest) {
    try {
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const { searchParams } = request.nextUrl;
        const propertyId = searchParams.get('propertyId');
        const month = searchParams.get('month') || '';
        const format = searchParams.get('format');
        const viewParam = searchParams.get('view') || 'clients';
        if (!VIEWS.includes(viewParam as RevenueView)) {
            return NextResponse.json({ error: 'view must be clients, internal or all' }, { status: 400 });
        }
        const view = viewParam as RevenueView;

        if (!propertyId) return NextResponse.json({ error: 'propertyId required' }, { status: 400 });
        const range = monthRange(month);
        if (!range) return NextResponse.json({ error: 'month must be YYYY-MM' }, { status: 400 });

        if (!(await canViewAllBookings(user.id, propertyId))) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        // Service-role client on purpose: property admins cannot read meeting_room_credits or
        // organization_memberships under RLS. Access was checked above, and every query below is
        // filtered by this property (or its organization), or by ids taken from its bookings.
        const { data: property, error: propError } = await supabaseAdmin
            .from('properties')
            .select('id, name, organization_id')
            .eq('id', propertyId)
            .maybeSingle();
        if (propError) throw propError;
        if (!property) return NextResponse.json({ error: 'Property not found' }, { status: 404 });

        // Rooms with their price. Before the hourly_rate migration is applied the column is
        // missing; fall back so the sheet still loads, with every room flagged "rate not set".
        let rateColumnMissing = false;
        let rooms: RevenueRoom[] = [];
        const roomsRes = await supabaseAdmin
            .from('meeting_rooms')
            .select('id, name, hourly_rate')
            .eq('property_id', propertyId);
        if (roomsRes.error) {
            const code = roomsRes.error.code;
            if (code === '42703' || code === 'PGRST204' || roomsRes.error.message?.includes('hourly_rate')) {
                rateColumnMissing = true;
                const fallback = await supabaseAdmin
                    .from('meeting_rooms')
                    .select('id, name')
                    .eq('property_id', propertyId);
                if (fallback.error) throw fallback.error;
                rooms = (fallback.data || []).map(r => ({ ...r, hourly_rate: null }));
            } else {
                throw roomsRes.error;
            }
        } else {
            rooms = roomsRes.data || [];
        }

        // Confirmed bookings in the month, paged so a busy property is never cut off at 1000 rows.
        const bookings = await fetchAllPages<RevenueBooking>((from, to) => supabaseAdmin
            .from('meeting_room_bookings')
            .select('id, meeting_room_id, user_id, company_id, booking_date, start_time, end_time')
            .eq('property_id', propertyId)
            .eq('status', 'confirmed')
            .gte('booking_date', range.start)
            .lte('booking_date', range.end)
            .order('booking_date', { ascending: true })
            .order('id', { ascending: true })
            .range(from, to));

        const companyIds = Array.from(new Set(bookings.map(b => b.company_id).filter((v): v is string => !!v)));
        const userIds = Array.from(new Set(bookings.map(b => b.user_id).filter((v): v is string => !!v)));
        const orgId = property.organization_id as string | null;

        const [credits, companies, users, orgMembers, propertyTenants] = await Promise.all([
            fetchAllPages<RevenueCredit>((from, to) => supabaseAdmin
                .from('meeting_room_credits')
                .select('company_id, user_id, monthly_hours')
                .eq('property_id', propertyId)
                .order('id', { ascending: true })
                .range(from, to)),
            fetchInChunks<{ id: string; name: string }>(companyIds, ids => supabaseAdmin
                .from('companies').select('id, name').in('id', ids)),
            fetchInChunks<{ id: string; full_name: string | null; email: string | null }>(userIds, ids => supabaseAdmin
                .from('users').select('id, full_name, email').in('id', ids)),
            orgId
                ? fetchInChunks<{ user_id: string; role: string }>(userIds, ids => supabaseAdmin
                    .from('organization_memberships')
                    .select('user_id, role')
                    .eq('organization_id', orgId)
                    .eq('is_active', true)
                    .in('user_id', ids))
                : Promise.resolve([] as { user_id: string; role: string }[]),
            fetchInChunks<{ user_id: string; role: string }>(userIds, ids => supabaseAdmin
                .from('property_memberships')
                .select('user_id, role')
                .eq('property_id', propertyId)
                .eq('is_active', true)
                .in('role', TENANT_ROLES)
                .in('user_id', ids)),
        ]);

        const companyNames: Record<string, string> = {};
        companies.forEach(c => { companyNames[c.id] = c.name; });
        const userNames: Record<string, string> = {};
        users.forEach(u => { userNames[u.id] = u.full_name || u.email || 'User'; });
        // Same source as the booking API (isCreditExemptBooker): organization roles only.
        const internalUserIds = new Set(orgMembers.filter(m => isCreditFreeBookingRole(m.role)).map(m => m.user_id));
        // Tenant role at this property, or super tenant on the organization (stored on org memberships).
        const tenantUserIds = new Set([
            ...propertyTenants.map(m => m.user_id),
            ...orgMembers.filter(m => TENANT_ROLES.includes(String(m.role).toLowerCase())).map(m => m.user_id),
        ]);

        const report = buildRevenueReport({
            rooms,
            bookings,
            credits,
            companyNames,
            userNames,
            internalUserIds,
            tenantUserIds,
            view,
        });

        if (format === 'xlsx') {
            const buffer = await buildRevenueWorkbook(report, property.name, month);
            const safeName = String(property.name).replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
            return new NextResponse(buffer, {
                headers: {
                    'Content-Disposition': `attachment; filename="MeetingRoomRevenue-${safeName}-${month}${view === 'clients' ? '' : `-${view}`}.xlsx"`,
                    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                    'Cache-Control': 'no-store',
                },
            });
        }

        return NextResponse.json({
            property: { id: property.id, name: property.name },
            month,
            rateColumnMissing,
            ...report,
        });
    } catch (error) {
        console.error('[Meeting Room Revenue] GET error:', error);
        return NextResponse.json({ error: 'Failed to build the revenue report' }, { status: 500 });
    }
}
