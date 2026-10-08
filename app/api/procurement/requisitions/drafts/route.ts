import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { draftSchema } from '@/frontend/lib/requisitionDrafts';
import { z } from 'zod';

const scopeSchema = z.object({ organization_id: z.string().uuid(), property_id: z.string().uuid() });
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    const client = await createClient();
    const { data: { user } } = await client.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const scope = scopeSchema.extend({ user_id: z.string().uuid() }).safeParse(Object.fromEntries(request.nextUrl.searchParams));
    if (!scope.success) return NextResponse.json({ error: 'Select a property' }, { status: 400 });
    if (scope.data.user_id !== user.id) return NextResponse.json({ error: 'Your account changed. Reopen the form.' }, { status: 403 });
    const { data, error } = await client.from('monthly_requisition_drafts').select('payload,updated_at')
        .eq('user_id', user.id).eq('organization_id', scope.data.organization_id)
        .eq('property_id', scope.data.property_id).order('updated_at', { ascending: false });
    if (error) return NextResponse.json({ error: 'Could not load saved drafts' }, { status: 503 });
    return NextResponse.json({ drafts: data }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function PUT(request: NextRequest) {
    const client = await createClient();
    const { data: { user } } = await client.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const parsed = scopeSchema.extend({ payload: draftSchema, user_id: z.string().uuid(),
        expected_updated_at: z.string().datetime({ offset: true }).nullable() }).safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: 'Invalid draft data' }, { status: 400 });
    const { organization_id, property_id, payload, expected_updated_at, user_id } = parsed.data;
    if (user_id !== user.id) return NextResponse.json({ error: 'Your account changed. Reopen the form.' }, { status: 403 });
    const row = { user_id: user.id, organization_id, property_id, requisition_month: payload.month,
        requisition_year: payload.year, floor_tag: payload.floorTag, payload, updated_at: new Date().toISOString() };
    const query = expected_updated_at
        ? client.from('monthly_requisition_drafts').update(row).eq('user_id', user.id)
            .eq('organization_id', organization_id).eq('property_id', property_id)
            .eq('requisition_month', payload.month).eq('requisition_year', payload.year)
            .eq('floor_tag', payload.floorTag).eq('updated_at', expected_updated_at)
        : client.from('monthly_requisition_drafts').insert(row);
    const { data, error } = await query.select('payload,updated_at').maybeSingle();
    if (error?.code === '23505' || (!error && !data)) return NextResponse.json({ error: 'This draft changed in another session. Your edits are preserved in this browser; reopen to review the saved version.' }, { status: 409 });
    if (error) return NextResponse.json({ error: 'Could not save draft. Your edits remain in this browser.' }, { status: 503 });
    return NextResponse.json({ draft: data });
}

export async function DELETE(request: NextRequest) {
    const client = await createClient();
    const { data: { user } } = await client.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const scope = scopeSchema.extend({ user_id: z.string().uuid(), month: z.coerce.number().int().min(1).max(12),
        year: z.coerce.number().int().min(2000).max(2200), floor: z.string().min(1).max(100),
        expected_updated_at: z.string().datetime({ offset: true }) })
        .safeParse(Object.fromEntries(request.nextUrl.searchParams));
    if (!scope.success) return NextResponse.json({ error: 'Invalid draft scope' }, { status: 400 });
    const s = scope.data;
    if (s.user_id !== user.id) return NextResponse.json({ error: 'Your account changed. Reopen the form.' }, { status: 403 });
    const { error } = await client.from('monthly_requisition_drafts').delete().eq('user_id', user.id)
        .eq('organization_id', s.organization_id).eq('property_id', s.property_id)
        .eq('requisition_month', s.month).eq('requisition_year', s.year).eq('floor_tag', s.floor)
        .eq('updated_at', s.expected_updated_at);
    if (error) return NextResponse.json({ error: 'Draft cleanup failed' }, { status: 503 });
    return NextResponse.json({ success: true });
}
