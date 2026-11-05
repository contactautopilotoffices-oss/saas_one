import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { createAdminClient } from '@/frontend/utils/supabase/admin';
import { WhatsAppEventProcessor } from '@/backend/services/WhatsAppEventProcessor';
import { EmailService } from '@/backend/services/EmailService';
import { EmailRecipientResolver } from '@/backend/services/EmailRecipientResolver';
import { isMissingSchemaError } from '@/backend/lib/procurement/catalogAccess';
import {
    requisitionNotes, siteEstimatedAmount, siteVendorQuotation, fileRevision, quoteBatchId,
    replacementBlock, prepareFileReplacement, reapprovalWhatsAppOptions, wasApprovedBeforeReplacement
} from '@/backend/lib/procurement/requisition-approval.mjs';

/**
 * Replace the comparison file procurement attached when sending requisitions for approval.
 *
 * GET  ?organization_id&batch_id | requisition_id - the sites the new file would apply to.
 * POST form: organization_id, batch_id | requisition_id, quote_file (required), note,
 *      target_approver_id - every Pending / Rejected / Approved site in the batch gets the new
 *      file and goes back to Pending Approval. PO issued sites, and approved sites that already
 *      received a delivery, keep the old file.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const submitterRoles = ['procurement', 'purchase_manager', 'purchase_executive', 'org_super_admin', 'ops_super_admin', 'master_admin'];
// The procurement_requisitions bucket only accepts Excel, CSV and PDF.
const FILE_TYPES: Record<string, string> = {
    pdf: 'application/pdf', csv: 'text/csv', xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
};
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

type Admin = ReturnType<typeof createAdminClient>;

interface RequisitionRow {
    id: string;
    organization_id: string;
    property_id: string;
    status: string;
    updated_at: string;
    uploaded_by?: string | null;
    floor_tag?: string | null;
    requisition_month: number;
    requisition_year: number;
    notes?: string | null;
    property?: { id?: string; name?: string } | null;
    uploader?: { id?: string; full_name?: string; email?: string } | null;
}

interface Site { record: RequisitionRow; blocked: string }

const escapeHtml = (value: string) => String(value ?? '').replace(/[&<>"']/g, character => {
    switch (character) {
        case '&': return '&amp;';
        case '<': return '&lt;';
        case '>': return '&gt;';
        case '"': return '&quot;';
        default: return '&#39;';
    }
});

async function authorize(admin: Admin, organizationId: string) {
    const client = await createClient();
    const { data: { user }, error: authError } = await client.auth.getUser();
    if (authError || !user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
    if (!UUID.test(organizationId)) return { error: NextResponse.json({ error: 'Select an organization.' }, { status: 400 }) };
    const { data: profile, error: profileError } = await admin.from('users')
        .select('is_master_admin,deleted_at').eq('id', user.id).maybeSingle();
    if (profileError) throw profileError;
    if (!profile || profile.deleted_at) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
    if (!profile.is_master_admin) {
        const { data: memberships, error } = await admin.from('organization_memberships')
            .select('role').eq('organization_id', organizationId).eq('user_id', user.id).eq('is_active', true);
        if (error) throw error;
        if (!memberships?.some((member: { role: string }) => submitterRoles.includes(member.role))) {
            return { error: NextResponse.json({ error: 'Procurement or administrator access is required.' }, { status: 403 }) };
        }
    }
    return { user };
}

/** Sites whose current quote belongs to this batch (or the one site), with what blocks each. */
async function loadSites(admin: Admin, organizationId: string, batchId: string, requisitionId: string) {
    let query = admin.from('property_monthly_requisitions')
        .select('*,property:properties!property_id(id,name),uploader:users!uploaded_by(id,full_name,email,phone)')
        .eq('organization_id', organizationId);
    // notes is JSON text; narrow by the stored batch id, then confirm on the parsed quote.
    query = batchId ? query.like('notes', '%"batch_id":"' + batchId + '"%') : query.eq('id', requisitionId);
    const { data, error } = await query;
    if (error) throw error;
    const records = ((data || []) as RequisitionRow[]).filter(record => batchId
        ? quoteBatchId(record) === batchId
        : !quoteBatchId(record) && Boolean(siteVendorQuotation(record)));

    const approvedIds = records.filter(record => record.status === 'approved').map(record => record.id);
    const delivered = new Set<string>();
    if (approvedIds.length) {
        const { data: deliveries, error: deliveryError } = await admin.from('requisition_deliveries')
            .select('requisition_id').eq('status', 'confirmed').in('requisition_id', approvedIds);
        if (deliveryError && !isMissingSchemaError(deliveryError)) throw deliveryError;
        ((deliveries || []) as { requisition_id: string }[]).forEach(row => delivered.add(row.requisition_id));
    }
    return records.map((record): Site => ({ record, blocked: replacementBlock(record, delivered.has(record.id)) }));
}

/** Site amount for messages; a bad stored estimate shows as 0 instead of failing after the save. */
function amountOf(record: RequisitionRow) {
    try { return siteEstimatedAmount(record); } catch { return 0; }
}

function siteLabel(record: RequisitionRow) {
    const floor = record.floor_tag && record.floor_tag !== 'All Floors' ? ' (' + record.floor_tag + ')' : '';
    return (record.property?.name || 'Property') + floor + ', ' + MONTHS[(record.requisition_month || 1) - 1] + ' ' + record.requisition_year;
}

function readTarget(searchOrForm: { get(key: string): unknown }) {
    return {
        organizationId: String(searchOrForm.get('organization_id') || ''),
        batchId: String(searchOrForm.get('batch_id') || ''),
        requisitionId: String(searchOrForm.get('requisition_id') || '')
    };
}

function invalidTarget(batchId: string, requisitionId: string) {
    return Boolean(batchId) === Boolean(requisitionId) || (batchId && !UUID.test(batchId)) || (requisitionId && !UUID.test(requisitionId));
}

export async function GET(request: NextRequest) {
    try {
        const admin = createAdminClient();
        const { organizationId, batchId, requisitionId } = readTarget(new URL(request.url).searchParams);
        const auth = await authorize(admin, organizationId);
        if (auth.error) return auth.error;
        if (invalidTarget(batchId, requisitionId)) {
            return NextResponse.json({ error: 'Choose one batch or one requisition.' }, { status: 400 });
        }
        const sites = await loadSites(admin, organizationId, batchId, requisitionId);
        if (!sites.length) return NextResponse.json({ error: 'No requisitions were found for this upload.' }, { status: 404 });
        const latest = sites.reduce((best, site) => fileRevision(site.record) >= fileRevision(best.record) ? site : best, sites[0]);
        const quote = siteVendorQuotation(latest.record) || {};
        const approver = requisitionNotes(latest.record).approver_info || null;
        return NextResponse.json({
            batch_id: batchId || null,
            revision: Math.max(...sites.map(site => fileRevision(site.record))),
            file: { url: quote.file_url || '', name: quote.file_name || '' },
            notes: quote.notes || '',
            approver: approver ? { id: approver.id, name: approver.name || 'Approver' } : null,
            sites: sites.map(({ record, blocked }) => {
                return { id: record.id, label: siteLabel(record), status: record.status, amount: amountOf(record),
                    revision: fileRevision(record), eligible: !blocked, blocked_reason: blocked };
            })
        });
    } catch (error) {
        console.error('[Requisition Re-approval GET]', error);
        return NextResponse.json({ error: 'Could not load this upload. Please retry.' }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        const admin = createAdminClient();
        const form = await request.formData();
        const { organizationId, batchId, requisitionId } = readTarget(form);
        const auth = await authorize(admin, organizationId);
        if (auth.error) return auth.error;
        const user = auth.user!;
        if (invalidTarget(batchId, requisitionId)) {
            return NextResponse.json({ error: 'Choose one batch or one requisition.' }, { status: 400 });
        }
        const quoteFile = form.get('quote_file') as File | null;
        if (!quoteFile || !quoteFile.size) {
            return NextResponse.json({ error: 'Attach the corrected comparison file.' }, { status: 400 });
        }
        const extension = (quoteFile.name.split('.').pop() || '').toLowerCase();
        const contentType = quoteFile.name.includes('.') ? FILE_TYPES[extension] : undefined;
        if (!contentType) {
            return NextResponse.json({ error: 'Upload the comparison file as Excel (.xlsx, .xls), CSV or PDF.' }, { status: 400 });
        }
        if (quoteFile.size > MAX_FILE_BYTES) {
            return NextResponse.json({ error: 'The comparison file is larger than 10 MB.' }, { status: 400 });
        }
        const note = String(form.get('note') || '').trim().slice(0, 1000);
        const targetApproverId = String(form.get('target_approver_id') || '');
        if (!UUID.test(targetApproverId)) return NextResponse.json({ error: 'Select the approver.' }, { status: 400 });
        const { data: approverMembership, error: approverMembershipError } = await admin.from('organization_memberships')
            .select('role').eq('organization_id', organizationId).eq('user_id', targetApproverId).eq('is_active', true).maybeSingle();
        if (approverMembershipError) throw approverMembershipError;
        if (!approverMembership || !['org_super_admin', 'ops_super_admin'].includes(approverMembership.role)) {
            return NextResponse.json({ error: 'Choose an active Org Super Admin or Ops Super Admin in this organization.' }, { status: 400 });
        }
        const { data: approver, error: approverError } = await admin.from('users')
            .select('id,full_name,email,phone,deleted_at').eq('id', targetApproverId).maybeSingle();
        if (approverError) throw approverError;
        if (!approver || approver.deleted_at) return NextResponse.json({ error: 'Approver is unavailable.' }, { status: 400 });

        const sites = await loadSites(admin, organizationId, batchId, requisitionId);
        if (!sites.length) return NextResponse.json({ error: 'No requisitions were found for this upload.' }, { status: 404 });
        const eligible = sites.filter(site => !site.blocked).map(site => site.record);
        const locked = sites.filter(site => site.blocked).map(({ record, blocked }) => ({ id: record.id, label: siteLabel(record), reason: blocked }));
        if (!eligible.length) {
            return NextResponse.json({ error: 'Every site in this upload already has a PO or a delivery, so the file cannot be replaced.', locked }, { status: 409 });
        }

        const revision = Math.max(...sites.map(site => fileRevision(site.record))) + 1;
        const revisionId = crypto.randomUUID();
        const timestamp = new Date().toISOString();
        const actorName = user.user_metadata?.full_name || 'Procurement Team';
        const previousApprover = requisitionNotes(eligible[0]).approver_info || null;

        // New name per attempt: the earlier file stays in storage and in the history, and a retry never collides.
        const safeName = quoteFile.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        const path = organizationId + '/bulk_quotes/' + (batchId || requisitionId) + '_rev' + revision + '_' + revisionId.slice(0, 8) + '_' + safeName;
        const { data: uploaded, error: uploadError } = await admin.storage.from('procurement_requisitions')
            .upload(path, Buffer.from(await quoteFile.arrayBuffer()), { contentType, upsert: false });
        if (uploadError || !uploaded) throw uploadError || new Error('Comparison file upload failed');
        const fileUrl = admin.storage.from('procurement_requisitions').getPublicUrl(uploaded.path).data.publicUrl;
        const fileName = quoteFile.name;

        const approverInfo = { id: targetApproverId, name: approver.full_name || 'Approver', email: approver.email || '',
            phone: approver.phone || '', assigned_at: timestamp, status: 'pending' };
        const context = { organization_id: organizationId, batch_id: batchId || null, revision, revision_id: revisionId,
            requisition_ids: eligible.map(record => record.id), approver_id: targetApproverId,
            approver_name: approverInfo.name, vendor_name: siteVendorQuotation(eligible[0])?.vendor_name || 'Vendor Quote',
            vendor_notes: note, is_reapproval: true };
        // Recovery first, as the bulk upload does: a crash after this point is resent by the outbox sweeper.
        const { error: outboxError } = await admin.from('event_outbox').insert({
            id: revisionId, entity_id: revisionId, event_type: 'REQUISITION_APPROVAL_BATCH_REQUESTED',
            status: 'processing', payload: context, updated_at: timestamp
        });
        if (outboxError) throw outboxError;

        const updatedRecords: RequisitionRow[] = [], failedIds: string[] = [];
        for (const existing of eligible) {
            let notes;
            try {
                notes = prepareFileReplacement(existing, { file_url: fileUrl, file_name: fileName, note, revision,
                    revision_id: revisionId, approver_info: approverInfo, actor_id: user.id, actor_name: actorName, timestamp });
            } catch { failedIds.push(existing.id); continue; }
            const { data, error } = await admin.from('property_monthly_requisitions')
                .update({ status: 'pending_approval', notes: JSON.stringify(notes), updated_at: timestamp })
                .eq('id', existing.id).eq('organization_id', organizationId)
                .eq('status', existing.status).eq('updated_at', existing.updated_at).select('*').maybeSingle();
            if (error || !data) { failedIds.push(existing.id); continue; }
            updatedRecords.push({ ...(data as RequisitionRow), property: existing.property, uploader: existing.uploader });
        }
        if (!updatedRecords.length) {
            await admin.from('event_outbox').update({ status: 'completed' }).eq('id', revisionId);
            await admin.storage.from('procurement_requisitions').remove([uploaded.path]);
            return NextResponse.json({ error: 'No requisitions were updated. Refresh and try again.', failed_ids: failedIds, locked }, { status: 409 });
        }

        const approvedEarlier = updatedRecords.filter(wasApprovedBeforeReplacement);
        const previousFile = siteVendorQuotation(eligible[0])?.file_url || '';
        const approvedEarlierIds = new Set(approvedEarlier.map(record => record.id));
        const notificationResults = await Promise.allSettled([
            // 1. Approver: one email for the whole replacement.
            (async () => {
                if (!approver.email) return;
                const resolution = await EmailRecipientResolver.resolveRecipients({
                    organizationId, featureKey: 'requisition_approval_requested', contextualEmails: [approver.email]
                });
                if (!resolution.enabled || !resolution.emails.length) return;
                const total = updatedRecords.reduce((sum, record) => sum + amountOf(record), 0);
                await EmailService.sendGenericNotificationEmail({
                    emailTo: resolution.emails.join(', '),
                    subject: '[Re-Approval] Comparison file updated for ' + updatedRecords.length + ' monthly requisition(s) · Rev ' + revision,
                    title: 'Comparison file updated: please review again',
                    htmlBody: '<p>Hello ' + escapeHtml(approverInfo.name) + ',</p>' +
                        '<p><b>' + escapeHtml(actorName) + '</b> replaced the comparison file (Rev ' + revision + ').' +
                        (approvedEarlier.length ? ' <b>' + approvedEarlier.length + ' site(s) you approved earlier need your approval again.</b>' : '') + '</p>' +
                        (note ? '<p><b>What was corrected:</b> ' + escapeHtml(note) + '</p>' : '') +
                        '<ul>' + updatedRecords.map(record => '<li>' + escapeHtml(siteLabel(record)) + ': ₹' +
                            amountOf(record).toLocaleString('en-IN') +
                            (approvedEarlierIds.has(record.id) ? ' <i>(approved earlier, needs approval again)</i>' : '') + '</li>').join('') + '</ul>' +
                        '<p>Combined estimated amount: ₹' + (Math.round(total * 100) / 100).toLocaleString('en-IN') +
                        '. Review and approve or reject each requisition separately in the app.</p>' +
                        '<p><a href="' + escapeHtml(fileUrl) + '">Open the new comparison file (Rev ' + revision + ')</a>' +
                        (previousFile ? ' · <a href="' + escapeHtml(previousFile) + '">Previous file</a>' : '') + '</p>'
                });
            })(),
            // 2. Approver: one WhatsApp summary, tracked by the outbox row for retries.
            (async () => {
                try {
                    await WhatsAppEventProcessor.dispatch(reapprovalWhatsAppOptions(updatedRecords, context));
                    const { error } = await admin.from('event_outbox').update({ status: 'completed' }).eq('id', revisionId);
                    if (error) throw error;
                } catch (error) {
                    await admin.from('event_outbox').update({ status: 'failed', retry_count: 0,
                        error_message: error instanceof Error ? error.message : 'Re-approval summary enqueue failed' }).eq('id', revisionId);
                    throw error;
                }
            })(),
            // 3. Earlier approver, when procurement chose someone else.
            (async () => {
                if (!previousApprover?.id || previousApprover.id === targetApproverId) return;
                const { data: earlier } = await admin.from('users').select('email,full_name').eq('id', previousApprover.id).maybeSingle();
                if (!earlier?.email) return;
                const resolution = await EmailRecipientResolver.resolveRecipients({
                    organizationId, featureKey: 'requisition_approval_requested', contextualEmails: []
                });
                if (!resolution.enabled) return;
                await EmailService.sendGenericNotificationEmail({
                    emailTo: earlier.email,
                    subject: '[Re-Approval] Monthly requisitions moved to ' + approverInfo.name + ' · Rev ' + revision,
                    title: 'Approval moved to another approver',
                    htmlBody: '<p>Hello ' + escapeHtml(earlier.full_name || 'Approver') + ',</p>' +
                        '<p>The comparison file was updated and these requisitions now go to <b>' + escapeHtml(approverInfo.name) +
                        '</b> for approval. No action is needed from you.</p><ul>' +
                        updatedRecords.map(record => '<li>' + escapeHtml(siteLabel(record)) + '</li>').join('') + '</ul>'
                });
            })(),
            // 4. Procurement and site team: an approval they may be acting on is no longer valid.
            (async () => {
                if (!approvedEarlier.length) return;
                const contextualEmails = [...new Set(approvedEarlier.map(record => record.uploader?.email).filter(Boolean))] as string[];
                const resolution = await EmailRecipientResolver.resolveRecipients({
                    organizationId, featureKey: 'requisition_status_updated', contextualEmails
                });
                if (resolution.enabled && resolution.emails.length) {
                    await EmailService.sendGenericNotificationEmail({
                        emailTo: resolution.emails.join(', '),
                        subject: '[Pending Re-Approval] ' + approvedEarlier.length + ' approved monthly requisition(s) sent back for approval · Rev ' + revision,
                        title: 'Approval needed again',
                        htmlBody: '<p>The comparison file was updated (Rev ' + revision + '), so these approved requisitions are back in ' +
                            '<b>Pending Approval</b> with ' + escapeHtml(approverInfo.name) + '. Do not issue a PO or act on the earlier approval until it is approved again.</p><ul>' +
                            approvedEarlier.map(record => '<li>' + escapeHtml(siteLabel(record)) + '</li>').join('') + '</ul>' +
                            (note ? '<p><b>What was corrected:</b> ' + escapeHtml(note) + '</p>' : '')
                    });
                }
                // One failed send must not stop the others.
                const failures: unknown[] = [];
                for (const record of approvedEarlier) {
                    try { await WhatsAppEventProcessor.dispatch({
                        featureKey: 'requisition_status_updated',
                        templateEventKey: 'requisition_status_updated',
                        organizationId,
                        propertyId: record.property_id,
                        entityId: record.id + ':rev:' + revision,
                        contextualUserIds: { requesterId: record.uploaded_by },
                        paramValues: {
                            user_name: 'Procurement Team',
                            property: record.property?.name || 'Property',
                            month: MONTHS[(record.requisition_month || 1) - 1],
                            year: String(record.requisition_year || ''),
                            status: 'PENDING RE-APPROVAL',
                            approver_name: approverInfo.name,
                            total_amount: amountOf(record).toLocaleString('en-IN'),
                            remarks: 'Comparison file updated (Rev ' + revision + '). The earlier approval is on hold until it is approved again.'
                        },
                        summaryMessage: 'Requisition for ' + siteLabel(record) + ' is back in Pending Approval: comparison file updated (Rev ' + revision + ')'
                    }); } catch (error) { failures.push(error); }
                }
                if (failures.length) throw failures[0];
            })()
        ]);
        const notificationWarning = notificationResults.some(result => result.status === 'rejected');
        notificationResults.forEach(result => { if (result.status === 'rejected') console.error('[Re-approval Notification]', result.reason); });
        return NextResponse.json({ success: true, revision, updated_count: updatedRecords.length,
            approved_earlier_count: approvedEarlier.length, failed_ids: failedIds, locked,
            notification_warning: notificationWarning });
    } catch (error) {
        console.error('[Requisition Re-approval]', error);
        return NextResponse.json({ error: 'Could not replace the comparison file. Please retry.' }, { status: 500 });
    }
}
