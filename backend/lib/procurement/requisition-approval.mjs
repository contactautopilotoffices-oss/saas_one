// Shared by the API, approval views and notification processor.
// Quotation attachments are not parsed: bulk approvals use each site's saved estimate.
export function requisitionNotes(record) {
    if (record?.notes && typeof record.notes === 'object' && !Array.isArray(record.notes)) return record.notes;
    try {
        const parsed = JSON.parse(record?.notes || '{}');
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch { return { site_notes: record?.notes || '' }; }
}

export function siteEstimatedAmount(record) {
    const notes = requisitionNotes(record);
    const value = notes.total_estimated_amount ?? record?.total_estimated_amount ?? 0;
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount < 0) throw new Error('Invalid site estimated amount');
    return Math.round(amount * 100) / 100;
}

export function siteVendorQuotation(record) {
    const quote = record?.vendor_quotation ?? requisitionNotes(record).vendor_quotation;
    if (!quote) return null;
    if (quote.is_bulk && quote.amount_scope !== 'requisition') {
        // Old uploads copied the batch total onto every record. Keep that total
        // as batch metadata; display the site's estimate without rewriting history.
        return {
            ...quote,
            batch_total_amount: quote.batch_total_amount ?? quote.total_quoted_amount,
            total_quoted_amount: siteEstimatedAmount(record),
            amount_scope: 'requisition',
            amount_source: 'site_estimate'
        };
    }
    return quote;
}

export function usesBulkApprovalSummary(record) {
    return requisitionNotes(record).vendor_quotation?.approval_notification_mode === 'batch_summary';
}

/** @param {Array<Record<string, any>>} records @param {Record<string, any>} quote */
export function prepareBulkApproval(records, quote) {
    return records.map(record => ({
        id: record.id,
        vendor_quotation: {
            ...quote,
            total_quoted_amount: siteEstimatedAmount(record),
            amount_scope: 'requisition',
            amount_source: 'site_estimate',
            approval_notification_mode: 'batch_summary',
            is_bulk: true
        }
    }));
}

/**
 * @param {Array<Record<string, any>>} records
 * @returns {{ entries: string[], total: number, month: string, year: string }}
 */
export function approvalBatchSummary(records) {
    const months = ['January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'];
    const entries = records.map(record => {
        const floor = record.floor_tag && record.floor_tag !== 'All Floors' ? ' (' + record.floor_tag + ')' : '';
        return (record.property?.name || 'Property') + floor + ' — ' +
            months[record.requisition_month - 1] + ' ' + record.requisition_year +
            ': ₹' + siteEstimatedAmount(record).toLocaleString('en-IN');
    });
    const total = Math.round(records.reduce((sum, record) => sum + siteEstimatedAmount(record), 0) * 100) / 100;
    const periodMonths = [...new Set(records.map(record => months[record.requisition_month - 1]))];
    const periodYears = [...new Set(records.map(record => String(record.requisition_year)))];
    return { entries, total, month: periodMonths.join(', '), year: periodYears.join(', ') };
}

/** @param {Array<Record<string, any>>} records @param {Record<string, any>} context */
export function batchWhatsAppOptions(records, context) {
    const summary = approvalBatchSummary(records);
    const sites = summary.entries.join('; ');
    return {
        featureKey: 'requisition_approval_requested', templateEventKey: 'requisition_approval_requested',
        organizationId: String(context.organization_id), entityId: String(context.batch_id),
        contextualUserIds: { approverId: String(context.approver_id) },
        durableBatch: true,
        paramValues: {
            approver_name: String(context.approver_name || 'Approver'),
            property: sites.length <= 900 ? sites : sites.slice(0, 860) + '… See all ' + records.length + ' requisitions in app.',
            month: summary.month, year: summary.year, vendor_name: String(context.vendor_name || 'Vendor Quote'),
            total_amount: summary.total.toLocaleString('en-IN'),
            notes: 'Combined site estimates. Review each requisition individually in the app.' +
                (context.vendor_notes ? ' ' + context.vendor_notes : '')
        },
        summaryMessage: records.length + ' monthly requisitions awaiting individual review: ' + sites
    };
}
