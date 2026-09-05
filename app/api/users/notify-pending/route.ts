import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { NotificationService } from '@/backend/services/NotificationService';

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { userId, propertyId, organizationId, requestedRole } = body;

        const supabase = await createClient();
        const { data: { user: currentUser } } = await supabase.auth.getUser();

        // Security check: target user must be the caller themselves or caller must be admin
        const targetUserId = userId || currentUser?.id;
        if (!targetUserId) {
            return NextResponse.json({ error: 'Unauthorized. No user specified.' }, { status: 401 });
        }

        await NotificationService.afterUserRegisteredPendingApproval({
            userId: targetUserId,
            propertyId,
            organizationId,
            requestedRole: requestedRole || 'member'
        });

        return NextResponse.json({ success: true, message: 'Notification dispatched' });
    } catch (error: any) {
        console.error('[Notify Pending API] Error:', error);
        return NextResponse.json({ error: error.message || 'Failed to dispatch notification' }, { status: 500 });
    }
}
