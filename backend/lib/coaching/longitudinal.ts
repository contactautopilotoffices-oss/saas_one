/**
 * Longitudinal coaching analysis — given a rep's recent calls, determine
 * whether they're improving, stagnant, or declining.
 *
 * Used by GET /api/crm/coaching/overview to power the admin dashboard's
 * "rep leaderboard" tile and the per-rep trend chart.
 */

import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { LAYER_KEYS, type CoachingReport, type LayerKey } from './schema';

export interface RepCallPoint {
    callId: string;
    uploadedAt: string;
    leadCompanyName: string | null;
    overallScore: number;
    repTalkRatio: number;
    avgRepTalkSeconds: number;
    layers: Record<LayerKey, number>;
}

export interface RepTrend {
    bdRepId: string;
    bdRepName: string;
    callCount: number;
    avgOverallScore: number;
    avgRepTalkRatio: number;
    avgLayers: Record<LayerKey, number>;
    /** Most recent call's overall score minus the previous one. */
    recentDelta: number | null;
    /** Direction across all data: 'improving' | 'flat' | 'declining'. */
    direction: 'improving' | 'flat' | 'declining' | 'insufficient_data';
    history: RepCallPoint[];
    /** The single layer the rep is worst at (best coaching target). */
    weakestLayer: LayerKey | null;
}

/**
 * Compute trend for one rep. Window is configurable; default last 20 calls.
 */
export function computeRepTrend(
    history: Array<{
        id: string;
        uploaded_at: string;
        overall_score: number | null;
        rep_talk_ratio: number | null;
        coaching: CoachingReport | null;
        lead_company_name_snapshot: string | null;
    }>,
    bdRepName: string,
    bdRepId: string
): RepTrend {
    const points: RepCallPoint[] = history
        .filter((c) => c.overall_score != null)
        .map((c) => {
            const report = c.coaching;
            const layers: Record<LayerKey, number> = {
                opening: report?.layers.opening.score ?? 0,
                rapport: report?.layers.rapport.score ?? 0,
                requirements: report?.layers.requirements.score ?? 0,
                core: report?.layers.core.score ?? 0,
                closing: report?.layers.closing.score ?? 0,
            };
            return {
                callId: c.id,
                uploadedAt: c.uploaded_at,
                leadCompanyName: c.lead_company_name_snapshot,
                overallScore: c.overall_score ?? 0,
                repTalkRatio: c.rep_talk_ratio ?? 0,
                avgRepTalkSeconds: report?.avg_rep_talk_seconds ?? 0,
                layers,
            };
        })
        .sort((a, b) => a.uploadedAt.localeCompare(b.uploadedAt));

    const callCount = points.length;

    if (callCount === 0) {
        return {
            bdRepId,
            bdRepName,
            callCount: 0,
            avgOverallScore: 0,
            avgRepTalkRatio: 0,
            avgLayers: { opening: 0, rapport: 0, requirements: 0, core: 0, closing: 0 },
            recentDelta: null,
            direction: 'insufficient_data',
            history: [],
            weakestLayer: null,
        };
    }

    const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

    const avgOverallScore = avg(points.map((p) => p.overallScore));
    const avgRepTalkRatio = avg(points.map((p) => p.repTalkRatio));

    const avgLayers = {
        opening: avg(points.map((p) => p.layers.opening)),
        rapport: avg(points.map((p) => p.layers.rapport)),
        requirements: avg(points.map((p) => p.layers.requirements)),
        core: avg(points.map((p) => p.layers.core)),
        closing: avg(points.map((p) => p.layers.closing)),
    } as Record<LayerKey, number>;

    // Direction: simple linear slope on overall_score.
    // For fewer than 3 calls we mark insufficient_data to avoid noise.
    let direction: RepTrend['direction'] = 'insufficient_data';
    if (callCount >= 3) {
        const xs = points.map((_, i) => i);
        const ys = points.map((p) => p.overallScore);
        const n = xs.length;
        const xMean = avg(xs);
        const yMean = avg(ys);
        let num = 0;
        let den = 0;
        for (let i = 0; i < n; i++) {
            num += (xs[i] - xMean) * (ys[i] - yMean);
            den += (xs[i] - xMean) ** 2;
        }
        const slope = den === 0 ? 0 : num / den;
        if (slope > 0.15) direction = 'improving';
        else if (slope < -0.15) direction = 'declining';
        else direction = 'flat';
    }

    const recentDelta =
        callCount >= 2
            ? Math.round((points[callCount - 1].overallScore - points[callCount - 2].overallScore) * 100) / 100
            : null;

    // Weakest layer across all calls
    const weakestEntry = (Object.entries(avgLayers) as [LayerKey, number][])
        .filter(([, score]) => score > 0)
        .sort((a, b) => a[1] - b[1])[0];

    return {
        bdRepId,
        bdRepName,
        callCount,
        avgOverallScore: Math.round(avgOverallScore * 100) / 100,
        avgRepTalkRatio: Math.round(avgRepTalkRatio * 100) / 100,
        avgLayers: {
            opening: Math.round(avgLayers.opening * 100) / 100,
            rapport: Math.round(avgLayers.rapport * 100) / 100,
            requirements: Math.round(avgLayers.requirements * 100) / 100,
            core: Math.round(avgLayers.core * 100) / 100,
            closing: Math.round(avgLayers.closing * 100) / 100,
        },
        recentDelta,
        direction,
        history: points,
        weakestLayer: weakestEntry?.[0] ?? null,
    };
}

/**
 * Load the per-rep trend for an entire org. Admin-only caller is responsible
 * for access checks.
 */
export async function loadOrgCoachingOverview(
    organizationId: string,
    windowSize = 20
): Promise<{ reps: RepTrend[]; totals: { callsAnalyzed: number; avgOrgScore: number } }> {
    // Pull recent analyzed calls for the org, joined with the rep's name.
    const { data, error } = await supabaseAdmin
        .from('crm_calls')
        .select(
            `
            id, bd_rep_id, uploaded_at, overall_score, rep_talk_ratio,
            coaching, lead_company_name_snapshot,
            rep:users!crm_calls_bd_rep_id_fkey(id, full_name, email)
        `
        )
        .eq('organization_id', organizationId)
        .eq('status', 'completed')
        .eq('is_archived', false)
        .order('uploaded_at', { ascending: false })
        .limit(windowSize * 10); // generous upper bound — we slice per rep below

    if (error) {
        console.error('[coaching] loadOrgCoachingOverview error:', error);
        return { reps: [], totals: { callsAnalyzed: 0, avgOrgScore: 0 } };
    }

    // Bucket by rep
    const byRep = new Map<
        string,
        {
            id: string;
            name: string;
            calls: Array<{
                id: string;
                uploaded_at: string;
                overall_score: number | null;
                rep_talk_ratio: number | null;
                coaching: CoachingReport | null;
                lead_company_name_snapshot: string | null;
            }>;
        }
    >();

    for (const row of data || []) {
        const repMeta = Array.isArray(row.rep) ? row.rep[0] : row.rep;
        const repId = row.bd_rep_id as string;
        const repName = (repMeta?.full_name as string | undefined) || (repMeta?.email as string | undefined) || 'Unknown rep';

        if (!byRep.has(repId)) {
            byRep.set(repId, { id: repId, name: repName, calls: [] });
        }
        byRep.get(repId)!.calls.push({
            id: row.id,
            uploaded_at: row.uploaded_at,
            overall_score: row.overall_score,
            rep_talk_ratio: row.rep_talk_ratio,
            coaching: row.coaching as CoachingReport | null,
            lead_company_name_snapshot: row.lead_company_name_snapshot,
        });
    }

    const reps: RepTrend[] = [];
    let totalCalls = 0;
    let totalScore = 0;

    for (const [, repBucket] of byRep) {
        const slice = repBucket.calls.slice(0, windowSize);
        const trend = computeRepTrend(slice, repBucket.name, repBucket.id);
        reps.push(trend);
        totalCalls += slice.length;
        totalScore += trend.avgOverallScore * slice.length;
    }

    reps.sort((a, b) => b.avgOverallScore - a.avgOverallScore);

    return {
        reps,
        totals: {
            callsAnalyzed: totalCalls,
            avgOrgScore: totalCalls === 0 ? 0 : Math.round((totalScore / totalCalls) * 100) / 100,
        },
    };
}
