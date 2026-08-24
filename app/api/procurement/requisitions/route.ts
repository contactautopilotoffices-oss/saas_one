import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/frontend/utils/supabase/admin';
import { generateRequisitionExcelWorkbook, RequisitionItemData } from '@/backend/lib/excel/requisitionExcelGenerator';
import { PricingAndAliasService, normalizeText } from '@/backend/lib/procurement/pricingAndAliasService';
import { EmailService } from '@/backend/services/EmailService';
import { EmailRecipientResolver } from '@/backend/services/EmailRecipientResolver';
import { WhatsAppEventProcessor } from '@/backend/services/WhatsAppEventProcessor';

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

        if (contentType.includes('application/json')) {
            // Interactive UI submission with dual-table items
            const body = await request.json();
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

            // Fetch property & user info to populate Excel template
            const { data: prop } = await adminSupabase.from('properties').select('id, name, address, city').eq('id', propertyId).single();
            const { data: uploader } = await adminSupabase.from('users').select('id, full_name, email, phone').eq('id', userId).single();

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

        // Insert into property_monthly_requisitions
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

        // Auto-sync available stock counts to property's stock_items table so they appear in Stock Management
        try {
            if (Array.isArray(rawItems) && rawItems.length > 0) {
                const siteCatalog = await PricingAndAliasService.getCatalogWithSitePrices(organizationId, propertyId);
                for (const item of rawItems) {
                    if (!item.name) continue;
                    const norm = normalizeText(item.name);
                    
                    const { data: existingStock } = await adminSupabase
                        .from('stock_items')
                        .select('id, quantity')
                        .eq('property_id', propertyId)
                        .ilike('name', item.name)
                        .maybeSingle();

                    const matchedCatalog = (siteCatalog || []).find((c: any) => normalizeText(c.name) === norm);

                    if (existingStock) {
                        if (item.available_stock_qty !== undefined && item.available_stock_qty !== null) {
                            await adminSupabase
                                .from('stock_items')
                                .update({
                                    quantity: Number(item.available_stock_qty) || 0,
                                    catalog_item_id: matchedCatalog?.id || null,
                                    updated_at: new Date().toISOString()
                                })
                                .eq('id', existingStock.id);
                        }
                    } else {
                        const itemCode = `STK-${Math.random().toString(36).substring(2, 7).toUpperCase()}`;
                        await adminSupabase
                            .from('stock_items')
                            .insert({
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
            }
        } catch (syncStockErr) {
            console.warn('[Auto Sync Stock Error]:', syncStockErr);
        }

        return NextResponse.json({
            success: true,
            requisition: insertedRecord,
            file_url: publicUrl
        });
    } catch (err: any) {
        console.error('[Requisitions POST Server Error]:', err);
        return NextResponse.json({ error: 'Internal server error', details: err.message }, { status: 500 });
    }
}
