import { NextRequest, NextResponse } from 'next/server';
import {
    resolveCommandCenterAccess,
    isCommandCenterAccessError,
    type CommandCenterAccess,
} from '@/backend/lib/commandCenter/access';
import { MAX_REPORT_DAYS } from '@/backend/lib/reports/taskManagerUsage/schedule';

/**
 * The Task Manager Usage Report is for org super admins only, the same rule as the App Usage Report: `isSuperAdmin` is a
 * master admin, or org_super_admin of the resolved organisation. The reporting data itself is read with the service role,
 * so this check is what protects it.
 */
export async function requireReportViewer(request: NextRequest, orgId: string | null): Promise<CommandCenterAccess | NextResponse> {
    const access = await resolveCommandCenterAccess(request, orgId);
    if (isCommandCenterAccessError(access)) return access;
    if (!access.isSuperAdmin) {
        return NextResponse.json({ error: 'Forbidden: the Task Manager report is for org super admins' }, { status: 403 });
    }
    return access;
}

const IST_OFFSET_MS = 330 * 60 * 1000;

const isDay = (v: unknown): v is string => {
    if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
    const t = Date.parse(`${v}T00:00:00Z`);
    return !isNaN(t) && new Date(t).toISOString().slice(0, 10) === v;
};

/** Checks a requested range. Days are IST and inclusive, and a report cannot reach past today. */
export function readRange(from: unknown, to: unknown): { ok: true; from: string; to: string } | { ok: false; error: string } {
    if (!isDay(from) || !isDay(to)) return { ok: false, error: 'Choose a valid start and end date.' };
    if (from > to) return { ok: false, error: 'The start date must be on or before the end date.' };
    if (to > new Date(Date.now() + IST_OFFSET_MS).toISOString().slice(0, 10)) return { ok: false, error: 'The end date cannot be in the future.' };
    const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
    if (days > MAX_REPORT_DAYS) return { ok: false, error: `A report can cover at most ${MAX_REPORT_DAYS} days.` };
    return { ok: true, from, to };
}
