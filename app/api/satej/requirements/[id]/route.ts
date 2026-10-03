/**
 * One Satej requirement.
 *   GET  ?organizationId=              → requirement, vendors, calls and the copyable summary
 *   GET  ?organizationId=&format=csv   → the exact CSV Bolna receives
 *   POST { organizationId, action, answers?, changes?, vendorId? }
 *        → answer | edit | exclude_vendor | approve_calls | resend_whatsapp | reanalyze | again | retry | cancel
 */

import { after, NextRequest, NextResponse } from 'next/server';
import { requireSatejCaller } from '@/backend/lib/satej/access';
import {
    addVendors,
    advance,
    analyseRehearsal,
    answerClarification,
    approveCalls,
    buildCallCsv,
    cancelRequirement,
    editRequirement,
    excludeVendor,
    reanalyze,
    resendSummary,
    refreshRehearsals,
    retryFailed,
    runAgain,
    startRehearsal,
} from '@/backend/lib/satej/pipeline';
import { getRepo } from '@/backend/lib/satej/repo';
import { fullSummary } from '@/backend/lib/satej/summary';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string }> };

/** The requirement, only if it belongs to the caller's organisation. A code (REQ-…) works as well as an id. */
async function load(id: string, organizationId: string) {
    const repo = getRepo();
    const r = /^REQ-/i.test(id) ? await repo.getRequirementByCode(id) : await repo.getRequirement(id);
    return r && r.organizationId === organizationId ? r : null;
}

export async function GET(request: NextRequest, ctx: Ctx) {
    const { id } = await ctx.params;
    const organizationId = request.nextUrl.searchParams.get('organizationId');
    const caller = await requireSatejCaller(organizationId);
    if (caller instanceof NextResponse) return caller;
    try {
        const r = await load(id, organizationId!);
        if (!r) return NextResponse.json({ error: 'Requirement not found' }, { status: 404 });
        const repo = getRepo();
        await refreshRehearsals(r);
        const [vendors, calls] = await Promise.all([repo.listVendors(r.id), repo.listCalls(r.id)]);

        if (request.nextUrl.searchParams.get('format') === 'csv') {
            if (!r.brief) return NextResponse.json({ error: 'No brief yet, so no call list' }, { status: 409 });
            return new NextResponse(buildCallCsv(r, vendors.filter((v) => v.status !== 'excluded')), {
                headers: { 'Content-Type': 'text/csv', 'Content-Disposition': `attachment; filename="${r.code}-vendors.csv"` },
            });
        }
        return NextResponse.json({ requirement: r, vendors, calls, summaryText: r.ranking ? fullSummary(r) : null });
    } catch (e) {
        console.error('[satej] detail failed', e);
        return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not load the requirement' }, { status: 500 });
    }
}

export async function POST(request: NextRequest, ctx: Ctx) {
    const { id } = await ctx.params;
    const body = (await request.json().catch(() => ({}))) as {
        organizationId?: string; action?: string; answers?: unknown; changes?: Record<string, unknown>; vendorId?: string;
        vendors?: unknown; phone?: string; asVendor?: string; callId?: string;
    };
    const caller = await requireSatejCaller(body.organizationId);
    if (caller instanceof NextResponse) return caller;

    let r;
    try {
        r = await load(id, body.organizationId!);
    } catch (e) {
        return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not load the requirement' }, { status: 500 });
    }
    if (!r) return NextResponse.json({ error: 'Requirement not found' }, { status: 404 });

    try {
        switch (body.action) {
            case 'answer': {
                const answers = Array.isArray(body.answers) ? body.answers.map(String) : [];
                if (!answers.some((a) => a.trim())) return NextResponse.json({ error: 'Type at least one answer' }, { status: 400 });
                await answerClarification(r, answers);
                break;
            }
            case 'edit': {
                const { newRound } = await editRequirement(r, body.changes ?? {}, caller.name);
                after(() => advance(r.id, { trigger: 'manual' }).then(() => undefined));
                return NextResponse.json({ ok: true, newRound });
            }
            case 'add_vendors': {
                const list = Array.isArray(body.vendors) ? (body.vendors as { name?: string; phone?: string; area?: string }[]) : [];
                if (!list.length) return NextResponse.json({ error: 'No vendors in the request' }, { status: 400 });
                return NextResponse.json({ ok: true, ...(await addVendors(r, list, caller.name)) });
            }
            case 'rehearse':
                return NextResponse.json({ ok: true, call: await startRehearsal(r, String(body.phone ?? ''), String(body.asVendor ?? ''), caller.name) });
            case 'analyze_rehearsal':
                return NextResponse.json({ ok: true, call: await analyseRehearsal(r, String(body.callId ?? '')) });
            case 'exclude_vendor':
                await excludeVendor(r, String(body.vendorId ?? ''), caller.name);
                return NextResponse.json({ ok: true });
            case 'approve_calls':
                await approveCalls(r, caller.name);
                break;
            case 'resend_whatsapp':
                await resendSummary(r);
                break;
            case 'reanalyze':
                await reanalyze(r);
                break;
            case 'again':
                await runAgain(r);
                break;
            case 'retry':
                await retryFailed(r);
                break;
            case 'cancel':
                await cancelRequirement(r);
                return NextResponse.json({ ok: true });
            default:
                return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
        }
    } catch (e) {
        return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
    }
    after(() => advance(r.id, { trigger: 'manual' }).then(() => undefined));
    return NextResponse.json({ ok: true });
}
