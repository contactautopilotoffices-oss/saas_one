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

        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();

        const rawHost = (body.whom_to_meet || '').trim();
        const isGeneralOrNoHost = !body.host_id && !body.whom_to_meet_uid && (!rawHost || rawHost.toLowerCase() === 'general' || rawHost.toLowerCase() === 'none' || rawHost.toLowerCase() === 'n/a');
        const defaultApprovalStatus = isGeneralOrNoHost ? 'approved' : 'pending';

        // Insert visitor log
        const insertPayload: Record<string, any> = {
            property_id: propertyId,
            organization_id: property.organization_id,
            visitor_id: visitorId,
            category: body.category,
            name: body.name,
            mobile: body.mobile || null,
            coming_from: body.coming_from || null,
            whom_to_meet: body.whom_to_meet || 'General Visit',
            host_id: body.host_id || null,
            created_by: user?.id || body.created_by || null,
            photo_url: body.photo_url || null,
            checkin_time: new Date().toISOString(),
            status: 'checked_in',
            approval_status: body.approval_status || defaultApprovalStatus,
        };

        let { data: visitor, error: insertError } = await supabaseAdmin
            .from('visitor_logs')
            .insert(insertPayload)
            .select()
            .single();

        // Fallback: If created_by, approval_status, or host_id is missing in DB schema cache (PGRST204)
        if (insertError && (insertError.code === 'PGRST204' || insertError.message?.includes('schema cache') || insertError.message?.includes('created_by') || insertError.message?.includes('approval_status'))) {
            console.warn('[VMS Check-in] Optional columns missing in schema cache, retrying basic insert:', insertError.message);
            delete insertPayload.created_by;
            delete insertPayload.approval_status;
            delete insertPayload.host_id;

            const { data: fallbackVisitor, error: schemaRetryError } = await supabaseAdmin
                .from('visitor_logs')
                .insert(insertPayload)
                .select()
                .single();

            if (!schemaRetryError && fallbackVisitor) {
                visitor = fallbackVisitor;
                insertError = null;
            } else if (schemaRetryError) {
                insertError = schemaRetryError;
            }
        }

        // If duplicate key error on visitor_id, auto-resolve with unique suffix
        if (insertError && (insertError.code === '23505' || insertError.message?.includes('unique constraint'))) {
            console.warn(`[VMS Check-in] Visitor ID '${visitorId}' already exists. Auto-generating unique fallback ID.`);
            const fallbackVisitorId = `${visitorId || 'VSR'}-${Date.now().toString().slice(-4)}${Math.floor(100 + Math.random() * 900)}`;

            insertPayload.visitor_id = fallbackVisitorId;

            let { data: retryVisitor, error: retryError } = await supabaseAdmin
                .from('visitor_logs')
                .insert(insertPayload)
                .select()
                .single();

            if (retryError && (retryError.code === 'PGRST204' || retryError.message?.includes('schema cache') || retryError.message?.includes('created_by') || retryError.message?.includes('approval_status'))) {
                delete insertPayload.created_by;
                delete insertPayload.approval_status;
                delete insertPayload.host_id;
                const { data: simpleVisitor, error: simpleErr } = await supabaseAdmin
                    .from('visitor_logs')
                    .insert(insertPayload)
                    .select()
                    .single();
                retryVisitor = simpleVisitor;
                retryError = simpleErr;
            }

            if (retryError) {
                console.error('Error retrying visitor check-in:', retryError);
                return NextResponse.json({ error: retryError.message }, { status: 500 });
            }

            visitor = retryVisitor;
            visitorId = fallbackVisitorId;
        } else if (insertError) {
            console.error('Error creating visitor log:', insertError);
            return NextResponse.json({ error: insertError.message }, { status: 500 });
        }

        // Notification is handled automatically via DB event_outbox trigger (trg_vms_visitors_outbox)

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
    const approvalStatus = searchParams.get('approval_status'); // 'pending' | 'approved' | 'rejected' | 'all'
    const date = searchParams.get('date'); // 'today' | 'week' | 'month' | specific date
    const search = searchParams.get('search'); // Visitor ID or name
    const hostId = searchParams.get('host_id') || searchParams.get('host_user_id') || searchParams.get('user_id');
    const hostName = searchParams.get('host_name');

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

        // Apply Host user filter if provided
        if (hostId && hostName) {
            filteredQ = filteredQ.or(`host_id.eq.${hostId},whom_to_meet_uid.eq.${hostId},whom_to_meet.ilike.%${hostName}%`);
        } else if (hostId) {
            filteredQ = filteredQ.or(`host_id.eq.${hostId},whom_to_meet_uid.eq.${hostId}`);
        } else if (hostName) {
            filteredQ = filteredQ.ilike('whom_to_meet', `%${hostName}%`);
        }

        // Apply Approval Status filter if provided and not 'all'
        if (approvalStatus && approvalStatus !== 'all') {
            filteredQ = filteredQ.eq('approval_status', approvalStatus);
        }

        return filteredQ;
    };

    // 1. Fetch visitors list
    let listQuery = supabaseAdmin
        .from('visitor_logs')
        .select('*')
        .order('checkin_time', { ascending: false });

    if (propertyId !== 'all') {
        listQuery = listQuery.eq('property_id', propertyId);
    }

    // Apply status filter to list query only
    if (status && status !== 'all') {
        listQuery = listQuery.eq('status', status);
    }

    // Apply common filters (date & search) to list query
    listQuery = applyCommonFilters(listQuery);

    let { data, error } = await listQuery.limit(100);

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Populate creator user info if created_by is present
    if (data && data.length > 0) {
        const creatorIds = Array.from(new Set(data.map((v: any) => v.created_by).filter(Boolean)));
        if (creatorIds.length > 0) {
            const { data: creatorUsers } = await supabaseAdmin
                .from('users')
                .select('id, full_name, email')
                .in('id', creatorIds);
            const creatorMap = new Map((creatorUsers || []).map(u => [u.id, u]));
            data.forEach((v: any) => {
                if (v.created_by && creatorMap.has(v.created_by)) {
                    v.creator = creatorMap.get(v.created_by);
                }
            });
        }
    }

    // 2. Fetch stats with exact same filters dynamically applied!
    let statsTotalQuery = supabaseAdmin
        .from('visitor_logs')
        .select('*', { count: 'exact', head: true });
    if (propertyId !== 'all') statsTotalQuery = statsTotalQuery.eq('property_id', propertyId);

    let statsInQuery = supabaseAdmin
        .from('visitor_logs')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'checked_in')
        .neq('approval_status', 'pending')
        .neq('approval_status', 'rejected');
    if (propertyId !== 'all') statsInQuery = statsInQuery.eq('property_id', propertyId);

    let statsOutQuery = supabaseAdmin
        .from('visitor_logs')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'checked_out');
    if (propertyId !== 'all') statsOutQuery = statsOutQuery.eq('property_id', propertyId);

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

// PATCH: Check-out a visitor or update visitor entry approval status
export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ propertyId: string }> }
) {
    const { propertyId } = await params;
    const supabaseAdmin = getAdminClient(); // Use admin client for checkout / approval
    const body = await request.json();

    const visitorId = body.visitor_id || body.id;

    if (!visitorId) {
        return NextResponse.json({ error: 'Visitor ID is required' }, { status: 400 });
    }

    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(visitorId);

    // Find visitor safely without causing UUID cast syntax errors
    let findQuery = supabaseAdmin
        .from('visitor_logs')
        .select('*, properties(organization_id)')
        .eq('property_id', propertyId);

    if (isUuid) {
        findQuery = findQuery.eq('id', visitorId);
    } else {
        findQuery = findQuery.eq('visitor_id', visitorId);
    }

    const { data: visitor, error: findError } = await findQuery.maybeSingle();

    if (findError || !visitor) {
        console.error('[VMS PATCH] Visitor lookup failed:', findError, 'for visitorId:', visitorId);
        return NextResponse.json({ error: findError?.message || 'Visitor not found' }, { status: 404 });
    }

    // Handle Visitor Entry Approval / Rejection action
    if (body.action === 'approval' || body.approval_status) {
        const approvalStatus = body.approval_status; // 'approved' | 'rejected' | 'pending'
        const { data: updatedVisitor, error: updateError } = await supabaseAdmin
            .from('visitor_logs')
            .update({
                approval_status: approvalStatus,
            })
            .eq('id', visitor.id)
            .select()
            .single();

        if (updateError) {
            if (updateError.code === 'PGRST204' || updateError.message?.includes('schema cache')) {
                console.warn('[VMS Approval] approval_status column missing in schema cache:', updateError.message);
                return NextResponse.json({
                    success: true,
                    message: `Visitor entry recorded (${approvalStatus}), but database column schema update is pending.`,
                    visitor: { ...visitor, approval_status: approvalStatus },
                });
            }
            return NextResponse.json({ error: updateError.message }, { status: 500 });
        }

        // Notification is handled automatically via DB event_outbox trigger (trg_vms_visitors_outbox)

        return NextResponse.json({
            success: true,
            message: `Visitor entry ${approvalStatus}.`,
            visitor: updatedVisitor,
        });
    }

    // Default: Visitor Check-out action
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
