import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { NotificationService } from '@/backend/services/NotificationService';
import { getISTDateBounds } from '@/backend/utils/timezone';

// Create admin client for operations that need to bypass RLS
const getAdminClient = () => createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
);

// POST: Check-in a visitor
export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ propertyId: string }> }
) {
    const { propertyId } = await params;
    const supabaseAdmin = getAdminClient(); // Use admin client for check-in
    const body = await request.json();

    try {
        // Get property and org info
        const { data: property, error: propError } = await supabaseAdmin
            .from('properties')
            .select('organization_id, code')
            .eq('id', propertyId)
            .single();

        if (propError || !property) {
            return NextResponse.json({ error: 'Property not found' }, { status: 404 });
        }

        // Use provided visitor ID or generate one
        let visitorId = body.visitor_id;

        if (!visitorId) {
            const { data: visitorIdData, error: idError } = await supabaseAdmin
                .rpc('generate_visitor_id', { p_property_id: propertyId });

            if (idError) {
                console.error('Error generating visitor ID:', idError);
                return NextResponse.json({ error: 'Failed to generate visitor ID' }, { status: 500 });
            }
            visitorId = visitorIdData;
        }

        // Insert visitor log
        const { data: visitor, error: insertError } = await supabaseAdmin
            .from('visitor_logs')
            .insert({
                property_id: propertyId,
                organization_id: property.organization_id,
                visitor_id: visitorId,
                category: body.category,
                name: body.name,
                mobile: body.mobile || null,
                coming_from: body.coming_from || null,
                whom_to_meet: body.whom_to_meet,
                photo_url: body.photo_url || null,
                checkin_time: new Date().toISOString(),
                status: 'checked_in',
            })
            .select()
            .single();

        if (insertError) {
            console.error('Error creating visitor log:', insertError);
            return NextResponse.json({ error: insertError.message }, { status: 500 });
        }

        // Fire notification: security + host person
        NotificationService.afterVisitorCheckedIn(
            visitor.id,
            propertyId,
            property.organization_id
        ).catch(err => console.error('[VMS] Notification error:', err));

        return NextResponse.json({
            success: true,
            visitor_id: visitorId,
            message: `Welcome ${body.name}! Your visit is logged.`,
            visitor,
        }, { status: 201 });
    } catch (err) {
        console.error('Check-in error:', err);
        return NextResponse.json({ error: 'Check-in failed' }, { status: 500 });
    }
}

// GET: List visitors for a property
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ propertyId: string }> }
) {
    const { propertyId } = await params;
    const supabaseAdmin = getAdminClient(); // Use admin client for listing
    const { searchParams } = new URL(request.url);

    const status = searchParams.get('status'); // 'checked_in' | 'checked_out' | 'all'
    const date = searchParams.get('date'); // 'today' | 'week' | 'month' | specific date
    const search = searchParams.get('search'); // Visitor ID or name

    // Helper to apply common filters (date & search) to any query
    const applyCommonFilters = (q: any) => {
        let filteredQ = q;

        // Apply date filter only if not "all"
        if (date && date !== 'all') {
            let filterType = date;
            let customStr = undefined;
            if (!['today', 'yesterday', 'week', 'month'].includes(date)) {
                filterType = 'custom';
                customStr = date;
            }
            const bounds = getISTDateBounds(filterType as any, customStr);
            filteredQ = filteredQ.gte('checkin_time', bounds.start).lte('checkin_time', bounds.end);
        }

        // Apply search filter (searches visitor_id, name, and mobile)
        if (search) {
            filteredQ = filteredQ.or(`visitor_id.ilike.%${search}%,name.ilike.%${search}%,mobile.ilike.%${search}%`);
        }

        return filteredQ;
    };

    // 1. Fetch visitors list
    let listQuery = supabaseAdmin
        .from('visitor_logs')
        .select('*')
        .eq('property_id', propertyId)
        .order('checkin_time', { ascending: false });

    // Apply status filter to list query only
    if (status && status !== 'all') {
        listQuery = listQuery.eq('status', status);
    }

    // Apply common filters (date & search) to list query
    listQuery = applyCommonFilters(listQuery);

    const { data, error } = await listQuery.limit(100);

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // 2. Fetch stats with exact same filters dynamically applied!
    const statsTotalQuery = supabaseAdmin
        .from('visitor_logs')
        .select('*', { count: 'exact', head: true })
        .eq('property_id', propertyId);

    const statsInQuery = supabaseAdmin
        .from('visitor_logs')
        .select('*', { count: 'exact', head: true })
        .eq('property_id', propertyId)
        .eq('status', 'checked_in');

    const statsOutQuery = supabaseAdmin
        .from('visitor_logs')
        .select('*', { count: 'exact', head: true })
        .eq('property_id', propertyId)
        .eq('status', 'checked_out');

    const [
        { count: totalCount },
        { count: checkedInCount },
        { count: checkedOutCount }
    ] = await Promise.all([
        applyCommonFilters(statsTotalQuery),
        applyCommonFilters(statsInQuery),
        applyCommonFilters(statsOutQuery)
    ]);

    return NextResponse.json({
        visitors: data,
        stats: {
            total_today: totalCount || 0,
            checked_in: checkedInCount || 0,
            checked_out: checkedOutCount || 0,
        },
    });
}

// PATCH: Check-out a visitor
export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ propertyId: string }> }
) {
    const { propertyId } = await params;
    const supabaseAdmin = getAdminClient(); // Use admin client for checkout
    const body = await request.json();

    if (!body.visitor_id) {
        return NextResponse.json({ error: 'Visitor ID is required' }, { status: 400 });
    }

    // Find visitor
    const { data: visitor, error: findError } = await supabaseAdmin
        .from('visitor_logs')
        .select('*')
        .eq('visitor_id', body.visitor_id)
        .eq('property_id', propertyId)
        .single();

    if (findError || !visitor) {
        return NextResponse.json({ error: 'Visitor not found' }, { status: 404 });
    }

    if (visitor.status === 'checked_out') {
        return NextResponse.json({ error: 'Visitor already checked out' }, { status: 400 });
    }

    // Update checkout time
    const { data, error } = await supabaseAdmin
        .from('visitor_logs')
        .update({
            checkout_time: new Date().toISOString(),
            status: 'checked_out',
        })
        .eq('id', visitor.id)
        .select()
        .single();

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
        success: true,
        message: `Goodbye ${visitor.name}! Your visit has been logged.`,
        visitor: data,
    });
}
