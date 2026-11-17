import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { isCallerError } from '@/backend/lib/auth/callerAccess';
import {
    auditPpmBulkAction,
    fetchPropertySchedulesSnapshot,
    guardPpmAdminWrite,
    summarizePpmRows,
    writePpmBackupSnapshot,
} from '@/backend/lib/ppm/scheduleGuard';

/**
 * DELETE /api/ppm/clear
 * Clears all PPM schedule records for a single property after admin auth check,
 * saving a recovery snapshot and writing an audit log entry.
 * Body: { organization_id, property_id }
 */
export async function DELETE(request: NextRequest) {
    try {
        const body = await request.json();
        const { organization_id, property_id } = body;

        const caller = await guardPpmAdminWrite(request, organization_id, property_id);
        if (isCallerError(caller)) return caller;

        const existingRows = await fetchPropertySchedulesSnapshot(organization_id, property_id);
        const summary = summarizePpmRows(existingRows);

        if (existingRows.length === 0) {
            await auditPpmBulkAction({
                eventBy: caller.userId,
                propertyId: property_id,
                action: 'ppm_schedules.cleared',
                payload: {
                    organization_id,
                    property_id,
                    actor_email: caller.email,
                    deleted_count: 0,
                    summary,
                },
            });
            return NextResponse.json({ success: true, deleted: 0 });
        }

        const backup = await writePpmBackupSnapshot({
            eventBy: caller.userId,
            organizationId: organization_id,
            propertyId: property_id,
            triggerAction: 'ppm_schedules.cleared',
            rows: existingRows,
        });
        if (!backup.ok) {
            console.error('PPM clear backup failed:', backup.error);
            return NextResponse.json(
                { error: 'Failed to create safety backup before clearing; no schedules were deleted.' },
                { status: 500 },
            );
        }

        const { error, count } = await supabaseAdmin
            .from('ppm_schedules')
            .delete({ count: 'exact' })
            .eq('organization_id', organization_id)
            .eq('property_id', property_id);

        if (error) return NextResponse.json({ error: error.message }, { status: 500 });

        const deletedCount = count ?? existingRows.length;
        await auditPpmBulkAction({
            eventBy: caller.userId,
            propertyId: property_id,
            action: 'ppm_schedules.cleared',
            payload: {
                organization_id,
                property_id,
                actor_email: caller.email,
                deleted_count: deletedCount,
                summary,
                backup_audit_log_id: backup.backupLogId ?? null,
            },
        });

        return NextResponse.json({
            success: true,
            deleted: deletedCount,
            backupAuditLogId: backup.backupLogId ?? null,
        });
    } catch (err) {
        console.error('PPM clear error:', err);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
