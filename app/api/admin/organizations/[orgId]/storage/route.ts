import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { resolveCaller, isCallerError, forbidden, isOrgAdmin } from '@/backend/lib/auth/callerAccess';

/**
 * GET /api/admin/organizations/[orgId]/storage
 * 
 * Get storage breakdown by property
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

    // Get properties for storage calculation
    const { data: properties, error } = await supabaseAdmin
        .from('properties')
        .select('id, name')
        .eq('organization_id', orgId);

    if (error) {
        console.error('Storage fetch error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Placeholder - storage is 0 for now
    const formattedProperties = (properties || []).map((prop) => ({
        id: prop.id,
        name: prop.name,
        storage_gb: 0
    }));

    return NextResponse.json({
        total_gb: 0,
        properties: formattedProperties
    });
}
