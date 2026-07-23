import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';

/**
 * GET /api/audit/master?organization_id=...
 * Fetch the master audit items (the 35-point template).
 */
export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const orgId = searchParams.get('organization_id');

    if (!orgId) return NextResponse.json({ error: 'Org ID required' }, { status: 400 });

    const { data, error } = await supabaseAdmin
        .from('audit_master_items')
        .select('*')
        .eq('organization_id', orgId)
        .order('si_no', { ascending: true });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ items: data });
}

/**
 * POST /api/audit/master
 * Create or bulk-insert master audit items (used for Excel upload).
 */
export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { items } = body; // Array of master items

        if (!Array.isArray(items)) return NextResponse.json({ error: 'Items array required' }, { status: 400 });

        const { data, error } = await supabaseAdmin
            .from('audit_master_items')
            .upsert(items, { onConflict: 'id' })
            .select();

        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        return NextResponse.json({ items: data });
    } catch (err) {
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
