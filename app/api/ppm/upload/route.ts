import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import * as XLSX from 'xlsx';
import { isCallerError } from '@/backend/lib/auth/callerAccess';
import {
    auditPpmBulkAction,
    fetchPropertySchedulesSnapshot,
    guardPpmAdminWrite,
    restorePpmBackupRows,
    summarizePpmRows,
    writePpmBackupSnapshot,
} from '@/backend/lib/ppm/scheduleGuard';

/**
 * POST /api/ppm/upload
 * Parses a 52-week PPM Excel file and inserts rows into ppm_schedules.
 *
 * Expected Excel format (row 3 = headers, row 4+ = data):
 * Col A: SI No | Col B: System Name | Col C: Details | Col D: Scope of Work
 * Col E: Frequency | Col F: Vendor Name | Col G: Location | Col H: Scope (repeat)
 * Col I: Maker | Col J: Checker
 * Then triplets: Planned Date | Done Date | Remark  (for each month Oct-Sep)
 */

// Month triplet start column index (0-based): col K = index 10
const MONTH_START_COL = 10;
const MONTHS_COUNT = 12;

export async function POST(request: NextRequest) {
    try {
        const formData = await request.formData();
        const file = formData.get('file') as File | null;
        const organizationId = formData.get('organization_id') as string | null;
        const propertyId = formData.get('property_id') as string | null;

        if (!file) {
            return NextResponse.json({ error: 'file, organization_id, and property_id are required' }, { status: 400 });
        }

        const caller = await guardPpmAdminWrite(request, organizationId, propertyId);
        if (isCallerError(caller)) return caller;
        const targetOrgId = organizationId as string;
        const targetPropertyId = propertyId as string;

        const buffer = Buffer.from(await file.arrayBuffer());
        // cellDates: false — keep dates as raw Excel serial numbers.
        // Converting via Date objects causes timezone shifts (IST midnight ≠ UTC midnight).
        // We convert serials ourselves using XLSX.SSF.parse_date_code which is pure arithmetic.
        const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: false });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true });

        const records: any[] = [];

        for (let r = 3; r < rows.length; r++) {
            const row = rows[r];
            if (!row || !row[1] && !row[2]) continue; // skip empty rows

            const siNo = row[0] != null ? String(row[0]).trim() : null;
            const systemName = row[1] != null ? String(row[1]).trim() : (row[2] ? '' : null);
            const detailName = row[2] != null ? String(row[2]).trim() : null;
            const scopeOfWork = row[3] != null ? String(row[3]).trim() : null;
            const frequency = row[4] != null ? String(row[4]).trim() : 'Quarterly';
            // Col F = Vendor Name (e.g. "Abtra Technologies") — the actual vendor company
            const vendorName = row[5] != null ? String(row[5]).trim() : null;
            const location = row[6] != null ? String(row[6]).trim() : null;
            // Col I = Maker — in this Excel it's a role label ("Vendor"/"Internal"), not a company name
            // Col J = Checker — internal person who verifies the task (e.g. "Mukesh Patil")
            const maker = row[8] != null ? String(row[8]).trim() : null;
            const checker = row[9] != null ? String(row[9]).trim() : null;
            // Responsible party: derive from maker column value
            const responsibleParty = maker?.toLowerCase() === 'vendor' ? 'vendor' : 'internal';

            const effectiveSystemName = systemName || detailName;
            if (!effectiveSystemName) continue;

            // Each month has 3 columns: planned_date, done_date, remark
            for (let m = 0; m < MONTHS_COUNT; m++) {
                const colBase = MONTH_START_COL + m * 3;
                const rawPlanned = row[colBase];
                if (!rawPlanned) continue; // no planned date for this month, skip

                const plannedDate = parseExcelDate(rawPlanned);
                // Debug: log first few rows to verify parsing
                if (r < 6 && m === 0) {
                }
                if (!plannedDate) continue;

                const rawDone = row[colBase + 1];
                const doneDate = rawDone ? parseExcelDate(rawDone) : null;
                const remark = row[colBase + 2] ? String(row[colBase + 2]).trim() : null;

                let status: string = 'pending';
                if (doneDate) status = 'done';
                else if (remark?.toLowerCase().includes('postponed')) status = 'postponed';

                records.push({
                    organization_id: targetOrgId,
                    property_id: targetPropertyId,
                    si_no: siNo,
                    system_name: effectiveSystemName,
                    detail_name: detailName,
                    scope_of_work: scopeOfWork,
                    frequency,
                    vendor_name: vendorName,
                    location,
                    maker,
                    checker,
                    planned_date: plannedDate,
                    done_date: doneDate,
                    remark,
                    status,
                });
            }
        }

        if (records.length === 0) {
            return NextResponse.json({ error: 'No valid PPM records found in the file' }, { status: 400 });
        }

        // Snapshot existing schedules before deleting so a failed insert can roll back cleanly
        // and every replacement is recoverable from audit_logs.
        const existingRows = await fetchPropertySchedulesSnapshot(targetOrgId, targetPropertyId);
        const previousSummary = summarizePpmRows(existingRows);
        let backupLogId: number | string | null = null;

        if (existingRows.length > 0) {
            const backup = await writePpmBackupSnapshot({
                eventBy: caller.userId,
                organizationId: targetOrgId,
                propertyId: targetPropertyId,
                triggerAction: 'ppm_schedules.replaced',
                rows: existingRows,
            });
            if (!backup.ok) {
                console.error('PPM upload backup failed:', backup.error);
                return NextResponse.json(
                    { error: 'Failed to create safety backup before replacing schedules; existing data was kept.' },
                    { status: 500 },
                );
            }
            backupLogId = backup.backupLogId ?? null;

            const { error: deleteError } = await supabaseAdmin
                .from('ppm_schedules')
                .delete()
                .eq('organization_id', targetOrgId)
                .eq('property_id', targetPropertyId);

            if (deleteError) {
                console.error('PPM delete error:', deleteError);
                return NextResponse.json(
                    { error: `Failed to replace existing schedules: ${deleteError.message}` },
                    { status: 500 },
                );
            }
        }

        // Batch insert with automatic rollback if any batch fails
        const BATCH = 200;
        for (let i = 0; i < records.length; i += BATCH) {
            const { error: insertError } = await supabaseAdmin
                .from('ppm_schedules')
                .insert(records.slice(i, i + BATCH));
            if (insertError) {
                console.error('PPM insert error:', insertError);
                let rolledBack = false;
                if (existingRows.length > 0) {
                    const rollback = await restorePpmBackupRows(targetOrgId, targetPropertyId, existingRows);
                    rolledBack = rollback.ok;
                    if (!rollback.ok) {
                        console.error('PPM upload rollback failed:', rollback.error);
                    }
                    await auditPpmBulkAction({
                        eventBy: caller.userId,
                        propertyId: targetPropertyId,
                        action: 'ppm_schedules.upload_rollback',
                        payload: {
                            organization_id: targetOrgId,
                            property_id: targetPropertyId,
                            actor_email: caller.email,
                            file_name: file.name,
                            insert_error: insertError.message,
                            rolled_back: rolledBack,
                            backup_audit_log_id: backupLogId,
                        },
                    });
                }
                return NextResponse.json(
                    {
                        error: rolledBack
                            ? `Insert failed (previous schedules restored): ${insertError.message}`
                            : `Insert failed: ${insertError.message}`,
                    },
                    { status: 500 },
                );
            }
        }

        await auditPpmBulkAction({
            eventBy: caller.userId,
            propertyId: targetPropertyId,
            action: 'ppm_schedules.replaced',
            payload: {
                organization_id: targetOrgId,
                property_id: targetPropertyId,
                actor_email: caller.email,
                file_name: file.name,
                deleted_count: existingRows.length,
                inserted_count: records.length,
                previous_summary: previousSummary,
                backup_audit_log_id: backupLogId,
            },
        });

        return NextResponse.json({
            success: true,
            inserted: records.length,
            replaced: existingRows.length,
            backupAuditLogId: backupLogId,
        });
    } catch (err) {
        console.error('PPM upload error:', err);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

/**
 * Converts an Excel cell value to YYYY-MM-DD string with NO timezone conversion.
 *
 * With cellDates:false (our setting), dates come as raw Excel serial numbers (integers).
 * XLSX.SSF.parse_date_code converts serials to {y,m,d} purely arithmetically — no Date
 * objects, no timezone shifts. This is the only reliable path.
 *
 * Strings (text-formatted date cells) are parsed by structure (DD-MM-YYYY etc.).
 * The `instanceof Date` path is a safety-net only — should not be reached.
 */
function parseExcelDate(value: any): string | null {
    if (!value) return null;

    // Primary path: Excel serial number → pure arithmetic conversion, no timezone
    if (typeof value === 'number') {
        const date = XLSX.SSF.parse_date_code(value);
        if (date && date.y > 1900) {
            return `${date.y}-${String(date.m).padStart(2, '0')}-${String(date.d).padStart(2, '0')}`;
        }
        return null;
    }

    // String path: text-formatted date cells
    if (typeof value === 'string') {
        const trimmed = value.trim();
        const parts = trimmed.split(/[-/.]/);
        if (parts.length === 3) {
            const [a, b, c] = parts;
            if (c.length === 4) {
                // DD-MM-YYYY → YYYY-MM-DD
                return `${c}-${b.padStart(2, '0')}-${a.padStart(2, '0')}`;
            }
            if (a.length === 4) {
                // YYYY-MM-DD already
                return `${a}-${b.padStart(2, '0')}-${c.padStart(2, '0')}`;
            }
        }
        return null; // unknown string format — skip rather than guess
    }

    // Safety-net: Date object (only reached if cellDates:true accidentally)
    if (value instanceof Date) {
        return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}-${String(value.getUTCDate()).padStart(2, '0')}`;
    }

    return null;
}
