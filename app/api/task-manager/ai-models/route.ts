import { NextRequest, NextResponse } from 'next/server';
import { requireControlCentre } from '../_shared/adminGuard';
import { AI_MODELS, AI_JOBS, MAX_CHAIN, isAiJob, modelStatus } from '@/task-manager/ai/aiCatalog';
import { aiModelsOverview, keyReady, saveChain, testModel } from '@/task-manager/ai/AiModelSettings';
import { inventoryWithStatus } from '@/task-manager/ai/aiInventory';

export const dynamic = 'force-dynamic';

/**
 * Owner 2026-10-28 — Control Center → "AI models" (Tech team only, like every Control Center action).
 *   GET  ?orgId=   each Task Manager job with today's / saved / effective models, every model with its status for each job,
 *                  which API keys are set (names only), and the read-only list of every AI model in the project.
 *   POST ?orgId=   { action: 'save', job, models: string[] | null }   (null = back to today's models)
 *                  { action: 'test', job, model }                     (one tiny request)
 * No API key value is ever returned.
 */
export async function GET(request: NextRequest) {
    try {
        const guard = await requireControlCentre(request.nextUrl.searchParams.get('orgId') || '');
        if (!guard.ok) return guard.response;
        const overview = await aiModelsOverview();
        const ready = (p: Parameters<typeof keyReady>[0], j: Parameters<typeof keyReady>[1]) => keyReady(p, j);
        const models = AI_MODELS.map(m => ({
            ...m,
            status: Object.fromEntries(AI_JOBS.map(j => [j.key, modelStatus(j.key, m.id, ready)])),
        }));
        return NextResponse.json({ success: true, ...overview, models, maxChain: MAX_CHAIN, inventory: inventoryWithStatus() });
    } catch (err) {
        console.error('[AiModelsAPI] GET error:', err);
        return NextResponse.json({ success: false, error: 'Could not load the AI model settings' }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        const guard = await requireControlCentre(request.nextUrl.searchParams.get('orgId') || '');
        if (!guard.ok) return guard.response;
        const body = (await request.json().catch(() => null)) ?? {};
        if (!isAiJob(body.job)) return NextResponse.json({ success: false, error: 'Unknown job' }, { status: 400 });

        if (body.action === 'save') {
            const models = body.models === null ? null : Array.isArray(body.models) ? body.models.filter((m: unknown): m is string => typeof m === 'string') : undefined;
            if (models === undefined) return NextResponse.json({ success: false, error: 'Send models as a list, or null to reset' }, { status: 400 });
            try {
                const { warnings } = await saveChain(body.job, models, guard.label);
                return NextResponse.json({ success: true, message: models === null ? "Back to today's models." : 'Saved. It takes effect within a minute.', warnings });
            } catch (err) {
                return NextResponse.json({ success: false, error: err instanceof Error ? err.message : 'Could not save' }, { status: 400 });
            }
        }
        if (body.action === 'test') {
            if (typeof body.model !== 'string') return NextResponse.json({ success: false, error: 'Missing model' }, { status: 400 });
            return NextResponse.json({ success: true, result: await testModel(body.job, body.model) });
        }
        return NextResponse.json({ success: false, error: 'Unknown action' }, { status: 400 });
    } catch (err) {
        console.error('[AiModelsAPI] POST error:', err);
        return NextResponse.json({ success: false, error: 'Something went wrong' }, { status: 500 });
    }
}
