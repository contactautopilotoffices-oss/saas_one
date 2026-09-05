/**
 * POST /api/agents/optimize?orgId=<uuid>   body { description }
 *
 * Raw operator sentence in, structured agent brief out — grounded in this FMS's
 * real modules and tables, and shaped to the prompt rules in
 * docs/AGENT_DOCTRINE.md L12 [BAA pp.105, 114].
 *
 * Separate from /compose (which builds a whole agent) and /plan (which builds a
 * workflow) because it does one small thing to ONE field: it rewrites the text
 * the operator is still editing. Nothing is saved.
 *
 * AUTH — signed-in session, same gate as every /api/agents/* route.
 * NO SCHEMA DEPENDENCY — the module list and table catalog are code constants, so
 * this works on an unprovisioned database.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { optimizePrompt } from '@/backend/lib/agents/optimizePrompt';
import { AGENT_TABLE_CATALOG, AGENT_MODULE_DESCRIPTORS } from '@/app/api/agents/_shared';

/** One model round-trip. */
export const maxDuration = 60;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const orgId = new URL(request.url).searchParams.get('orgId');
        if (!orgId || !UUID_RE.test(orgId)) {
            return NextResponse.json({ error: 'orgId (uuid) required' }, { status: 400 });
        }

        const body = (await request.json().catch(() => ({}))) as { description?: string };
        const description = (body.description ?? '').trim();
        if (description.length < 12) {
            return NextResponse.json(
                { error: 'Write a sentence or two first — there is nothing to optimize yet.' },
                { status: 400 },
            );
        }

        const result = await optimizePrompt({
            description,
            modules: AGENT_MODULE_DESCRIPTORS.map((m) => ({
                key: m.key, label: m.label, description: m.description,
            })),
            tables: AGENT_TABLE_CATALOG.map((t) => ({
                name: t.name, domain: t.domain, purpose: t.purpose,
            })),
        });

        return NextResponse.json({ ok: true, ...result, original: description });
    } catch (e) {
        // A model outage is a 502 — the request itself was fine.
        const msg = (e as Error).message ?? 'optimize failed';
        const upstream = /model|json|envelope|timed out|\b4\d\d\b|\b5\d\d\b/i.test(msg);
        return NextResponse.json({ error: msg }, { status: upstream ? 502 : 500 });
    }
}
