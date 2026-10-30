/**
 * GET ?organizationId= → headline numbers for the Meera overview.
 *
 * Read-only. Everything here is counted from what actually happened:
 *   · calls made / connected / quotes, from satej_calls (real call rows,
 *     rehearsal/test calls left out so the desk sees vendor outreach only);
 *   · qualified vendors and the campaign counts, from satej_requirements.
 * Week-on-week deltas compare the last 7 days with the 7 before, by call date,
 * so a badge is only ever shown when there is a real prior week to compare to.
 * Nothing is invented; when the tables are not there yet, every number is 0.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireSatejCaller } from '@/backend/lib/satej/access';
import { getRepo } from '@/backend/lib/satej/repo';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { satejConfig } from '@/backend/lib/satej/config';
import { isMissingSchemaError } from '@/backend/lib/procurement/catalogAccess';
import type { CallRecord } from '@/backend/lib/satej/types';

export const dynamic = 'force-dynamic';

const WORKING = ['submitted', 'structured', 'discovering', 'calling', 'calls_done', 'analyzing', 'ranked'];
const WAITING = ['needs_clarification', 'awaiting_call_approval'];
const DAY = 86_400_000;

type Metric = { total: number; thisWeek: number; prevWeek: number; deltaPct: number | null };

/** +N% only when there is a real previous week to compare against. */
function metric(all: { at: number }[]): Metric {
    const now = Date.now();
    const thisWeek = all.filter((x) => x.at >= now - 7 * DAY).length;
    const prevWeek = all.filter((x) => x.at >= now - 14 * DAY && x.at < now - 7 * DAY).length;
    const deltaPct = prevWeek > 0 ? Math.round(((thisWeek - prevWeek) / prevWeek) * 100) : null;
    return { total: all.length, thisWeek, prevWeek, deltaPct };
}

export async function GET(request: NextRequest) {
    const organizationId = request.nextUrl.searchParams.get('organizationId');
    const caller = await requireSatejCaller(organizationId);
    if (caller instanceof NextResponse) return caller;

    try {
        // Campaigns (requirements): full records, so ranking is available.
        const reqs = await getRepo().listRequirements(organizationId!, 100);

        let qualifiedVendors = 0;
        for (const r of reqs) {
            for (const v of r.ranking ?? []) {
                if (v.score?.qualification === 'qualified') qualifiedVendors += 1;
            }
        }
        const campaigns = {
            total: reqs.length,
            active: reqs.filter((r) => WORKING.includes(r.status)).length,
            waiting: reqs.filter((r) => WAITING.includes(r.status)).length,
            completed: reqs.filter((r) => r.status === 'notified').length,
        };

        // Calls: real vendor outreach only (rehearsals/test calls excluded).
        let calls: Pick<CallRecord, 'status' | 'analysis' | 'rehearsal'>[] = [];
        let callDates: { at: number; status: string; hasRate: boolean }[] = [];
        if (!satejConfig.mockMode) {
            const res = await supabaseAdmin
                .from('satej_calls')
                .select('created_at, status, data')
                .eq('organization_id', organizationId!)
                .order('created_at', { ascending: false })
                .limit(5000);
            if (res.error) {
                if (isMissingSchemaError(res.error)) return NextResponse.json(empty());
                throw res.error;
            }
            const rows = (res.data ?? []) as { created_at: string; status: string; data: CallRecord }[];
            const real = rows.filter((row) => !row.data?.rehearsal);
            calls = real.map((row) => row.data);
            callDates = real.map((row) => ({
                at: new Date(row.created_at).getTime(),
                status: row.data?.status ?? row.status,
                hasRate: row.data?.analysis?.quotedRate != null,
            }));
        }

        const connected = callDates.filter((c) => c.status === 'completed');
        const quotes = callDates.filter((c) => c.hasRate);
        const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
        const todayAt = todayStart.getTime();
        const todayCalls = callDates.filter((c) => c.at >= todayAt);

        return NextResponse.json({
            ready: true,
            callsMade: metric(callDates),
            connected: metric(connected),
            quotesReceived: metric(quotes),
            qualifiedVendors: { total: qualifiedVendors },
            campaigns,
            today: {
                calls: todayCalls.length,
                connected: todayCalls.filter((c) => c.status === 'completed').length,
                quotes: todayCalls.filter((c) => c.hasRate).length,
                noAnswer: todayCalls.filter((c) => ['no-answer', 'busy', 'failed', 'canceled', 'call-disconnected', 'error'].includes(c.status)).length,
                inProgress: todayCalls.filter((c) => ['in-progress', 'ringing', 'initiated'].includes(c.status)).length,
            },
        });
    } catch (e) {
        console.error('[satej stats] failed', e);
        return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not load the overview' }, { status: 500 });
    }
}

function empty() {
    const zero: Metric = { total: 0, thisWeek: 0, prevWeek: 0, deltaPct: null };
    return {
        ready: false,
        callsMade: zero, connected: zero, quotesReceived: zero,
        qualifiedVendors: { total: 0 },
        campaigns: { total: 0, active: 0, waiting: 0, completed: 0 },
        today: { calls: 0, connected: 0, quotes: 0, noAnswer: 0, inProgress: 0 },
    };
}
