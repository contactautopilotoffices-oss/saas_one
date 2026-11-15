import { NextRequest, NextResponse } from 'next/server';
import { requireControlCentre } from '../../task-manager/_shared/adminGuard';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const NO_STORE = { 'Cache-Control': 'private, no-store' };

export const fail = (status: number, error: string) => NextResponse.json({ success: false, error }, { status, headers: NO_STORE });

/**
 * Who may open the Brain Console: someone signed in who holds the 'tech' role IN THIS organisation (the same check as
 * the Task Manager's Control Centre; super admins and master admins are not included). The organisation id is required
 * and must be a real id, so the role is always checked against the organisation whose data is about to be read.
 */
export async function consoleGuard(request: NextRequest): Promise<{ ok: true; orgId: string; userId: string } | { ok: false; response: NextResponse }> {
    const orgId = (request.nextUrl.searchParams.get('orgId') || '').trim();
    if (!UUID.test(orgId)) return { ok: false, response: fail(400, 'Missing organisation.') };
    const guard = await requireControlCentre(orgId);
    if (!guard.ok) return { ok: false, response: fail(guard.response.status, guard.response.status === 401 ? 'Please sign in.' : 'This console is for the Tech team only.') };
    return { ok: true, orgId, userId: guard.userId };
}
