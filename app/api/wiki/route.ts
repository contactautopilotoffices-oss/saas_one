/**
 * ORG WIKI — reading pages. SUPER ADMINS ONLY.
 *
 * GET ?org_id=                       status: page counts by kind, last compiled, recent questions
 * GET ?org_id=&slug=                 one page
 * GET ?org_id=&kind=vendor           every page of one kind (title order)
 * GET ?org_id=&q=bvg                 search, top 20
 * POST ?org_id= { action: 'note', question, answer, cited }   file an answer back as a note page
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { requireWikiAccess, isWikiAccessError } from '@/backend/lib/wiki/access';
import { fileNote, isMissingTable, WIKI_NOT_PROVISIONED } from '@/backend/lib/wiki/store';

export const dynamic = 'force-dynamic';

const KINDS = ['overview', 'flags', 'vendor', 'site', 'item', 'month', 'mail', 'dev', 'note'] as const;

export async function GET(request: NextRequest) {
    const access = await requireWikiAccess(request);
    if (isWikiAccessError(access)) return access;
    const { orgId } = access;
    const sp = new URL(request.url).searchParams;

    const slug = sp.get('slug');
    if (slug) {
        const { data, error } = await supabaseAdmin.from('wiki_pages')
            .select('slug, kind, title, summary, body_md, links, sources, origin, compiled_at')
            .eq('organization_id', orgId).eq('slug', slug).maybeSingle();
        if (isMissingTable(error)) return NextResponse.json({ provisioned: false, note: WIKI_NOT_PROVISIONED });
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        if (!data) return NextResponse.json({ error: 'No such page.' }, { status: 404 });
        const { data: backlinks } = await supabaseAdmin.from('wiki_pages')
            .select('slug, title, kind').eq('organization_id', orgId).contains('links', [slug]).limit(40);
        return NextResponse.json({ page: data, backlinks: backlinks ?? [] });
    }

    const q = sp.get('q')?.trim();
    if (q) {
        const { data, error } = await supabaseAdmin.rpc('wiki_search', { p_org: orgId, p_query: q.slice(0, 200), p_limit: 20 });
        if (isMissingTable(error)) return NextResponse.json({ provisioned: false, note: WIKI_NOT_PROVISIONED });
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        return NextResponse.json({ results: data ?? [] });
    }

    const kind = sp.get('kind');
    if (kind) {
        if (!(KINDS as readonly string[]).includes(kind)) return NextResponse.json({ error: 'Unknown kind.' }, { status: 400 });
        const { data, error } = await supabaseAdmin.from('wiki_pages')
            .select('slug, kind, title, summary').eq('organization_id', orgId).eq('kind', kind)
            .order(kind === 'month' || kind === 'mail' || kind === 'dev' || kind === 'note' ? 'slug' : 'title', { ascending: !['month', 'mail', 'dev', 'note'].includes(kind) })
            .limit(1000);
        if (isMissingTable(error)) return NextResponse.json({ provisioned: false, note: WIKI_NOT_PROVISIONED });
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        return NextResponse.json({ pages: data ?? [] });
    }

    const counts = await Promise.all(KINDS.map(async (k) => {
        const { count, error } = await supabaseAdmin.from('wiki_pages')
            .select('id', { count: 'exact', head: true }).eq('organization_id', orgId).eq('kind', k);
        return { k, count: count ?? 0, error };
    }));
    if (counts.some((c) => isMissingTable(c.error))) {
        return NextResponse.json({ provisioned: false, note: WIKI_NOT_PROVISIONED });
    }
    const [{ data: overview }, { data: questions }] = await Promise.all([
        supabaseAdmin.from('wiki_pages').select('compiled_at').eq('organization_id', orgId).eq('slug', 'overview').maybeSingle(),
        supabaseAdmin.from('wiki_questions').select('id, question, status, cited, created_at')
            .eq('organization_id', orgId).order('created_at', { ascending: false }).limit(10),
    ]);
    return NextResponse.json({
        provisioned: true,
        compiled_at: overview?.compiled_at ?? null,
        counts: Object.fromEntries(counts.map((c) => [c.k, c.count])),
        recent_questions: questions ?? [],
    });
}

export async function POST(request: NextRequest) {
    const body = await request.json().catch(() => null);
    const access = await requireWikiAccess(request, body);
    if (isWikiAccessError(access)) return access;
    if (body?.action !== 'note') return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
    if (typeof body.question !== 'string' || typeof body.answer !== 'string') {
        return NextResponse.json({ error: 'question and answer are required.' }, { status: 400 });
    }
    try {
        const note = await fileNote({
            orgId: access.orgId, userId: access.userId, question: body.question, answer: body.answer,
            cited: Array.isArray(body.cited) ? body.cited.filter((s: unknown): s is string => typeof s === 'string') : [],
        });
        return NextResponse.json(note);
    } catch (e) {
        return NextResponse.json({ error: e instanceof Error ? e.message : 'Filing failed.' }, { status: 500 });
    }
}
