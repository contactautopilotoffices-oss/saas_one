import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { logAudit } from '@/backend/lib/audit';
import {
    CallerAccess,
    ORG_ADMIN_ROLES,
    forbidden,
    isCallerError,
    isOrgAdmin,
    propertyOrgId,
    resolveCaller,
} from '@/backend/lib/auth/callerAccess';

/** Property-level roles permitted to bulk-replace or clear a property's PPM schedules. */
export const PPM_PROPERTY_ADMIN_ROLES = ['property_admin', 'admin', 'owner', ...ORG_ADMIN_ROLES];

export interface PpmScheduleSummary {
    total: number;
    done: number;
    pending: number;
    postponed: number;
    skipped: number;
    with_attachments: number;
}

/**
 * Pure role check: master admins, org admins of organizationId, or property admins of propertyId.
 */
export function canAdministerPpmProperty(
    caller: CallerAccess,
    organizationId: string,
    propertyId: string,
): boolean {
    if (isOrgAdmin(caller, organizationId)) return true;
    return caller.propertyMemberships.some(
        m => m.property_id === propertyId && PPM_PROPERTY_ADMIN_ROLES.includes(m.role),
    );
}

/**
 * Shared guard for destructive/bulk-replacing PPM routes (`clear` and `upload`).
 * Enforces:
 * 1. Both organization_id and property_id are present (never allow org-wide wipes).
 * 2. Caller is authenticated.
 * 3. Property exists and belongs to organization_id.
 * 4. Caller is an org admin or property admin for that property.
 */
export async function guardPpmAdminWrite(
    request: Request | NextRequest,
    organizationId: string | null | undefined,
    propertyId: string | null | undefined,
): Promise<CallerAccess | NextResponse> {
    if (!organizationId || !propertyId) {
        return NextResponse.json(
            { error: 'organization_id and property_id are required' },
            { status: 400 },
        );
    }

    const caller = await resolveCaller(request);
    if (isCallerError(caller)) return caller;

    const ownerOrgId = await propertyOrgId(propertyId);
    if (!ownerOrgId) {
        return NextResponse.json({ error: 'Property not found' }, { status: 404 });
    }
    if (ownerOrgId !== organizationId) {
        return NextResponse.json(
            { error: 'Property does not belong to this organization' },
            { status: 400 },
        );
    }

    if (!canAdministerPpmProperty(caller, organizationId, propertyId)) {
        return forbidden('Forbidden: only organization or property admins can modify or clear PPM schedules');
    }

    return caller;
}

/** Summarize existing PPM rows for audit logs. */
export function summarizePpmRows(rows: Record<string, any>[]): PpmScheduleSummary {
    let done = 0;
    let pending = 0;
    let postponed = 0;
    let skipped = 0;
    let withAttachments = 0;

    for (const r of rows) {
        if (r.status === 'done') done++;
        else if (r.status === 'postponed') postponed++;
        else if (r.status === 'skipped') skipped++;
        else pending++;

        const hasAttachmentsObj =
            r.attachments && typeof r.attachments === 'object' && Object.keys(r.attachments).length > 0;
        const hasPhotos = Array.isArray(r.completion_photos) && r.completion_photos.length > 0;
        if (hasAttachmentsObj || hasPhotos || r.completion_doc_url || r.invoice_url) {
            withAttachments++;
        }
    }

    return {
        total: rows.length,
        done,
        pending,
        postponed,
        skipped,
        with_attachments: withAttachments,
    };
}

/**
 * Fetch all current ppm_schedules rows for a property (paginated so >1,000 rows are never truncated).
 */
export async function fetchPropertySchedulesSnapshot(
    organizationId: string,
    propertyId: string,
): Promise<Record<string, any>[]> {
    const all: Record<string, any>[] = [];
    const pageSize = 1000;
    let from = 0;

    while (true) {
        const { data, error } = await supabaseAdmin
            .from('ppm_schedules')
            .select('*')
            .eq('organization_id', organizationId)
            .eq('property_id', propertyId)
            .order('created_at', { ascending: true })
            .order('id', { ascending: true })
            .range(from, from + pageSize - 1);

        if (error) {
            throw new Error(`Snapshot fetch failed: ${error.message}`);
        }
        if (!data || data.length === 0) break;
        all.push(...data);
        if (data.length < pageSize) break;
        from += pageSize;
    }

    return all;
}

/**
 * Persist a full pre-delete recovery snapshot in audit_logs (RLS-protected, admin client).
 * Aborts the caller if the backup insert fails so destructive operations never run unprotected.
 */
export async function writePpmBackupSnapshot(params: {
    eventBy: string;
    organizationId: string;
    propertyId: string;
    triggerAction: 'ppm_schedules.cleared' | 'ppm_schedules.replaced';
    rows: Record<string, any>[];
}): Promise<{ ok: boolean; backupLogId?: number | string | null; error?: string }> {
    const { data, error } = await supabaseAdmin
        .from('audit_logs')
        .insert({
            event_by: params.eventBy,
            object_type: 'ppm_schedules_backup',
            object_id: params.propertyId,
            action: 'ppm_schedules.backup_snapshot',
            payload: {
                organization_id: params.organizationId,
                property_id: params.propertyId,
                trigger_action: params.triggerAction,
                summary: summarizePpmRows(params.rows),
                rows: params.rows,
            },
        })
        .select('id')
        .single();

    if (error) {
        return { ok: false, error: error.message };
    }

    return { ok: true, backupLogId: data?.id ?? null };
}

/**
 * Roll back a failed replacement upload by removing any partial new rows and restoring the backup.
 */
export async function restorePpmBackupRows(
    organizationId: string,
    propertyId: string,
    backupRows: Record<string, any>[],
): Promise<{ ok: boolean; error?: string }> {
    const { error: cleanupError } = await supabaseAdmin
        .from('ppm_schedules')
        .delete()
        .eq('organization_id', organizationId)
        .eq('property_id', propertyId);

    if (cleanupError) {
        return { ok: false, error: cleanupError.message };
    }

    const BATCH = 200;
    for (let i = 0; i < backupRows.length; i += BATCH) {
        const { error: restoreError } = await supabaseAdmin
            .from('ppm_schedules')
            .insert(backupRows.slice(i, i + BATCH));
        if (restoreError) {
            return { ok: false, error: restoreError.message };
        }
    }

    return { ok: true };
}

/** Write a lightweight summary record to audit_logs via the shared audit helper. */
export async function auditPpmBulkAction(params: {
    eventBy: string;
    propertyId: string;
    action: 'ppm_schedules.cleared' | 'ppm_schedules.replaced' | 'ppm_schedules.upload_rollback';
    payload: Record<string, unknown>;
}): Promise<void> {
    await logAudit({
        eventBy: params.eventBy,
        objectType: 'ppm_schedules',
        objectId: params.propertyId,
        action: params.action,
        payload: params.payload,
    });
}
