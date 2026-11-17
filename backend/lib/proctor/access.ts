import { NextRequest, NextResponse } from 'next/server';
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

/** The secret the signed-out taker's page sends on every call after start. */
export function readAttemptToken(request: NextRequest, body?: { attempt_token?: unknown }): string | null {
    const header = request.headers.get('x-attempt-token');
    if (header && header.trim()) return header.trim();
    return typeof body?.attempt_token === 'string' && body.attempt_token.trim() ? body.attempt_token.trim() : null;
}

/**
 * The caller's own attempt plus its test, for the routes the locked page calls
 * while a test is running. Two ways to prove it is theirs, because a test can
 * be taken from a public link with no account:
 *   · the signed-in user owns the attempt, or
 *   · the caller holds the attempt_token issued when the attempt started.
 * Returns an error response otherwise.
 */
export async function loadOwnAttempt(attemptId: string, attemptToken?: string | null) {
    const { data: attempt } = await supabaseAdmin
        .from('proctor_attempts')
        .select('id, test_id, user_id, status, started_at, attempt_no, attempt_token, candidate_name, candidate_email, question_order, answers, test:proctor_tests(id, organization_id, questions, duration_minutes, ai_monitoring, max_attempts, look_away_strikes)')
        .eq('id', attemptId)
        .maybeSingle();
    if (!attempt) return { error: NextResponse.json({ error: 'Attempt not found' }, { status: 404 }) };

    const tokenMatches = !!attemptToken && attemptToken === attempt.attempt_token;
    if (!tokenMatches) {
        // Fall back to the session: a signed-in taker's own attempt.
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user || !attempt.user_id || attempt.user_id !== user.id) {
            return { error: NextResponse.json({ error: 'Attempt not found' }, { status: 404 }) };
        }
    }

    const test = (Array.isArray(attempt.test) ? attempt.test[0] : attempt.test) as {
        id: string; organization_id: string; questions: ProctorQuestion[]; duration_minutes: number;
        ai_monitoring: boolean; max_attempts: number; look_away_strikes: number;
    };
    return { attempt, test };
}

export interface ProctorSection {
    key: string;
    title: string;
    description?: string;
}

export interface ProctorQuestion {
    id: string;
    section?: string;
    text: string;
    options: string[];
    /** The correct option; for a multiple-answer question, the first of answer_indexes. */
    answer_index: number;
    /** "Select all that apply": scored all or nothing against answer_indexes. */
    multi?: boolean;
    answer_indexes?: number[];
}

/** A stored answer: one option index, or for a multiple-answer question, the set picked. */
export type ProctorAnswer = number | number[];

/** The correct options of a question, as a sorted list. */
export function correctOptions(q: ProctorQuestion): number[] {
    return q.multi && Array.isArray(q.answer_indexes) && q.answer_indexes.length
        ? [...q.answer_indexes].sort((a, b) => a - b)
        : [q.answer_index];
}

/** All or nothing: right only when exactly the correct options were picked. */
export function isCorrectAnswer(q: ProctorQuestion, given: ProctorAnswer | undefined) {
    if (given === undefined) return false;
    const picked = (Array.isArray(given) ? [...given] : [given]).sort((a, b) => a - b);
    const correct = correctOptions(q);
    return picked.length === correct.length && picked.every((v, i) => v === correct[i]);
}

/** What the test taker is allowed to see — the answer key stripped out. */
export function stripAnswers(questions: ProctorQuestion[]) {
    return (questions || []).map(({ id, section, text, options, multi }) => ({ id, section: section || 'general', text, options, multi: !!multi }));
}

/** Grace on top of the test duration for network lag before an attempt counts as expired. */
export const EXPIRY_GRACE_MS = 60_000;

/**
 * The sections of a test, in order, as the taker and the reviewer see them:
 * what the author saved, limited to sections that actually have questions, with
 * anything the author never described falling back to the standard labels.
 */
export function resolveSections(
    stored: unknown,
    questions: ProctorQuestion[],
): Array<ProctorSection & { question_count: number }> {
    const used = [...new Set((questions || []).map((q) => q.section || 'general'))];
    const saved = (Array.isArray(stored) ? stored : []) as ProctorSection[];
    const ordered = [
        ...saved.filter((s) => used.includes(s.key)),
        ...used.filter((k) => !saved.some((s) => s.key === k)).map((key): ProctorSection => ({ key, title: '' })),
    ];
    return ordered.map((s) => ({
        key: s.key,
        title: s.title || SECTION_FALLBACK_TITLES[s.key] || 'Questions',
        description: s.description || '',
        question_count: (questions || []).filter((q) => (q.section || 'general') === s.key).length,
    }));
}

/** Labels for the built-in sections, used when an author didn't title one. */
const SECTION_FALLBACK_TITLES: Record<string, string> = {
    cognitive: 'Cognitive ability',
    aptitude: 'Aptitude',
    culture: 'Workplace culture',
    situational: 'Situational judgement',
    general: 'General',
};

/** Private bucket holding flagged webcam frames, read back through signed URLs. */
export const EVIDENCE_BUCKET = 'proctor-evidence';

/** An attempt that finished the test (on time or late) — no further chances after this. */
export const COMPLETED_STATUSES = ['submitted', 'expired'];

export function isPastDeadline(startedAt: string, durationMinutes: number) {
    return Date.now() > new Date(startedAt).getTime() + durationMinutes * 60_000 + EXPIRY_GRACE_MS;
}
