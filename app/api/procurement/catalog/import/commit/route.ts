import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { createAdminClient } from '@/frontend/utils/supabase/admin';
import { isProcurementUser, resolveOrganizationId } from '@/backend/lib/procurement/catalogAccess';
import type { StagedCatalogRow } from '@/backend/lib/procurement/catalogImport';

export const maxDuration = 120;

const INSERT_CHUNK_SIZE = 200;

/**
 * POST /api/procurement/catalog/import/commit
 *
 * Applies a previously previewed batch to procurement_catalog.
 * Body: { batch_id, organizationId?, deactivate_ids?: string[] }
 *
 * Deactivation is opt-in per item and is a soft close (is_active = false) —
 * historic requisitions and stock rows must keep resolving their catalog item.
 */
export async function POST(request: NextRequest) {
    try {
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const body = await request.json();
        const batchId = body.batch_id as string | undefined;
        const deactivateIds: string[] = Array.isArray(body.deactivate_ids) ? body.deactivate_ids : [];

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

        // ── Opt-in deactivations
        let deactivatedCount = 0;
        if (deactivateIds.length > 0) {
            const { data, error } = await adminSupabase
                .from('procurement_catalog')
                .update({ is_active: false, deactivated_at: now, updated_at: now })
                .eq('organization_id', organizationId)
                .in('id', deactivateIds)
                .select('id');

            if (error) {
                console.error('[Catalog Commit] Deactivation failed:', error);
                failures.push({ row: 0, message: `Deactivation failed: ${error.message}` });
            } else {
                deactivatedCount = data?.length || 0;
            }
        }

        await adminSupabase
            .from('catalog_import_batches')
            .update({
                status: 'committed',
                committed_at: now,
                created_count: createdCount,
                updated_count: updatedCount,
                deactivated_count: deactivatedCount,
                errors: [...(Array.isArray(batch.errors) ? batch.errors : []), ...failures.map(f => ({ row: f.row, errors: [f.message] }))],
            })
            .eq('id', batchId);

        return NextResponse.json({
            success: failures.length === 0,
            batch_id: batchId,
            created: createdCount,
            updated: updatedCount,
            unchanged: batch.unchanged_count || 0,
            deactivated: deactivatedCount,
            skipped_errors: batch.error_count || 0,
            failures,
        });
    } catch (error) {
        console.error('[Catalog Import Commit] API Error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
