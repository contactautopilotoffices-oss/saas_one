import { NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';

/**
 * Proctored tests access — service-role, enforced in the API layer (same
 * pattern as assets / petty cash).
 *
 *   - Take a test:              any active member whose role is not tenant-like.
 *   - Write tests, see results: org admins, property admins, HR (same HR roles
 *     the HR module treats as admins).
 */

const TENANT_LIKE_ROLES = ['tenant', 'tenant_user', 'super_tenant', 'vendor'];
const AUTHOR_ROLES = [
    'org_super_admin', 'org_admin', 'master_admin', 'ops_super_admin', 'owner',
    'property_admin', 'hr', 'hr_head', 'hr_manager', 'director',
];

export interface ProctorAccess {
    userId: string;
    organizationId: string;
    /** may create tests and see everyone's results */
    canAuthor: boolean;
}

export async function resolveProctorAccess(requestedOrgId?: string | null): Promise<ProctorAccess | NextResponse> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const [profileRes, propRes, orgRes] = await Promise.all([
        supabaseAdmin.from('users').select('is_master_admin').eq('id', user.id).maybeSingle(),
        supabaseAdmin.from('property_memberships').select('organization_id, role').eq('user_id', user.id).eq('is_active', true),
        supabaseAdmin.from('organization_memberships').select('organization_id, role').eq('user_id', user.id).eq('is_active', true),
    ]);
    const isMasterAdmin = !!profileRes.data?.is_master_admin;

    const memberships = [...(propRes.data || []), ...(orgRes.data || [])]
        .filter((m) => m.organization_id && m.role && !TENANT_LIKE_ROLES.includes(m.role));
    const orgIds = [...new Set(memberships.map((m) => m.organization_id as string))];

    let organizationId = requestedOrgId || null;
    if (organizationId) {
        if (!isMasterAdmin && !orgIds.includes(organizationId))
            return NextResponse.json({ error: 'Forbidden: no access to this organization' }, { status: 403 });
    } else if (orgIds.length === 1) {
        organizationId = orgIds[0];
    } else if (orgIds.length > 1 || isMasterAdmin) {
        return NextResponse.json({ error: 'organization_id is required' }, { status: 400 });
    } else {
        return NextResponse.json({ error: 'Forbidden: tests are not available for this account' }, { status: 403 });
    }

    const roles = memberships.filter((m) => m.organization_id === organizationId).map((m) => m.role as string);
    const canAuthor = isMasterAdmin || roles.some((r) => AUTHOR_ROLES.includes(r));

    return { userId: user.id, organizationId, canAuthor };
}

export function isProctorAccessError(x: ProctorAccess | NextResponse): x is NextResponse {
    return x instanceof NextResponse;
}

/**
 * The caller's own attempt plus its test, for the routes the locked page calls
 * while a test is running. Returns an error response if it isn't theirs.
 */
export async function loadOwnAttempt(attemptId: string) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };

    const { data: attempt } = await supabaseAdmin
        .from('proctor_attempts')
        .select('id, test_id, user_id, status, started_at, attempt_no, test:proctor_tests(id, questions, duration_minutes, ai_monitoring, max_attempts)')
        .eq('id', attemptId)
        .maybeSingle();
    if (!attempt || attempt.user_id !== user.id) {
        return { error: NextResponse.json({ error: 'Attempt not found' }, { status: 404 }) };
    }
    const test = (Array.isArray(attempt.test) ? attempt.test[0] : attempt.test) as {
        id: string; questions: ProctorQuestion[]; duration_minutes: number; ai_monitoring: boolean; max_attempts: number;
    };
    return { attempt, test };
}

export interface ProctorQuestion {
    id: string;
    section?: string;
    text: string;
    options: string[];
    answer_index: number;
}

/** What the test taker is allowed to see — the answer key stripped out. */
export function stripAnswers(questions: ProctorQuestion[]) {
    return (questions || []).map(({ id, section, text, options }) => ({ id, section: section || 'general', text, options }));
}

/** Grace on top of the test duration for network lag before an attempt counts as expired. */
export const EXPIRY_GRACE_MS = 60_000;

/** An attempt that finished the test (on time or late) — no further chances after this. */
export const COMPLETED_STATUSES = ['submitted', 'expired'];

export function isPastDeadline(startedAt: string, durationMinutes: number) {
    return Date.now() > new Date(startedAt).getTime() + durationMinutes * 60_000 + EXPIRY_GRACE_MS;
}
