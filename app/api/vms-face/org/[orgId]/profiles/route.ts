import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { getUser } from '@/backend/lib/vms-face/context';
import { deleteFaceProfile } from '@/backend/lib/vms-face/face';

/**
 * GET    /api/vms-face/org/[orgId]/profiles?search=   enrolled faces (fixed details only)
 * DELETE /api/vms-face/org/[orgId]/profiles?id=&reason=visitor_request|admin
 *        Permanently deletes the face from BioFRQ and our table; the deletion is logged.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ orgId: string }> }) {
    const { orgId } = await params;
    const user = await getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const search = (request.nextUrl.searchParams.get('search') || '').replace(/[,()%]/g, '').trim();
    let query = supabaseAdmin
        .from('vms_face_profiles')
        .select('id, name, mobile, coming_from, last_seen_at, created_at')
        .eq('organization_id', orgId)
        .order('last_seen_at', { ascending: false })
        .limit(100);
    if (search) query = query.or(`name.ilike.%${search}%,mobile.ilike.%${search}%`);

    const { data, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ profiles: data || [] });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ orgId: string }> }) {
    const { orgId } = await params;
    const user = await getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const id = request.nextUrl.searchParams.get('id');
    const reason = request.nextUrl.searchParams.get('reason') === 'visitor_request' ? 'visitor_request' : 'admin';
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

    const res = await deleteFaceProfile(id, orgId, reason, user.id);
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: 502 });
    return NextResponse.json({ success: true });
}
