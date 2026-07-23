import { NextRequest, NextResponse } from 'next/server';
import { resolveCrmAccess, isCrmAccessError, readOrgId } from '@/backend/lib/crm/access';
import { syncMetaLeadsForOrg } from '@/backend/services/metaLeadSync';

/**
 * POST /api/crm/meta-sync
 *
 * Admin-triggered "pull now" for Meta leads. Same engine as the cron backstop
 * (backend/services/metaLeadSync). Passes a large per-form cap for a full
 * backfill.
 */
export async function POST(request: NextRequest) {
    const access = await resolveCrmAccess(request, readOrgId(request));
    if (isCrmAccessError(access)) return access;
    if (!access.isAdmin && !access.isMasterAdmin) {
        return NextResponse.json({ error: 'Admin only' }, { status: 403 });
    }

    const result = await syncMetaLeadsForOrg(access.organizationId, { perFormCap: 2000 });
    if (result.status === 'skipped' || result.status === 'failed') {
        return NextResponse.json({ error: result.error || 'Sync failed', ...result }, { status: 400 });
    }
    return NextResponse.json({
        status: 'ok',
        total_inserted: result.inserted,
        total_skipped: result.skipped,
        forms_processed: result.formsProcessed,
        result,
    });
}
