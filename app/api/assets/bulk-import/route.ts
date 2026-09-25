import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { resolveAssetAccess, isAssetAccessError, readOrgId, canAccessProperty } from '@/backend/lib/assets/access';
import { parseAssetFile, type ImportError, type ImportRowInput } from '@/backend/lib/assets/import';

const MAX_ROWS = 2000;

/**
 * POST /api/assets/bulk-import — multipart form: file, property_id, organization_id, mode.
 * mode=validate (default): parse + validate only, no writes, returns a preview.
 * mode=import: parse, validate, then insert in batches; a per-row error skips that row only.
 */
export async function POST(request: NextRequest) {
    const form = await request.formData();
    const file = form.get('file') as File | null;
    const propertyId = String(form.get('property_id') || '');
    const mode = (String(form.get('mode') || 'validate') === 'import') ? 'import' : 'validate';

    const access = await resolveAssetAccess(request, readOrgId(request, { organization_id: form.get('organization_id') }));
    if (isAssetAccessError(access)) return access;
    if (!access.canManage) return NextResponse.json({ error: 'Forbidden: you cannot import assets' }, { status: 403 });
    if (!file) return NextResponse.json({ error: 'file is required' }, { status: 400 });
    if (!propertyId) return NextResponse.json({ error: 'property_id is required' }, { status: 400 });
    if (!canAccessProperty(access, propertyId)) return NextResponse.json({ error: 'Forbidden: no access to this property' }, { status: 403 });

    const { rows, errors: parseErrors, unmapped } = await parseAssetFile(file);
    if (rows.length > MAX_ROWS) {
        return NextResponse.json({ error: `Too many rows (${rows.length}). Split the file — max ${MAX_ROWS} per import.` }, { status: 413 });
    }

    const { data: categories } = await supabaseAdmin
        .from('asset_categories')
        .select('id, name, code, organization_id')
        .or(`organization_id.eq.${access.organizationId},organization_id.is.null`)
        .eq('is_active', true);
    const catByName = new Map<string, { id: string; code: string }>();
    for (const c of (categories || []).sort((a, b) => (a.organization_id ? 1 : 0) - (b.organization_id ? 1 : 0))) {
        catByName.set(c.name.toLowerCase(), { id: c.id, code: c.code });
        catByName.set(c.code.toLowerCase(), { id: c.id, code: c.code });
    }

    const errors: ImportError[] = [...parseErrors];
    const { data: existingCodes } = await supabaseAdmin.from('assets').select('asset_code').eq('organization_id', access.organizationId);
    const codeSet = new Set((existingCodes || []).map((r) => r.asset_code.toUpperCase()));
    const seenInFile = new Set<string>();

    type Resolved = ImportRowInput & { category_id: string; category_code: string };
    const resolved: Resolved[] = [];

    for (const row of rows) {
        if (!row.name || !row.category) continue; // already flagged by the parser
        const cat = catByName.get(row.category.toLowerCase());
        if (!cat) {
            errors.push({ row: row.row, field: 'Category', message: `"${row.category}" is not a known category — check the Categories tab or the template's category list` });
            continue;
        }
        if (row.asset_code) {
            const norm = row.asset_code.toUpperCase();
            if (codeSet.has(norm)) { errors.push({ row: row.row, field: 'Asset Code', message: `"${row.asset_code}" already exists in this organization` }); continue; }
            if (seenInFile.has(norm)) { errors.push({ row: row.row, field: 'Asset Code', message: `"${row.asset_code}" is duplicated in this file` }); continue; }
            seenInFile.add(norm);
        }
        if (row.warranty_start && row.warranty_end && row.warranty_start > row.warranty_end) {
            errors.push({ row: row.row, field: 'Warranty End', message: 'Warranty End is before Warranty Start' });
            continue;
        }
        resolved.push({ ...row, category_id: cat.id, category_code: cat.code });
    }

    if (mode === 'validate') {
        return NextResponse.json({
            success: true,
            total: rows.length,
            valid: resolved.length,
            invalid: rows.length - resolved.length,
            errors: errors.slice(0, 200),
            preview: resolved.slice(0, 50),
            unmapped_columns: unmapped,
        });
    }

    // mode=import — generate codes (sequenced per property+category) and insert in batches.
    let imported = 0;
    const insertErrors: ImportError[] = [...errors];
    const created: { id: string; asset_code: string; name: string; qr_token: string }[] = [];
    const BATCH = 300;
    for (let i = 0; i < resolved.length; i += BATCH) {
        const batch = resolved.slice(i, i + BATCH);
        const records = [];
        for (const row of batch) {
            let code = row.asset_code?.trim();
            if (!code) {
                const { data: generated, error: genErr } = await supabaseAdmin.rpc('generate_asset_code', {
                    p_org_id: access.organizationId, p_property_id: propertyId, p_category_code: row.category_code,
                });
                if (genErr) { insertErrors.push({ row: row.row, field: 'Asset Code', message: `Could not generate code: ${genErr.message}` }); continue; }
                code = generated as string;
            }
            records.push({
                organization_id: access.organizationId,
                property_id: propertyId,
                category_id: row.category_id,
                asset_code: code,
                name: row.name,
                asset_type: row.asset_type || null,
                make: row.make || null,
                model: row.model || null,
                serial_number: row.serial_number || null,
                floor: row.floor || null,
                location: row.location || null,
                installation_date: row.installation_date || null,
                purchase_cost: row.purchase_cost ?? null,
                vendor_name: row.vendor_name || null,
                lifecycle_years: row.lifecycle_years ?? null,
                warranty_start: row.warranty_start || null,
                warranty_end: row.warranty_end || null,
                amc_required: !!row.amc_required,
                notes: row.notes || null,
                created_by: access.user.id,
            });
        }
        if (records.length === 0) continue;

        const { data: inserted, error: insertError } = await supabaseAdmin.from('assets').insert(records).select('id, property_id, organization_id, asset_code, name, qr_token');
        if (insertError) {
            batch.forEach((row) => insertErrors.push({ row: row.row, field: 'Import', message: insertError.message }));
            continue;
        }
        imported += inserted.length;
        created.push(...inserted.map((a) => ({ id: a.id, asset_code: a.asset_code, name: a.name, qr_token: a.qr_token })));
        await supabaseAdmin.from('asset_events').insert(
            inserted.map((a) => ({
                asset_id: a.id, organization_id: a.organization_id, property_id: a.property_id,
                event_type: 'imported', title: 'Asset imported in bulk', created_by: access.user.id,
            })),
        );
    }

    return NextResponse.json({
        success: true,
        total: rows.length,
        imported,
        skipped: rows.length - imported,
        errors: insertErrors.slice(0, 200),
        created: created.slice(0, 1000),
    });
}
