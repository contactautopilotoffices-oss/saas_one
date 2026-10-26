import { NextRequest, NextResponse, after } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { getISTDateBounds } from '@/backend/utils/timezone';
import { refreshStaleCalls, startHostCall } from '@/backend/lib/vms-face/hostCall';

/**
 * VMS Face (testing) — Tech Team only. A separate copy of /api/vms/[propertyId] that reads and
 * writes vms_face_visits, never visitor_logs. See docs/VMS_BIOFRQ_PLAN.md.
 */

const TABLE = 'vms_face_visits';
const PURPOSES = ['meeting', 'interview', 'delivery', 'vendor_work', 'personal', 'other'];
const CATEGORIES = ['visitor', 'vendor', 'other'];
const GENERAL_HOSTS = ['general', 'general visit', 'none', 'n/a', 'na', 'delivery', 'courier', 'maintenance', 'facility', ''];

const getUser = async () => {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    return user;
};

// POST: Check-in a visitor
export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ propertyId: string }> }
) {
    const { propertyId } = await params;
    const user = await getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    try {
        const body = await request.json();
        const name = String(body.name || '').trim();
        if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 });

        const { data: property, error: propError } = await supabaseAdmin
            .from('properties')
            .select('organization_id, code')
            .eq('id', propertyId)
            .single();

        if (propError || !property) {
            return NextResponse.json({ error: 'Property not found' }, { status: 404 });
        }

        const rawHost = String(body.whom_to_meet || '').trim().toLowerCase();
        const isGeneralOrNoHost = !body.host_id && GENERAL_HOSTS.includes(rawHost);

        // A face-recognised (or just-enrolled) visitor: link the visit to their profile.
        let faceProfileId: string | null = null;
        if (body.face_profile_id) {
            const { data: profile } = await supabaseAdmin
                .from('vms_face_profiles')
                .select('id')
                .eq('id', body.face_profile_id)
                .eq('organization_id', property.organization_id)
                .maybeSingle();
            faceProfileId = profile?.id || null;
        }
        const score = Number(body.face_match_score);

        const insertPayload = {
            property_id: propertyId,
            organization_id: property.organization_id,
            category: CATEGORIES.includes(body.category) ? body.category : 'visitor',
            name,
            mobile: body.mobile || null,
            coming_from: body.coming_from || null,
            purpose: PURPOSES.includes(body.purpose) ? body.purpose : null,
            whom_to_meet: body.whom_to_meet || 'General Visit',
            host_id: body.host_id || null,
            created_by: user.id,
            status: 'checked_in',
            approval_status: isGeneralOrNoHost ? 'approved' : 'pending',
            approved_via: isGeneralOrNoHost ? 'auto' : null,
            face_profile_id: faceProfileId,
            face_match_score: faceProfileId && Number.isFinite(score) ? score : null,
        };

        // Visitor code: FV-<property code>-<5 digits>. Retry on the rare unique clash.
        const prefix = `FV-${property.code || 'PROP'}`;
        for (let attempt = 0; attempt < 3; attempt++) {
            const visitorCode = `${prefix}-${Math.floor(10000 + Math.random() * 90000)}`;
            const { data: visitor, error } = await supabaseAdmin
                .from(TABLE)
                .insert({ ...insertPayload, visitor_code: visitorCode })
                .select()
                .single();

            if (!error) {
                if (faceProfileId) {
                    // Keep the fixed details current and restart the 12-month retention clock.
                    await supabaseAdmin.from('vms_face_profiles').update({
                        name,
                        ...(insertPayload.mobile ? { mobile: insertPayload.mobile } : {}),
                        coming_from: insertPayload.coming_from,
                        last_seen_at: new Date().toISOString(),
                    }).eq('id', faceProfileId);
                }
                if (visitor.approval_status === 'pending') {
                    after(async () => {
                        const res = await startHostCall(visitor.id);
                        if (res.error) console.warn('[VMS Face] Host call:', res.status, res.error);
                    });
                }
                return NextResponse.json({
                    success: true,
                    visitor_id: visitorCode,
                    message: `Welcome ${name}! Your visit is logged.`,
                    visitor,
                }, { status: 201 });
            }
            if (error.code !== '23505') {
                console.error('[VMS Face] Check-in error:', error);
                return NextResponse.json({ error: error.message }, { status: 500 });
            }
        }
        return NextResponse.json({ error: 'Could not generate a visitor ID, please retry' }, { status: 500 });
    } catch (err) {
        console.error('[VMS Face] Check-in error:', err);
        return NextResponse.json({ error: 'Check-in failed' }, { status: 500 });
    }
}

// GET: List visitors for a property
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ propertyId: string }> }
) {
    const { propertyId } = await params;
    const user = await getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status'); // 'checked_in' | 'checked_out' | 'all'
    const date = searchParams.get('date'); // 'today' | 'yesterday' | 'week' | 'month' | YYYY-MM-DD | 'all'
    const search = (searchParams.get('search') || '').replace(/[,()%]/g, '').trim();

    // The dashboard refreshes every 30s; use that to catch host-call webhooks that never arrived.
    await refreshStaleCalls(propertyId);

    type DatePreset = 'today' | 'yesterday' | 'week' | 'month';
    // Postgrest builder types differ between select and count queries; both share these filter methods.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const applyCommonFilters = (q: any) => {
        let filteredQ = q.eq('property_id', propertyId);
        if (date && date !== 'all') {
            const isPreset = ['today', 'yesterday', 'week', 'month'].includes(date);
            const bounds = getISTDateBounds(isPreset ? date as DatePreset : 'custom', isPreset ? undefined : date);
            filteredQ = filteredQ.gte('checkin_time', bounds.start).lte('checkin_time', bounds.end);
        }
        if (search) {
            filteredQ = filteredQ.or(`visitor_code.ilike.%${search}%,name.ilike.%${search}%,mobile.ilike.%${search}%`);
        }
        return filteredQ;
    };

    let listQuery = applyCommonFilters(
        supabaseAdmin.from(TABLE).select('*').order('checkin_time', { ascending: false })
    );
    if (status && status !== 'all') listQuery = listQuery.eq('status', status);

    const { data, error } = await listQuery.limit(100);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const rows: Array<Record<string, unknown> & { created_by?: string | null; visitor_code: string }> = data || [];
    const creatorIds = Array.from(new Set(rows.map(v => v.created_by).filter(Boolean)));
    if (creatorIds.length > 0) {
        const { data: creatorUsers } = await supabaseAdmin
            .from('users')
            .select('id, full_name, email')
            .in('id', creatorIds);
        const creatorMap = new Map((creatorUsers || []).map(u => [u.id, u]));
        rows.forEach(v => { v.creator = creatorMap.get(v.created_by) || null; });
    }

    const countQuery = () => supabaseAdmin.from(TABLE).select('*', { count: 'exact', head: true });
    const [{ count: totalCount }, { count: checkedInCount }, { count: checkedOutCount }] = await Promise.all([
        applyCommonFilters(countQuery()),
        applyCommonFilters(countQuery()).eq('status', 'checked_in').eq('approval_status', 'approved'),
        applyCommonFilters(countQuery()).eq('status', 'checked_out'),
    ]);

    return NextResponse.json({
        // The copied UI reads visitor_id as the display ID.
        visitors: rows.map(v => ({ ...v, visitor_id: v.visitor_code })),
        stats: {
            total_today: totalCount || 0,
            checked_in: checkedInCount || 0,
            checked_out: checkedOutCount || 0,
        },
    });
}

// PATCH: Check-out a visitor (by row id or visitor code) or set approval status
export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ propertyId: string }> }
) {
    const { propertyId } = await params;
    const user = await getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json();
    const ref = String(body.visitor_id || body.id || '').trim();
    if (!ref) return NextResponse.json({ error: 'Visitor ID is required' }, { status: 400 });

    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ref);
    const { data: visitor, error: findError } = await supabaseAdmin
        .from(TABLE)
        .select('*')
        .eq('property_id', propertyId)
        .eq(isUuid ? 'id' : 'visitor_code', ref)
        .maybeSingle();

    if (findError || !visitor) {
        return NextResponse.json({ error: findError?.message || 'Visitor not found' }, { status: 404 });
    }

    if (body.action === 'approval') {
        if (!['approved', 'rejected', 'pending'].includes(body.approval_status)) {
            return NextResponse.json({ error: 'Invalid approval status' }, { status: 400 });
        }
        const { data: updated, error } = await supabaseAdmin
            .from(TABLE)
            .update({ approval_status: body.approval_status, approved_via: body.approval_status === 'pending' ? null : 'reception' })
            .eq('id', visitor.id)
            .select()
            .single();
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        return NextResponse.json({ success: true, message: `Visitor entry ${body.approval_status}.`, visitor: updated });
    }

    // Reception asks to ring the host again (only while the visit is still pending).
    if (body.action === 'call_host') {
        if (visitor.status !== 'checked_in' || visitor.approval_status !== 'pending') {
            return NextResponse.json({ error: 'Only a pending visit can call the host' }, { status: 400 });
        }
        await supabaseAdmin.from(TABLE).update({ host_call_attempts: 0, host_call_status: 'not_started' }).eq('id', visitor.id);
        const res = await startHostCall(visitor.id);
        if (res.status !== 'calling') return NextResponse.json({ error: res.error || `Call ${res.status}` }, { status: 409 });
        return NextResponse.json({ success: true, message: 'Calling the host…' });
    }

    if (visitor.status === 'checked_out') {
        return NextResponse.json({ error: 'Visitor already checked out' }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
        .from(TABLE)
        .update({ checkout_time: new Date().toISOString(), status: 'checked_out' })
        .eq('id', visitor.id)
        .select()
        .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({
        success: true,
        message: `Goodbye ${visitor.name}! Your visit has been logged.`,
        visitor: data,
    });
}
