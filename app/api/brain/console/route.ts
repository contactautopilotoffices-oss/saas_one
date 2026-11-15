import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import {
    clampDays, consoleStatus, conversationView, conversationsView, costViewFor, memoryView, overviewView, scorecardView, shadowView, skillsView,
} from '@/backend/lib/aiLayer/brain/console/server';
import { NO_STORE, consoleGuard, fail } from './_lib';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Brain Console, read side (Tech team only). GET ?orgId=&view=
 *   overview        &days=1|7|30
 *   conversations   &days=  &track=live|shadow  &only=all|flagged
 *   conversation    &person=<tag>  &day=YYYY-MM-DD  &track=live|shadow
 *   shadow          &days=
 *   skills | memory | cost | scorecard
 *
 * Owner 2026-11-14: nothing returned here says who a person is. Messages are shown with phone numbers, emails and ids
 * masked; the person is a tag that is the same for one day only and cannot be turned back into a user.
 * Until the brain's tables exist, every view answers with status.tableMissing = true and empty data.
 */
export async function GET(request: NextRequest) {
    const guard = await consoleGuard(request);
    if (!guard.ok) return guard.response;
    const { orgId } = guard;
    const q = request.nextUrl.searchParams;
    const view = q.get('view') || 'overview';
    const shadow = q.get('track') === 'shadow';
    try {
        const { status, settings } = await consoleStatus(supabaseAdmin, orgId);
        const data = await (async () => {
            switch (view) {
                case 'overview': return overviewView(supabaseAdmin, orgId, clampDays(q.get('days')));
                case 'conversations': return conversationsView(supabaseAdmin, orgId, clampDays(q.get('days')), shadow, q.get('only') === 'flagged');
                case 'conversation': return conversationView(supabaseAdmin, orgId, q.get('person') || '', q.get('day') || '', shadow);
                case 'shadow': return shadowView(supabaseAdmin, orgId, clampDays(q.get('days')));
                case 'skills': return skillsView(supabaseAdmin, orgId, settings);
                case 'memory': return memoryView(supabaseAdmin, orgId, settings);
                case 'cost': return costViewFor(supabaseAdmin, orgId, settings);
                case 'scorecard': return scorecardView();
                default: return undefined;
            }
        })();
        if (data === undefined) return fail(400, 'Unknown view.');
        if (data === null) return fail(400, 'That conversation could not be found.');
        return NextResponse.json({ success: true, status, data }, { headers: NO_STORE });
    } catch (err) {
        console.error('[BrainConsole] GET failed:', err instanceof Error ? err.message : err);
        return fail(500, 'The console could not load this screen.');
    }
}
