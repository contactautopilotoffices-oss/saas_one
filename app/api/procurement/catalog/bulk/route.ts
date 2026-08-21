import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/frontend/utils/supabase/admin';
import * as XLSX from 'xlsx';

function normalizeItemKey(str: string): string {
    return (str || '')
        .toLowerCase()
        .replace(/[\-_,\.\(\)\[\]\/\|"']/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

export async function POST(request: NextRequest) {
    try {
        const contentType = request.headers.get('content-type') || '';
        const adminSupabase = createAdminClient();

        let organizationId = '';
        let itemsToInsert: Array<{
            name: string;
            category: string;
            brand?: string;
            color_size_details?: string;
            unit: string;
            estimated_price: number;
            unit_price: number;
            hsn_code?: string;
        }> = [];

        if (contentType.includes('multipart/form-data')) {
            const formData = await request.formData();
            organizationId = formData.get('organization_id') as string;
            const file = formData.get('file') as File | null;

            if (!file || !organizationId) {
                return NextResponse.json({ error: 'Missing file or organization_id' }, { status: 400 });
            }

            const buffer = await file.arrayBuffer();
            const workbook = XLSX.read(buffer, { type: 'array' });
            const sheet = workbook.Sheets[workbook.SheetNames[0]];
            const jsonData = XLSX.utils.sheet_to_json(sheet) as any[];

            itemsToInsert = jsonData.map((r: any) => {
                const name = String(r['Item Name'] || r['Item'] || r['name'] || r['Product Name'] || '').trim();
                const price = parseFloat(r['Base Price'] || r['Price'] || r['price'] || r['Rate'] || r['estimated_price'] || '0');
                const category = String(r['Category'] || r['category'] || 'HK').trim();
                const brand = String(r['Brand'] || r['brand'] || 'NA').trim();
                const details = String(r['Details'] || r['Color / Size'] || r['details'] || '').trim();
                const unit = String(r['Unit'] || r['UOM'] || r['unit'] || 'pcs').trim();
                const hsn = String(r['HSN'] || r['HSN Code'] || r['hsn_code'] || '').trim();

                return {
                    name,
                    category,
                    brand,
                    color_size_details: details,
                    unit,
                    estimated_price: price,
                    unit_price: price,
                    hsn_code: hsn
                };
            }).filter(i => i.name.length > 0);
        } else {
            const body = await request.json();
            organizationId = body.organization_id;
            itemsToInsert = body.items || [];
        }

        if (!organizationId) {
            return NextResponse.json({ error: 'organization_id is required' }, { status: 400 });
        }

        if (itemsToInsert.length === 0) {
            return NextResponse.json({ error: 'No valid items found to insert' }, { status: 400 });
        }

        // 1. Fetch all existing active catalog items for this org
        const { data: existing } = await adminSupabase
            .from('procurement_catalog')
            .select('id, name')
            .eq('organization_id', organizationId)
            .eq('is_active', true);

        const existingNormalizedMap = new Map<string, string>();
        (existing || []).forEach((e: any) => {
            existingNormalizedMap.set(normalizeItemKey(e.name), e.id);
        });

        // 2. Filter out duplicates from existing DB + duplicates within the incoming file itself
        const seenInPayload = new Set<string>();
        const newItemsToInsert: any[] = [];
        let duplicateCount = 0;

        for (const item of itemsToInsert) {
            const normKey = normalizeItemKey(item.name);
            if (!normKey) continue;

            if (existingNormalizedMap.has(normKey) || seenInPayload.has(normKey)) {
                duplicateCount++;
                continue;
            }

            seenInPayload.add(normKey);
            newItemsToInsert.push({
                organization_id: organizationId,
                name: item.name.trim(),
                category: item.category || 'HK',
                brand: item.brand || 'NA',
                color_size_details: item.color_size_details || '',
                unit: item.unit || 'pcs',
                estimated_price: item.estimated_price || 0,
                unit_price: item.unit_price || item.estimated_price || 0,
                is_active: true
            });
        }

        if (newItemsToInsert.length === 0) {
            return NextResponse.json({
                success: true,
                message: `All ${itemsToInsert.length} items already exist in the catalog (0 duplicates created).`,
                inserted_count: 0,
                skipped_count: duplicateCount
            });
        }

        // 3. Insert unique items safely
        const { data: inserted, error: insertError } = await adminSupabase
            .from('procurement_catalog')
            .insert(newItemsToInsert)
            .select();

        if (insertError) {
            console.error('[Bulk Catalog Insert Error]:', insertError);
            return NextResponse.json({ error: 'Database insert error', details: insertError.message }, { status: 500 });
        }

        return NextResponse.json({
            success: true,
            message: `Successfully added ${inserted?.length || 0} new items. Skipped ${duplicateCount} duplicate items.`,
            inserted_count: inserted?.length || 0,
            skipped_count: duplicateCount
        });
    } catch (err: any) {
        console.error('[Bulk Catalog API Error]:', err);
        return NextResponse.json({ error: 'Internal server error', details: err.message }, { status: 500 });
    }
}
