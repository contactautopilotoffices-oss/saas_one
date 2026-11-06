import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { TaskManagerAuth } from './adminGuard';
import { isMeetingSpace, spacesForMemberships, type MeetingSpace } from '@/task-manager/meetings/visibility';

/**
 * Owner 2026-10-29: the Meeting Assistant's access check. The request says which dashboard it comes from
 * (`?space=`, one of MEETING_SPACES); the signed-in person must hold a role for THAT space (task-manager/meetings/visibility.ts).
 * Roles come from the person's active memberships, never from the request. Fails closed: no login 401, unknown space 400,
 * wrong role 403.
 */
export type MeetingGuardResult =
    | { ok: true; userId: string; space: MeetingSpace }
    | { ok: false; response: NextResponse };

const deny = (status: number, error: string): MeetingGuardResult => ({ ok: false, response: NextResponse.json({ success: false, error }, { status }) });

export async function requireMeetingSpace(request: NextRequest): Promise<MeetingGuardResult> {
    const user = await TaskManagerAuth.currentUser();
    if (!user) return deny(401, 'Unauthorized');
    const space = request.nextUrl.searchParams.get('space') || 'tech';
    if (!isMeetingSpace(space)) return deny(400, 'Unknown Meeting Assistant space');

    const [orgRes, propRes] = await Promise.all([
        supabaseAdmin.from('organization_memberships').select('role').eq('user_id', user.id).eq('is_active', true),
        supabaseAdmin.from('property_memberships').select('role').eq('user_id', user.id).eq('is_active', true),
    ]);
    const roleList = (rows: unknown[] | null) => (rows ?? []).map(r => (r as { role: string | null }).role);
    // Organisation roles only (the same source as the Tech check), except HR and Procurement roles, which may also be property roles.
    const allowed = spacesForMemberships(roleList(orgRes.data), roleList(propRes.data));
    if (!allowed.has(space)) return deny(403, 'Forbidden: the Meeting Assistant here is not available for your role');
    return { ok: true, userId: user.id, space };
}
