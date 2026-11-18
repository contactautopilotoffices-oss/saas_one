'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { createClient } from '@/frontend/utils/supabase/client';
import { maskStorageUrl } from '@/frontend/utils/storageUrl';

export interface CADAreaItem {
    id: string;
    label: string;
    shape_type?: 'rectangle' | 'polygon' | 'freehand';
    coordinates: { x: number; y: number; width: number; height: number };
    points?: { x: number; y: number }[];
    linked_step_ids: string[];
}

export interface AreaAuditScore {
    areaId: string;
    label: string;
    category: string;
    score: number | null;
    status: 'excellent' | 'good' | 'attention' | 'poor' | 'uninspected';
    previewPhoto?: string;
    benchmarkPhoto?: string;
    capturedAt?: string;
    reason?: string;
    completionId?: string;
    propertyId?: string;
    /** The scorer's own rule-based verdict (sop_completion_items.ai_pass), not a score band. */
    aiPass?: boolean | null;
    /** The scorer flagged this step for a human checker (unseen parameter, missing angle, wrong angle). */
    needsReview?: boolean;
    /** Whether the AI compared against uploaded reference photos or a CAD crop. */
    referenceUsed?: 'cad' | 'uploaded' | null;
    analyzedAt?: string | null;
    /** True when no linked step has been AI-scored yet, so every number here is absent rather than zero. */
    notEvaluated?: boolean;
    /** The scorer's injected "Timestamp & Anti-Spoofing" system parameter, verbatim. */
    antiSpoofing?: {
        status: 'pass' | 'fail' | 'unknown';
        score: number | null;
        reason: string;
    };
    parameters: Array<{
        name: string;
        score: number | null;
        status: 'pass' | 'fail' | 'warning' | 'needs_attention' | 'not_visible' | 'not_in_frame' | 'not_evaluated';
        reason?: string;
        reviewed_by_checker?: boolean;
        photo_url?: string;
        /** Set by the scorer for the Timestamp & Anti-Spoofing row it injects itself. */
        system?: boolean;
    }>;
    linkedItemIds: string[];
    linkedTitles: string[];
    allProofs: Array<{ url: string; label?: string; captured_at?: string }>;
    allBenchmarks: Array<{ id?: string; url: string; label?: string }>;
    aiPhotoMatches?: Array<{
        benchmark_id?: string;
        benchmark_label?: string;
        matched_photo_url?: string;
        cleanliness_score?: number;
        reason?: string;
        // The scorer also returns 'angle_mismatch' for a photo that shows the area from the
        // wrong viewpoint; it was missing here, so the report collapsed it into a pass.
        status?: 'matched' | 'angle_mismatch' | 'missing';
    }>;
}

export interface CategoryMetric {
    name: string;
    score: number;
    count: number;
}

export interface RecentAudit {
    id: string;
    areaName: string;
    location: string;
    score: number;
    status: 'excellent' | 'good' | 'attention' | 'poor';
    photoUrl?: string;
    timestamp: string;
}

export interface AIInsight {
    id: string;
    type: 'critical' | 'warning' | 'success' | 'info';
    title: string;
    description: string;
}

export function useCADReportData(propertyId: string, isAdmin: boolean) {
    const supabase = createClient();

    // Filters
    const [selectedDate, setSelectedDate] = useState(() => {
        const now = new Date();
        const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' });
        return formatter.format(now);
    });
    const [dateRangeMode, setDateRangeMode] = useState<'today' | 'yesterday' | 'this_week' | 'this_month' | 'custom'>('this_week');
    const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
    const [selectedFloor, setSelectedFloor] = useState<string>('1st Floor');
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedAreaId, setSelectedAreaId] = useState<string | null>(null);

    // Raw State
    const [templates, setTemplates] = useState<any[]>([]);
    const [cadTemplate, setCadTemplate] = useState<any | null>(null);
    const [completions, setCompletions] = useState<any[]>([]);
    const [templateChecklistItems, setTemplateChecklistItems] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    /**
     * The property's own pass mark, the same one the scorer applies when the checklist is submitted
     * (score-photo route reads checklist_property_settings.ai_scoring_threshold, falling back to 70).
     * The report must band scores against this, not against a number of its own.
     */
    const [passThreshold, setPassThreshold] = useState(70);

    useEffect(() => {
        if (!propertyId) return;
        let cancelled = false;
        (async () => {
            const { data } = await supabase
                .from('checklist_property_settings')
                .select('ai_scoring_threshold')
                .eq('property_id', propertyId)
                .maybeSingle();
            const raw = Number(data?.ai_scoring_threshold);
            if (!cancelled && Number.isFinite(raw) && raw > 0 && raw <= 100) {
                setPassThreshold(Math.round(raw));
            }
        })();
        return () => { cancelled = true; };
    }, [propertyId]);

    // 1. Fetch all templates for property
    useEffect(() => {
        if (!propertyId) return;
        async function fetchTemplates() {
            try {
                const { data, error } = await supabase
                    .from('sop_templates')
                    .select('id, title, category, cad_areas, cad_file_url, cad_file_type, cad_converted_image_url')
                    .eq('property_id', propertyId)
                    .eq('is_active', true);

                if (error) throw error;
                const tmpls = data || [];
                setTemplates(tmpls);

                // Auto-select template with CAD floor plan (preferring D Wing 1st floor or template with most CAD areas)
                if (tmpls.length > 0) {
                    const withCad = [...tmpls]
                        .filter(t => (t.cad_areas && t.cad_areas.length > 0) || t.cad_converted_image_url)
                        .sort((a, b) => (b.cad_areas?.length || 0) - (a.cad_areas?.length || 0))[0];
                    const defaultId = withCad ? withCad.id : tmpls[0].id;
                    setSelectedTemplateId(prev => prev || defaultId);
                }
            } catch (err) {
                console.error('Error fetching SOP templates:', err);
            }
        }
        fetchTemplates();
    }, [propertyId]);

    // 2. Fetch selected template details & CAD areas
    useEffect(() => {
        if (!selectedTemplateId || !propertyId) return;

        async function fetchTemplateCAD() {
            setIsLoading(true);
            try {
                // Fetch template CAD areas from API
                const cadRes = await fetch(`/api/properties/${propertyId}/sop/templates/${selectedTemplateId}/cad/areas`);
                const cadData = await cadRes.json();

                // Fetch checklist items with parameters
                const { data: items } = await supabase
                    .from('sop_checklist_items')
                    .select('id, title, reference_photo_url, reference_photos, parameters')
                    .eq('template_id', selectedTemplateId);

                setCadTemplate({
                    id: selectedTemplateId,
                    title: cadData.title || 'Checklist Template',
                    cadImageUrl: cadData.cadConvertedImageUrl || cadData.cadImageUrl,
                    areas: (cadData.areas || []) as CADAreaItem[],
                });
                setTemplateChecklistItems(items || []);
            } catch (err) {
                console.error('Error fetching template CAD data:', err);
            } finally {
                setIsLoading(false);
            }
        }
        fetchTemplateCAD();
    }, [selectedTemplateId, propertyId]);

    // 3. Fetch completions for selected date/range
    const fetchCompletions = useCallback(async () => {
        if (!propertyId) return;
        try {
            let query = supabase
                .from('sop_completions')
                .select(`
                    id,
                    template_id,
                    completion_date,
                    completed_at,
                    status,
                    created_at,
                    items:sop_completion_items(
                        id,
                        checklist_item_id,
                        is_checked,
                        value,
                        photo_url,
                        photos,
                        ai_cleanliness_score,
                        ai_cleanliness_reason,
                        ai_parameter_scores,
                        ai_photo_matches,
                        ai_pass,
                        ai_needs_review,
                        ai_reference_used,
                        ai_analyzed_at,
                        checked_at
                    )
                `)
                .eq('property_id', propertyId)
                .order('created_at', { ascending: false });

            // Apply date filters
            if (dateRangeMode === 'today') {
                query = query.eq('completion_date', selectedDate);
            } else if (dateRangeMode === 'yesterday') {
                const yDate = new Date();
                yDate.setDate(yDate.getDate() - 1);
                query = query.eq('completion_date', yDate.toISOString().split('T')[0]);
            } else if (dateRangeMode === 'this_week') {
                const d = new Date();
                d.setDate(d.getDate() - 7);
                query = query.gte('completion_date', d.toISOString().split('T')[0]);
            } else if (dateRangeMode === 'this_month') {
                const d = new Date();
                d.setDate(d.getDate() - 30);
                query = query.gte('completion_date', d.toISOString().split('T')[0]);
            } else {
                query = query.eq('completion_date', selectedDate);
            }

            const { data, error } = await query;
            if (error) throw error;
            setCompletions(data || []);
        } catch (err) {
            console.error('Error fetching completions:', err);
        }
    }, [propertyId, selectedDate, dateRangeMode]);

    useEffect(() => {
        fetchCompletions();
    }, [fetchCompletions]);

    // 3b. Self-healing auto-trigger: if any completed checklist has items with photos that are missing AI scores, evaluate them in background
    useEffect(() => {
        if (!propertyId || propertyId === 'all' || completions.length === 0) return;
        const unscoredComps = completions.filter(c =>
            c.status === 'completed' &&
            Array.isArray(c.items) &&
            c.items.some((it: any) =>
                (it.photo_url || (Array.isArray(it.photos) && it.photos.length > 0)) &&
                (it.ai_cleanliness_score === null || it.ai_cleanliness_score === undefined) &&
                !it.ai_cleanliness_reason?.startsWith('Skipped')
            )
        );

        if (unscoredComps.length === 0) return;

        let isCancelled = false;
        const autoHeal = async () => {
            for (const comp of unscoredComps) {
                if (isCancelled) break;
                const unscored = (comp.items || []).filter(
                    (it: any) =>
                        (it.photo_url || (Array.isArray(it.photos) && it.photos.length > 0)) &&
                        (it.ai_cleanliness_score === null || it.ai_cleanliness_score === undefined) &&
                        !it.ai_cleanliness_reason?.startsWith('Skipped')
                );
                for (const it of unscored) {
                    if (isCancelled) break;
                    try {
                        const res = await fetch(`/api/properties/${comp.property_id || propertyId}/sop/completions/${comp.id}/score-photo`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ completionItemId: it.id }),
                        });
                        if (res.ok && !isCancelled) {
                            fetchCompletions();
                        }
                    } catch {
                        // Ignore background failures
                    }
                }
            }
        };

        autoHeal();
        return () => { isCancelled = true; };
    }, [completions, propertyId, fetchCompletions]);

    // 4. Map and Aggregate Areas with Scores
    const areaAudits: AreaAuditScore[] = useMemo(() => {
        if (!cadTemplate?.areas) return [];

        const templateCompletions = completions.filter(c => c.template_id === selectedTemplateId);
        // Find completion that has completed status or audited items with real photos/scores
        const latestCompletion = templateCompletions.find(c =>
            c.status === 'completed' ||
            (c.items && c.items.some((i: any) => i.photo_url || (i.photos && i.photos.length > 0) || i.ai_cleanliness_score !== null))
        ) || templateCompletions[0];
        const completionItems = latestCompletion?.items || [];

        // Build item lookup
        const compItemMap = new Map<string, any>();
        completionItems.forEach((ci: any) => compItemMap.set(ci.checklist_item_id, ci));

        const tmplItemMap = new Map<string, any>();
        templateChecklistItems.forEach(ti => tmplItemMap.set(ti.id, ti));

        return cadTemplate.areas.map((area: CADAreaItem) => {
            const linkedIds = area.linked_step_ids || [];
            const linkedTitles = linkedIds.map(id => tmplItemMap.get(id)?.title).filter(Boolean);

            // Collect scores and proofs from linked items
            const scores: number[] = [];
            const allProofs: Array<{ url: string; label?: string; captured_at?: string }> = [];
            const allBenchmarks: Array<{ id?: string; url: string; label?: string }> = [];
            const allParams: AreaAuditScore['parameters'] = [];
            const allMatches: AreaAuditScore['aiPhotoMatches'] = [];
            let reason = '';
            // The scorer's own verdicts, collected across every step linked to this area.
            let anyScored = false;
            let allPass: boolean | null = null;
            let needsReview = false;
            let referenceUsed: 'cad' | 'uploaded' | null = null;
            let analyzedAt: string | null = null;

            linkedIds.forEach(stepId => {
                const ci = compItemMap.get(stepId);
                const ti = tmplItemMap.get(stepId);

                // Benchmarks
                if (ti?.reference_photos && Array.isArray(ti.reference_photos)) {
                    ti.reference_photos.forEach((rp: any, rpIdx: number) => {
                        if (rp.url) allBenchmarks.push({ id: rp.id || `bm_${rpIdx + 1}`, url: maskStorageUrl(rp.url), label: rp.label || `Angle ${rpIdx + 1}` });
                    });
                } else if (ti?.reference_photo_url) {
                    allBenchmarks.push({ id: 'ref_1', url: maskStorageUrl(ti.reference_photo_url), label: ti.title || 'Clean Standard' });
                }

                // Proofs
                if (ci) {
                    if (ci.ai_cleanliness_score !== null && ci.ai_cleanliness_score !== undefined) {
                        scores.push(Number(ci.ai_cleanliness_score));
                        anyScored = true;
                    }
                    if (ci.ai_cleanliness_reason && !reason) {
                        reason = ci.ai_cleanliness_reason;
                    }
                    // Carry the scorer's verdict through unchanged. ai_pass is null on rows scored
                    // before that column existed, so it stays null rather than being read as a fail.
                    if (typeof ci.ai_pass === 'boolean') {
                        allPass = allPass === null ? ci.ai_pass : (allPass && ci.ai_pass);
                    }
                    if (ci.ai_needs_review === true) needsReview = true;
                    if (!referenceUsed && ci.ai_reference_used) referenceUsed = ci.ai_reference_used;
                    if (ci.ai_analyzed_at && (!analyzedAt || ci.ai_analyzed_at > analyzedAt)) {
                        analyzedAt = ci.ai_analyzed_at;
                    }
                    if (Array.isArray(ci.photos) && ci.photos.length > 0) {
                        ci.photos.forEach((p: any, pIdx: number) => {
                            if (typeof p === 'string') allProofs.push({ url: maskStorageUrl(p), label: `Angle ${pIdx + 1}`, captured_at: ci.checked_at });
                            else if (p?.url) allProofs.push({ ...p, url: maskStorageUrl(p.url), label: p.label || `Angle ${pIdx + 1}`, captured_at: p.captured_at || ci.checked_at });
                        });
                    } else if (ci.photo_url) {
                        allProofs.push({ url: maskStorageUrl(ci.photo_url), label: ti?.title || 'Execution Proof', captured_at: ci.checked_at });
                    }

                    // AI Photo Matches
                    let rawMatches = ci.ai_photo_matches;
                    if (typeof rawMatches === 'string') {
                        try { rawMatches = JSON.parse(rawMatches); } catch { rawMatches = []; }
                    }
                    if (Array.isArray(rawMatches)) {
                        rawMatches.forEach((m: any) => {
                            // A reference angle with no matching photo, or one shot from the wrong
                            // viewpoint, is what the scorer flags for review — mirror that here.
                            if (m?.status === 'missing' || m?.status === 'angle_mismatch') {
                                needsReview = true;
                            }
                        });
                        allMatches.push(...rawMatches.map((m: any) => ({
                            ...m,
                            matched_photo_url: maskStorageUrl(m.matched_photo_url),
                            benchmark_photo_url: maskStorageUrl(m.benchmark_photo_url),
                        })));
                    }

                    // Parameters
                    let pScores = ci.ai_parameter_scores;
                    if (typeof pScores === 'string') {
                        try { pScores = JSON.parse(pScores); } catch { pScores = []; }
                    }
                    if (Array.isArray(pScores)) {
                        pScores.forEach(ps => {
                            // A checker correction overrides the AI verdict in the report
                            const reviewed = Boolean(ps.reviewer_status);
                            const resolvedStatus = ps.reviewer_status || ps.status
                                || (typeof ps.score === 'number'
                                    ? (ps.score >= passThreshold ? 'pass' : 'fail')
                                    : 'not_evaluated');
                            // Anything the AI could not see sends the step to a human, exactly as the
                            // scorer decides it at submit time.
                            if (resolvedStatus === 'not_visible' || resolvedStatus === 'not_in_frame') {
                                needsReview = true;
                            }
                            allParams.push({
                                name: ps.name || 'Check',
                                score: reviewed ? null : (ps.score !== undefined ? ps.score : null),
                                status: resolvedStatus,
                                system: Boolean(ps.system),
                                reason: reviewed
                                    ? `Checker: ${ps.reviewer_verdict === 'correct' ? 'AI was right' : 'corrected'}${ps.reviewer_note ? ` · ${ps.reviewer_note}` : ''}`
                                    : ps.reason,
                                reviewed_by_checker: reviewed,
                                photo_url: ps.found_in_photo_url || (allProofs[0]?.url ? allProofs[0].url : undefined),
                            });
                        });
                    }
                }
            });

            // No AI verdict for this area yet: still list the parameters the template expects, so the
            // report shows what WILL be checked — but as "not evaluated", never as a pass. Marking an
            // unexamined parameter green is what made the report disagree with the submit-time audit.
            if (allParams.length === 0 && linkedIds.length > 0) {
                const firstTmpl = tmplItemMap.get(linkedIds[0]);
                if (Array.isArray(firstTmpl?.parameters) && firstTmpl.parameters.length > 0) {
                    firstTmpl.parameters.forEach((p: any) => {
                        allParams.push({
                            name: p.name || p.title,
                            score: null,
                            status: 'not_evaluated',
                            reason: 'Not evaluated by AI yet.',
                        });
                    });
                }
            }

            // Derive category from area label
            const l = area.label.toLowerCase();
            let category = 'Workstation';
            if (l.includes('meeting') || l.includes('board') || l.includes('conference')) category = 'Meeting Room';
            else if (l.includes('washroom') || l.includes('toilet')) category = 'Washroom';
            else if (l.includes('cafeteria') || l.includes('pantry') || l.includes('canteen')) category = 'Cafeteria';
            else if (l.includes('cabin') || l.includes('md') || l.includes('vp')) category = 'Cabin';
            else if (l.includes('reception') || l.includes('lobby') || l.includes('visitor')) category = 'Reception';
            else if (l.includes('phone')) category = 'Phone Booth';

            const avgScore = scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;

            // Bands hang off the property's pass mark so the map, the legend and the inspector all
            // agree with the verdict the scorer reached at submit time.
            let status: 'excellent' | 'good' | 'attention' | 'poor' | 'uninspected' = 'uninspected';
            if (avgScore !== null) {
                if (avgScore >= 85) status = 'excellent';
                else if (avgScore >= passThreshold) status = 'good';
                else if (avgScore >= 50) status = 'attention';
                else status = 'poor';
            }

            // The scorer injects this row itself; it is the only real anti-spoofing evidence there is.
            const spoofParam = allParams.find(p => p.system || /timestamp\s*&\s*anti-?spoofing/i.test(p.name));
            const antiSpoofing = spoofParam
                ? {
                    status: (spoofParam.status === 'pass' ? 'pass' : 'fail') as 'pass' | 'fail',
                    score: spoofParam.score,
                    reason: spoofParam.reason || '',
                }
                : { status: 'unknown' as const, score: null, reason: '' };

            return {
                areaId: area.id,
                label: area.label,
                category,
                score: avgScore,
                status,
                previewPhoto: maskStorageUrl(allProofs[0]?.url || allBenchmarks[0]?.url),
                benchmarkPhoto: maskStorageUrl(allBenchmarks[0]?.url),
                capturedAt: allProofs[0]?.captured_at,
                reason,
                parameters: allParams,
                linkedItemIds: linkedIds,
                linkedTitles,
                allProofs,
                allBenchmarks,
                aiPhotoMatches: allMatches,
                completionId: latestCompletion?.id,
                propertyId,
                aiPass: allPass,
                needsReview,
                referenceUsed,
                analyzedAt,
                notEvaluated: !anyScored,
                antiSpoofing,
            };
        });
    }, [cadTemplate, completions, selectedTemplateId, templateChecklistItems, passThreshold]);

    // Filtered areas based on search
    const filteredAreas = useMemo(() => {
        if (!searchQuery.trim()) return areaAudits;
        const q = searchQuery.toLowerCase();
        return areaAudits.filter(a =>
            a.label.toLowerCase().includes(q) ||
            a.category.toLowerCase().includes(q) ||
            a.linkedTitles.some(t => t.toLowerCase().includes(q))
        );
    }, [areaAudits, searchQuery]);

    // Active selected area
    const selectedArea = useMemo(() => {
        if (!selectedAreaId) return areaAudits[0] || null;
        return areaAudits.find(a => a.areaId === selectedAreaId) || areaAudits[0] || null;
    }, [areaAudits, selectedAreaId]);

    // Overall Score — null when nothing has been scored. It used to fall back to a demo 74, which
    // showed a confident number for a floor the AI had never looked at.
    const overallScore = useMemo(() => {
        const scored = areaAudits.filter(a => a.score !== null);
        if (scored.length === 0) return null;
        return Math.round(scored.reduce((sum, a) => sum + (a.score as number), 0) / scored.length);
    }, [areaAudits]);

    /** How much of the floor the overall score actually covers. */
    const scoreCoverage = useMemo(() => ({
        scored: areaAudits.filter(a => a.score !== null).length,
        total: areaAudits.length,
        needsReview: areaAudits.filter(a => a.needsReview).length,
    }), [areaAudits]);

    // Status Counts for Donut Chart
    const statusCounts = useMemo(() => {
        const counts = { excellent: 0, good: 0, attention: 0, poor: 0, uninspected: 0 };
        areaAudits.forEach(a => {
            counts[a.status] = (counts[a.status] || 0) + 1;
        });
        const total = areaAudits.length || 1;
        return {
            total: areaAudits.length,
            excellent: counts.excellent,
            excellentPct: Math.round((counts.excellent / total) * 100),
            good: counts.good,
            goodPct: Math.round((counts.good / total) * 100),
            attention: counts.attention,
            attentionPct: Math.round((counts.attention / total) * 100),
            poor: counts.poor,
            poorPct: Math.round((counts.poor / total) * 100),
            uninspected: counts.uninspected,
        };
    }, [areaAudits]);

    // Category Breakdown for Bar Chart
    const categoryMetrics: CategoryMetric[] = useMemo(() => {
        // Only scored areas count. Substituting 70 for an un-inspected area, as this did before,
        // invented a passing grade for work nobody had looked at.
        const map = new Map<string, { sum: number; count: number }>();
        areaAudits.forEach(a => {
            if (a.score === null) return;
            const current = map.get(a.category) || { sum: 0, count: 0 };
            map.set(a.category, { sum: current.sum + a.score, count: current.count + 1 });
        });

        const list: CategoryMetric[] = [];
        map.forEach((val, name) => {
            list.push({
                name,
                score: Math.round(val.sum / val.count),
                count: val.count,
            });
        });

        // Priority order for displaying categories
        const order = ['Meeting Room', 'Workstation', 'Cafeteria', 'Washroom', 'Cabin', 'Reception', 'Phone Booth'];
        const sorted = list.sort((a, b) => {
            const idxA = order.indexOf(a.name);
            const idxB = order.indexOf(b.name);
            return (idxA !== -1 ? idxA : 99) - (idxB !== -1 ? idxB : 99);
        });

        return sorted.slice(0, 5);
    }, [areaAudits]);

    // Recent Audit Stream from Real Data
    const recentAudits: RecentAudit[] = useMemo(() => {
        // Audited areas only. The old fallback dressed un-inspected areas up with invented
        // scores of 85 / 90 / 78, which read as a finished audit that never happened.
        return areaAudits
            .filter(a => a.score !== null)
            .slice(0, 4)
            .map((a) => ({
                id: a.areaId,
                areaName: a.label,
                location: `${cadTemplate?.title || 'D Wing'} • 1st Floor`,
                score: a.score as number,
                status: a.status as any,
                photoUrl: maskStorageUrl(a.previewPhoto || a.benchmarkPhoto),
                timestamp: a.capturedAt
                    ? new Date(a.capturedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                    : '—',
            }));
    }, [areaAudits, cadTemplate]);

    // AI Insights & Recommendations from Real Audit Observations
    const aiInsights: AIInsight[] = useMemo(() => {
        const insights: AIInsight[] = [];

        // 1. Critical: the scorer's own anti-spoofing verdict, not a guess from the wording of a reason.
        const failedAntiSpoof = areaAudits.find(a => a.antiSpoofing?.status === 'fail');
        if (failedAntiSpoof) {
            insights.push({
                id: 'anti_spoof_critical',
                type: 'critical',
                title: `Photo integrity failed: ${failedAntiSpoof.label}`,
                description: failedAntiSpoof.antiSpoofing?.reason
                    || 'The submitted photo did not pass the live-capture check.',
            });
        }

        // 2. Washrooms moisture / cleanliness alert
        const washrooms = areaAudits.filter(a => a.category === 'Washroom');
        const scoredWashrooms = washrooms.filter(w => w.score !== null);
        if (scoredWashrooms.length > 0) {
            const avgWashroom = Math.round(scoredWashrooms.reduce((s, w) => s + (w.score || 0), 0) / scoredWashrooms.length);
            if (avgWashroom < passThreshold) {
                insights.push({
                    id: 'washrooms_alert',
                    type: 'warning',
                    title: 'Washroom Areas Need Attention',
                    description: `Average cleanliness score is ${avgWashroom}, below the ${passThreshold} pass mark set for this property.`,
                });
            }
        }

        // 3. Steps the scorer could not finish on its own and handed to a checker.
        const review = areaAudits.filter(a => a.needsReview);
        if (review.length > 0) {
            const unseen = review
                .flatMap(a => a.parameters.filter(p => p.status === 'not_visible' || p.status === 'not_in_frame').map(p => p.name))
                .filter((v, i, arr) => arr.indexOf(v) === i)
                .slice(0, 3);
            insights.push({
                id: 'needs_checker_review',
                type: 'warning',
                title: `${review.length} ${review.length === 1 ? 'area needs' : 'areas need'} checker review`,
                description: unseen.length > 0
                    ? `The AI could not see ${unseen.join(', ')} in the photos submitted. A checker has to confirm these before the score stands.`
                    : `${review.map(a => a.label).slice(0, 3).join(', ')} came back with a missing or wrong-angle photo.`,
            });
        }

        // 4. High performance — stated from the scores only, with no claim about timestamps.
        const highScorers = areaAudits.filter(a => (a.score ?? 0) >= 90).map(a => a.label);
        if (highScorers.length > 0) {
            insights.push({
                id: 'high_performance',
                type: 'success',
                title: 'Consistent high performance',
                description: `${highScorers.slice(0, 3).join(', ')} scored 90 or above.`,
            });
        }

        // 5. Follow-up target, drawn from the AI's own explanation for the weakest area.
        const attentionAreas = areaAudits.filter(a => a.status === 'attention' || a.status === 'poor');
        if (attentionAreas.length > 0) {
            const worst = [...attentionAreas].sort((a, b) => (a.score ?? 0) - (b.score ?? 0))[0];
            insights.push({
                id: 'focus_followup',
                type: 'info',
                title: `Follow-up target: ${worst.label}`,
                description: worst.reason || `Scored ${worst.score}/100, below the ${passThreshold} pass mark.`,
            });
        }

        // 6. Coverage — say plainly how much of the floor this report actually covers.
        const unscored = areaAudits.filter(a => a.score === null).length;
        if (unscored > 0) {
            insights.push({
                id: 'coverage_gap',
                type: 'info',
                title: `${unscored} of ${areaAudits.length} areas not evaluated`,
                description: 'No AI-scored photo was submitted for these areas in the selected period, so they are excluded from the scores above.',
            });
        }

        return insights;
    }, [areaAudits, passThreshold]);

    return {
        selectedDate,
        setSelectedDate,
        dateRangeMode,
        setDateRangeMode,
        selectedTemplateId,
        setSelectedTemplateId,
        selectedFloor,
        setSelectedFloor,
        searchQuery,
        setSearchQuery,
        selectedAreaId,
        setSelectedAreaId,
        templates,
        cadTemplate,
        areaAudits,
        filteredAreas,
        selectedArea,
        overallScore,
        scoreCoverage,
        passThreshold,
        statusCounts,
        categoryMetrics,
        recentAudits,
        aiInsights,
        isLoading,
        refetch: fetchCompletions,
    };
}
