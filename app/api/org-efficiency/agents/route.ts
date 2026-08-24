import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { regenerateAndStorePrompt } from '@/backend/lib/oem/prompt';

/**
 * GET  /api/org-efficiency/agents?orgId=
 *      — registry + active bundle + recent council log per agent
 * POST /api/org-efficiency/agents
 *      body.action = 'register'          -> create/update an agent
 *      body.action = 'set_bundle'        -> new bundle version (deactivates old)
 *      body.action = 'regenerate_prompt' -> rebuild system prompt from goals+bundle
 */

export async function GET(request: NextRequest) {
    try {
        const supabase = await createClient();
        const { searchParams } = new URL(request.url);
        const orgId = searchParams.get('orgId');
        if (!orgId) return NextResponse.json({ error: 'orgId required' }, { status: 400 });

        const [agentsRes, bundlesRes, councilRes] = await Promise.all([
            supabase.from('oem_agents').select('*').eq('organization_id', orgId).order('agent_key'),
            supabase.from('oem_agent_bundles').select('*').eq('organization_id', orgId).eq('is_active', true),
            supabase.from('oem_council_log').select('*').eq('organization_id', orgId)
                .order('created_at', { ascending: false }).limit(50),
        ]);

        if (agentsRes.error) return NextResponse.json({ error: agentsRes.error.message }, { status: 500 });

        return NextResponse.json({
            agents: agentsRes.data ?? [],
            bundles: bundlesRes.data ?? [],
            council_log: councilRes.data ?? [],
        });
    } catch (e) {
        return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const body = await request.json();
        const { action, organization_id: orgId } = body;
        if (!orgId) return NextResponse.json({ error: 'organization_id required' }, { status: 400 });

        if (action === 'register') {
            const { agent_key, display_name } = body;
            if (!agent_key || !display_name) {
                return NextResponse.json({ error: 'agent_key and display_name required' }, { status: 400 });
            }
            const { data, error } = await supabase
                .from('oem_agents')
                .upsert(
                    {
                        organization_id: orgId,
                        agent_key,
                        display_name,
                        department: body.department ?? null,
                        role_description: body.role_description ?? null,
                        status: body.status ?? 'draft',
                        config: body.config ?? {},
                    },
                    { onConflict: 'organization_id,agent_key' }
                )
                .select()
                .single();
            if (error) return NextResponse.json({ error: error.message }, { status: 500 });

            await supabase.from('oem_council_log').insert({
                organization_id: orgId,
                agent_key,
                review_type: 'note',
                summary: `Agent '${display_name}' registered (status: ${data.status}).`,
                decided_by: 'human',
                created_by: user.id,
            });
            return NextResponse.json({ agent: data }, { status: 201 });
        }

        if (action === 'set_bundle') {
            const { agent_key, bundle } = body;
            if (!agent_key || !bundle?.tables) {
                return NextResponse.json({ error: 'agent_key and bundle.tables required' }, { status: 400 });
            }

            const { data: current } = await supabase
                .from('oem_agent_bundles')
                .select('version')
                .eq('organization_id', orgId)
                .eq('agent_key', agent_key)
                .order('version', { ascending: false })
                .limit(1)
                .maybeSingle();

            const nextVersion = (current?.version ?? 0) + 1;

            await supabase
                .from('oem_agent_bundles')
                .update({ is_active: false })
                .eq('organization_id', orgId)
                .eq('agent_key', agent_key);

            const { data, error } = await supabase
                .from('oem_agent_bundles')
                .insert({
                    organization_id: orgId,
                    agent_key,
                    version: nextVersion,
                    is_active: true,
                    bundle,
                    created_by: user.id,
                })
                .select()
                .single();
            if (error) return NextResponse.json({ error: error.message }, { status: 500 });

            await supabase.from('oem_council_log').insert({
                organization_id: orgId,
                agent_key,
                review_type: 'bundle_change',
                summary: `Data bundle v${nextVersion} activated: ${bundle.tables.map((t: { name: string }) => t.name).join(', ') || 'empty'}.`,
                decided_by: 'human',
                details: { version: nextVersion, table_count: bundle.tables.length },
                created_by: user.id,
            });
            return NextResponse.json({ bundle: data }, { status: 201 });
        }

        if (action === 'regenerate_prompt') {
            const { agent_key } = body;
            if (!agent_key) return NextResponse.json({ error: 'agent_key required' }, { status: 400 });
            const result = await regenerateAndStorePrompt(orgId, agent_key, user.id);
            return NextResponse.json(result);
        }

        return NextResponse.json({ error: `Unknown action '${action}'` }, { status: 400 });
    } catch (e) {
        return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
}
