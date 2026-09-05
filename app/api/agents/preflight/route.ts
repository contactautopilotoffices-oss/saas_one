/**
 * GET /api/agents/preflight?orgId=&agentKey=
 *
 * Everything that has to be true for an agent to run, checked live. Read-only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { preflight } from '@/backend/lib/agents/preflight';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const sp = new URL(request.url).searchParams;
    const orgId = sp.get('orgId') ?? '';
    const agentKey = sp.get('agentKey') ?? '';
    if (!UUID_RE.test(orgId) || !agentKey) {
        return NextResponse.json({ error: 'orgId (uuid) and agentKey required' }, { status: 400 });
    }
    return NextResponse.json(await preflight(orgId, agentKey));
}
