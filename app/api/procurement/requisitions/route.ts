import {
    siteVendorQuotation,
    siteEditInfo,
    siteEditHistory,
    canSiteEditRequisition,
    prepareRequisitionEdit,
    requisitionNotes,
} from '@/backend/lib/procurement/requisition-approval.mjs';
import { prepareRequisitionArtifacts } from '@/backend/lib/procurement/requisitionSubmission';
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/frontend/utils/supabase/admin';
import { resolveCaller, isCallerError, forbidden, canUseProperty, propertyOrgId, internalOrgIds, internalPropertyIds } from '@/backend/lib/auth/callerAccess';
import type { RequisitionItemData } from '@/backend/lib/excel/requisitionExcelGenerator';
import { deliverySummaries, type DeliverySummary } from '@/backend/lib/procurement/requisitionDelivery';

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const organizationId = searchParams.get('organization_id');
        const propertyId = searchParams.get('property_id');
        const requisitionMonth = searchParams.get('requisition_month');
        const requisitionYear = searchParams.get('requisition_year');
        const status = searchParams.get('status');

        // Signed-in internal staff only. Organisation-level members see their organisations'
        // requisitions (procurement, admins and the like share them, as before); property-level
        // members see their own properties'. Clients, tenants and vendors see none.
        const caller = await resolveCaller(request);
        if (isCallerError(caller)) return caller;
        const myOrgIds = internalOrgIds(caller);
        const myPropertyIds = internalPropertyIds(caller);
        if (!caller.isMasterAdmin && myOrgIds.length === 0 && myPropertyIds.length === 0) {
            return forbidden('Forbidden: no access to requisitions');
        }

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

        if (!caller.isMasterAdmin) {
            const scopes: string[] = [];
            if (myOrgIds.length) scopes.push(`organization_id.in.(${myOrgIds.join(',')})`);
            if (myPropertyIds.length) scopes.push(`property_id.in.(${myPropertyIds.join(',')})`);
            query = query.or(scopes.join(','));
        }

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
                site_notes: parsedData.site_notes || parsedData.creator_notes || (typeof req.notes === 'string' && !req.notes.trim().startsWith('{') ? req.notes : '') || '',
                vendor_quotation: siteVendorQuotation({ ...req, vendor_quotation: parsedData.vendor_quotation }),
                approver_info: parsedData.approver_info || null,
                edit_info: siteEditInfo({ notes: parsedData }),
                edit_history: siteEditHistory({ notes: parsedData }),
                is_over_budget: Boolean(isOverBudget),
                budget_limit: Number(budgetLimit) || 0,
                over_budget_amount: Number(overBudgetAmount) || 0,
                budget_breakdown: parsedData.budget_breakdown || null
            };
        });

        // Delivery progress from confirmed challans, shown next to the status
        // (the status itself stays as approval / Issue PO need it).
        let deliveries = new Map<string, DeliverySummary>();
        try {
            deliveries = await deliverySummaries(adminSupabase, (data || []).filter(r => ['approved', 'ordered'].includes(r.status)));
        } catch (deliveryErr) {
            console.warn('[Requisitions GET] Delivery summary unavailable:', deliveryErr);
        }

        return NextResponse.json({
            requisitions: enriched.map(req => ({ ...req, delivery: deliveries.get(req.id) || null })),
        });
    } catch (err: any) {
        console.error('[Requisitions GET Server Error]:', err);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        const caller = await resolveCaller(request);
        if (isCallerError(caller)) return caller;
        // The caller may only submit for a property they work at, and is always recorded as the uploader.
        const refuseUnlessAllowed = async (orgId: string, propId: string): Promise<NextResponse | null> => {
            const actualOrg = await propertyOrgId(propId);
            if (!actualOrg || actualOrg !== orgId) return NextResponse.json({ error: 'Property not found in this organization' }, { status: 400 });
            if (!canUseProperty(caller, propId, actualOrg)) return forbidden('Forbidden: no access to this property');
            return null;
        };
        const adminSupabase = createAdminClient();

        const contentType = request.headers.get('content-type') || '';
        let organizationId = '';
        let propertyId = '';
        let floorTag = 'All Floors';
        let requisitionMonth = 0;
        let requisitionYear = 0;
        let userId = '';
        let siteNotes = '';
        let rawItems: RequisitionItemData[] = [];
        let uploadedFile: File | null = null;
        let isPreviewOnly = false;

        if (contentType.includes('application/json')) {
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
            const refusedJson = await refuseUnlessAllowed(organizationId, propertyId);
            if (refusedJson) return refusedJson;
            userId = caller.userId;
        } else {
            const form = await request.formData();
            uploadedFile = form.get('file') as File | null;
            organizationId = form.get('organization_id') as string;
            propertyId = form.get('property_id') as string;
            floorTag = (form.get('floor_tag') as string) || 'All Floors';
            requisitionMonth = parseInt(form.get('requisition_month') as string || '0');
            requisitionYear = parseInt(form.get('requisition_year') as string || '0');
            siteNotes = (form.get('site_notes') as string) || (form.get('notes') as string) || '';
            userId = form.get('user_id') as string;

            if (!uploadedFile || !organizationId || !propertyId || !requisitionMonth || !requisitionYear || !userId) {
                return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
            }
            const refusedForm = await refuseUnlessAllowed(organizationId, propertyId);
            if (refusedForm) return refusedForm;
            userId = caller.userId;
        }

        const artifacts = await prepareRequisitionArtifacts(adminSupabase, {
            organizationId,
            propertyId,
            requisitionMonth,
            requisitionYear,
            floorTag,
            siteNotes,
            userId,
            items: rawItems,
            file: uploadedFile,
            previewOnly: isPreviewOnly,
        });

        if (artifacts.previewResponse) {
            return artifacts.previewResponse;
        }

        const publicUrl = artifacts.publicUrl!;
        const uploadedFileName = artifacts.uploadedFileName!;
        const fileSizeBytes = artifacts.fileSizeBytes || 0;
        const totalEstimatedAmount = artifacts.totalEstimatedAmount || 0;
        const requestedItemsCount = artifacts.requestedItemsCount || 0;
        const isOverBudget = Boolean(artifacts.isOverBudget);
        const allocatedBudgetLimit = artifacts.allocatedBudgetLimit || 0;
        const overBudgetAmount = artifacts.overBudgetAmount || 0;
        const baseNotesObj = artifacts.baseNotesObj || {};
        rawItems = artifacts.rawItems || rawItems;
        const notesPayload = JSON.stringify(baseNotesObj);

        // IDEMPOTENCY & DUPLICATION PREVENTION:
        // Check if a requisition for this property, month, year, and floor tag already exists
        const { data: existingRecords } = await adminSupabase
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
        let isEditUpdate = false;

        if (existingRecords && existingRecords.length > 0) {
            const latest = existingRecords[0];
            const msSinceCreation = Date.now() - new Date(latest.created_at).getTime();
            const latestNotes = requisitionNotes(latest);
            const sameItems = JSON.stringify((latestNotes.items || []).map((i: any) => [i.name, i.requested_qty, i.available_stock_qty, i.remarks || '']))
                === JSON.stringify(rawItems.map((i: any) => [i.name, i.requested_qty, i.available_stock_qty, i.remarks || '']));
            const sameNotes = (latestNotes.site_notes || '') === siteNotes;

            // 1. Debounce identical rapid double-submissions within 45 seconds by the same user
            if (msSinceCreation < 45000 && latest.uploaded_by === userId && sameItems && sameNotes) {
                console.log(`[Requisition Deduplication]: Debounced identical submission within ${msSinceCreation}ms. Returning existing requisition ${latest.id}`);
                return NextResponse.json({
                    success: true,
                    requisition: latest,
                    file_url: latest.file_url,
                    debounced: true
                });
            }

            // 2. If existing record is in an editable site status, update it cleanly (marking Edited when already uploaded)
            if (canSiteEditRequisition(latest)) {
                const nowIso = new Date().toISOString();
                let finalNotes = notesPayload;
                if (latest.status !== 'draft') {
                    const { data: editorUser } = await adminSupabase.from('users').select('full_name, email').eq('id', userId).maybeSingle();
                    const editorName = editorUser?.full_name || editorUser?.email || caller.email || 'Site Team';
                    finalNotes = JSON.stringify(prepareRequisitionEdit(latest, {
                        baseNotes: baseNotesObj,
                        editorId: userId,
                        editorName,
                        editedAt: nowIso,
                        nextStatus: 'submitted',
                    }));
                    isEditUpdate = true;
                }

                const { data: updatedRecord, error: updateError } = await adminSupabase
                    .from('property_monthly_requisitions')
                    .update({
                        file_url: publicUrl,
                        file_name: uploadedFileName,
                        file_size_bytes: fileSizeBytes,
                        notes: finalNotes,
                        status: 'submitted',
                        uploaded_by: latest.uploaded_by || userId,
                        updated_at: nowIso,
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

        // 3. If no existing editable record found, insert new record
        if (!finalRecord) {
            const insertPayload: any = {
                organization_id: organizationId,
                property_id: propertyId,
                requisition_month: requisitionMonth,
                requisition_year: requisitionYear,
                floor_tag: floorTag,
                file_url: publicUrl,
                file_name: uploadedFileName,
                file_size_bytes: fileSizeBytes,
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

        const outboxType = isEditUpdate ? 'REQUISITION_EDITED' : 'REQUISITION_UPLOADED';

        // Submitting a requisition does not write to stock. Stock changes only through
        // the stock screens and confirmed delivery challans (matched by catalog item id).

        // Dispatch Omnichannel notification via event_outbox (automatically delivers Email & WhatsApp via /api/webhooks/process-event)
        (async () => {
            try {
                await adminSupabase.from('event_outbox').insert({
                    event_type: outboxType,
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
                        is_edited: isEditUpdate,
                        edit_info: isEditUpdate ? siteEditInfo(finalRecord) : null,
                        status: 'submitted'
                    }
                });
            } catch (notifErr) {
                console.error('[Requisition Notification Dispatch Error]:', notifErr);
            }
        })();

        const editInfo = siteEditInfo(finalRecord);
        return NextResponse.json({
            success: true,
            requisition: {
                ...finalRecord,
                edit_info: editInfo,
                edit_history: siteEditHistory(finalRecord),
            },
            file_url: publicUrl
        });
    } catch (err: any) {
        console.error('[Requisitions POST Server Error]:', err);
        return NextResponse.json({ error: 'Internal server error', details: err.message }, { status: 500 });
    }
}
