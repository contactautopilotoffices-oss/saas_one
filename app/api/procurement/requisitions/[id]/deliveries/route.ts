import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { createClient } from '@/frontend/utils/supabase/server';
import { createAdminClient } from '@/frontend/utils/supabase/admin';
import { requisitionNotes } from '@/backend/lib/procurement/requisition-approval.mjs';
import { isMissingSchemaError, isProcurementUser } from '@/backend/lib/procurement/catalogAccess';
import { ensureStockRowsForCatalogItems, getPropertyStockSource, type CatalogItemForStock } from '@/backend/lib/stock/propertyStock';
import { isValidUuid } from '@/backend/lib/utils';

/**
 * Delivery challans for an approved monthly requisition.
 *
 * GET  - what was ordered, what has arrived so far, and every challan uploaded.
 * POST - a property admin uploads a challan and the received quantity per item;
 *        confirm_requisition_delivery() adds it to stock in one transaction.
 *
 * Items are matched to stock by the catalog item id each requisition line was
 * created from (row id 'cat-<catalog id>'), never by name.
 */

const CHALLAN_BUCKET = 'procurement_requisitions';
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
const CHALLAN_STATUSES = ['approved', 'ordered'];
const MISSING_SCHEMA =
    'Delivery challans have not been set up on this database yet. Run the pending Supabase migration 20261026000001 and try again.';

interface OrderedLine {
    catalog_item_id: string;
    item_name: string;
    unit: string;
    category: string;
    ordered_qty: number;
}

/** The lines a property actually asked for, keyed by catalog item id. */
function orderedLines(record: Record<string, unknown>): Map<string, OrderedLine> {
    const notes = requisitionNotes(record) as { items?: unknown };
    const items = Array.isArray(notes.items) ? notes.items : [];
    const lines = new Map<string, OrderedLine>();

    for (const raw of items as Record<string, unknown>[]) {
        const qty = Number(raw?.requested_qty) || 0;
        if (qty <= 0) continue;
        const rowId = String(raw?.id || '');
        const catalogId = String(raw?.catalog_item_id || (rowId.startsWith('cat-') ? rowId.slice(4) : ''));
        if (!isValidUuid(catalogId)) continue;

        const existing = lines.get(catalogId);
        if (existing) {
            existing.ordered_qty += qty;
            continue;
        }
        lines.set(catalogId, {
            catalog_item_id: catalogId,
            item_name: String(raw?.name || 'Item'),
            unit: String(raw?.unit || ''),
            category: String(raw?.category || ''),
            ordered_qty: qty,
        });
    }
    return lines;
}

async function loadContext(requisitionId: string) {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
    if (!isValidUuid(requisitionId)) return { error: NextResponse.json({ error: 'Requisition not found' }, { status: 404 }) };

    const admin = createAdminClient();
    const { data: requisition, error: reqError } = await admin
        .from('property_monthly_requisitions')
        .select('id, organization_id, property_id, status, notes, requisition_month, requisition_year, property:properties!property_id(id, name, code)')
        .eq('id', requisitionId)
        .maybeSingle();
    if (reqError) throw reqError;
    if (!requisition) return { error: NextResponse.json({ error: 'Requisition not found' }, { status: 404 }) };

    const [{ data: propertyMemberships }, { data: profile }] = await Promise.all([
        admin.from('property_memberships')
            .select('role')
            .eq('user_id', user.id)
            .eq('property_id', requisition.property_id)
            .eq('is_active', true),
        admin.from('users').select('is_master_admin').eq('id', user.id).maybeSingle(),
    ]);

    const isPropertyAdmin = (propertyMemberships || []).some(m => m.role === 'property_admin');
    const canView = (propertyMemberships || []).length > 0
        || Boolean(profile?.is_master_admin)
        || await isProcurementUser(user.id, requisition.organization_id);
    if (!canView) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };

    return { user, admin, requisition, isPropertyAdmin };
}

export async function GET(
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        const ctx = await loadContext(id);
        if (ctx.error) return ctx.error;
        const { admin, requisition, isPropertyAdmin } = ctx;

        const itemSource = await getPropertyStockSource(requisition.property_id);

        const { data: deliveries, error: delError } = await admin
            .from('requisition_deliveries')
            .select('*, confirmed_by_user:users!confirmed_by(full_name), items:requisition_delivery_items(*)')
            .eq('requisition_id', requisition.id)
            .eq('status', 'confirmed')
            .order('confirmed_at', { ascending: false });

        const schemaMissing = isMissingSchemaError(delError);
        if (delError && !schemaMissing) throw delError;

        const received = new Map<string, number>();
        for (const d of deliveries || []) {
            for (const item of (d.items || []) as { catalog_item_id: string | null; received_qty: number }[]) {
                if (!item.catalog_item_id) continue;
                received.set(item.catalog_item_id, (received.get(item.catalog_item_id) || 0) + Number(item.received_qty || 0));
            }
        }

        const lines = [...orderedLines(requisition).values()].map(line => {
            const got = received.get(line.catalog_item_id) || 0;
            return { ...line, received_qty: got, pending_qty: Math.max(line.ordered_qty - got, 0) };
        });

        let blockedReason: string | null = null;
        if (schemaMissing) blockedReason = MISSING_SCHEMA;
        else if (!CHALLAN_STATUSES.includes(requisition.status)) blockedReason = 'A challan can be uploaded once the requisition is approved.';
        else if (itemSource !== 'catalog') blockedReason = 'This property is still on its old stock list. Ask procurement to switch it to requisition items in Stock Settings.';
        else if (!isPropertyAdmin) blockedReason = 'Only the property admin can upload a delivery challan.';
        else if (lines.length === 0) blockedReason = 'This requisition has no items from the standard list to receive.';

        return NextResponse.json({
            success: true,
            requisition: {
                id: requisition.id,
                status: requisition.status,
                property_id: requisition.property_id,
                property: requisition.property,
                requisition_month: requisition.requisition_month,
                requisition_year: requisition.requisition_year,
            },
            can_upload: !blockedReason,
            blocked_reason: blockedReason,
            lines,
            deliveries: (deliveries || []).map(d => ({
                id: d.id,
                challan_number: d.challan_number,
                challan_date: d.challan_date,
                file_url: d.file_url,
                file_name: d.file_name,
                total_items: d.total_items,
                total_qty: d.total_qty,
                confirmed_at: d.confirmed_at,
                confirmed_by: (d.confirmed_by_user as { full_name?: string } | null)?.full_name || null,
                items: d.items || [],
            })),
        });
    } catch (err) {
        return NextResponse.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 });
    }
}

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    let uploadedPath: string | null = null;
    const admin = createAdminClient();

    try {
        const { id } = await params;
        const ctx = await loadContext(id);
        if (ctx.error) return ctx.error;
        const { user, requisition, isPropertyAdmin } = ctx;

        if (!isPropertyAdmin) {
            return NextResponse.json({ error: 'Only the property admin can upload a delivery challan.' }, { status: 403 });
        }
        if (!CHALLAN_STATUSES.includes(requisition.status)) {
            return NextResponse.json({ error: 'A challan can be uploaded once the requisition is approved.' }, { status: 409 });
        }
        if (await getPropertyStockSource(requisition.property_id) !== 'catalog') {
            return NextResponse.json({ error: 'This property is still on its old stock list. Ask procurement to switch it to requisition items in Stock Settings.' }, { status: 409 });
        }

        const form = await request.formData();
        const file = form.get('file');
        const challanNumber = String(form.get('challan_number') || '').trim();
        const challanDate = String(form.get('challan_date') || '').trim();
        const idempotencyKey = String(form.get('idempotency_key') || '');
        let submitted: { catalog_item_id?: string; received_qty?: number; remarks?: string }[] = [];
        try {
            submitted = JSON.parse(String(form.get('lines') || '[]'));
        } catch {
            return NextResponse.json({ error: 'Could not read the item list' }, { status: 400 });
        }

        if (!(file instanceof File) || file.size === 0) {
            return NextResponse.json({ error: 'Attach the delivery challan (photo or PDF).' }, { status: 400 });
        }
        if (file.size > MAX_FILE_BYTES) {
            return NextResponse.json({ error: 'The challan file must be 10 MB or smaller.' }, { status: 400 });
        }
        if (file.type && !ALLOWED_TYPES.includes(file.type)) {
            return NextResponse.json({ error: 'Upload the challan as a PDF or an image.' }, { status: 400 });
        }
        if (!challanNumber) {
            return NextResponse.json({ error: 'Enter the challan number.' }, { status: 400 });
        }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(challanDate)) {
            return NextResponse.json({ error: 'Enter the challan date.' }, { status: 400 });
        }
        if (!isValidUuid(idempotencyKey)) {
            return NextResponse.json({ error: 'Missing submission key. Refresh and try again.' }, { status: 400 });
        }
        if (!Array.isArray(submitted)) {
            return NextResponse.json({ error: 'Could not read the item list' }, { status: 400 });
        }

        // Ordered quantities come from the requisition, never from the browser.
        const ordered = orderedLines(requisition);
        const lines = [];
        for (const s of submitted) {
            const qty = Number(s?.received_qty);
            if (!Number.isFinite(qty) || qty < 0) {
                return NextResponse.json({ error: 'Received quantities must be 0 or more.' }, { status: 400 });
            }
            if (qty === 0) continue;
            const line = ordered.get(String(s?.catalog_item_id || ''));
            if (!line) {
                return NextResponse.json({ error: 'An item on this challan is not on the requisition.' }, { status: 400 });
            }
            lines.push({
                catalog_item_id: line.catalog_item_id,
                item_name: line.item_name,
                unit: line.unit,
                ordered_qty: line.ordered_qty,
                received_qty: qty,
                remarks: String(s?.remarks || '').slice(0, 500),
            });
        }
        if (lines.length === 0) {
            return NextResponse.json({ error: 'Enter the received quantity for at least one item.' }, { status: 400 });
        }

        // Every received item needs a requisition-list stock row to land in, even
        // one procurement has since taken off this property's list.
        // Requisition lines are saved as the browser sent them, so a line's catalog
        // id is only trusted once it is found in this organisation's catalog.
        const { data: catalogRows, error: catalogError } = await admin
            .from('procurement_catalog')
            .select('id, name, item_code, category, unit')
            .eq('organization_id', requisition.organization_id)
            .in('id', lines.map(l => l.catalog_item_id));
        if (catalogError) throw catalogError;
        const known = new Set((catalogRows || []).map(c => c.id as string));
        const unknown = lines.find(l => !known.has(l.catalog_item_id));
        if (unknown) {
            return NextResponse.json({ error: `${unknown.item_name} is not an item in this organisation's catalog.` }, { status: 400 });
        }

        const property = requisition.property as unknown as { code?: string | null } | null;
        await ensureStockRowsForCatalogItems(admin, {
            organizationId: requisition.organization_id,
            propertyId: requisition.property_id,
            propertyCode: property?.code,
            userId: user.id,
        }, (catalogRows || []) as CatalogItemForStock[]);

        const safeName = (file.name || 'challan').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(-80);
        uploadedPath = `deliveries/${requisition.organization_id}/${requisition.property_id}/${requisition.id}/${Date.now()}_${randomUUID().slice(0, 8)}_${safeName}`;
        const { error: uploadError } = await admin.storage
            .from(CHALLAN_BUCKET)
            .upload(uploadedPath, Buffer.from(await file.arrayBuffer()), {
                contentType: file.type || 'application/octet-stream',
                upsert: false,
            });
        if (uploadError) {
            uploadedPath = null;
            return NextResponse.json({ error: 'Could not upload the challan file', details: uploadError.message }, { status: 500 });
        }
        const fileUrl = admin.storage.from(CHALLAN_BUCKET).getPublicUrl(uploadedPath).data.publicUrl;

        const { data: delivery, error: rpcError } = await admin.rpc('confirm_requisition_delivery', {
            p_actor: user.id,
            p_requisition_id: requisition.id,
            p_challan_number: challanNumber,
            p_challan_date: challanDate,
            p_file_url: fileUrl,
            p_file_name: file.name || safeName,
            p_idempotency_key: idempotencyKey,
            p_lines: lines,
        });

        if (rpcError) {
            await admin.storage.from(CHALLAN_BUCKET).remove([uploadedPath]);
            uploadedPath = null;
            if (isMissingSchemaError(rpcError) || rpcError.code === 'PGRST202') {
                return NextResponse.json({ error: MISSING_SCHEMA }, { status: 503 });
            }
            return NextResponse.json({ error: rpcError.message }, { status: 400 });
        }

        // A retried submit returns the first challan; drop the duplicate file.
        if (delivery && (delivery as { file_url?: string }).file_url !== fileUrl) {
            await admin.storage.from(CHALLAN_BUCKET).remove([uploadedPath]);
        }

        return NextResponse.json({ success: true, delivery }, { status: 201 });
    } catch (err) {
        if (uploadedPath) await admin.storage.from(CHALLAN_BUCKET).remove([uploadedPath]);
        const error = err as { code?: string; message?: string };
        if (isMissingSchemaError(error)) return NextResponse.json({ error: MISSING_SCHEMA }, { status: 503 });
        return NextResponse.json({ error: error?.message || 'Unknown error' }, { status: 500 });
    }
}
