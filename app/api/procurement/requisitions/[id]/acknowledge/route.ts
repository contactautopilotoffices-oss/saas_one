import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/frontend/utils/supabase/admin';

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params;
        const body = await request.json();
        const { user_id } = body;

        if (!id || !user_id) {
            return NextResponse.json({ error: 'Missing required parameters: id and user_id' }, { status: 400 });
        }

        const adminSupabase = createAdminClient();

        const { data, error } = await adminSupabase
            .from('property_monthly_requisitions')
            .update({
                status: 'acknowledged',
                acknowledged_by: user_id,
                acknowledged_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            })
            .eq('id', id)
            .select(`
                *,
                property:properties!property_id(id, name),
                uploader:users!uploaded_by(id, full_name, email),
                acknowledger:users!acknowledged_by(id, full_name, email)
            `)
            .single();

        if (error) {
            console.error('[Requisition Acknowledge Error]:', error);
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        return NextResponse.json({ success: true, requisition: data });
    } catch (err: any) {
        console.error('[Requisition Acknowledge Server Error]:', err);
        return NextResponse.json({ error: 'Internal server error', details: err.message }, { status: 500 });
    }
}
