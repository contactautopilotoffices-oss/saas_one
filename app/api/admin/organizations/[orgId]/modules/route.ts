import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { resolveCaller, isCallerError, forbidden, isOrgAdmin } from '@/backend/lib/auth/callerAccess';

/**
 * GET /api/admin/organizations/[orgId]/modules
 * 
 * Get module usage analytics
 * Uses service role - bypasses RLS
 */
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ orgId: string }> }
) {
    const { orgId } = await params;
    const caller = await resolveCaller(request);
    if (isCallerError(caller)) return caller;
    if (!isOrgAdmin(caller, orgId)) return forbidden('Forbidden: organisation admins only');

    // Return empty modules for now
    return NextResponse.json({
        modules: []
    });
}
