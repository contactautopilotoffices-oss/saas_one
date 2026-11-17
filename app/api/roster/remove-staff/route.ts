import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/frontend/utils/supabase/admin';
import { guardProperty } from '@/backend/lib/auth/callerAccess';

export async function DELETE(request: NextRequest) {
    try {
        const url = new URL(request.url);
        const propertyId = url.searchParams.get('propertyId');
        const staffUserId = url.searchParams.get('userId');

        if (!propertyId || !staffUserId) {
            return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 });
        }

        // Verify caller has internal access to this property
        const denied = await guardProperty(request, propertyId);
        if (denied) return denied;

        const adminClient = createAdminClient();

        // Hide staff from roster view without revoking property access (is_active remains true)
        const { error } = await adminClient
            .from('property_memberships')
            .update({ hide_from_roster: true })
            .eq('user_id', staffUserId)
            .eq('property_id', propertyId);

        if (error) {
            console.error('[DELETE /api/roster/remove-staff] Update error:', error);
            return NextResponse.json({ error: 'Failed to remove staff from roster' }, { status: 500 });
        }

        // Audit log (best effort)
        try {
            await adminClient.from('user_management_audit_logs').insert({
                action: 'remove_staff',
                target_user_id: staffUserId,
                details: { propertyId }
            });
        } catch (auditErr) {
            console.warn('[DELETE /api/roster/remove-staff] Audit log error:', auditErr);
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('[DELETE /api/roster/remove-staff] API error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
