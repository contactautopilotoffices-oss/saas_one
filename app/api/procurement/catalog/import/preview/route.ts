import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';
import { createClient } from '@/frontend/utils/supabase/server';
import { createAdminClient } from '@/frontend/utils/supabase/admin';
import {
    isProcurementUser,
    resolveOrganizationId,
    ensureCatalogPhotoBucket,
    isMissingSchemaError,
    CATALOG_PHOTO_BUCKET,
    MISSING_SCHEMA_MESSAGE,
} from '@/backend/lib/procurement/catalogAccess';
import {
    parseCatalogTemplateWorkbook,
    normalizeItemName,
    generateItemCode,
    MAX_TEMPLATE_ROWS,
    type ParsedTemplateRow,
    type ParsedPhoto,
} from '@/backend/lib/procurement/catalogTemplate';
import type {
    AbsentCatalogItem,
    CellValue,
    ExistingCatalogRow,
    StagedCatalogRow,
} from '@/backend/lib/procurement/catalogImport';

export const maxDuration = 120;

/** Fields compared to decide create vs update vs unchanged. A blank cell never clears an existing value. */
const DIFFABLE_FIELDS = [
    'name',
    'category',
    'brand',
    'color_size_details',
    'unit',
    'unit_price',
    'sort_order',
    'description',
] as const;

/** Normalise a photo into a stored public URL. Embedded pictures are converted to webp. */
async function persistPhoto(
    photo: ParsedPhoto,
    organizationId: string,
    itemCode: string,
): Promise<{ url: string | null; error?: string }> {
    if (photo.kind === 'url') return { url: photo.url || null };
    if (!photo.buffer) return { url: null };

    const adminSupabase = createAdminClient();
    let body: Buffer = photo.buffer;
    let contentType = 'image/webp';
    let extension = 'webp';

    try {
        body = await sharp(photo.buffer)
            .rotate()
            .resize(800, 800, { fit: 'inside', withoutEnlargement: true })
            .webp({ quality: 80 })
            .toBuffer();
    } catch (err) {
        // Keep the original bytes rather than losing the picture entirely.
        console.warn('[Catalog Import] sharp conversion failed, storing original:', err);
        extension = (photo.extension || 'png').replace(/[^a-z0-9]/gi, '') || 'png';
        contentType = `image/${extension === 'jpg' ? 'jpeg' : extension}`;
    }

    const safeCode = itemCode.replace(/[^a-zA-Z0-9\-_]/g, '-').toLowerCase() || 'item';
    const path = `${organizationId}/${safeCode}-${Date.now()}.${extension}`;

    const { error } = await adminSupabase.storage
        .from(CATALOG_PHOTO_BUCKET)
        .upload(path, body, { contentType, upsert: true });

    if (error) {
        console.error('[Catalog Import] Photo upload failed:', error);
        return { url: null, error: 'Photo could not be uploaded' };
    }

    const { data } = adminSupabase.storage.from(CATALOG_PHOTO_BUCKET).getPublicUrl(path);
    return { url: data.publicUrl };
}

function valuesDiffer(field: string, incoming: CellValue, current: CellValue): boolean {
    if (field === 'unit_price' || field === 'sort_order') {
        return Number(incoming ?? 0) !== Number(current ?? 0);
    }
    return String(incoming ?? '').trim() !== String(current ?? '').trim();
}

/**
 * POST /api/procurement/catalog/import/preview
 *
 * Reads an uploaded template, classifies every row against the existing catalog
 * and stages the result as a batch. Nothing is written into procurement_catalog
 * here — the uploader reviews the diff and then calls /commit.
 */
export async function POST(request: NextRequest) {
    try {
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        let formData: FormData;
        try {
            formData = await request.formData();
        } catch {
            return NextResponse.json({ error: 'Expected a multipart upload containing the template file' }, { status: 400 });
        }

        const file = formData.get('file') as File | null;
        const organizationId = await resolveOrganizationId(user.id, formData.get('organizationId') as string | null);

        if (!file) return NextResponse.json({ error: 'No file was uploaded' }, { status: 400 });
        if (!organizationId) return NextResponse.json({ error: 'Valid Organization ID is required' }, { status: 400 });

        if (!(await isProcurementUser(user.id, organizationId))) {
            return NextResponse.json({ error: 'Forbidden: procurement role required' }, { status: 403 });
        }

        const fileBuffer = Buffer.from(await file.arrayBuffer());
        const parsed = await parseCatalogTemplateWorkbook(fileBuffer);

        if (parsed.fatalError) {
            return NextResponse.json({ error: parsed.fatalError }, { status: 422 });
        }
        if (parsed.missingRequired.length > 0) {
            return NextResponse.json({
                error: `The file is missing required column(s): ${parsed.missingRequired.join(', ')}. Download the template and keep its header row intact.`,
                headerMap: parsed.headerMap,
            }, { status: 422 });
        }
        if (parsed.rows.length === 0) {
            return NextResponse.json({ error: 'The template has headers but no item rows.' }, { status: 422 });
        }

        const adminSupabase = createAdminClient();

        const { data: existingRows, error: fetchErr } = await adminSupabase
            .from('procurement_catalog')
            .select('id, item_code, name, category, brand, color_size_details, unit, unit_price, estimated_price, photo_url, sort_order, description, is_active, lifecycle')
            .eq('organization_id', organizationId);

        if (fetchErr) {
            console.error('[Catalog Import] Failed to load existing catalog:', fetchErr);
            if (isMissingSchemaError(fetchErr)) {
                return NextResponse.json({ error: MISSING_SCHEMA_MESSAGE }, { status: 503 });
            }
            return NextResponse.json({ error: 'Database error' }, { status: 500 });
        }

        const byCode = new Map<string, ExistingCatalogRow>();
        const byName = new Map<string, ExistingCatalogRow>();
        for (const row of (existingRows || []) as ExistingCatalogRow[]) {
            if (row.item_code) byCode.set(String(row.item_code).toLowerCase(), row);
            if (row.is_active) byName.set(normalizeItemName(row.name), row);
        }

        // Codes already taken, so generated codes never collide with an existing one.
        const usedCodes = new Set<string>(Array.from(byCode.keys()));
        let codeSequence = 1;
        const nextGeneratedCode = (row: ParsedTemplateRow): string => {
            let candidate = generateItemCode(row.category, codeSequence++);
            while (usedCodes.has(candidate.toLowerCase())) {
                candidate = generateItemCode(row.category, codeSequence++);
            }
            usedCodes.add(candidate.toLowerCase());
            return candidate;
        };

        await ensureCatalogPhotoBucket();

        const staged: StagedCatalogRow[] = [];
        const seenCodesInFile = new Map<string, number>();
        const seenNamesInFile = new Map<string, number>();
        const touchedIds = new Set<string>();
        let photoCount = 0;

        for (const row of parsed.rows) {
            const errors = [...row.errors];
            const codeKey = row.item_code.trim().toLowerCase();
            const nameKey = normalizeItemName(row.name);

            // ── Duplicates inside the uploaded file itself
            if (codeKey) {
                const firstRow = seenCodesInFile.get(codeKey);
                if (firstRow !== undefined) {
                    errors.push(`Item Code "${row.item_code}" is also used on row ${firstRow}`);
                } else {
                    seenCodesInFile.set(codeKey, row.rowNumber);
                }
            }
            if (nameKey) {
                const firstRow = seenNamesInFile.get(nameKey);
                if (firstRow !== undefined && !codeKey) {
                    errors.push(`"${row.name}" also appears on row ${firstRow}`);
                } else if (firstRow === undefined) {
                    seenNamesInFile.set(nameKey, row.rowNumber);
                }
            }

            // ── Match an existing catalog row: code first, then name
            const existing = (codeKey && byCode.get(codeKey)) || (!codeKey && byName.get(nameKey)) || null;

            if (existing && touchedIds.has(existing.id)) {
                errors.push(`Row ${row.rowNumber} targets an item already updated earlier in this file`);
            }

            if (errors.length > 0) {
                staged.push({
                    rowNumber: row.rowNumber,
                    action: 'error',
                    existing_id: existing?.id || null,
                    item_code: row.item_code,
                    name: row.name,
                    changes: {},
                    values: {},
                    photo_url: null,
                    errors,
                });
                continue;
            }

            // ── Photo: stored now so commit is a pure database write
            let photoUrl: string | null = null;
            if (row.photo) {
                const result = await persistPhoto(row.photo, organizationId, row.item_code || nameKey || 'item');
                if (result.error) errors.push(result.error);
                photoUrl = result.url;
                if (photoUrl) photoCount++;
            }

            // Blank optional cells mean "leave as is", so they are never written as null over existing data.
            const incoming: Record<string, CellValue> = {
                name: row.name,
                category: row.category,
                brand: row.brand || null,
                color_size_details: row.color_size_details || null,
                unit: row.unit || 'pcs',
                unit_price: row.unit_price,
                sort_order: row.sort_order,
                description: row.description || null,
            };

            if (!existing) {
                const itemCode = row.item_code.trim() || nextGeneratedCode(row);
                staged.push({
                    rowNumber: row.rowNumber,
                    action: 'create',
                    existing_id: null,
                    item_code: itemCode,
                    name: row.name,
                    changes: {},
                    values: {
                        item_code: itemCode,
                        lifecycle: 'standard',
                        name: row.name,
                        category: row.category,
                        brand: incoming.brand,
                        color_size_details: incoming.color_size_details,
                        unit: incoming.unit,
                        unit_price: row.unit_price ?? 0,
                        estimated_price: row.unit_price ?? 0,
                        sort_order: row.sort_order ?? 0,
                        description: incoming.description,
                        photo_url: photoUrl,
                    },
                    photo_url: photoUrl,
                    errors: [],
                });
                continue;
            }

            touchedIds.add(existing.id);

            const changes: Record<string, { from: CellValue; to: CellValue }> = {};
            const updateValues: Record<string, CellValue> = {};

            for (const field of DIFFABLE_FIELDS) {
                const value = incoming[field];
                const isBlank = value === null || value === undefined || value === '';
                if (isBlank) continue;

                const current = field === 'unit_price'
                    ? (existing.unit_price ?? existing.estimated_price)
                    : existing[field];

                if (valuesDiffer(field, value, current)) {
                    changes[field] = { from: current ?? null, to: value };
                    updateValues[field] = value;
                    if (field === 'unit_price') updateValues.estimated_price = value;
                }
            }

            if (photoUrl && photoUrl !== existing.photo_url) {
                changes.photo_url = { from: existing.photo_url || null, to: photoUrl };
                updateValues.photo_url = photoUrl;
            }
            if (!existing.is_active) {
                changes.is_active = { from: false, to: true };
                updateValues.is_active = true;
                updateValues.deactivated_at = null;
            }
            // Appearing on the template promotes an item back to standard.
            if (existing.lifecycle !== 'standard') {
                changes.lifecycle = { from: existing.lifecycle, to: 'standard' };
                updateValues.lifecycle = 'standard';
            }
            if (row.item_code.trim() && !existing.item_code) {
                updateValues.item_code = row.item_code.trim();
            }

            staged.push({
                rowNumber: row.rowNumber,
                action: Object.keys(changes).length > 0 ? 'update' : 'unchanged',
                existing_id: existing.id,
                item_code: existing.item_code || row.item_code,
                name: row.name,
                changes,
                values: updateValues,
                photo_url: photoUrl,
                errors: [],
            });
        }

        // ── Active items the file does not mention.
        // Listed with their live stock footprint so the uploader can decide
        // per item whether to keep, mark legacy, or retire. Nothing is automatic.
        const absentRows = ((existingRows || []) as ExistingCatalogRow[])
            .filter(r => r.is_active && !touchedIds.has(r.id));

        const stockByCatalogItem = new Map<string, { properties: Set<string>; qty: number }>();
        if (absentRows.length > 0) {
            const { data: stockRows, error: stockErr } = await adminSupabase
                .from('stock_items')
                .select('catalog_item_id, property_id, quantity')
                .in('catalog_item_id', absentRows.map(r => r.id));

            if (stockErr) {
                // Not fatal — the uploader just loses the "still held on site" hint.
                console.warn('[Catalog Import] Could not load stock footprint:', stockErr);
            }

            for (const row of stockRows || []) {
                if (!row.catalog_item_id) continue;
                const entry = stockByCatalogItem.get(row.catalog_item_id)
                    || { properties: new Set<string>(), qty: 0 };
                if (row.property_id) entry.properties.add(row.property_id);
                entry.qty += Number(row.quantity) || 0;
                stockByCatalogItem.set(row.catalog_item_id, entry);
            }
        }

        const absentItems: AbsentCatalogItem[] = absentRows.map(r => {
            const stock = stockByCatalogItem.get(r.id);
            return {
                id: r.id,
                item_code: r.item_code,
                name: r.name,
                category: r.category,
                lifecycle: r.lifecycle || 'standard',
                stock_property_count: stock?.properties.size || 0,
                stock_total_qty: stock?.qty || 0,
            };
        });

        const counts = {
            row_count: staged.length,
            created_count: staged.filter(r => r.action === 'create').length,
            updated_count: staged.filter(r => r.action === 'update').length,
            unchanged_count: staged.filter(r => r.action === 'unchanged').length,
            error_count: staged.filter(r => r.action === 'error').length,
            photo_count: photoCount,
        };

        const { data: batch, error: batchErr } = await adminSupabase
            .from('catalog_import_batches')
            .insert({
                organization_id: organizationId,
                uploaded_by: user.id,
                file_name: file.name,
                ...counts,
                deactivated_count: 0,
                status: 'previewed',
                staged_rows: staged,
                errors: staged.filter(r => r.errors.length > 0).map(r => ({ row: r.rowNumber, errors: r.errors })),
            })
            .select('id, created_at, expires_at')
            .single();

        if (batchErr) {
            console.error('[Catalog Import] Failed to stage batch:', batchErr);
            if (isMissingSchemaError(batchErr)) {
                return NextResponse.json({ error: MISSING_SCHEMA_MESSAGE }, { status: 503 });
            }
            return NextResponse.json({ error: 'Could not stage this import' }, { status: 500 });
        }

        return NextResponse.json({
            batch_id: batch.id,
            expires_at: batch.expires_at,
            file_name: file.name,
            header_map: parsed.headerMap,
            unmatched_headers: parsed.unmatchedHeaders,
            truncated: parsed.rows.length >= MAX_TEMPLATE_ROWS,
            counts,
            // Full detail lives in the batch; the response carries enough to review.
            rows: staged.slice(0, 300),
            rows_returned: Math.min(staged.length, 300),
            absent_items: absentItems,
        });
    } catch (error) {
        console.error('[Catalog Import Preview] API Error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
