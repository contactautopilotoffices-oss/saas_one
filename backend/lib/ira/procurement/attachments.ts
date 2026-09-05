/**
 * ATTACHMENT POLICY — link by default, attach only when the decision needs the file.
 * -----------------------------------------------------------------------------
 * HTML cannot create an attachment. The template renders links; the TRANSPORT
 * layer carries files:
 *
 *     html_body  +  [{ filename, content: Buffer }]  ->  sendMail  ->  recipient
 *
 * So this module answers one question per evidence item: link, or attach?
 *
 * THE RULE, encoded rather than left to judgement:
 *   · PO, invoice, supporting quotation      -> LINK
 *   · comparison sheet needed to approve     -> ATTACH
 *   · evidence PDF required for the decision -> ATTACH
 *
 * Default is LINK. Attaching requires the finding to say WHY, because every
 * attachment is weight in an inbox and most of them are never opened. A digest
 * that drags four PDFs to say "these two POs share an invoice number" has made
 * the recipient's job harder, not easier.
 *
 * SIZE IS A HARD CAP, NOT A GUIDELINE. Nothing else in this repo bounds attachment
 * size (the recon found no mailer that checks), and an SMTP relay rejecting a 30MB
 * message loses the whole digest, not just the file. Over-budget items degrade to
 * links and say so.
 */

/** Per-file ceiling. Beyond this, a link is strictly better than a bounced email. */
export const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024;

/** Whole-message ceiling across all attachments on one email. */
export const MAX_TOTAL_ATTACHMENT_BYTES = 10 * 1024 * 1024;

/** Why a file would travel with the email rather than be linked. */
export type AttachReason =
    | 'comparison_sheet'   // the sheet the approver is being asked to approve against
    | 'decision_evidence'; // a document the decision cannot be made without

/**
 * An evidence item a finding wants to carry. `reason` present = the finding is
 * claiming this must travel WITH the email; absent = link it.
 */
export interface EvidenceItem {
    filename: string;
    /** Signed URL for the link path. */
    url: string | null;
    /** Bytes for the attach path. Resolved lazily so a linked item never downloads. */
    fetch?: () => Promise<Buffer | null>;
    contentType?: string;
    reason?: AttachReason;
    sizeHint?: number | null;
}

/** nodemailer's shape, as used by EmailService.sendEmail. */
export interface MailAttachment {
    filename: string;
    content: Buffer;
    contentType?: string;
}

export interface ResolvedAttachments {
    attachments: MailAttachment[];
    /** Items that stay as links — either by policy or because they were too big. */
    linked: Array<{ filename: string; url: string | null; note: string }>;
    /** Operator-facing notes. Rendered, never swallowed. */
    notes: string[];
}

/**
 * Decide link-vs-attach for a set of evidence items, then fetch only what attaches.
 *
 * Never throws: a fetch that fails degrades that item to a link. One unreachable
 * file must not cost the recipient the whole digest.
 */
export async function resolveAttachments(
    items: ReadonlyArray<EvidenceItem>,
): Promise<ResolvedAttachments> {
    const attachments: MailAttachment[] = [];
    const linked: ResolvedAttachments['linked'] = [];
    const notes: string[] = [];
    let total = 0;

    for (const item of items) {
        // POLICY GATE. No reason stated -> link. This is the default and most items hit it.
        if (!item.reason) {
            linked.push({ filename: item.filename, url: item.url, note: 'linked by policy' });
            continue;
        }

        if (!item.fetch) {
            linked.push({ filename: item.filename, url: item.url, note: 'no fetcher — linked' });
            continue;
        }

        if (typeof item.sizeHint === 'number' && item.sizeHint > MAX_ATTACHMENT_BYTES) {
            linked.push({ filename: item.filename, url: item.url, note: 'too large to attach' });
            notes.push(`${item.filename} exceeds the ${Math.round(MAX_ATTACHMENT_BYTES / 1024 / 1024)}MB attachment cap — sent as a link.`);
            continue;
        }

        let buf: Buffer | null = null;
        try {
            buf = await item.fetch();
        } catch {
            buf = null;
        }

        if (!buf) {
            linked.push({ filename: item.filename, url: item.url, note: 'could not be fetched — linked' });
            notes.push(`${item.filename} could not be retrieved, so it was linked instead of attached.`);
            continue;
        }
        if (buf.length > MAX_ATTACHMENT_BYTES || total + buf.length > MAX_TOTAL_ATTACHMENT_BYTES) {
            linked.push({ filename: item.filename, url: item.url, note: 'over size budget — linked' });
            notes.push(`${item.filename} would push this email over its attachment budget — sent as a link.`);
            continue;
        }

        attachments.push({ filename: item.filename, content: buf, contentType: item.contentType });
        total += buf.length;
    }

    return { attachments, linked, notes };
}
