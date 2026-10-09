import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { createAdminClient } from '@/frontend/utils/supabase/admin';
import { WhatsAppEventProcessor } from '@/backend/services/WhatsAppEventProcessor';
import { EmailService } from '@/backend/services/EmailService';
import { EmailRecipientResolver } from '@/backend/services/EmailRecipientResolver';
import { requisitionNotes, prepareBulkApproval, approvalBatchSummary, batchWhatsAppOptions } from '@/backend/lib/procurement/requisition-approval.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const submitterRoles = ['procurement', 'purchase_manager', 'purchase_executive', 'org_super_admin', 'ops_super_admin', 'master_admin'];
const eligibleStatuses = ['submitted', 'uploaded', 'acknowledged', 'pending_approval', 'rejected'];

export async function POST(request: NextRequest) {
    try {
        const client = await createClient();
        const { data: { user }, error: authError } = await client.auth.getUser();
        if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        const admin = createAdminClient();
        const form = await request.formData();
        const organizationId = String(form.get('organization_id') || '');
        const targetApproverId = String(form.get('target_approver_id') || '');
        let requisitionIds: string[];
        try {
            const parsed = JSON.parse(String(form.get('requisition_ids') || '[]'));
            if (!Array.isArray(parsed) || !parsed.length || parsed.length > 500 ||
                parsed.some(id => typeof id !== 'string' || !UUID.test(id))) throw new Error('Invalid selection');
            requisitionIds = [...new Set<string>(parsed)];
        } catch {
            return NextResponse.json({ error: 'Select valid requisitions (up to 500 per upload).' }, { status: 400 });
        }
        if (!UUID.test(organizationId) || !UUID.test(targetApproverId)) {
            return NextResponse.json({ error: 'Select an organization and designated approver.' }, { status: 400 });
        }
        const { data: profile, error: profileError } = await admin.from('users')
            .select('is_master_admin,deleted_at').eq('id', user.id).maybeSingle();
        if (profileError) throw profileError;
        if (!profile || profile.deleted_at) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        if (!profile.is_master_admin) {
            const { data: memberships, error } = await admin.from('organization_memberships')
                .select('role').eq('organization_id', organizationId).eq('user_id', user.id).eq('is_active', true);
            if (error) throw error;
            if (!memberships?.some(member => submitterRoles.includes(member.role))) {
                return NextResponse.json({ error: 'Procurement or administrator access is required.' }, { status: 403 });
            }
        }
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
        const { data: records, error: fetchError } = await admin.from('property_monthly_requisitions')
            .select('*,property:properties!property_id(id,name),uploader:users!uploaded_by(id,full_name,email,phone)')
            .eq('organization_id', organizationId).in('id', requisitionIds);
        if (fetchError) throw fetchError;
        if (!records || records.length !== requisitionIds.length || records.some(record => !eligibleStatuses.includes(record.status))) {
            return NextResponse.json({ error: 'Some requisitions are unavailable or already approved/ordered. Refresh and select again.' }, { status: 409 });
        }
        const batchId = crypto.randomUUID();
        const timestamp = new Date().toISOString();
        const vendorName = String(form.get('vendor_name') || '').trim() || 'Vendor Quote';
        const vendorNotes = String(form.get('vendor_notes') || '').trim();
        let allocations;
        try { allocations = prepareBulkApproval(records, { vendor_name: vendorName, notes: vendorNotes, batch_id: batchId, uploaded_at: timestamp }); }
        catch { return NextResponse.json({ error: 'A selected requisition has an invalid estimated amount. Correct it before submitting.' }, { status: 400 }); }
        let fileUrl = '', fileName = '';
        const quoteFile = form.get('quote_file') as File | null;
        if (quoteFile && quoteFile.size > 0) {
            const path = organizationId + '/bulk_quotes/' + batchId + '_' + quoteFile.name.replace(/[^a-zA-Z0-9._-]/g, '_');
            const { data, error } = await admin.storage.from('procurement_requisitions')
                .upload(path, Buffer.from(await quoteFile.arrayBuffer()), { contentType: quoteFile.type || 'application/octet-stream', upsert: false });
            if (error || !data) throw error || new Error('Quotation upload failed');
            fileUrl = admin.storage.from('procurement_requisitions').getPublicUrl(data.path).data.publicUrl;
            fileName = quoteFile.name;
        }
        const approverInfo = { id: targetApproverId, name: approver.full_name || 'Approver', email: approver.email || '',
            phone: approver.phone || '', assigned_at: timestamp, status: 'pending' };
        const batchContext = { organization_id: organizationId, batch_id: batchId, requisition_ids: requisitionIds,
            approver_id: targetApproverId, approver_name: approverInfo.name, vendor_name: vendorName, vendor_notes: vendorNotes };
        // Persist recovery before mutating any requisition. A crashed request remains
        // recoverable by the existing outbox sweeper, which selects only rows saved for this batch.
        const { error: outboxError } = await admin.from('event_outbox').insert({
            id: batchId, entity_id: batchId, event_type: 'REQUISITION_APPROVAL_BATCH_REQUESTED',
            status: 'processing', payload: batchContext, updated_at: timestamp
        });
        if (outboxError) throw outboxError;
        const updatedRecords: any[] = [], failedIds: string[] = [];
        for (const existing of records) {
            const notes = requisitionNotes(existing);
            const allocation = allocations.find(item => item.id === existing.id)!;
            const mergedNotes = JSON.stringify({
                ...notes,
                vendor_quotation: { ...allocation.vendor_quotation, file_url: fileUrl, file_name: fileName },
                approver_info: approverInfo, batch_id: batchId, updated_at: timestamp,
                status_history: [...(Array.isArray(notes.status_history) ? notes.status_history : []),
                    { status: 'pending_approval', by_id: user.id, by_name: user.user_metadata?.full_name || 'Procurement Team',
                        remarks: 'Quotation assigned to ' + approverInfo.name, timestamp }]
            });
            const { data, error } = await admin.from('property_monthly_requisitions')
                .update({ status: 'pending_approval', notes: mergedNotes, updated_at: timestamp })
                .eq('id', existing.id).eq('organization_id', organizationId)
                .eq('status', existing.status).eq('updated_at', existing.updated_at).select('*').maybeSingle();
            if (error || !data) { failedIds.push(existing.id); continue; }
            updatedRecords.push({ ...data, property: existing.property, uploader: existing.uploader });
        }
        if (!updatedRecords.length) {
            await admin.from('event_outbox').update({ status: 'completed' }).eq('id', batchId);
            return NextResponse.json({ error: 'No requisitions were submitted. Refresh and try again.', failed_ids: failedIds }, { status: 409 });
        }
        // Only this batch summary sends WhatsApp. Per-record trigger events are
        // suppressed by the batch_summary marker in the shared event processor.
        const summary = approvalBatchSummary(updatedRecords);
        const sites = summary.entries.join('; ');
        const notificationResults = await Promise.allSettled([
            (async () => {
                if (!approver.email) return;
                const resolution = await EmailRecipientResolver.resolveRecipients({
                    organizationId, featureKey: 'requisition_approval_requested', contextualEmails: [approver.email]
                });
                if (!resolution.enabled || !resolution.emails.length) return;
                const escapeHtml = (value: string) => value.replace(/[&<>"']/g, character => {
                    switch (character) {
                        case '&': return '&amp;';
                        case '<': return '&lt;';
                        case '>': return '&gt;';
                        case '"': return '&quot;';
                        default: return '&#39;';
                    }
                });
                await EmailService.sendGenericNotificationEmail({
                    emailTo: resolution.emails.join(', '),
                    subject: '[Action Required] ' + updatedRecords.length + ' monthly requisitions for individual review',
                    title: 'Monthly requisitions awaiting your review',
                    htmlBody: '<p>Hello ' + escapeHtml(approverInfo.name) + ',</p><ul>' +
                        summary.entries.map(entry => '<li>' + escapeHtml(entry) + '</li>').join('') + '</ul>' +
                        '<p>Combined estimated amount: ₹' + summary.total.toLocaleString('en-IN') +
                        '. Review and approve or reject each requisition separately in the app.</p>' +
                        (fileUrl ? '<p><a href="' + escapeHtml(fileUrl) + '">View consolidated quotation</a></p>' : '') +
                        '<p>' + escapeHtml(vendorNotes) + '</p>'
                });
            })(),
            (async () => {
                try {
                    await WhatsAppEventProcessor.dispatch(batchWhatsAppOptions(updatedRecords, batchContext));
                    const { error } = await admin.from('event_outbox').update({ status: 'completed' }).eq('id', batchId);
                    if (error) throw error;
                } catch (error) {
                    await admin.from('event_outbox').update({ status: 'failed', retry_count: 0,
                        error_message: error instanceof Error ? error.message : 'Batch summary enqueue failed' }).eq('id', batchId);
                    throw error;
                }
            })()
        ]);
        const notificationWarning = notificationResults.some(result => result.status === 'rejected');
        notificationResults.forEach(result => { if (result.status === 'rejected') console.error('[Bulk Approval Notification]', result.reason); });
        return NextResponse.json({ success: true, batch_id: batchId, updated_count: updatedRecords.length,
            failed_ids: failedIds, notification_warning: notificationWarning, requisitions: updatedRecords });
    } catch (error) {
        console.error('[Bulk Requisition Approval]', error);
        return NextResponse.json({ error: 'Could not submit requisitions. Please retry.' }, { status: 500 });
    }
}
