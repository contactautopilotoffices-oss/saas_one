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

// ---------------------------------------------------------------------------
// Re-approval: procurement replaces the comparison file after sending it.
// The batch keeps its id; only the file revision goes up. Earlier files stay
// listed in vendor_quotation.previous_files so the approver can still open them.
// ---------------------------------------------------------------------------

/** Statuses whose comparison file procurement may replace. */
export const REPLACEABLE_STATUSES = ['pending_approval', 'rejected', 'approved'];

function currentQuote(record) {
    return record?.vendor_quotation ?? requisitionNotes(record).vendor_quotation ?? null;
}

/** File revision of the quote now attached; 1 for anything uploaded before re-approval existed. */
export function fileRevision(record) {
    const revision = Number(currentQuote(record)?.revision);
    return Number.isInteger(revision) && revision > 0 ? revision : 1;
}

/** Batch the current quote was uploaded in, or null for a single-site upload. */
export function quoteBatchId(record) {
    return currentQuote(record)?.batch_id || null;
}

/**
 * Why this site cannot take a replaced file, or '' when it can.
 * @param {Record<string, any>} record
 * @param {boolean} hasConfirmedDelivery a delivery challan already added stock from this approval
 */
export function replacementBlock(record, hasConfirmedDelivery) {
    if (record?.status === 'ordered' || record?.status === 'po_issued') return 'PO already issued';
    if (record?.status === 'approved' && hasConfirmedDelivery) return 'Delivery already received';
    if (!REPLACEABLE_STATUSES.includes(record?.status)) return 'Not sent for approval yet';
    return '';
}

/**
 * Notes for one site after its comparison file is replaced. The site goes back to
 * pending_approval; an earlier approval or rejection is kept as previous_decision.
 * @param {Record<string, any>} record
 * @param {{ file_url: string, file_name: string, note?: string, revision: number, revision_id: string,
 *   approver_info: Record<string, any>, actor_id: string, actor_name: string, timestamp: string }} change
 */
export function prepareFileReplacement(record, change) {
    const notes = requisitionNotes(record);
    const quote = siteVendorQuotation(record) || {};
    const earlier = Array.isArray(quote.previous_files) ? quote.previous_files : [];
    const previous_files = quote.file_url
        ? [...earlier, { revision: fileRevision(record), file_url: quote.file_url, file_name: quote.file_name || '',
            uploaded_at: quote.replaced_at || quote.uploaded_at || null }]
        : earlier;
    const decided = record.status === 'approved' || record.status === 'rejected';
    const note = String(change.note || '').trim();
    const vendor_quotation = {
        ...quote,
        total_quoted_amount: quote.total_quoted_amount ?? siteEstimatedAmount(record),
        file_url: change.file_url,
        file_name: change.file_name,
        revision: change.revision,
        revision_id: change.revision_id,
        is_reapproval: true,
        reapproval_note: note,
        replaced_at: change.timestamp,
        replaced_by_id: change.actor_id,
        replaced_by_name: change.actor_name,
        previous_files,
        previous_decision: decided ? {
            status: record.status,
            by_name: notes.approver_info?.name || 'Approver',
            remarks: notes.approver_info?.remarks || '',
            at: notes.approver_info?.action_at || null
        } : null,
        // One summary per replacement; the per-site outbox handler stays quiet.
        approval_notification_mode: 'batch_summary'
    };
    return {
        ...notes,
        vendor_quotation,
        approver_info: change.approver_info,
        updated_at: change.timestamp,
        status_history: [...(Array.isArray(notes.status_history) ? notes.status_history : []), {
            status: 'pending_approval', type: 'file_replaced', previous_status: record.status,
            revision: change.revision, by_id: change.actor_id, by_name: change.actor_name,
            remarks: 'Comparison file replaced (Rev ' + change.revision + ')' + (note ? ': ' + note : ''),
            timestamp: change.timestamp
        }]
    };
}

/** True when this site had been approved before its file was replaced. */
export function wasApprovedBeforeReplacement(record) {
    return currentQuote(record)?.previous_decision?.status === 'approved';
}

/**
 * @typedef {{ is_edited: boolean, edit_count: number, edited_by_id: string | null, edited_by_name: string, edited_at: string | null, previous_status: string | null }} RequisitionEditInfo
 */

export const EDITABLE_SITE_STATUSES = ['draft', 'uploaded', 'submitted', 'acknowledged', 'rejected'];

/** True while the requisition can still be edited and re-uploaded by the site team.
 * @param {any} record
 * @returns {boolean}
 */
export function canSiteEditRequisition(record) {
    return Boolean(record?.status && EDITABLE_SITE_STATUSES.includes(String(record.status)));
}

/** Normalized latest edit metadata stored in requisition notes JSON, or null if never edited.
 * @param {any} record
 * @returns {RequisitionEditInfo | null}
 */
export function siteEditInfo(record) {
    const info = requisitionNotes(record)?.edit_info;
    if (!info || typeof info !== 'object') return null;
    if (!info.edited_at && !info.is_edited) return null;
    const count = Number(info.edit_count);
    return {
        is_edited: true,
        edit_count: Number.isFinite(count) && count > 0 ? count : 1,
        edited_by_id: info.edited_by_id || null,
        edited_by_name: info.edited_by_name || 'Site Team',
        edited_at: info.edited_at || null,
        previous_status: info.previous_status || null,
    };
}

/** Chronological edit history recorded in requisition notes JSON.
 * @param {any} record
 * @returns {any[]}
 */
export function siteEditHistory(record) {
    const history = requisitionNotes(record)?.edit_history;
    return Array.isArray(history) ? history : [];
}

/** Human-readable date and time label for requisition edit clarifications.
 * @param {string | null | undefined} iso
 * @returns {string}
 */
export function formatEditDateTime(iso) {
    if (!iso) return '';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
    });
}

/**
 * Merges newly prepared requisition notes with prior notes while recording
 * who edited the requisition, when, and keeping audit history intact.
 * @param {any} existing
 * @param {{ baseNotes?: Record<string, any> | string, editorId?: string | null, editorName?: string, editedAt?: string, nextStatus?: string, summary?: string }} [options]
 * @returns {Record<string, any>}
 */
export function prepareRequisitionEdit(existing, options = {}) {
    const {
        baseNotes = {},
        editorId = null,
        editorName = 'Site Team',
        editedAt = new Date().toISOString(),
        nextStatus = 'submitted',
        summary = '',
    } = options;
    const prevNotes = requisitionNotes(existing);
    /** @type {Record<string, any>} */
    let parsedBase = {};
    if (typeof baseNotes === 'string') {
        try {
            parsedBase = JSON.parse(baseNotes);
        } catch {
            parsedBase = {};
        }
    } else if (baseNotes && typeof baseNotes === 'object') {
        parsedBase = { ...baseNotes };
    }

    const prevInfo = siteEditInfo(existing);
    const prevEditHistory = siteEditHistory(existing);
    const prevStatusHistory = Array.isArray(prevNotes.status_history) ? prevNotes.status_history : [];
    const previousStatus = String(existing?.status || 'submitted');
    const editCount = (prevInfo?.edit_count || 0) + 1;
    const cleanName = (editorName && String(editorName).trim()) || 'Site Team';
    const cleanSummary = summary && String(summary).trim() ? String(summary).trim() : '';

    const editEntry = {
        edit_number: editCount,
        edited_by_id: editorId || null,
        edited_by_name: cleanName,
        edited_at: editedAt,
        previous_status: previousStatus,
        next_status: nextStatus,
        ...(cleanSummary ? { summary: cleanSummary } : {}),
    };

    const editInfo = {
        is_edited: true,
        edit_count: editCount,
        edited_by_id: editorId || null,
        edited_by_name: cleanName,
        edited_at: editedAt,
        previous_status: previousStatus,
    };

    /** @type {Record<string, any>} */
    const merged = {
        ...parsedBase,
        edit_info: editInfo,
        edit_history: [...prevEditHistory, editEntry],
        status_history: [
            ...prevStatusHistory,
            {
                status: nextStatus,
                action: 'edited',
                by_id: editorId || null,
                by_name: cleanName,
                remarks: cleanSummary || `Requisition edited & re-uploaded (Edit #${editCount})`,
                timestamp: editedAt,
            },
        ],
    };

    // Keep prior quotes/approvals unless the requisition was previously rejected and is now re-submitted.
    if (previousStatus !== 'rejected') {
        if (prevNotes.vendor_quotation) merged.vendor_quotation = prevNotes.vendor_quotation;
        if (prevNotes.approver_info) merged.approver_info = prevNotes.approver_info;
    }
    if (prevNotes.po_info) merged.po_info = prevNotes.po_info;

    return merged;
}

/** One WhatsApp summary to the approver for a replaced comparison file. */
export function reapprovalWhatsAppOptions(records, context) {
    const options = batchWhatsAppOptions(records, context);
    const approvedEarlier = records.filter(wasApprovedBeforeReplacement).length;
    const note = String(context.vendor_notes || '').trim();
    const sites = approvalBatchSummary(records).entries.join('; ');
    options.entityId = String(context.revision_id);
    options.paramValues.notes = 'RE-APPROVAL: comparison file re-uploaded (Rev ' + context.revision + ').' +
        (approvedEarlier ? ' ' + approvedEarlier + ' site(s) approved earlier need approval again.' : '') +
        (note ? ' Note: ' + (note.length > 300 ? note.slice(0, 297) + '...' : note) : '') +
        ' Review each requisition in the app.';
    options.summaryMessage = 'Re-approval (Rev ' + context.revision + '): comparison file updated for ' +
        records.length + ' monthly requisition(s): ' + sites;
    return options;
}
