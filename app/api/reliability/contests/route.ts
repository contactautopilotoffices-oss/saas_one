import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { isMissingRelation } from '@/backend/lib/aop/access';

/**
 * Contesting a reliability strike (SPEC-ELECTRICITY.md REQ-E-06, condition 2).
 *
 *   GET   /api/reliability/contests            — mine, or the org's open queue for reviewers
 *   POST  /api/reliability/contests            — the employee contests one strike
 *   PATCH /api/reliability/contests            — a super admin upholds or overturns it
 *
 * WHY THIS ROUTE IS NOT UNDER /api/electricity
 * The strike is written by the electricity chase today, but a reliability record that
 * follows a person is not an electricity concept, and the appeal path must not be
 * discoverable only to people with electricity access. The subject of a strike may be an
 * MST with no tracker permission at all — they must still be able to reach their own case.
 *
 * THE ASYMMETRY THAT MATTERS
 * Anyone may contest their OWN strike (no role needed). Only a super admin may decide one,
 * and never their own — checked server-side below.
 */

export const dynamic = 'force-dynamic';

async function currentUser(): Promise<{ id: string; email?: string } | null> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    return user ? { id: user.id, email: user.email ?? undefined } : null;
}

async function isOrgSuperAdmin(userId: string, organizationId: string): Promise<boolean> {
    const { data: profile } = await supabaseAdmin
        .from('users').select('is_master_admin').eq('id', userId).maybeSingle();
    if (profile?.is_master_admin) return true;

    const { data } = await supabaseAdmin
        .from('organization_memberships')
        .select('role')
        .eq('user_id', userId)
        .eq('organization_id', organizationId);

    return (data || []).some(m => ['org_super_admin', 'ops_super_admin'].includes(m.role || ''));
}

export async function GET(request: NextRequest) {
    const user = await currentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const scope = request.nextUrl.searchParams.get('scope') || 'mine';
    const orgId = request.nextUrl.searchParams.get('org_id');

    try {
        let query = supabaseAdmin
            .from('employee_reliability_contests')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(200);

        if (scope === 'queue') {
            if (!orgId) return NextResponse.json({ error: 'org_id required for the review queue' }, { status: 400 });
            if (!(await isOrgSuperAdmin(user.id, orgId))) {
                return NextResponse.json({ error: 'Forbidden: only super admins review contests' }, { status: 403 });
            }
            query = query.eq('organization_id', orgId).eq('status', 'open');
        } else {
            query = query.eq('user_id', user.id);
        }

        const { data, error } = await query;
        if (error) {
            if (isMissingRelation(error)) return NextResponse.json({ provisioned: false, contests: [] });
            throw new Error(error.message);
        }
        return NextResponse.json({ provisioned: true, contests: data || [] });
    } catch (e) {
        const message = e instanceof Error ? e.message : 'Could not load contests';
        console.error('[api/reliability/contests GET]', message);
        return NextResponse.json({ error: message }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    const user = await currentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json().catch(() => ({} as Record<string, unknown>));
    const eventId = body.event_id as string;
    const reason = String(body.reason || '').trim();

    if (!eventId) return NextResponse.json({ error: 'event_id is required' }, { status: 400 });
    if (reason.length < 10) {
        return NextResponse.json({ error: 'Please describe what happened (at least 10 characters)' }, { status: 400 });
    }

    try {
        const { data: event, error: evErr } = await supabaseAdmin
            .from('employee_reliability_events')
            .select('id, organization_id, user_id, kind, is_overturned')
            .eq('id', eventId)
            .maybeSingle();

        if (evErr) {
            if (isMissingRelation(evErr)) {
                return NextResponse.json({ error: 'Reliability tables are not provisioned yet' }, { status: 503 });
            }
            throw new Error(evErr.message);
        }
        if (!event) return NextResponse.json({ error: 'No such reliability event' }, { status: 404 });

        // The subject, and only the subject, opens a contest. A manager contesting on
        // someone's behalf would put words in their mouth in a record about their conduct.
        if (event.user_id !== user.id) {
            return NextResponse.json({ error: 'Forbidden: you can only contest your own record' }, { status: 403 });
        }
        if (event.is_overturned) {
            return NextResponse.json({ error: 'This strike has already been overturned' }, { status: 409 });
        }

        const { data, error } = await supabaseAdmin
            .from('employee_reliability_contests')
            .insert({
                organization_id: event.organization_id,
                event_id: event.id,
                user_id: user.id,
                reason,
                attachments: Array.isArray(body.attachments) ? body.attachments : [],
            })
            .select('*')
            .single();

        if (error) {
            if (error.code === '23505') {
                return NextResponse.json({ error: 'You have already contested this strike' }, { status: 409 });
            }
            throw new Error(error.message);
        }

        // Tell the reviewers there is something waiting. Best-effort: a notification
        // failure must not swallow the contest itself.
        await notifyReviewers(event.organization_id, user.id).catch(e =>
            console.error('[api/reliability/contests] reviewer notify failed:', e?.message));

        return NextResponse.json({ contest: data });
    } catch (e) {
        const message = e instanceof Error ? e.message : 'Could not file the contest';
        console.error('[api/reliability/contests POST]', message);
        return NextResponse.json({ error: message }, { status: 500 });
    }
}

export async function PATCH(request: NextRequest) {
    const user = await currentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json().catch(() => ({} as Record<string, unknown>));
    const contestId = body.contest_id as string;
    const decision = body.status as string;

    if (!contestId || !['upheld', 'overturned'].includes(decision)) {
        return NextResponse.json({ error: 'contest_id and status (upheld|overturned) are required' }, { status: 400 });
    }

    try {
        const { data: contest, error: cErr } = await supabaseAdmin
            .from('employee_reliability_contests')
            .select('id, organization_id, user_id, event_id, status')
            .eq('id', contestId)
            .maybeSingle();

        if (cErr) {
            if (isMissingRelation(cErr)) {
                return NextResponse.json({ error: 'Reliability tables are not provisioned yet' }, { status: 503 });
            }
            throw new Error(cErr.message);
        }
        if (!contest) return NextResponse.json({ error: 'No such contest' }, { status: 404 });
        if (contest.status !== 'open') {
            return NextResponse.json({ error: `This contest is already ${contest.status}` }, { status: 409 });
        }
        if (!(await isOrgSuperAdmin(user.id, contest.organization_id))) {
            return NextResponse.json({ error: 'Forbidden: only super admins decide contests' }, { status: 403 });
        }
        // Nobody clears their own strike, whatever role they hold.
        if (contest.user_id === user.id) {
            return NextResponse.json({ error: 'You cannot decide a contest about your own record' }, { status: 403 });
        }

        const { error: upErr } = await supabaseAdmin
            .from('employee_reliability_contests')
            .update({
                status: decision,
                reviewed_by: user.id,
                reviewed_at: new Date().toISOString(),
                resolution_note: (body.resolution_note as string) || null,
            })
            .eq('id', contestId);
        if (upErr) throw new Error(upErr.message);

        // Overturning marks the event rather than deleting it: the contest and its outcome
        // are part of the person's record, and employee_reliability_scores excludes
        // overturned events from both the score and the strike count.
        if (decision === 'overturned') {
            const { error: evErr } = await supabaseAdmin
                .from('employee_reliability_events')
                .update({ is_overturned: true, overturned_at: new Date().toISOString() })
                .eq('id', contest.event_id);
            if (evErr) console.error('[api/reliability/contests] overturn flag failed:', evErr.message);
        }

        await notifySubject(contest.organization_id, contest.user_id, decision).catch(e =>
            console.error('[api/reliability/contests] subject notify failed:', e?.message));

        return NextResponse.json({ ok: true, status: decision });
    } catch (e) {
        const message = e instanceof Error ? e.message : 'Could not decide the contest';
        console.error('[api/reliability/contests PATCH]', message);
        return NextResponse.json({ error: message }, { status: 500 });
    }
}

async function notifyReviewers(organizationId: string, subjectId: string) {
    const { data: admins } = await supabaseAdmin
        .from('organization_memberships')
        .select('user_id, role')
        .eq('organization_id', organizationId)
        .in('role', ['org_super_admin', 'ops_super_admin']);

    const recipients = (admins || []).map(a => a.user_id).filter(id => id && id !== subjectId);
    if (recipients.length === 0) return;

    await supabaseAdmin.from('notifications').insert(recipients.map(recipient_id => ({
        recipient_id,
        organization_id: organizationId,
        title: 'Reliability strike contested',
        message: 'An employee has contested a reliability strike and is waiting on a decision.',
        type: 'reliability_contest',
    })));
}

async function notifySubject(organizationId: string, userId: string, decision: string) {
    await supabaseAdmin.from('notifications').insert({
        recipient_id: userId,
        organization_id: organizationId,
        title: decision === 'overturned' ? 'Your strike was removed' : 'Your contest was reviewed',
        message: decision === 'overturned'
            ? 'The strike you contested has been overturned and no longer counts against your reliability score.'
            : 'The strike you contested has been reviewed and upheld. The reviewer left a note on your record.',
        type: 'reliability_contest',
    });
}
