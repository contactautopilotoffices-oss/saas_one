import { NextResponse } from 'next/server';
import { generateRequisitionExcelWorkbook, RequisitionItemData } from '@/backend/lib/excel/requisitionExcelGenerator';
import { PricingAndAliasService, normalizeText } from '@/backend/lib/procurement/pricingAndAliasService';

const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
];

export interface PrepareRequisitionParams {
    organizationId: string;
    propertyId: string;
    requisitionMonth: number;
    requisitionYear: number;
    floorTag: string;
    siteNotes: string;
    userId: string;
    items?: RequisitionItemData[];
    file?: File | null;
    previewOnly?: boolean;
}

export interface PreparedRequisitionResult {
    previewResponse?: NextResponse;
    publicUrl?: string;
    uploadedFileName?: string;
    fileSizeBytes?: number;
    totalEstimatedAmount?: number;
    requestedItemsCount?: number;
    isOverBudget?: boolean;
    allocatedBudgetLimit?: number;
    overBudgetAmount?: number;
    baseNotesObj?: Record<string, any>;
    rawItems?: RequisitionItemData[];
}

/**
 * Resolves verified catalog pricing, generates (or reads) the `.xlsx` workbook,
 * uploads it to Supabase Storage, computes budget/category totals, and builds
 * the structured notes metadata shared by both create (POST) and edit (PATCH).
 */
export async function prepareRequisitionArtifacts(
    adminSupabase: any,
    params: PrepareRequisitionParams,
): Promise<PreparedRequisitionResult> {
    const {
        organizationId,
        propertyId,
        requisitionMonth,
        requisitionYear,
        floorTag,
        siteNotes,
        userId,
        file = null,
        previewOnly = false,
    } = params;

    let rawItems: RequisitionItemData[] = Array.isArray(params.items) ? params.items : [];

    // Ensure storage bucket exists before uploading workbook
    const { error: bucketErr } = await adminSupabase.storage.getBucket('procurement_requisitions');
    if (bucketErr) {
        await adminSupabase.storage.createBucket('procurement_requisitions', {
            public: true,
            allowedMimeTypes: [
                'application/vnd.ms-excel',
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                'text/csv',
                'application/csv',
                'application/octet-stream',
                'application/pdf',
            ],
        });
    }

    let uploadedFileBuffer: Buffer;
    let uploadedFileName = '';

    if (file) {
        uploadedFileName = file.name;
        const arrayBuffer = await file.arrayBuffer();
        uploadedFileBuffer = Buffer.from(arrayBuffer);
    } else {
        // Resolve authorized prices server-side from item_site_prices / procurement_catalog
        const siteCatalog = await PricingAndAliasService.getCatalogWithSitePrices(organizationId, propertyId);
        const verifiedPriceMap = new Map<string, number>();
        siteCatalog.forEach((item: any) => {
            verifiedPriceMap.set(normalizeText(item.name), item.unit_price);
        });

        const verifiedItems: RequisitionItemData[] = rawItems.map(item => {
            const serverVerifiedPrice = verifiedPriceMap.get(normalizeText(item.name));
            const finalPrice = serverVerifiedPrice !== undefined ? serverVerifiedPrice : (item.unit_price || 0);
            return { ...item, unit_price: finalPrice };
        });

        const [{ data: prop }, { data: uploader }] = await Promise.all([
            adminSupabase.from('properties').select('id, name, address, city').eq('id', propertyId).single(),
            adminSupabase.from('users').select('id, full_name, email, phone').eq('id', userId).single(),
        ]);

        const monthName = MONTH_NAMES[requisitionMonth - 1] || 'Month';
        const now = new Date();
        const dateFormatted = `${now.getDate()}/${now.getMonth() + 1}/${now.getFullYear()}`;

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
            status: 'submitted',
        });

        const cleanPropName = (prop?.name || 'Requisition').replace(/\s+/g, '_');
        const cleanFloor = floorTag.replace(/\s+/g, '_');
        uploadedFileName = `${cleanPropName}_${cleanFloor}_${monthName}_${requisitionYear}_requisition.xlsx`;
        rawItems = verifiedItems;

        if (previewOnly && uploadedFileBuffer) {
            return {
                previewResponse: new NextResponse(new Uint8Array(uploadedFileBuffer), {
                    status: 200,
                    headers: {
                        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                        'Content-Disposition': `attachment; filename="${uploadedFileName}"`,
                        'Content-Length': uploadedFileBuffer.length.toString(),
                    },
                }),
            };
        }
    }

    const filePath = `${organizationId}/${propertyId}/${requisitionYear}_${requisitionMonth}_${Date.now()}_${uploadedFileName}`;
    const { data: uploadData, error: uploadError } = await adminSupabase.storage
        .from('procurement_requisitions')
        .upload(filePath, uploadedFileBuffer, {
            upsert: true,
            contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        });

    if (uploadError) {
        throw new Error(`Failed to upload file to storage: ${uploadError.message}`);
    }

    const publicUrl = `/api/storage/procurement_requisitions/${uploadData.path}`;
    const totalEstimatedAmount = rawItems.reduce((acc, curr) => acc + ((curr.requested_qty || 0) * (curr.unit_price || 0)), 0);
    const requestedItemsCount = rawItems.filter(i => (i.requested_qty || 0) > 0).length;

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

    const baseNotesObj = {
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
            other_spent: otherSpent,
        },
    };

    return {
        publicUrl,
        uploadedFileName,
        fileSizeBytes: uploadedFileBuffer.length,
        totalEstimatedAmount,
        requestedItemsCount,
        isOverBudget,
        allocatedBudgetLimit,
        overBudgetAmount,
        baseNotesObj,
        rawItems,
    };
}
