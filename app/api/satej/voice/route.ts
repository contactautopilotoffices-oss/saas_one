/**
 * Meera's caller script in the Meera console.
 *   GET  ?organizationId=                     → live script, greeting preview, versions, last 7 days of calls
 *   POST { organizationId, action:'suggest', welcome, prompt, feedback, transcripts? } → a revision to review
 *   POST { organizationId, action:'publish', welcome, prompt, note? }                 → push to Bolna (admins)
 */

import { NextRequest, NextResponse } from 'next/server';
import { canPublishVoiceScript, requireSatejCaller } from '@/backend/lib/satej/access';
import { getVoiceScript, listVoiceCalls } from '@/backend/lib/satej/clients/bolna';
import { satejConfig } from '@/backend/lib/satej/config';
import { getRepo } from '@/backend/lib/satej/repo';
import { CALL_VARIABLES } from '@/backend/lib/satej/prompts/voiceAgent';
import { listVersions, previewGreeting, publishScript, suggestRevision, validateScript } from '@/backend/lib/satej/voiceScript';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(request: NextRequest) {
    const organizationId = request.nextUrl.searchParams.get('organizationId');
    const caller = await requireSatejCaller(organizationId);
    if (caller instanceof NextResponse) return caller;
    const agentId = satejConfig.bolnaAgentId;
    if (!agentId) return NextResponse.json({ error: 'SATEJ_BOLNA_AGENT_ID is not set on this server' }, { status: 503 });
    try {
        const repo = getRepo();
        const [script, calls, versions, canPublish, reqs] = await Promise.all([
            getVoiceScript(agentId),
            listVoiceCalls(agentId, 30).catch(() => null),
            listVersions(organizationId!),
            canPublishVoiceScript(caller.userId, organizationId!),
            repo.listRequirements(organizationId!, 20).catch(() => []),
        ]);
        const sample = reqs.find((r) => r.brief);
        const preview = sample ? previewGreeting(script.welcome, sample, await repo.listVendors(sample.id)) : null;
        return NextResponse.json({
            script,
            problems: validateScript(script.welcome, script.prompt),
            variables: CALL_VARIABLES.slice(1),
            preview: preview && { ...preview, requirement: sample!.code, title: sample!.input.title },
            calls,
            versions: versions.versions,
            versionsTableMissing: versions.tableMissing,
            canPublish,
        });
    } catch (e) {
        console.error('[satej voice] read failed', e);
        return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not read the caller script' }, { status: 502 });
    }
}

export async function POST(request: NextRequest) {
    const body = (await request.json().catch(() => ({}))) as {
        organizationId?: string; action?: string; welcome?: string; prompt?: string; feedback?: string; note?: string; transcripts?: unknown;
    };
    const caller = await requireSatejCaller(body.organizationId);
    if (caller instanceof NextResponse) return caller;
    const welcome = String(body.welcome ?? '');
    const prompt = String(body.prompt ?? '');
    try {
        if (body.action === 'suggest') {
            const feedback = String(body.feedback ?? '').trim();
            if (feedback.length < 5) return NextResponse.json({ error: 'Write what should change' }, { status: 400 });
            const transcripts = Array.isArray(body.transcripts) ? body.transcripts.map(String).slice(0, 3) : [];
            return NextResponse.json({ suggestion: await suggestRevision({ welcome, prompt, feedback, transcripts }) });
        }
        if (body.action === 'publish') {
            if (!(await canPublishVoiceScript(caller.userId, body.organizationId!))) {
                return NextResponse.json({ error: 'Only org super admins and master admins can publish Meera\'s script. Share the draft with one of them.' }, { status: 403 });
            }
            const script = await publishScript(body.organizationId!, { welcome, prompt, note: body.note }, { id: caller.userId, name: caller.name });
            return NextResponse.json({ script });
        }
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    } catch (e) {
        console.error('[satej voice] action failed', e);
        return NextResponse.json({ error: e instanceof Error ? e.message : 'The action failed' }, { status: 400 });
    }
}
