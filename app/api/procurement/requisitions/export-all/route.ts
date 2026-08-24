import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/frontend/utils/supabase/admin';
import {
    generateAllPropertiesRequisitionExcelWorkbook,
    RequisitionExportData,
    RequisitionItemData
} from '@/backend/lib/excel/requisitionExcelGenerator';

const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
];

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const organizationId = searchParams.get('organization_id');
        const reqMonthParam = searchParams.get('requisition_month');
        const reqYearParam = searchParams.get('requisition_year');
        const statusParam = searchParams.get('status');

        if (!organizationId) {
            return NextResponse.json({ error: 'Organization ID is required' }, { status: 400 });
        }

        const adminSupabase = createAdminClient();

        // 1. Fetch Organization Details
        const { data: orgData } = await adminSupabase
            .from('organizations')
            .select('id, name')
            .eq('id', organizationId)
            .maybeSingle();

        const orgName = orgData?.name || 'Autopilot Organization';

        // 2. Fetch All Properties for this Organization
        const { data: properties, error: propErr } = await adminSupabase
            .from('properties')
            .select('id, name, address, city')
            .eq('organization_id', organizationId)
            .order('name', { ascending: true });

        if (propErr) {
            console.error('[Export All Properties] Fetch properties error:', propErr);
            return NextResponse.json({ error: 'Failed to fetch properties' }, { status: 500 });
        }

        const allProperties = properties || [];

        // 3. Fetch All Monthly Requisition Budgets for this Org
        const { data: budgetsData } = await adminSupabase
            .from('property_monthly_requisition_budgets')
            .select('*')
            .eq('organization_id', organizationId);

        const budgetsList = budgetsData || [];
        const budgetMap = new Map<string, any>(); // key: `${property_id}_${floor_tag.toLowerCase()}`
        budgetsList.forEach((b: any) => {
            const key = `${b.property_id}_${(b.floor_tag || 'All Floors').toLowerCase()}`;
            budgetMap.set(key, b);
            // Also fallback for property_id alone
            if (!budgetMap.has(b.property_id)) {
                budgetMap.set(b.property_id, b);
            }
        });

        // 4. Fetch All Requisitions for this Org with applied filters
        let reqQuery = adminSupabase
            .from('property_monthly_requisitions')
            .select(`
                *,
                property:properties!property_id(id, name, address, city),
                uploader:users!uploaded_by(id, full_name, email, phone),
                acknowledger:users!acknowledged_by(id, full_name, email)
            `)
            .eq('organization_id', organizationId)
            .order('created_at', { ascending: false });

        if (reqMonthParam && reqMonthParam !== 'all') {
            reqQuery = reqQuery.eq('requisition_month', parseInt(reqMonthParam));
        }
        if (reqYearParam && reqYearParam !== 'all') {
            reqQuery = reqQuery.eq('requisition_year', parseInt(reqYearParam));
        }
        if (statusParam && statusParam !== 'all') {
            reqQuery = reqQuery.eq('status', statusParam);
        }

        const { data: reqData, error: reqErr } = await reqQuery;

        if (reqErr) {
            console.error('[Export All Properties] Fetch requisitions error:', reqErr);
            return NextResponse.json({ error: 'Failed to fetch requisitions' }, { status: 500 });
        }

        const allRequisitions = reqData || [];

        // Determine active month and year for metadata
        const now = new Date();
        const currentMonthIndex = (reqMonthParam && reqMonthParam !== 'all')
            ? parseInt(reqMonthParam)
            : (allRequisitions[0]?.requisition_month || now.getMonth() + 1);
        const currentYear = (reqYearParam && reqYearParam !== 'all')
            ? parseInt(reqYearParam)
            : (allRequisitions[0]?.requisition_year || now.getFullYear());
        const monthName = MONTH_NAMES[currentMonthIndex - 1] || 'Month';

        // 5. Group Requisitions by Property & Floor Tag
        const exportItems: RequisitionExportData[] = [];
        const processedPropertyIds = new Set<string>();

        for (const req of allRequisitions) {
            let parsedItems: RequisitionItemData[] = [];
            let siteNotes = req.notes || '';
            let requesterPhone = req.uploader?.phone || '';
            let parsedData: any = {};

            try {
                if (req.notes && typeof req.notes === 'string' && req.notes.trim().startsWith('{')) {
                    parsedData = JSON.parse(req.notes);
                    if (Array.isArray(parsedData.items)) {
                        parsedItems = parsedData.items;
                    }
                    siteNotes = parsedData.site_notes || siteNotes;
                    requesterPhone = parsedData.requester_phone || requesterPhone;
                } else if (req.notes && typeof req.notes === 'object' && Array.isArray(req.notes.items)) {
                    parsedItems = req.notes.items;
                    parsedData = req.notes;
                }
            } catch {
                // Notes was plain text
            }

            const floorTag = req.floor_tag || parsedData.floor_tag || 'All Floors';
            const budgetKey = `${req.property_id}_${floorTag.toLowerCase()}`;
            const matchedBudget = budgetMap.get(budgetKey) || budgetMap.get(req.property_id);

            const totalEstimatedAmount = parsedData.total_estimated_amount || req.total_estimated_amount || 0;
            const budgetLimit = matchedBudget?.total_budget || req.budget_limit || parsedData.budget_limit || 0;
            const isOverBudget = req.is_over_budget || (budgetLimit > 0 && totalEstimatedAmount > budgetLimit);
            const overBudgetAmount = isOverBudget ? (totalEstimatedAmount - budgetLimit) : 0;

            const createdAt = new Date(req.created_at || Date.now());
            const dateFormatted = `${createdAt.getDate()}/${createdAt.getMonth() + 1}/${createdAt.getFullYear()}`;

            exportItems.push({
                propertyName: req.property?.name || 'Site Property',
                propertyLocation: req.property?.location || req.property?.address || req.property?.name,
                requesterName: req.uploader?.full_name || req.uploader?.email || 'Site Admin',
                requesterPhone,
                dateFormatted,
                monthName: MONTH_NAMES[(req.requisition_month || currentMonthIndex) - 1] || monthName,
                monthIndex: req.requisition_month || currentMonthIndex,
                year: req.requisition_year || currentYear,
                floorTag,
                siteNotes,
                items: parsedItems,
                status: req.status || 'submitted',
                totalEstimatedAmount,
                budgetLimit,
                isOverBudget,
                overBudgetAmount,
                hkBudget: matchedBudget?.hk_budget || 0,
                beverageBudget: matchedBudget?.beverage_budget || 0,
                totalBudget: matchedBudget?.total_budget || 0
            });

            processedPropertyIds.add(req.property_id);
        }

        // 6. For any properties in the organization that do NOT have a requisition record yet,
        // include them with their budget allocation and standard template items
        for (const prop of allProperties) {
            if (!processedPropertyIds.has(prop.id)) {
                // Find any budgets for this property
                const propBudgets = budgetsList.filter((b: any) => b.property_id === prop.id);

                if (propBudgets.length > 0) {
                    propBudgets.forEach((b: any) => {
                        exportItems.push({
                            propertyName: prop.name,
                            propertyLocation: prop.address || prop.name,
                            requesterName: 'Property Admin',
                            requesterPhone: 'N/A',
                            dateFormatted: `${now.getDate()}/${now.getMonth() + 1}/${now.getFullYear()}`,
                            monthName,
                            monthIndex: currentMonthIndex,
                            year: currentYear,
                            floorTag: b.floor_tag || 'All Floors',
                            siteNotes: 'Pending Submission / Draft Allocation',
                            items: [],
                            status: 'Draft / Pending',
                            totalEstimatedAmount: 0,
                            budgetLimit: b.total_budget || 0,
                            isOverBudget: false,
                            overBudgetAmount: 0,
                            hkBudget: b.hk_budget || 0,
                            beverageBudget: b.beverage_budget || 0,
                            totalBudget: b.total_budget || 0
                        });
                    });
                } else {
                    exportItems.push({
                        propertyName: prop.name,
                        propertyLocation: prop.address || prop.name,
                        requesterName: 'Property Admin',
                        requesterPhone: 'N/A',
                        dateFormatted: `${now.getDate()}/${now.getMonth() + 1}/${now.getFullYear()}`,
                        monthName,
                        monthIndex: currentMonthIndex,
                        year: currentYear,
                        floorTag: 'All Floors',
                        siteNotes: 'Pending Submission / Draft Allocation',
                        items: [],
                        status: 'Draft / Pending',
                        totalEstimatedAmount: 0,
                        budgetLimit: 0,
                        isOverBudget: false,
                        overBudgetAmount: 0,
                        hkBudget: 0,
                        beverageBudget: 0,
                        totalBudget: 0
                    });
                }
            }
        }

        // Sort items alphabetically by property name
        exportItems.sort((a, b) => a.propertyName.localeCompare(b.propertyName));

        // 7. Generate Multi-Sheet Consolidated Workbook
        const excelBuffer = await generateAllPropertiesRequisitionExcelWorkbook({
            organizationName: orgName,
            monthName,
            monthIndex: currentMonthIndex,
            year: currentYear,
            exportedBy: 'Autopilot Procurement Team',
            propertiesData: exportItems
        });

        const safeOrg = orgName.replace(/[^a-zA-Z0-9]/g, '_');
        const safeFileName = `${safeOrg}_All_Properties_Requisitions_${monthName}_${currentYear}.xlsx`;

        // 8. Return as binary file download response
        return new NextResponse(new Uint8Array(excelBuffer), {
            status: 200,
            headers: {
                'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                'Content-Disposition': `attachment; filename="${safeFileName}"`,
                'Content-Length': excelBuffer.length.toString(),
            }
        });
    } catch (err: any) {
        console.error('[Export All Properties Requisitions Error]:', err);
        return NextResponse.json({ error: 'Failed to generate Excel export', details: err.message }, { status: 500 });
    }
}
