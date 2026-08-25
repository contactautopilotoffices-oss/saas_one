import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';

/**
 * GET /api/voice/logs?organizationId=...
 * Fetches recent AI voice call logs.
 */
export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const organizationId = searchParams.get('organizationId');

        let query = supabaseAdmin
            .from('omnichannel_call_logs')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(20);

        if (organizationId) {
            query = query.eq('organization_id', organizationId);
        }

        const { data: logs, error } = await query;
        if (error) throw error;

        return NextResponse.json({ success: true, logs: logs || [] });
    } catch (err: any) {
        console.error('[Voice Logs API] Error:', err);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
