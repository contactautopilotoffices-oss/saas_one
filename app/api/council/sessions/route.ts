import { NextRequest, NextResponse } from 'next/server';
import { requireMasterAdmin, isCouncilAccessError, resolveCouncilOrgId } from '@/backend/lib/council/guard';
import { gatherDataPack } from '@/backend/lib/council/dataPack';
import { runCouncil, loadAgents, createSupabaseCouncilStore } from '@/backend/lib/council/runner';
import { DEFAULT_QUESTION } from '@/backend/lib/council/personas';

/**
 * POST /api/council/sessions {question?}
 * Creates a session and runs the full 3-stage council inline (MVP — Groq is
 * fast enough; per docs/COUNCIL_SPEC.md the completed session is returned).
 *
 * GET /api/council/sessions
 * Recent sessions, newest first.
 */
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
    const access = await requireMasterAdmin();
    if (isCouncilAccessError(access)) return access;

    let body: { question?: string; org_id?: string; organization_id?: string; orgId?: string } = {};
    try {
        body = await request.json();
    } catch {
        // empty body is fine — question is optional
    }

    const orgId = await resolveCouncilOrgId(access, request, body);
    const question = (body.question || '').trim() || DEFAULT_QUESTION;
    const { adminClient } = access;

    // 1. Create the session row.
    const { data: session, error: insertErr } = await adminClient
        .from('council_sessions')
        .insert({
            org_id: orgId,
            question,
            trigger: 'manual',
            status: 'running',
            created_by: access.user.id,
        })
        .select()
        .single();

    if (insertErr) {
        console.error('[council/sessions] insert', insertErr.message);
        return NextResponse.json({
            error: 'Could not create council session',
            details: insertErr.message,
            hint: 'If this mentions a missing relation, apply supabase/migrations/20260803000001_agent_council.sql',
        }, { status: 500 });
    }

    // 2. Gather the real org data pack and pin it to the session.
    const dataPack = await gatherDataPack(orgId);
    await adminClient
        .from('council_sessions')
        .update({ data_pack: dataPack })
        .eq('id', session.id);

    // 3. Run the council (status transitions + persistence live in the runner).
    const agents = await loadAgents(orgId);
    try {
        const result = await runCouncil({
            sessionId: session.id,
            orgId,
            question,
            agents,
            dataPack,
            store: createSupabaseCouncilStore(),
        });

        const { data: completed } = await adminClient
            .from('council_sessions')
            .select('*')
            .eq('id', session.id)
            .single();

        return NextResponse.json({
            session: completed,
            synthesis: result.synthesis,
            findings_count: result.findingsCount,
            agents_run: result.opinions.length,
            agents_failed: result.failedAgents,
        });
    } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        console.error('[council/sessions] run failed:', message);
        return NextResponse.json({
            error: 'Council run failed',
            details: message,
            session_id: session.id,
        }, { status: 500 });
    }
}

export async function GET(request: NextRequest) {
    const access = await requireMasterAdmin();
    if (isCouncilAccessError(access)) return access;

    const orgId = await resolveCouncilOrgId(access, request);
    const { data, error } = await access.adminClient
        .from('council_sessions')
        .select('id, question, trigger, status, error, created_at, completed_at')
        .eq('org_id', orgId)
        .order('created_at', { ascending: false })
        .limit(20);

    if (error) {
        console.error('[council/sessions] list', error.message);
        return NextResponse.json({ error: 'Could not load sessions', details: error.message }, { status: 500 });
    }
    return NextResponse.json({ org_id: orgId, sessions: data || [] });
}
