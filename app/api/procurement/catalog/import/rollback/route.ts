import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { createAdminClient } from '@/frontend/utils/supabase/admin';
import {
    isProcurementUser,
    resolveOrganizationId,
    isMissingSchemaError,
    MISSING_SCHEMA_MESSAGE,
} from '@/backend/lib/procurement/catalogAccess';
import type {
    CellValue,
    LifecycleChange,
    StagedCatalogRow,
} from '@/backend/lib/procurement/catalogImport';

export const maxDuration = 120;

/**
 * POST /api/procurement/catalog/import/rollback
 *
 * Undoes a committed template import. Body: { batch_id, organizationId? }
 *
 * The batch recorded the before-value of every field it changed and every
 * lifecycle change it applied, so the undo is exact:
 *   - fields it updated are put back to their previous values
 *   - items it created are deactivated (not deleted, so anything that already
 *     references them keeps resolving; re-importing the same code revives them)
 *   - items it marked legacy or retired go back to their previous state
 *
 * Only the most recent committed batch can be rolled back. A newer import may
 * have changed the same rows, and reverting under it would silently clobber it.
 */
export async function POST(request: NextRequest) {
    try {
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const body = await request.json();
        const batchId = body.batch_id as string | undefined;
        if (!batchId) return NextResponse.json({ error: 'batch_id is required' }, { status: 400 });

        const organizationId = await resolveOrganizationId(user.id, body.organizationId || null);
        if (!organizationId) return NextResponse.json({ error: 'Valid Organization ID is required' }, { status: 400 });

        if (!(await isProcurementUser(user.id, organizationId))) {
            return NextResponse.json({ error: 'Forbidden: procurement role required' }, { status: 403 });
        }

        const adminSupabase = createAdminClient();

        const { data: batch, error: batchErr } = await adminSupabase
            .from('catalog_import_batches')
            .select('*')
            .eq('id', batchId)
            .eq('organization_id', organizationId)
            .maybeSingle();

        if (isMissingSchemaError(batchErr)) {
            return NextResponse.json({ error: MISSING_SCHEMA_MESSAGE }, { status: 503 });
        }
        if (batchErr || !batch) {
            return NextResponse.json({ error: 'Import batch not found' }, { status: 404 });
        }
        if (batch.status === 'rolled_back') {
            return NextResponse.json({ error: 'This import has already been undone.' }, { status: 409 });
        }
        if (batch.status !== 'committed') {
            return NextResponse.json({ error: 'Only a committed import can be undone.' }, { status: 409 });
        }

        // ── Refuse to revert underneath a newer import
        const { data: newer } = await adminSupabase
            .from('catalog_import_batches')
            .select('id, file_name, committed_at')
            .eq('organization_id', organizationId)
            .eq('status', 'committed')
            .gt('committed_at', batch.committed_at)
            .order('committed_at', { ascending: true })
            .limit(1)
            .maybeSingle();

        if (newer) {
            return NextResponse.json({
                error: `A newer import ("${newer.file_name}") has been applied since this one. Undo that first, or correct the catalog with a fresh upload.`,
            }, { status: 409 });
        }

        const staged: StagedCatalogRow[] = Array.isArray(batch.staged_rows) ? batch.staged_rows : [];
        const lifecycleChanges: LifecycleChange[] = Array.isArray(batch.lifecycle_changes) ? batch.lifecycle_changes : [];
        const now = new Date().toISOString();

        let revertedUpdates = 0;
        let deactivatedCreates = 0;
        let restoredLifecycle = 0;
        const failures: string[] = [];

        // ── 1. Put updated fields back to their previous values
        const updatedIds = new Set<string>();
        for (const row of staged) {
            if (row.action !== 'update' || !row.existing_id) continue;
            updatedIds.add(row.existing_id);

            const patch: Record<string, CellValue> = { updated_at: now };
            for (const [field, change] of Object.entries(row.changes || {})) {
                patch[field] = change.from;
            }
            if (Object.keys(patch).length === 1) continue; // nothing but updated_at

            const { error } = await adminSupabase
                .from('procurement_catalog')
                .update(patch)
                .eq('id', row.existing_id)
                .eq('organization_id', organizationId);

            if (error) {
                console.error(`[Catalog Rollback] Revert failed for row ${row.rowNumber}:`, error);
                failures.push(`${row.name}: ${error.message}`);
                continue;
            }
            revertedUpdates++;
        }

        // ── 2. Deactivate the items this batch created
        const { data: createdRows, error: createdErr } = await adminSupabase
            .from('procurement_catalog')
            .select('id')
            .eq('organization_id', organizationId)
            .eq('import_batch_id', batchId);

        if (createdErr) {
            console.error('[Catalog Rollback] Could not list created items:', createdErr);
            failures.push(`Could not list created items: ${createdErr.message}`);
        } else {
            const createdOnlyIds = (createdRows || [])
                .map(r => r.id)
                .filter(id => !updatedIds.has(id));

            if (createdOnlyIds.length > 0) {
                const { data, error } = await adminSupabase
                    .from('procurement_catalog')
                    .update({ is_active: false, lifecycle: 'retired', deactivated_at: now, updated_at: now })
                    .eq('organization_id', organizationId)
                    .in('id', createdOnlyIds)
                    .select('id');

                if (error) {
                    console.error('[Catalog Rollback] Could not deactivate created items:', error);
                    failures.push(`Could not deactivate created items: ${error.message}`);
                } else {
                    deactivatedCreates = data?.length || 0;
                }
            }
        }

        // ── 3. Restore items this batch marked legacy or retired
        for (const change of lifecycleChanges) {
            const { error } = await adminSupabase
                .from('procurement_catalog')
                .update({
                    lifecycle: change.from_lifecycle,
                    is_active: change.from_is_active,
                    deactivated_at: change.from_is_active ? null : now,
                    updated_at: now,
                })
                .eq('id', change.id)
                .eq('organization_id', organizationId);

            if (error) {
                console.error(`[Catalog Rollback] Could not restore ${change.name}:`, error);
                failures.push(`${change.name}: ${error.message}`);
                continue;
            }
            restoredLifecycle++;
        }

        await adminSupabase
            .from('catalog_import_batches')
            .update({ status: 'rolled_back', rolled_back_at: now, rolled_back_by: user.id })
            .eq('id', batchId);

        return NextResponse.json({
            success: failures.length === 0,
            batch_id: batchId,
            reverted_updates: revertedUpdates,
            deactivated_new_items: deactivatedCreates,
            restored_items: restoredLifecycle,
            failures,
        });
    } catch (error) {
        console.error('[Catalog Import Rollback] API Error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
