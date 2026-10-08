import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';

/**
 * One place that answers "who is calling this Task Manager API, and are they allowed?".
 * Every route that can change settings, send a message, or read people's details goes through here.
 * The two I/O pieces live on `TaskManagerAuth` so tests can replace them.
 */

/** Same role set the /api/agents routes use for admin-level access. */
const ADMIN_ROLES = ['org_super_admin', 'master_admin', 'org_admin'];

export class TaskManagerAuth {
    /** The signed-in user from the login session (never from anything the browser sends). */
    static async currentUser(): Promise<{ id: string; email: string | null } | null> {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        return user ? { id: user.id, email: user.email ?? null } : null;
    }

    /**
     * True for a master admin, or someone holding an admin role.
     * With an orgId the role must be in THAT organisation; without one, an admin role in any organisation counts
     * (the Control Center does not pass an org, and this Task Manager serves a single company).
     */
    static async isAdmin(userId: string, orgId?: string): Promise<boolean> {
        const [profileRes, orgRes, propRes] = await Promise.all([
            supabaseAdmin.from('users').select('is_master_admin').eq('id', userId).maybeSingle(),
            supabaseAdmin.from('organization_memberships').select('organization_id, role').eq('user_id', userId).eq('is_active', true),
            supabaseAdmin.from('property_memberships').select('organization_id, role').eq('user_id', userId).eq('is_active', true),
        ]);
        if (profileRes.data?.is_master_admin) return true;
        const memberships = [...(orgRes.data ?? []), ...(propRes.data ?? [])] as { organization_id: string | null; role: string | null }[];
        return memberships.some(m => !!m.role && ADMIN_ROLES.includes(m.role) && (!orgId || m.organization_id === orgId));
    }
}

export type AdminGuardResult =
    | { ok: true; userId: string; label: string }
    | { ok: false; response: NextResponse };

const deny = (status: number, error: string): { ok: false; response: NextResponse } => ({
    ok: false,
    response: NextResponse.json({ success: false, error }, { status }),
});

/** Requires a signed-in organisation admin (or master admin). `label` names them in audit trails. */
export async function requireTaskManagerAdmin(orgId = ''): Promise<AdminGuardResult> {
    const user = await TaskManagerAuth.currentUser();
    if (!user) return deny(401, 'Unauthorized');
    if (!(await TaskManagerAuth.isAdmin(user.id, orgId || undefined))) return deny(403, 'Forbidden: organization admin access required');
    return { ok: true, userId: user.id, label: user.email || user.id };
}

/**
 * Requires a signed-in user and binds the request to THEM.
 * If the caller also claims to be someone (an `actorId`), the claim must match the login, so nobody can act as another person.
 */
export async function requireActor(claimedActorId?: string | null): Promise<AdminGuardResult> {
    const user = await TaskManagerAuth.currentUser();
    if (!user) return deny(401, 'Unauthorized');
    if (claimedActorId && claimedActorId !== user.id) return deny(403, 'Forbidden: you can only act as yourself');
    return { ok: true, userId: user.id, label: user.email || user.id };
}

/** For trigger endpoints: the scheduler's secret, or a signed-in admin. Nothing else (no actorId, no "confirm" flags). */
export async function requireCronOrAdmin(request: NextRequest): Promise<{ ok: true } | { ok: false; response: NextResponse }> {
    const secret = process.env.CRON_SECRET;
    if (secret) {
        const header = request.headers.get('authorization');
        const urlSecret = request.nextUrl.searchParams.get('secret');
        if (header === `Bearer ${secret}` || urlSecret === secret) return { ok: true };
    }
    const guard = await requireTaskManagerAdmin();
    return guard.ok ? { ok: true } : { ok: false, response: guard.response };
}
