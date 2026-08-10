import { NextRequest, NextResponse } from 'next/server';
import { resolveAccountsAccess, isAccountsAccessError, readOrgId } from '@/backend/lib/accounts/access';
import {
    syncVendorList, enrichVendorDetails, MissingVendorTableError,
    DEFAULT_DETAIL_LIMIT, MAX_DETAIL_LIMIT,
} from '@/backend/services/zohoVendorSync';
import type { VendorZohoSyncResult } from '@/backend/lib/accounts/trackerTypes';

/**
 * POST /api/accounts/vendor-profiles/sync-zoho — pull vendor compliance data from Zoho Books.
 *
 *   { "phase": "list" }                4 paginated calls, the whole roster, seconds.
 *   { "phase": "detail", "limit": 50 } per-vendor Udyam / MSME / address / bank, throttled.
 *
 * SESSION-AUTHENTICATED, ORG-SCOPED, AND AT THE ACCOUNTS/ADMIN BAR. It writes org-wide
 * master data that decides who gets paid, so it sits where the backfill sits rather than at
 * the general tracker-write bar. The cron path is a SEPARATE route with its own bearer
 * check — this one never trusts a header.
 *
 * The detail phase is expected to be run repeatedly: `remaining` in the response is the
 * number still waiting, and the cron drains the rest in capped batches.
 */

// The detail phase can be asked for up to MAX_DETAIL_LIMIT vendors at ~600ms each.
export const maxDuration = 300;

const PHASES = ['list', 'detail'] as const;
type Phase = (typeof PHASES)[number];

export async function POST(request: NextRequest) {
    const body = await request.json().catch(() => ({}));

    const access = await resolveAccountsAccess(request, readOrgId(request, body));
    if (isAccountsAccessError(access)) return access;
    if (!access.canComplete && !access.isAdmin) {
        return NextResponse.json(
            { error: 'Forbidden: only accounts or an org admin may sync vendors from Zoho' },
            { status: 403 },
        );
    }

    const phase = (body?.phase ?? 'list') as Phase;
    if (!PHASES.includes(phase)) {
        return NextResponse.json({ error: `phase must be one of: ${PHASES.join(', ')}` }, { status: 400 });
    }

    let limit: number | undefined;
    if (body?.limit !== undefined) {
        const parsed = Number(body.limit);
        if (!Number.isFinite(parsed) || parsed < 1) {
            return NextResponse.json({ error: 'limit must be a positive number' }, { status: 400 });
        }
        // Clamped rather than rejected: asking for 5,000 is a reasonable thing to want and
        // an unreasonable thing to do to Zoho inside one request.
        limit = Math.min(MAX_DETAIL_LIMIT, Math.floor(parsed));
    }

    try {
        const actor = { actorId: access.user.id, actorChannel: 'app' as const };
        const result: VendorZohoSyncResult = phase === 'list'
            ? await syncVendorList(access.organizationId, actor)
            : await enrichVendorDetails(access.organizationId, { ...actor, limit: limit ?? DEFAULT_DETAIL_LIMIT });

        // A run that reached Zoho but could not use the credentials is not a success, and a
        // 200 here would leave the button looking like it worked.
        if (result.error) return NextResponse.json(result, { status: 502 });
        return NextResponse.json(result);
    } catch (e) {
        if (e instanceof MissingVendorTableError) {
            return NextResponse.json(
                { error: 'Vendor compliance requires a pending database migration (20260805000001). Apply migrations and retry.' },
                { status: 503 },
            );
        }
        console.error('Vendor Zoho sync error:', e);
        return NextResponse.json({ error: 'Failed to sync vendors from Zoho Books' }, { status: 500 });
    }
}
