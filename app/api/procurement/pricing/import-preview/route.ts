import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/frontend/utils/supabase/admin';
import { PricingAndAliasService, normalizeText } from '@/backend/lib/procurement/pricingAndAliasService';
import * as XLSX from 'xlsx';

export async function POST(request: NextRequest) {
    try {
        const contentType = request.headers.get('content-type') || '';
        const adminSupabase = createAdminClient();

        let organizationId = '';
        let commit = false;
        let rows: Array<{
            item_name: string;
            unit_price: number;
            unit?: string;
            category?: string;
            hsn_code?: string;
            property_name: string;
            source_po?: string;
        }> = [];

        if (contentType.includes('multipart/form-data')) {
            const formData = await request.formData();
            organizationId = formData.get('organization_id') as string;
            commit = formData.get('commit') === 'true';
            const file = formData.get('file') as File | null;

            if (!file || !organizationId) {
                return NextResponse.json({ error: 'Missing file or organization_id' }, { status: 400 });
            }

            const buffer = await file.arrayBuffer();
            const workbook = XLSX.read(buffer, { type: 'array' });
            const sheet = workbook.Sheets[workbook.SheetNames[0]];
            const jsonData = XLSX.utils.sheet_to_json(sheet) as any[];

            rows = jsonData.map((r: any) => ({
                item_name: String(r['Item Name'] || r['item_name'] || r['Item'] || r['Particulars'] || '').trim(),
                unit_price: parseFloat(r['Price'] || r['unit_price'] || r['Rate'] || r['Unit Price'] || '0'),
                unit: String(r['Unit'] || r['UOM'] || 'pcs').trim(),
                category: String(r['Category'] || 'HK').trim(),
                hsn_code: String(r['HSN'] || r['hsn_code'] || '').trim(),
                property_name: String(r['Site'] || r['Property'] || r['Applicable site(s)'] || r['Location'] || '').trim(),
                source_po: String(r['PO'] || r['Source PO'] || r['Invoice'] || '').trim()
            })).filter(r => r.item_name && r.property_name && r.unit_price > 0);
        } else {
            const body = await request.json();
            organizationId = body.organization_id;
            commit = body.commit === true;
            rows = body.rows || [];
        }

        if (!organizationId) {
            return NextResponse.json({ error: 'organization_id is required' }, { status: 400 });
        }

        // Fetch existing items & existing site prices
        const { data: existingCatalog } = await adminSupabase
            .from('procurement_catalog')
            .select('id, name')
            .eq('organization_id', organizationId);

        const { data: existingSitePrices } = await adminSupabase
            .from('item_site_prices')
            .select('item_id, property_id, unit_price')
            .eq('organization_id', organizationId)
            .eq('is_active', true);

        const catalogMap = new Map<string, string>(); // normalized_name -> item_id
        (existingCatalog || []).forEach((item: any) => {
            catalogMap.set(normalizeText(item.name), item.id);
        });

        const sitePriceMap = new Map<string, number>(); // `${item_id}_${property_id}` -> price
        (existingSitePrices || []).forEach((sp: any) => {
            sitePriceMap.set(`${sp.item_id}_${sp.property_id}`, Number(sp.unit_price));
        });

        // Analyze and classify each row
        const processedRows: any[] = [];
        const unmappedProperties = new Set<string>();
        const priceConflicts: any[] = [];
        let newItemsCount = 0;
        let existingItemsCount = 0;
        let newSitePricesCount = 0;

        for (const row of rows) {
            const normalizedItem = normalizeText(row.item_name);
            const resolvedProp = await PricingAndAliasService.resolveProperty(row.property_name, organizationId);

            if (resolvedProp.confidence === 'unmapped' || !resolvedProp.property_id) {
                unmappedProperties.add(row.property_name);
            }

            const existingItemId = catalogMap.get(normalizedItem);
            const isNewItem = !existingItemId;

            if (isNewItem) {
                newItemsCount++;
            } else {
                existingItemsCount++;
            }

            let isConflict = false;
            let existingPrice = 0;

            if (existingItemId && resolvedProp.property_id) {
                const key = `${existingItemId}_${resolvedProp.property_id}`;
                if (sitePriceMap.has(key)) {
                    existingPrice = sitePriceMap.get(key) || 0;
                    if (existingPrice !== row.unit_price) {
                        isConflict = true;
                        priceConflicts.push({
                            item_name: row.item_name,
                            property_name: resolvedProp.property_name,
                            raw_property: row.property_name,
                            existing_price: existingPrice,
                            new_price: row.unit_price,
                            source_po: row.source_po
                        });
                    }
                } else {
                    newSitePricesCount++;
                }
            }

            processedRows.push({
                ...row,
                normalized_item: normalizedItem,
                is_new_item: isNewItem,
                resolved_property_id: resolvedProp.property_id,
                resolved_property_name: resolvedProp.property_name,
                floor_tag: resolvedProp.floor_tag,
                property_confidence: resolvedProp.confidence,
                is_conflict: isConflict,
                existing_price: existingPrice
            });
        }

        // IF COMMIT IS TRUE: Write to Database
        if (commit) {
            // 1. Insert new catalog items
            const newItemsToInsert: any[] = [];
            const processedItemNames = new Set<string>();

            for (const row of processedRows) {
                if (row.is_new_item && !processedItemNames.has(row.normalized_item)) {
                    processedItemNames.add(row.normalized_item);
                    newItemsToInsert.push({
                        organization_id: organizationId,
                        name: row.item_name,
                        category: row.category || 'HK',
                        unit: row.unit || 'pcs',
                        unit_price: row.unit_price,
                        estimated_price: row.unit_price,
                        is_active: true
                    });
                }
            }

            if (newItemsToInsert.length > 0) {
                const { data: insertedItems } = await adminSupabase
                    .from('procurement_catalog')
                    .insert(newItemsToInsert)
                    .select('id, name');

                (insertedItems || []).forEach((item: any) => {
                    catalogMap.set(normalizeText(item.name), item.id);
                });
            }

            // 2. Insert or Update item_site_prices
            const sitePricesToUpsert: any[] = [];
            for (const row of processedRows) {
                const itemId = catalogMap.get(row.normalized_item);
                if (itemId && row.resolved_property_id) {
                    sitePricesToUpsert.push({
                        organization_id: organizationId,
                        item_id: itemId,
                        property_id: row.resolved_property_id,
                        unit_price: row.unit_price,
                        source: row.source_po ? `PO: ${row.source_po}` : 'PO_HISTORICAL',
                        is_active: true,
                        updated_at: new Date().toISOString()
                    });
                }
            }

            if (sitePricesToUpsert.length > 0) {
                await adminSupabase
                    .from('item_site_prices')
                    .upsert(sitePricesToUpsert, { onConflict: 'item_id,property_id,is_active' });
            }

            return NextResponse.json({
                success: true,
                message: `Successfully imported ${newItemsToInsert.length} new items and ${sitePricesToUpsert.length} site-specific prices.`,
                committed_items_count: newItemsToInsert.length,
                committed_prices_count: sitePricesToUpsert.length
            });
        }

        // Return Validation & Import Preview Summary
        return NextResponse.json({
            preview: {
                total_rows: rows.length,
                new_items_count: newItemsCount,
                existing_items_count: existingItemsCount,
                new_site_prices_count: newSitePricesCount,
                price_conflicts: priceConflicts,
                unmapped_properties: Array.from(unmappedProperties),
                sample_rows: processedRows.slice(0, 50)
            }
        });
    } catch (err: any) {
        console.error('[Import Preview Server Error]:', err);
        return NextResponse.json({ error: 'Internal server error', details: err.message }, { status: 500 });
    }
}
