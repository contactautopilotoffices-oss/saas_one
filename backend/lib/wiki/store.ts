/**
 * ORG WIKI — saving compiled pages, rebuilding, and filing notes back.
 *
 * A rebuild upserts every compiled page with one shared `compiled_at`, then deletes
 * the compiled pages that run did not produce (a vendor renamed, a month that no longer
 * has POs). Filed notes (origin = 'filed') are never touched by a rebuild.
 */

import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { withAgentRun } from '@/backend/lib/agents/instrument';
import type { AgentRunTrigger } from '@/frontend/types/agentRuntime';
import { buildWiki, loadWikiSources, slugify, cell, type WikiPage } from './compile';

export const WIKI_AGENT_KEY = 'wiki';

export const isMissingTable = (e: { code?: string; message?: string } | null) =>
    Boolean(e && (e.code === '42P01' || e.code === 'PGRST205' || e.code === 'PGRST202' || /does not exist/i.test(e.message ?? '')));

export const WIKI_NOT_PROVISIONED = 'The wiki is not set up yet. Apply supabase/migrations/20261016000001_org_wiki.sql.';

export interface RebuildResult {
    pages: number;
    byKind: Record<string, number>;
    pruned: number;
    compiledAt: string;
    journal: boolean;
    ms: number;
}

async function savePages(orgId: string, pages: WikiPage[], compiledAt: string): Promise<number> {
    const rows = pages.map((p) => ({ organization_id: orgId, origin: 'compiled', compiled_at: compiledAt, ...p }));
    for (let i = 0; i < rows.length; i += 200) {
        const { error } = await supabaseAdmin.from('wiki_pages')
            .upsert(rows.slice(i, i + 200), { onConflict: 'organization_id,slug' });
        if (error) throw new Error(isMissingTable(error) ? WIKI_NOT_PROVISIONED : `Saving wiki pages failed: ${error.message}`);
    }
    const { count, error } = await supabaseAdmin.from('wiki_pages')
        .delete({ count: 'exact' })
        .eq('organization_id', orgId).eq('origin', 'compiled').lt('compiled_at', compiledAt);
    if (error) throw new Error(`Pruning old wiki pages failed: ${error.message}`);
    return count ?? 0;
}

/** Recompile every page for one org. No model call, so no tokens are reported. */
export async function rebuildWiki(orgId: string, trigger: AgentRunTrigger): Promise<RebuildResult> {
    const result = await withAgentRun<RebuildResult>(
        { orgId, agentKey: WIKI_AGENT_KEY, module: 'procurement', trigger },
        async (step) => {
            const t0 = Date.now();
            const compiledAt = new Date().toISOString();

            const load = await step('Loading POs, line items, mail and journal', 'fetch');
            const src = await loadWikiSources(supabaseAdmin, orgId);
            await load.ok({ detail: { pos: src.pos.length, lines: src.lines.length, threads: src.threads.length, journal: Boolean(src.journal) } });

            const build = await step('Compiling pages', 'think');
            const pages = buildWiki(src);
            const byKind: Record<string, number> = {};
            for (const p of pages) byKind[p.kind] = (byKind[p.kind] ?? 0) + 1;
            await build.ok({ detail: byKind });

            const save = await step('Saving pages', 'write');
            const pruned = await savePages(orgId, pages, compiledAt);
            await save.ok({ detail: { saved: pages.length, pruned } });

            const r: RebuildResult = { pages: pages.length, byKind, pruned, compiledAt, journal: Boolean(src.journal), ms: Date.now() - t0 };
            return {
                outcome: `Compiled ${pages.length} pages (${byKind.vendor ?? 0} vendors, ${byKind.item ?? 0} items, ${byKind.site ?? 0} sites); pruned ${pruned}.`
                    + (src.journal ? '' : ' Journal not found on this server.'),
                result: r,
            };
        },
    );
    if (!result) throw new Error('Wiki rebuild returned no result.');
    return result;
}

/** File a good answer back into the wiki as a note page, so the next question can find it. */
export async function fileNote(opts: {
    orgId: string; userId: string; question: string; answer: string; cited: string[];
}): Promise<{ slug: string }> {
    const question = cell(opts.question, 200);
    const answer = opts.answer.trim().slice(0, 8000);
    if (question.length < 3 || answer.length < 3) throw new Error('A note needs a question and an answer.');
    const date = new Date().toISOString().slice(0, 10);
    const base = `note/${date}-${slugify(question, 50)}`;
    let slug = base;
    for (let n = 2; n < 50; n++) {
        const { data } = await supabaseAdmin.from('wiki_pages').select('id').eq('organization_id', opts.orgId).eq('slug', slug).maybeSingle();
        if (!data) break;
        slug = `${base}-${n}`;
    }
    const cited = [...new Set(opts.cited)].filter((s) => /^[a-z0-9/-]+$/.test(s)).slice(0, 20);
    const body = [
        `# ${question}`,
        `Note filed ${date} from a question asked of the wiki. The figures are as of that day; follow the sources for current values.`,
        '## Answer',
        answer.replace(/\[\[([^\]|]+)\]\]/g, (_m, s: string) => `[[${s}|${s}]]`),
        cited.length ? `## Sources\n\n${cited.map((s) => `- [[${s}|${s}]]`).join('\n')}` : '',
    ].filter(Boolean).join('\n\n');
    const { error } = await supabaseAdmin.from('wiki_pages').insert({
        organization_id: opts.orgId, slug, kind: 'note', origin: 'filed', filed_by: opts.userId,
        title: question, summary: cell(answer, 240), body_md: body, links: cited,
        sources: [{ table: 'wiki_questions', rows: 1 }],
    });
    if (error) throw new Error(isMissingTable(error) ? WIKI_NOT_PROVISIONED : `Filing the note failed: ${error.message}`);
    return { slug };
}
