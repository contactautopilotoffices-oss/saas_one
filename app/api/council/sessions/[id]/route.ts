import { NextRequest, NextResponse } from 'next/server';
import { requireMasterAdmin, isCouncilAccessError } from '@/backend/lib/council/guard';

/**
 * GET /api/council/sessions/[id] — one session with its full transcript
 * (opinions, reviews, synthesis) and its findings.
 */
export const dynamic = 'force-dynamic';

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const access = await requireMasterAdmin();
    if (isCouncilAccessError(access)) return access;

    const { id } = await params;
    const { adminClient } = access;

    const { data: session, error } = await adminClient
        .from('council_sessions')
        .select('*')
        .eq('id', id)
        .maybeSingle();

    if (error) {
        console.error('[council/sessions/id]', error.message);
        return NextResponse.json({ error: 'Could not load session', details: error.message }, { status: 500 });
    }
    if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 });

    const [messagesRes, findingsRes] = await Promise.all([
        adminClient
            .from('council_messages')
            .select('id, agent_key, stage, label, content, findings, model, created_at')
            .eq('session_id', id)
            .order('created_at', { ascending: true }),
        adminClient
            .from('council_findings')
            .select('id, agent_key, severity, title, detail, evidence, recommendation, status, created_at')
            .eq('session_id', id)
            .order('created_at', { ascending: true }),
    ]);

    if (messagesRes.error) {
        console.error('[council/sessions/id] messages', messagesRes.error.message);
        return NextResponse.json({ error: 'Could not load messages', details: messagesRes.error.message }, { status: 500 });
    }
    if (findingsRes.error) {
        console.error('[council/sessions/id] findings', findingsRes.error.message);
        return NextResponse.json({ error: 'Could not load findings', details: findingsRes.error.message }, { status: 500 });
    }

    return NextResponse.json({
        session,
        messages: messagesRes.data || [],
        findings: findingsRes.data || [],
    });
}
