import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { resolveCaller, isCallerError, forbidden } from '@/backend/lib/auth/callerAccess';

/**
 * GET /api/sop/completion-report
 *
 * Date-wise + property-wise checklist completion report.
 *
 * Query params:
 *   from        YYYY-MM-DD (default: today IST)
 *   to          YYYY-MM-DD (default: same as `from`)
 *   propertyId  a single property, or 'all'
 *   propertyIds comma-separated property ids (used by the org-wide view)
 *   templateId  restrict to one checklist template
 *
 * Returns per-day rollups (each with a property breakdown), per-property rollups for the
 * whole range, and the individual checklist runs so the UI can drill down.
 */

const ADMIN_ROLES = [
    'property_admin',
    'org_admin',
    'org_super_admin',
    'master_admin',
    'ops_super_admin',
    'super_admin',
];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_ROWS = 8000;

/** A single scheduled checklist run, as selected below. */
interface CompletionRun {
    id: string;
    property_id: string;
    template_id: string;
    completion_date: string;
    slot_time: string | null;
    status: string | null;
    is_late: boolean | null;
    ai_avg_score: number | null;
    completed_at: string | null;
    due_at: string | null;
    approval_status: string | null;
    template: { title: string | null; frequency: string | null; category: string | null } | null;
    user: { full_name: string | null } | null;
}

function todayIST(): string {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(new Date());
}

interface Bucket {
    total: number;
    done: number;
    missed: number;
    pending: number;
    inProgress: number;
    partial: number;
    late: number;
    scoreSum: number;
    scoreCount: number;
}

const emptyBucket = (): Bucket => ({
    total: 0,
    done: 0,
    missed: 0,
    pending: 0,
    inProgress: 0,
    partial: 0,
    late: 0,
    scoreSum: 0,
    scoreCount: 0,
});

function addToBucket(
    b: Bucket,
    row: { status: string | null; is_late: boolean | null; ai_avg_score: number | null }
) {
    b.total += 1;
    switch ((row.status || '').toLowerCase()) {
        case 'completed':
            b.done += 1;
            if (row.is_late) b.late += 1;
            break;
        case 'missed':
            b.missed += 1;
            break;
        case 'in_progress':
            b.inProgress += 1;
            break;
        case 'partial':
            b.partial += 1;
            break;
        default:
            b.pending += 1;
    }
    if (typeof row.ai_avg_score === 'number') {
        b.scoreSum += row.ai_avg_score;
        b.scoreCount += 1;
    }
}

function shapeBucket(b: Bucket) {
    const { scoreSum, scoreCount, ...rest } = b;
    return {
        ...rest,
        completionRate: b.total > 0 ? Math.round((b.done / b.total) * 100) : null,
        avgScore: scoreCount > 0 ? Math.round(scoreSum / scoreCount) : null,
    };
}

export async function GET(request: NextRequest) {
    const caller = await resolveCaller(request);
    if (isCallerError(caller)) return caller;

    const hasAdminRole =
        caller.isMasterAdmin ||
        caller.orgMemberships.some(m => ADMIN_ROLES.includes(m.role)) ||
        caller.propertyMemberships.some(m => ADMIN_ROLES.includes(m.role));

    if (!hasAdminRole) {
        return forbidden('Forbidden: Admin access required for checklist reports');
    }

    const { searchParams } = new URL(request.url);
    const from = searchParams.get('from') || todayIST();
    const to = searchParams.get('to') || from;
    const templateId = searchParams.get('templateId');

    if (!DATE_RE.test(from) || !DATE_RE.test(to)) {
        return NextResponse.json({ error: 'from / to must be YYYY-MM-DD' }, { status: 400 });
    }
    if (from > to) {
        return NextResponse.json({ error: 'from must not be after to' }, { status: 400 });
    }

    try {
        // Which properties may this caller report on?
        const adminOrgIds = [
            ...new Set(
                caller.orgMemberships
                    .filter(m => ADMIN_ROLES.includes(m.role))
                    .map(m => m.organization_id)
            ),
        ];
        const adminPropertyIds = [
            ...new Set(
                caller.propertyMemberships
                    .filter(m => ADMIN_ROLES.includes(m.role))
                    .map(m => m.property_id)
            ),
        ];

        let allowedQuery = supabaseAdmin.from('properties').select('id, name, organization_id');
        if (!caller.isMasterAdmin) {
            const orFilters: string[] = [];
            if (adminOrgIds.length) orFilters.push(`organization_id.in.(${adminOrgIds.join(',')})`);
            if (adminPropertyIds.length) orFilters.push(`id.in.(${adminPropertyIds.join(',')})`);
            if (!orFilters.length) {
                return forbidden('Forbidden: no properties in scope');
            }
            allowedQuery = allowedQuery.or(orFilters.join(','));
        }

        const { data: allowedProperties, error: propError } = await allowedQuery;
        if (propError) {
            return NextResponse.json({ error: propError.message }, { status: 500 });
        }

        const propertyNames = new Map<string, string>();
        (allowedProperties || []).forEach(p => propertyNames.set(p.id, p.name || 'Unnamed property'));

        // Narrow to the requested property / properties
        const requestedSingle = searchParams.get('propertyId');
        const requestedList = (searchParams.get('propertyIds') || '')
            .split(',')
            .map(s => s.trim())
            .filter(Boolean);

        const requested =
            requestedSingle && !['all', 'undefined', 'null', ''].includes(requestedSingle)
                ? [requestedSingle]
                : requestedList;

        let scopedIds = [...propertyNames.keys()];
        if (requested.length) {
            scopedIds = scopedIds.filter(id => requested.includes(id));
            if (!scopedIds.length) {
                return forbidden('Forbidden: no access to the requested properties');
            }
        }

        if (!scopedIds.length) {
            return NextResponse.json({
                success: true,
                range: { from, to },
                properties: [],
                days: [],
                propertyTotals: [],
                summary: shapeBucket(emptyBucket()),
                rows: [],
                truncated: false,
            });
        }

        // Fetch the checklist runs in range
        let query = supabaseAdmin
            .from('sop_completions')
            .select(`
                id,
                property_id,
                template_id,
                completion_date,
                slot_time,
                status,
                is_late,
                ai_avg_score,
                completed_at,
                due_at,
                approval_status,
                template:sop_templates(title, frequency, category),
                user:users!completed_by(full_name)
            `)
            .in('property_id', scopedIds)
            .gte('completion_date', from)
            .lte('completion_date', to)
            .order('completion_date', { ascending: false })
            .order('slot_time', { ascending: true })
            .limit(MAX_ROWS);

        if (templateId) {
            query = query.eq('template_id', templateId);
        }

        const { data: completions, error } = await query;
        if (error) {
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        const runs = (completions || []) as unknown as CompletionRun[];

        // Aggregate
        const overall = emptyBucket();
        const byDate = new Map<string, { totals: Bucket; byProperty: Map<string, Bucket> }>();
        const byProperty = new Map<string, Bucket>();

        for (const run of runs) {
            const date = run.completion_date;
            const pid = run.property_id;

            addToBucket(overall, run);

            if (!byDate.has(date)) byDate.set(date, { totals: emptyBucket(), byProperty: new Map() });
            const day = byDate.get(date)!;
            addToBucket(day.totals, run);

            if (!day.byProperty.has(pid)) day.byProperty.set(pid, emptyBucket());
            addToBucket(day.byProperty.get(pid)!, run);

            if (!byProperty.has(pid)) byProperty.set(pid, emptyBucket());
            addToBucket(byProperty.get(pid)!, run);
        }

        const days = [...byDate.entries()]
            .sort((a, b) => (a[0] < b[0] ? 1 : -1))
            .map(([date, entry]) => ({
                date,
                totals: shapeBucket(entry.totals),
                properties: [...entry.byProperty.entries()]
                    .map(([pid, bucket]) => ({
                        propertyId: pid,
                        propertyName: propertyNames.get(pid) || 'Unknown property',
                        ...shapeBucket(bucket),
                    }))
                    .sort((a, b) => a.propertyName.localeCompare(b.propertyName)),
            }));

        const propertyTotals = [...byProperty.entries()]
            .map(([pid, bucket]) => ({
                propertyId: pid,
                propertyName: propertyNames.get(pid) || 'Unknown property',
                ...shapeBucket(bucket),
            }))
            .sort((a, b) => a.propertyName.localeCompare(b.propertyName));

        const rows = runs.map(run => ({
            id: run.id,
            date: run.completion_date,
            propertyId: run.property_id,
            propertyName: propertyNames.get(run.property_id) || 'Unknown property',
            templateId: run.template_id,
            title: run.template?.title || 'Checklist',
            frequency: run.template?.frequency || null,
            category: run.template?.category || null,
            slotTime: run.slot_time ? String(run.slot_time).slice(0, 5) : null,
            status: run.status,
            isLate: !!run.is_late,
            score: typeof run.ai_avg_score === 'number' ? run.ai_avg_score : null,
            completedAt: run.completed_at,
            dueAt: run.due_at,
            approvalStatus: run.approval_status || null,
            completedBy: run.user?.full_name || null,
        }));

        return NextResponse.json({
            success: true,
            range: { from, to },
            properties: scopedIds
                .map(id => ({ id, name: propertyNames.get(id) || 'Unknown property' }))
                .sort((a, b) => a.name.localeCompare(b.name)),
            days,
            propertyTotals,
            summary: shapeBucket(overall),
            rows,
            truncated: runs.length >= MAX_ROWS,
        });
    } catch (err) {
        return NextResponse.json(
            { error: err instanceof Error ? err.message : 'Unknown error' },
            { status: 500 }
        );
    }
}
