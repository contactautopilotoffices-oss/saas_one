import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { OEM_LEVELS } from '@/backend/lib/oem/types';
import type { OemGoalProgress, OemLevel } from '@/backend/lib/oem/types';

/**
 * GET /api/org-efficiency/meter?orgId=&cadence=&department=&owner=
 *
 * The meter itself: per-level progress (agent -> employee -> department ->
 * tech -> org), overall %, and the three governance lists the console
 * filters on:
 *   - completing:    goals at/over their expected pace
 *   - behind:        goals moving slower than expected (actual vs expected rate)
 *   - not_in_chain:  goals with no fresh measurement — data missing
 */

export async function GET(request: NextRequest) {
    try {
        const supabase = await createClient();
        const { searchParams } = new URL(request.url);
        const orgId = searchParams.get('orgId');
        if (!orgId) return NextResponse.json({ error: 'orgId required' }, { status: 400 });

        let query = supabase
            .from('v_oem_goal_progress')
            .select('*')
            .eq('organization_id', orgId)
            .eq('status', 'active');

        const cadence = searchParams.get('cadence');
        const department = searchParams.get('department');
        const owner = searchParams.get('owner');
        if (cadence) query = query.eq('cadence', cadence);
        if (department) query = query.eq('department', department);
        if (owner) query = query.eq('owner_uid', owner);

        const { data, error } = await query;
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });

        const goals = (data ?? []) as OemGoalProgress[];

        // Per-level progress: mean of measured goals; unmeasured goals are
        // reported separately, not averaged in as zero.
        const levels = OEM_LEVELS.map((level: OemLevel) => {
            const atLevel = goals.filter((g) => g.level === level);
            const measured = atLevel.filter((g) => g.progress_pct != null);
            const pct = measured.length
                ? Math.round(measured.reduce((s, g) => s + (g.progress_pct ?? 0), 0) / measured.length)
                : null;
            return {
                level,
                goal_count: atLevel.length,
                measured_count: measured.length,
                progress_pct: pct,
            };
        });

        const measuredLevels = levels.filter((l) => l.progress_pct != null);
        const overall = measuredLevels.length
            ? Math.round(measuredLevels.reduce((s, l) => s + (l.progress_pct ?? 0), 0) / measuredLevels.length)
            : null;

        // Pace: actual_rate vs expected_rate (both direction-normalised).
        const paced = goals.filter((g) => g.expected_rate != null && g.actual_rate != null);
        const completing = paced.filter((g) => (g.actual_rate ?? 0) >= (g.expected_rate ?? 0));
        const behind = paced.filter((g) => (g.actual_rate ?? 0) < (g.expected_rate ?? 0));
        const notInChain = goals.filter((g) => !g.data_in_chain);

        return NextResponse.json({
            overall_progress: overall,
            levels,
            counts: {
                total_goals: goals.length,
                completing: completing.length,
                behind: behind.length,
                not_in_chain: notInChain.length,
            },
            completing,
            behind,
            not_in_chain: notInChain,
        });
    } catch (e) {
        return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
}
