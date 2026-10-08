import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/frontend/utils/supabase/admin';
import { generateRequisitionExcelWorkbook, RequisitionItemData } from '@/backend/lib/excel/requisitionExcelGenerator';
import { PricingAndAliasService, normalizeText } from '@/backend/lib/procurement/pricingAndAliasService';

const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
];

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const organizationId = searchParams.get('organization_id');
        const propertyId = searchParams.get('property_id');
        const requisitionMonth = searchParams.get('requisition_month');
        const requisitionYear = searchParams.get('requisition_year');
        const status = searchParams.get('status');

        const adminSupabase = createAdminClient();

        let query = adminSupabase
            .from('property_monthly_requisitions')
            .select(`
                *,
                property:properties!property_id(id, name, address, city),
                uploader:users!uploaded_by(id, full_name, email, phone),
                acknowledger:users!acknowledged_by(id, full_name, email)
            `)
            .order('created_at', { ascending: false });

        if (organizationId) {
            query = query.eq('organization_id', organizationId);
        }
        const propertyIds = searchParams.get('property_ids');
        if (propertyId && propertyId !== 'all') {
            query = query.eq('property_id', propertyId);
        } else if (propertyIds) {
            const list = propertyIds.split(',').map(s => s.trim()).filter(Boolean);
            if (list.length > 0) {
                query = query.in('property_id', list);
            }
        }
        if (requisitionMonth && requisitionMonth !== 'all') {
            query = query.eq('requisition_month', parseInt(requisitionMonth));
        }
        if (requisitionYear && requisitionYear !== 'all') {
            query = query.eq('requisition_year', parseInt(requisitionYear));
        }
        if (status && status !== 'all') {
            query = query.eq('status', status);
        }

        const { data, error } = await query;

        if (error) {
            console.error('[Requisitions GET Error]:', error);
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        // Augment each record with parsed JSON metadata
        const enriched = (data || []).map((req: any) => {
            let parsedData: any = {};
            try {
                if (req.notes && typeof req.notes === 'string' && req.notes.trim().startsWith('{')) {
                    parsedData = JSON.parse(req.notes);
                }
            } catch {
                parsedData = {};
            }

            const isOverBudget = req.is_over_budget !== undefined 
                ? req.is_over_budget 
                : (parsedData.is_over_budget || false);
            const budgetLimit = req.budget_limit !== undefined 
                ? req.budget_limit 
                : (parsedData.budget_limit || 0);
            const overBudgetAmount = req.over_budget_amount !== undefined 
                ? req.over_budget_amount 
                : (parsedData.over_budget_amount || 0);

            return {
                ...req,
                floor_tag: req.floor_tag || parsedData.floor_tag || 'All Floors',
                items: parsedData.items || [],
                categories: parsedData.categories || [],
                total_estimated_amount: parsedData.total_estimated_amount || req.total_estimated_amount || 0,
                total_items_count: parsedData.items?.length || 0,
                site_notes: parsedData.site_notes || req.notes || '',
                vendor_quotation: parsedData.vendor_quotation || null,
                approver_info: parsedData.approver_info || null,
                is_over_budget: Boolean(isOverBudget),
                budget_limit: Number(budgetLimit) || 0,
                over_budget_amount: Number(overBudgetAmount) || 0,
                budget_breakdown: parsedData.budget_breakdown || null
            };
        });

        return NextResponse.json({ requisitions: enriched });
    } catch (err: any) {
        console.error('[Requisitions GET Server Error]:', err);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        const adminSupabase = createAdminClient();

        // Ensure storage bucket exists
        const { data: bucket, error: bucketErr } = await adminSupabase.storage.getBucket('procurement_requisitions');
        if (bucketErr) {
            await adminSupabase.storage.createBucket('procurement_requisitions', {
                public: true,
                allowedMimeTypes: [
                    'application/vnd.ms-excel',
                    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                    'text/csv',
                    'application/csv',
                    'application/octet-stream',
                    'application/pdf'
                ],
            });
        }

        const contentType = request.headers.get('content-type') || '';
        let organizationId = '';
        let propertyId = '';
        let floorTag = 'All Floors';
        let requisitionMonth = 0;
        let requisitionYear = 0;
        let userId = '';
        let siteNotes = '';
        let rawItems: RequisitionItemData[] = [];
        let uploadedFileBuffer: Buffer | null = null;
        let uploadedFileName = '';
        let cachedCatalog: any[] = [];

        let isPreviewOnly = false;
        if (contentType.includes('application/json')) {
            // Interactive UI submission with dual-table items
            const body = await request.json();
            isPreviewOnly = Boolean(body.preview_only);
            organizationId = body.organization_id;
            propertyId = body.property_id;
            floorTag = body.floor_tag || 'All Floors';
            requisitionMonth = parseInt(body.requisition_month || '0');
            requisitionYear = parseInt(body.requisition_year || '0');
            userId = body.user_id;
            siteNotes = body.site_notes || body.notes || '';
            rawItems = body.items || [];

            if (!organizationId || !propertyId || !requisitionMonth || !requisitionYear || !userId) {
                return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 });
            }

            // CRITICAL SECURITY RULE: Resolve authorized prices server-side from item_site_prices / procurement_catalog
            const siteCatalog = await PricingAndAliasService.getCatalogWithSitePrices(organizationId, propertyId);
            cachedCatalog = siteCatalog;
            const verifiedPriceMap = new Map<string, number>();
            siteCatalog.forEach((item: any) => {
                verifiedPriceMap.set(normalizeText(item.name), item.unit_price);
            });

            // Enforce verified price snapshot on each line item
            const verifiedItems: RequisitionItemData[] = rawItems.map(item => {
                const normalized = normalizeText(item.name);
                const serverVerifiedPrice = verifiedPriceMap.get(normalized);
                const finalPrice = serverVerifiedPrice !== undefined ? serverVerifiedPrice : (item.unit_price || 0);

                return {
                    ...item,
                    unit_price: finalPrice
                };
            });

            // Fetch property & user info to populate Excel template concurrently
            const [{ data: prop }, { data: uploader }] = await Promise.all([
                adminSupabase.from('properties').select('id, name, address, city').eq('id', propertyId).single(),
                adminSupabase.from('users').select('id, full_name, email, phone').eq('id', userId).single()
            ]);

            const monthName = MONTH_NAMES[requisitionMonth - 1] || 'Month';
            const now = new Date();
            const dateFormatted = `${now.getDate()}/${now.getMonth() + 1}/${now.getFullYear()}`;

            // Generate exact Excel workbook buffer matching user photos
            uploadedFileBuffer = await generateRequisitionExcelWorkbook({
                propertyName: `${prop?.name || 'Site Property'} (${floorTag})`,
                propertyLocation: prop?.address || prop?.city || prop?.name,
                requesterName: uploader?.full_name || uploader?.email || 'Site Admin',
                requesterPhone: uploader?.phone || '',
                dateFormatted,
                monthName,
                monthIndex: requisitionMonth,
                year: requisitionYear,
                siteNotes,
                items: verifiedItems,
                status: 'submitted'
            });

            const cleanPropName = (prop?.name || 'Requisition').replace(/\s+/g, '_');
            const cleanFloor = floorTag.replace(/\s+/g, '_');
            uploadedFileName = `${cleanPropName}_${cleanFloor}_${monthName}_${requisitionYear}_requisition.xlsx`;
            rawItems = verifiedItems;

            // IF PREVIEW ONLY: Return the generated Excel directly as a file download without touching the DB
            if (isPreviewOnly && uploadedFileBuffer) {
                return new NextResponse(new Uint8Array(uploadedFileBuffer), {
                    status: 200,
                    headers: {
                        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                        'Content-Disposition': `attachment; filename="${uploadedFileName}"`,
                        'Content-Length': uploadedFileBuffer.length.toString()
                    }
                });
            }
        } else {
            // FormData File Upload
            const form = await request.formData();
            const file = form.get('file') as File | null;
            organizationId = form.get('organization_id') as string;
            propertyId = form.get('property_id') as string;
            floorTag = (form.get('floor_tag') as string) || 'All Floors';
            requisitionMonth = parseInt(form.get('requisition_month') as string || '0');
            requisitionYear = parseInt(form.get('requisition_year') as string || '0');
            siteNotes = form.get('notes') as string || '';
            userId = form.get('user_id') as string;

            if (!file || !organizationId || !propertyId || !requisitionMonth || !requisitionYear || !userId) {
                return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
            }

            uploadedFileName = file.name;
            const arrayBuffer = await file.arrayBuffer();
            uploadedFileBuffer = Buffer.from(arrayBuffer);
        }

        // Upload generated / submitted Excel to Supabase storage
        const filePath = `${organizationId}/${propertyId}/${requisitionYear}_${requisitionMonth}_${Date.now()}_${uploadedFileName}`;
        const { data: uploadData, error: uploadError } = await adminSupabase.storage
            .from('procurement_requisitions')
            .upload(filePath, uploadedFileBuffer, {
                upsert: true,
                contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            });

        if (uploadError) {
            console.error('[Requisition Upload Storage Error]:', uploadError);
            return NextResponse.json({ error: 'Failed to upload file to storage', details: uploadError.message }, { status: 500 });
        }

        const publicUrl = adminSupabase.storage.from('procurement_requisitions').getPublicUrl(uploadData.path).data.publicUrl;

        // Calculate total cost using locked price snapshots
        const totalEstimatedAmount = rawItems.reduce((acc, curr) => acc + ((curr.requested_qty || 0) * (curr.unit_price || 0)), 0);
        const requestedItemsCount = rawItems.filter(i => (i.requested_qty || 0) > 0).length;

        // Category breakdown calculation
        let hkSpent = 0;
        let beverageSpent = 0;
        let otherSpent = 0;

        rawItems.forEach(item => {
            const cost = (Number(item.requested_qty) || 0) * (Number(item.unit_price) || 0);
            const cat = (item.category || '').toLowerCase();
            if (cat.includes('bev') || cat.includes('pantry') || cat.includes('tea') || cat.includes('coffee') || cat.includes('ccd')) {
                beverageSpent += cost;
            } else if (cat.includes('hk') || cat.includes('housekeeping') || cat.includes('tissue') || cat.includes('stationery') || cat.includes('paper')) {
                hkSpent += cost;
            } else {
                otherSpent += cost;
            }
        });

        // Query property monthly requisition budget (floor-specific first, then fallback to All Floors)
        let allocatedBudgetLimit = 0;
        let hkBudgetLimit = 0;
        let beverageBudgetLimit = 0;
        let budgetFound = false;

        try {
            const { data: budgetData } = await adminSupabase
                .from('property_monthly_requisition_budgets')
                .select('*')
                .eq('organization_id', organizationId)
                .eq('property_id', propertyId)
                .eq('is_active', true);

            if (budgetData && budgetData.length > 0) {
                const floorMatch = budgetData.find((b: any) => b.floor_tag === floorTag);
                const allFloorsMatch = budgetData.find((b: any) => b.floor_tag === 'All Floors');
                const matchedBudget = floorMatch || allFloorsMatch || budgetData[0];

                if (matchedBudget) {
                    budgetFound = true;
                    allocatedBudgetLimit = Number(matchedBudget.total_budget) || (Number(matchedBudget.hk_budget) + Number(matchedBudget.beverage_budget)) || 0;
                    hkBudgetLimit = Number(matchedBudget.hk_budget) || 0;
                    beverageBudgetLimit = Number(matchedBudget.beverage_budget) || 0;
                }
            }
        } catch (bErr) {
            console.warn('[Requisition Budget Lookup Warning]:', bErr);
        }

        const isOverBudget = budgetFound && allocatedBudgetLimit > 0 && totalEstimatedAmount > allocatedBudgetLimit;
        const overBudgetAmount = isOverBudget ? Math.max(0, totalEstimatedAmount - allocatedBudgetLimit) : 0;

        // Store structured JSON inside notes column for rich persistence
        const notesPayload = JSON.stringify({
            floor_tag: floorTag,
            site_notes: siteNotes,
            total_estimated_amount: totalEstimatedAmount,
            total_items_count: rawItems.length,
            requested_items_count: requestedItemsCount > 0 ? requestedItemsCount : rawItems.length,
            categories: Array.from(new Set(rawItems.map(i => i.category || 'HK'))),
            items: rawItems,
            submitted_at: new Date().toISOString(),
            is_over_budget: isOverBudget,
            budget_limit: allocatedBudgetLimit,
            over_budget_amount: overBudgetAmount,
            budget_breakdown: {
                total_budget: allocatedBudgetLimit,
                hk_budget: hkBudgetLimit,
                beverage_budget: beverageBudgetLimit,
                total_spent: totalEstimatedAmount,
                hk_spent: hkSpent,
                beverage_spent: beverageSpent,
                other_spent: otherSpent
            }
        });

        // IDEMPOTENCY & DUPLICATION PREVENTION:
        // Check if a requisition for this property, month, year, and floor tag already exists
        const { data: existingRecords, error: existingError } = await adminSupabase
            .from('property_monthly_requisitions')
            .select(`
                *,
                property:properties!property_id(id, name),
                uploader:users!uploaded_by(id, full_name, email, phone)
            `)
            .eq('organization_id', organizationId)
            .eq('property_id', propertyId)
            .eq('requisition_month', requisitionMonth)
            .eq('requisition_year', requisitionYear)
            .eq('floor_tag', floorTag)
            .order('created_at', { ascending: false });

        let finalRecord = null;

        if (existingRecords && existingRecords.length > 0) {
            const latest = existingRecords[0];
            const msSinceCreation = Date.now() - new Date(latest.created_at).getTime();

            // 1. Debounce rapid double-submissions within 45 seconds by the same user
            if (msSinceCreation < 45000 && latest.uploaded_by === userId) {
                console.log(`[Requisition Deduplication]: Debounced concurrent submission within ${msSinceCreation}ms. Returning existing requisition ${latest.id}`);
                return NextResponse.json({
                    success: true,
                    requisition: latest,
                    file_url: latest.file_url,
                    debounced: true
                });
            }

            // 2. If existing record is still in 'submitted' or 'draft' status, UPDATE it (upsert) instead of creating duplicate row
            if (['submitted', 'draft'].includes(latest.status)) {
                console.log(`[Requisition Upsert]: Updating existing ${latest.status} requisition ${latest.id} instead of creating duplicate`);
                const { data: updatedRecord, error: updateError } = await adminSupabase
                    .from('property_monthly_requisitions')
                    .update({
                        file_url: publicUrl,
                        file_name: uploadedFileName,
                        file_size_bytes: uploadedFileBuffer.length,
                        notes: notesPayload,
                        uploaded_by: userId,
                        updated_at: new Date().toISOString(),
                        is_over_budget: isOverBudget,
                        budget_limit: allocatedBudgetLimit,
                        over_budget_amount: overBudgetAmount
                    })
                    .eq('id', latest.id)
                    .select(`
                        *,
                        property:properties!property_id(id, name),
                        uploader:users!uploaded_by(id, full_name, email, phone)
                    `)
                    .single();

                if (!updateError && updatedRecord) {
                    finalRecord = updatedRecord;
                } else {
                    console.error('[Requisition Upsert Update Error]:', updateError);
                }
            }
        }

        // 3. If no existing active record found or update failed, insert new record
        if (!finalRecord) {
            const insertPayload: any = {
                organization_id: organizationId,
                property_id: propertyId,
                requisition_month: requisitionMonth,
                requisition_year: requisitionYear,
                floor_tag: floorTag,
                file_url: publicUrl,
                file_name: uploadedFileName,
                file_size_bytes: uploadedFileBuffer.length,
                notes: notesPayload,
                status: 'submitted',
                uploaded_by: userId,
                updated_at: new Date().toISOString(),
                is_over_budget: isOverBudget,
                budget_limit: allocatedBudgetLimit,
                over_budget_amount: overBudgetAmount
            };

            const { data: insertedRecord, error: insertError } = await adminSupabase
                .from('property_monthly_requisitions')
                .insert(insertPayload)
                .select(`
                    *,
                    property:properties!property_id(id, name),
                    uploader:users!uploaded_by(id, full_name, email, phone)
                `)
                .single();

            if (insertError) {
                console.error('[Requisition Insert Error]:', insertError);
                return NextResponse.json({ error: 'Failed to save requisition record', details: insertError.message }, { status: 500 });
            }
            finalRecord = insertedRecord;
        }

        // Fire-and-forget background sync of available stock counts to property's stock_items table
        // Runs non-blocking so the user gets an instant submission response (< 1s)
        if (Array.isArray(rawItems) && rawItems.length > 0) {
            (async () => {
                try {
                    const catalogToUse = cachedCatalog && cachedCatalog.length > 0
                        ? cachedCatalog
                        : await PricingAndAliasService.getCatalogWithSitePrices(organizationId, propertyId);

                    const { data: existingStocks } = await adminSupabase
                        .from('stock_items')
                        .select('id, name, quantity')
                        .eq('property_id', propertyId);

                    const stockMap = new Map<string, any>();
                    (existingStocks || []).forEach((stk: any) => {
                        if (stk.name) stockMap.set(normalizeText(stk.name), stk);
                    });

                    const catalogMap = new Map<string, any>();
                    (catalogToUse || []).forEach((c: any) => {
                        if (c.name) catalogMap.set(normalizeText(c.name), c);
                    });

                    const updatePromises: PromiseLike<any>[] = [];
                    const toInsert: any[] = [];

                    for (const item of rawItems) {
                        if (!item.name) continue;
                        const norm = normalizeText(item.name);
                        const existingStock = stockMap.get(norm);
                        const matchedCatalog = catalogMap.get(norm);

                        if (existingStock) {
                            if (item.available_stock_qty !== undefined && item.available_stock_qty !== null && Number(existingStock.quantity) !== Number(item.available_stock_qty)) {
                                updatePromises.push(
                                    adminSupabase
                                        .from('stock_items')
                                        .update({
                                            quantity: Number(item.available_stock_qty) || 0,
                                            catalog_item_id: matchedCatalog?.id || null,
                                            updated_at: new Date().toISOString()
                                        })
                                        .eq('id', existingStock.id)
                                );
                            }
                        } else {
                            const itemCode = `STK-${Math.random().toString(36).substring(2, 7).toUpperCase()}`;
                            toInsert.push({
                                organization_id: organizationId,
                                property_id: propertyId,
                                catalog_item_id: matchedCatalog?.id || null,
                                name: item.name,
                                category: item.category || 'HK',
                                unit: item.unit || 'pcs',
                                item_code: itemCode,
                                quantity: Number(item.available_stock_qty) || 0,
                                min_threshold: 10,
                                unit_price: item.unit_price || 0
                            });
                        }
                    }

                    if (toInsert.length > 0) {
                        await adminSupabase.from('stock_items').insert(toInsert);
                    }
                    if (updatePromises.length > 0) {
                        const batchSize = 25;
                        for (let i = 0; i < updatePromises.length; i += batchSize) {
                            await Promise.all(updatePromises.slice(i, i + batchSize));
                        }
                    }
                } catch (syncStockErr) {
                    console.warn('[Auto Sync Stock Background Error]:', syncStockErr);
                }
            })();
        }

        // Dispatch Omnichannel notification via event_outbox (automatically delivers Email & WhatsApp via /api/webhooks/process-event)
        (async () => {
            try {
                await adminSupabase.from('event_outbox').insert({
                    event_type: 'REQUISITION_UPLOADED',
                    entity_id: finalRecord.id,
                    payload: {
                        requisition_id: finalRecord.id,
                        property_id: propertyId,
                        organization_id: organizationId,
                        floor_tag: floorTag,
                        requisition_month: requisitionMonth,
                        requisition_year: requisitionYear,
                        file_name: uploadedFileName,
                        file_url: publicUrl,
                        items_count: requestedItemsCount > 0 ? requestedItemsCount : rawItems.length,
                        total_amount: totalEstimatedAmount,
                        total_estimated_amount: totalEstimatedAmount,
                        is_over_budget: isOverBudget,
                        budget_limit: allocatedBudgetLimit,
                        over_budget_amount: overBudgetAmount,
                        uploaded_by: userId,
                        status: 'submitted'
                    }
                });
            } catch (notifErr) {
                console.error('[Requisition Notification Dispatch Error]:', notifErr);
            }
        })();

        return NextResponse.json({
            success: true,
            requisition: finalRecord,
            file_url: publicUrl
        });
    } catch (err: any) {
        console.error('[Requisitions POST Server Error]:', err);
        return NextResponse.json({ error: 'Internal server error', details: err.message }, { status: 500 });
    }
}
