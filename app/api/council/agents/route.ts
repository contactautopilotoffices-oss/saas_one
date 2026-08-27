import { NextRequest, NextResponse } from 'next/server';
import { requireMasterAdmin, isCouncilAccessError, resolveCouncilOrgId } from '@/backend/lib/council/guard';
import { loadAgents } from '@/backend/lib/council/runner';

/**
 * GET /api/council/agents — the org's active council agents (the 8 founding
 * personas once seeded; built-in fallback before the migration lands).
 */
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    const access = await requireMasterAdmin();
    if (isCouncilAccessError(access)) return access;

    const orgId = await resolveCouncilOrgId(access, request);
    const agents = await loadAgents(orgId);

    return NextResponse.json({
        org_id: orgId,
        agents: agents.map(a => ({
            key: a.key,
            name: a.name,
            title: a.title,
            email: a.email,
            lens: a.lens,
            color: a.color,
            sort: a.sort,
        })),
    });
}
