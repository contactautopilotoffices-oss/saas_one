import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { CATALOG } from '@/backend/lib/aiLayer';
import { interpret } from '@/backend/lib/aiLayer/interpret';
import { TEACHABLE_SPECIAL, runExampleTests, selectExamples, validateExample, type Example } from '@/backend/lib/aiLayer/learning';
import { brainInterpretLlm, clearLearningCache, loadSettings } from '@/backend/lib/aiLayer/server';
import { requireOrgSuperAdmin } from '../_lib/auth';

export const runtime = 'nodejs';
export const maxDuration = 120;

const missing = (e: { code?: string } | null) => !!e && ['42P01', 'PGRST205'].includes(e.code ?? '');

/** Everything the "Learning" section shows: flagged messages, taught examples, instruction versions. Org super admin only. */
export async function GET(request: NextRequest) {
    const organizationId = request.nextUrl.searchParams.get('organizationId') || '';
    const auth = await requireOrgSuperAdmin(organizationId);
    if (auth.error) return auth.error;
    const [review, examples, versions] = await Promise.all([
        supabaseAdmin.from('ai_review_items').select('id, created_at, user_id, channel, message_text, follow_up_text, bot_reply, entry_id, triggers')
            .eq('organization_id', organizationId).eq('status', 'open').gt('expires_at', new Date().toISOString()).order('created_at', { ascending: false }).limit(50),
        supabaseAdmin.from('ai_examples').select('id, created_at, message_text, entry_id, fields').eq('organization_id', organizationId).order('created_at', { ascending: false }).limit(200),
        supabaseAdmin.from('ai_prompt_versions').select('id, created_at, instructions, status, pass_rate, tested_count, tested_at, activated_at')
            .eq('organization_id', organizationId).order('created_at', { ascending: false }).limit(20),
    ]);
    if (missing(review.error) || missing(examples.error) || missing(versions.error)) return NextResponse.json({ tableMissing: true, review: [], examples: [], versions: [], entries: [] });
    for (const r of [review, examples, versions]) if (r.error) return NextResponse.json({ error: "Couldn't load learning data" }, { status: 500 });
    const ids = [...new Set(((review.data || []) as Array<{ user_id: string | null }>).map(r => r.user_id).filter((x): x is string => !!x))];
    const names = new Map<string, string>();
    if (ids.length) {
        const u = await supabaseAdmin.from('users').select('id, full_name').in('id', ids);
        for (const row of (u.data || []) as Array<{ id: string; full_name: string | null }>) names.set(row.id, row.full_name || 'Unknown');
    }
    return NextResponse.json({
        tableMissing: false,
        review: ((review.data || []) as Array<Record<string, unknown> & { user_id: string | null }>).map(r => ({ ...r, user_name: r.user_id ? names.get(r.user_id) ?? 'Unknown' : null })),
        examples: examples.data || [],
        versions: versions.data || [],
        entries: [
            ...CATALOG.map(e => ({ id: e.id, kind: e.kind, label: e.abilities.en })),
            { id: 'tasks', kind: 'special', label: 'about tasks (send to Task Manager)' },
            { id: 'none', kind: 'special', label: 'nothing (the AI should say it can\'t help)' },
        ],
    }, { headers: { 'Cache-Control': 'private, no-store' } });
}

const entryId = z.string().min(1).max(64);
const fields = z.record(z.string(), z.unknown()).default({});
const body = z.discriminatedUnion('action', [
    z.object({ action: z.literal('teach'), organizationId: z.string().uuid(), reviewId: z.string().uuid(), entryId, fields }).strict(),
    z.object({ action: z.literal('ignore'), organizationId: z.string().uuid(), reviewId: z.string().uuid() }).strict(),
    z.object({ action: z.literal('add_example'), organizationId: z.string().uuid(), message: z.string().trim().min(1).max(600), entryId, fields }).strict(),
    z.object({ action: z.literal('delete_example'), organizationId: z.string().uuid(), id: z.string().uuid() }).strict(),
    z.object({ action: z.literal('save_version'), organizationId: z.string().uuid(), instructions: z.string().trim().min(1).max(4000) }).strict(),
    z.object({ action: z.literal('test_version'), organizationId: z.string().uuid(), id: z.string().uuid() }).strict(),
    z.object({ action: z.literal('activate_version'), organizationId: z.string().uuid(), id: z.string().uuid() }).strict(),
    z.object({ action: z.literal('deactivate_versions'), organizationId: z.string().uuid() }).strict(),
]);

export async function POST(request: NextRequest) {
    const raw = await request.json().catch(() => null) as { organizationId?: unknown } | null;
    const auth = await requireOrgSuperAdmin(typeof raw?.organizationId === 'string' ? raw.organizationId : '');
    if (auth.error) return auth.error;
    const parsed = body.safeParse(raw);
    if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    const b = parsed.data;
    const org = b.organizationId;
    const fail = (error: string, status = 400) => NextResponse.json({ error }, { status });

    try {
        switch (b.action) {
            case 'teach':
            case 'add_example': {
                // L7: a taught answer must name a real question / action with valid details (unknown keys are rejected).
                const v = validateExample(b.entryId, b.fields);
                if (!v.ok) return fail(v.error);
                let message = b.action === 'add_example' ? b.message : '';
                if (b.action === 'teach') {
                    const item = await supabaseAdmin.from('ai_review_items').select('message_text').eq('id', b.reviewId).eq('organization_id', org).maybeSingle();
                    if (item.error || !item.data) return fail('That flagged message was not found', 404);
                    message = String(item.data.message_text);
                }
                const ins = await supabaseAdmin.from('ai_examples').insert({ organization_id: org, message_text: message, entry_id: b.entryId, fields: v.fields,
                    source_review_id: b.action === 'teach' ? b.reviewId : null, created_by: auth.user.id }).select('id').single();
                if (ins.error) throw new Error(ins.error.message);
                if (b.action === 'teach') {
                    await supabaseAdmin.from('ai_review_items').update({ status: 'taught', resolved_by: auth.user.id, resolved_at: new Date().toISOString(),
                        expires_at: new Date(Date.now() + 365 * 86400_000).toISOString() }).eq('id', b.reviewId).eq('organization_id', org);
                }
                clearLearningCache(org);
                return NextResponse.json({ ok: true, id: ins.data.id });
            }
            case 'ignore': {
                const r = await supabaseAdmin.from('ai_review_items').update({ status: 'ignored', resolved_by: auth.user.id, resolved_at: new Date().toISOString() })
                    .eq('id', b.reviewId).eq('organization_id', org);
                if (r.error) throw new Error(r.error.message);
                return NextResponse.json({ ok: true });
            }
            case 'delete_example': {
                const r = await supabaseAdmin.from('ai_examples').delete().eq('id', b.id).eq('organization_id', org);
                if (r.error) throw new Error(r.error.message);
                clearLearningCache(org);
                return NextResponse.json({ ok: true });
            }
            case 'save_version': {
                const r = await supabaseAdmin.from('ai_prompt_versions').insert({ organization_id: org, instructions: b.instructions, created_by: auth.user.id }).select('id').single();
                if (r.error) throw new Error(r.error.message);
                return NextResponse.json({ ok: true, id: r.data.id });
            }
            case 'test_version': {
                const version = await supabaseAdmin.from('ai_prompt_versions').select('instructions').eq('id', b.id).eq('organization_id', org).maybeSingle();
                if (version.error || !version.data) return fail('Version not found', 404);
                const report = await testWith(org, String(version.data.instructions));
                const u = await supabaseAdmin.from('ai_prompt_versions').update({ pass_rate: report.passRate, tested_count: report.total, tested_at: new Date().toISOString() })
                    .eq('id', b.id).eq('organization_id', org);
                if (u.error) throw new Error(u.error.message);
                return NextResponse.json({ ok: true, report });
            }
            case 'activate_version': {
                const [cand, live] = await Promise.all([
                    supabaseAdmin.from('ai_prompt_versions').select('id, pass_rate, tested_at, status').eq('id', b.id).eq('organization_id', org).maybeSingle(),
                    supabaseAdmin.from('ai_prompt_versions').select('id, pass_rate').eq('organization_id', org).eq('status', 'active').maybeSingle(),
                ]);
                if (cand.error || !cand.data) return fail('Version not found', 404);
                if (!cand.data.tested_at) return fail('Test this version first: it goes live only after a test run.');
                const livePass = Number(live.data?.pass_rate ?? 0);
                if (live.data && Number(cand.data.pass_rate ?? 0) < livePass)
                    return fail(`This version scored ${pct(cand.data.pass_rate)}, below the live version (${pct(livePass)}). Improve it and test again.`);
                if (live.data) {
                    const r = await supabaseAdmin.from('ai_prompt_versions').update({ status: 'retired' }).eq('id', live.data.id).eq('organization_id', org);
                    if (r.error) throw new Error(r.error.message);
                }
                const r = await supabaseAdmin.from('ai_prompt_versions').update({ status: 'active', activated_at: new Date().toISOString() }).eq('id', b.id).eq('organization_id', org);
                if (r.error) throw new Error(r.error.message);
                clearLearningCache(org);
                return NextResponse.json({ ok: true });
            }
            case 'deactivate_versions': {
                const r = await supabaseAdmin.from('ai_prompt_versions').update({ status: 'retired' }).eq('organization_id', org).eq('status', 'active');
                if (r.error) throw new Error(r.error.message);
                clearLearningCache(org);
                return NextResponse.json({ ok: true });
            }
        }
    } catch (err) {
        console.error('[AiLayer] learning action failed', b.action, err instanceof Error ? err.message : err);
        return fail("Couldn't complete that", 500);
    }
}

const pct = (x: unknown) => `${Math.round(Number(x ?? 0) * 100)}%`;

/** Run this org's taught examples against the AI with the given instructions (each tested with the OTHER examples). */
async function testWith(orgId: string, instructions: string | null) {
    const [ex, props, { settings }] = await Promise.all([
        supabaseAdmin.from('ai_examples').select('message_text, entry_id, fields').eq('organization_id', orgId).order('created_at', { ascending: false }).limit(200),
        supabaseAdmin.from('properties').select('id, name, is_active, deleted_at').eq('organization_id', orgId),
        loadSettings(supabaseAdmin, orgId),
    ]);
    if (ex.error) throw new Error(ex.error.message);
    const examples: Example[] = ((ex.data || []) as Array<{ message_text: string; entry_id: string; fields: Record<string, unknown> | null }>)
        .map(r => ({ messageText: r.message_text, entryId: r.entry_id, fields: r.fields ?? {} }));
    const propertyList = ((props.data || []) as Array<{ id: string; name: string | null; is_active: boolean | null; deleted_at: string | null }>)
        .filter(p => p.is_active !== false && !p.deleted_at)
        .map(p => (p.name || 'Property').replace(/[\s,;.:-]+$/, '') + (settings.aliases[p.id]?.length ? ` (${settings.aliases[p.id].join(', ')})` : ''));
    const llm = brainInterpretLlm();
    const ids = [...CATALOG.map(e => e.id), ...TEACHABLE_SPECIAL];
    return runExampleTests(examples, async (message, others) => {
        const r = await interpret(llm, message, CATALOG, propertyList, null, { examples: selectExamples(message, others, ids), instructions });
        return 'fields' in r.value ? { entry: r.value.entry, fields: r.value.fields } : { entry: r.value.entry };
    });
}
