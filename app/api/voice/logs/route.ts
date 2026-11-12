import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { resolveCaller, isCallerError, isInternalOrgMember, forbidden } from '@/backend/lib/auth/callerAccess';

/**
 * GET /api/voice/logs?organizationId=...
 * Fetches recent AI voice call logs.
 */
export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const organizationId = searchParams.get('organizationId');
        // Call logs hold phone numbers and scripts: members of that organisation; all organisations only for a master admin.
        const caller = await resolveCaller(request);
        if (isCallerError(caller)) return caller;
        if (organizationId ? !(await isInternalOrgMember(caller, organizationId)) : !caller.isMasterAdmin) {
            return forbidden('Forbidden: no access to these call logs');
        }

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
