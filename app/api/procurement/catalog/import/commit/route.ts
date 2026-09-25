import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { createAdminClient } from '@/frontend/utils/supabase/admin';
import {
    isProcurementUser,
    resolveOrganizationId,
    isMissingSchemaError,
    MISSING_SCHEMA_MESSAGE,
} from '@/backend/lib/procurement/catalogAccess';
import type { ExistingCatalogRow, LifecycleChange, StagedCatalogRow } from '@/backend/lib/procurement/catalogImport';

export const maxDuration = 120;

const INSERT_CHUNK_SIZE = 200;

/**
 * POST /api/procurement/catalog/import/commit
 *
 * Applies a previously previewed batch to procurement_catalog.
 * Body: { batch_id, organizationId?, legacy_ids?: string[], retire_ids?: string[] }
 *
 * Items the template did not mention are only touched if the uploader named
 * them. `legacy_ids` keeps an item fully usable and requestable but marks it as
 * being phased out; `retire_ids` hides it from new requisitions. Neither deletes
 * anything — historic requisitions and stock rows must keep resolving their
 * catalog item. Everything applied here is recorded in lifecycle_changes so the
 * whole batch can be undone via /rollback.
 */
export async function POST(request: NextRequest) {
    try {
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const body = await request.json();
        const batchId = body.batch_id as string | undefined;
        const legacyIds: string[] = Array.isArray(body.legacy_ids) ? body.legacy_ids : [];
        const retireIds: string[] = Array.isArray(body.retire_ids) ? body.retire_ids : [];

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
        if (batch.status === 'committed') {
            return NextResponse.json({ error: 'This import has already been applied.' }, { status: 409 });
        }
        if (batch.status !== 'previewed') {
            return NextResponse.json({ error: `This import can no longer be applied (${batch.status}).` }, { status: 409 });
        }
        if (batch.expires_at && new Date(batch.expires_at) < new Date()) {
            await adminSupabase.from('catalog_import_batches').update({ status: 'expired' }).eq('id', batchId);
            return NextResponse.json({ error: 'This preview has expired. Please upload the file again.' }, { status: 409 });
        }

        const staged: StagedCatalogRow[] = Array.isArray(batch.staged_rows) ? batch.staged_rows : [];
        const toCreate = staged.filter(r => r.action === 'create');
        const toUpdate = staged.filter(r => r.action === 'update');

        const now = new Date().toISOString();
        let createdCount = 0;
        let updatedCount = 0;
        const failures: Array<{ row: number; message: string }> = [];

        // ── Creates, chunked
        for (let i = 0; i < toCreate.length; i += INSERT_CHUNK_SIZE) {
            const chunk = toCreate.slice(i, i + INSERT_CHUNK_SIZE).map(r => ({
                organization_id: organizationId,
                is_active: true,
                import_batch_id: batchId,
                ...r.values,
            }));

            const { data, error } = await adminSupabase
                .from('procurement_catalog')
                .insert(chunk)
                .select('id');

            if (error) {
                console.error('[Catalog Commit] Insert chunk failed:', error);
                failures.push({
                    row: toCreate[i]?.rowNumber ?? 0,
                    message: `Rows ${toCreate[i]?.rowNumber}–${toCreate[Math.min(i + INSERT_CHUNK_SIZE, toCreate.length) - 1]?.rowNumber}: ${error.message}`,
                });
                continue;
            }
            createdCount += data?.length || 0;
        }

        // ── Updates, one row at a time so a single bad row cannot block the rest
        for (const row of toUpdate) {
            if (!row.existing_id) continue;

            const { error } = await adminSupabase
                .from('procurement_catalog')
                .update({ ...row.values, import_batch_id: batchId, updated_at: now })
                .eq('id', row.existing_id)
                .eq('organization_id', organizationId);

            if (error) {
                console.error(`[Catalog Commit] Update failed for row ${row.rowNumber}:`, error);
                failures.push({ row: row.rowNumber, message: error.message });
                continue;
            }
            updatedCount++;
        }

        // ── Opt-in lifecycle changes for items absent from the template.
        // Recorded before/after so /rollback can put them back exactly.
        const lifecycleChanges: LifecycleChange[] = [];
        let legacyCount = 0;
        let retiredCount = 0;

        // retire wins if an id were somehow passed in both lists
        const retireSet = new Set(retireIds);
        const legacySet = new Set(legacyIds.filter(id => !retireSet.has(id)));
        const affectedIds = [...retireSet, ...legacySet];

        if (affectedIds.length > 0) {
            const { data: beforeRows, error: beforeErr } = await adminSupabase
                .from('procurement_catalog')
                .select('id, name, lifecycle, is_active')
                .eq('organization_id', organizationId)
                .in('id', affectedIds);

            if (beforeErr) {
                console.error('[Catalog Commit] Could not read items before lifecycle change:', beforeErr);
                failures.push({ row: 0, message: `Could not apply lifecycle changes: ${beforeErr.message}` });
            } else {
                for (const before of (beforeRows || []) as Pick<ExistingCatalogRow, 'id' | 'name' | 'lifecycle' | 'is_active'>[]) {
                    const retiring = retireSet.has(before.id);
                    const patch = retiring
                        ? { lifecycle: 'retired', is_active: false, deactivated_at: now, updated_at: now }
                        : { lifecycle: 'legacy', updated_at: now };

                    const { error } = await adminSupabase
                        .from('procurement_catalog')
                        .update(patch)
                        .eq('id', before.id)
                        .eq('organization_id', organizationId);

                    if (error) {
                        console.error(`[Catalog Commit] Lifecycle change failed for ${before.name}:`, error);
                        failures.push({ row: 0, message: `${before.name}: ${error.message}` });
                        continue;
                    }

                    lifecycleChanges.push({
                        id: before.id,
                        name: before.name,
                        from_lifecycle: before.lifecycle || 'standard',
                        from_is_active: before.is_active,
                        to_lifecycle: retiring ? 'retired' : 'legacy',
                        to_is_active: retiring ? false : before.is_active,
                    });

                    if (retiring) retiredCount++; else legacyCount++;
                }
            }
        }

        await adminSupabase
            .from('catalog_import_batches')
            .update({
                status: 'committed',
                committed_at: now,
                created_count: createdCount,
                updated_count: updatedCount,
                legacy_count: legacyCount,
                deactivated_count: retiredCount,
                lifecycle_changes: lifecycleChanges,
                errors: [...(Array.isArray(batch.errors) ? batch.errors : []), ...failures.map(f => ({ row: f.row, errors: [f.message] }))],
            })
            .eq('id', batchId);

        return NextResponse.json({
            success: failures.length === 0,
            batch_id: batchId,
            created: createdCount,
            updated: updatedCount,
            unchanged: batch.unchanged_count || 0,
            marked_legacy: legacyCount,
            retired: retiredCount,
            skipped_errors: batch.error_count || 0,
            failures,
        });
    } catch (error) {
        console.error('[Catalog Import Commit] API Error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
