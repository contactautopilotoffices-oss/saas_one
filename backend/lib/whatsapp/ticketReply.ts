import { canonicalPhone, normalizeInbound } from './assistant/protocol.mjs';

/**
 * Ticket replies on WhatsApp (owner 2026-11-04).
 *
 * OUT: the ticket_reply_v1 notification comes from the DB trigger on ticket_comments. After it is sent, its WhatsApp
 *      message id is saved here against the comment it carried.
 * IN:  when someone swipes right on that message, WhatsApp tells us which message they answered, so the ticket is known
 *      exactly. Their text becomes their comment, and the same DB trigger then notifies the other person, so there is no
 *      second hook and no loop (the person who wrote a comment is never its recipient).
 *
 * No LLM on purpose (doctrine L1, [BAA p.104]): the path is known. A message that is not a swipe on a ticket notification
 * is never guessed at; it carries on to the bots exactly as before. A wrong guess would show it to the wrong person.
 */

export const TICKET_REPLY_EVENT = 'TICKET_REPLY';
export const TICKET_REPLY_WORKFLOW = 'ticket_reply';
/** Longer than the 24-hour default of whatsapp_outgoing_context: people answer tickets days later. */
const SWIPE_WINDOW_DAYS = 30;

const FILE_KINDS = new Set(['image', 'video', 'audio', 'voice', 'ptt', 'document', 'file', 'sticker']);

export const replies = {
    added: (ticket: string) => `✅ Your reply was added to ticket #${ticket}.`,
    fileNotAdded: (ticket: string) => `Files and voice notes can't be added from WhatsApp yet. Please attach it on ticket #${ticket} in FMS, or type your reply here.`,
    notOnTicket: (ticket: string) => `You are no longer on ticket #${ticket}, so this reply was not added. Please open the ticket in FMS.`,
    gone: 'That ticket is no longer available, so this reply was not added.',
    failed: 'Sorry, I could not add that reply. Please try again in a minute, or reply on the ticket in FMS.',
};

export interface TicketReplyTicket {
    id: string;
    ticket_number: string | null;
    raised_by: string | null;
    assigned_to: string | null;
}

export interface TicketReplyDeps {
    quote(phone: string, quotedIds: string[]): Promise<{ workflow: string; conversation_id: string } | null>;
    ticketOfComment(commentId: string): Promise<TicketReplyTicket | null>;
    findUser(phone: string): Promise<{ id: string } | null>;
    /** 'duplicate' = this WhatsApp message already added its comment. */
    addComment(input: { ticketId: string; userId: string; text: string; messageId: string; repliedToCommentId: string }): Promise<'added' | 'duplicate'>;
    send(phone: string, text: string, inboundAt: string): Promise<void>;
}

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const field = (from: unknown, key: string): unknown =>
    (from && typeof from === 'object' ? (from as Record<string, unknown>)[key] : undefined);

interface Inbound {
    phone: string;
    messageId: string;
    text: string;
    mediaUrl: string | null;
    mediaType: string;
    quotedIds?: string[];
    inboundAt?: string;
}

/** normalizeInbound skips a caption-less document, so hand it the document URL (same approach as Task Import). */
function parse(body: unknown): (Inbound & { hasFile: boolean }) | null {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
    const data = field(body, 'data') || field(body, 'payload') || body;
    const messages = field(data, 'messages');
    const msg = (Array.isArray(messages) ? messages[0] : undefined) || field(data, 'message') || {};
    const doc = field(msg, 'document') || field(data, 'document') || field(field(msg, 'message_content'), 'document') || {};
    const docUrl = text(field(doc, 'url')) || text(field(doc, 'link')) || text(field(doc, 'mediaUrl')) || text(field(doc, 'media_url'));
    const inbound = normalizeInbound(!text(field(body, 'mediaUrl')) && docUrl ? { ...body, mediaUrl: docUrl } : body) as Inbound | null;
    return inbound ? { ...inbound, hasFile: !!inbound.mediaUrl || !!docUrl || FILE_KINDS.has(String(inbound.mediaType).toLowerCase()) } : null;
}

const NOT_HANDLED = { handled: false } as const;

/**
 * Handled = this was a swipe-reply to a ticket notification, and the bots must not see it.
 * Everything else comes back handled:false, and a message that is not a swipe costs no database read at all.
 * Never throws.
 */
export async function claimTicketReply(body: unknown, deps?: TicketReplyDeps): Promise<{ handled: boolean }> {
    let inbound: ReturnType<typeof parse>;
    try { inbound = parse(body); } catch { return NOT_HANDLED; }
    if (!inbound?.quotedIds?.length) return NOT_HANDLED;

    let io: TicketReplyDeps;
    try { io = deps ?? await liveDeps(); }
    catch (error) {
        console.error('[TicketReply] Could not load', error instanceof Error ? error.message : error);
        return NOT_HANDLED;
    }
    const inboundAt: string = inbound.inboundAt || new Date().toISOString();
    const answer = (message: string) => io.send(inbound.phone, message, inboundAt)
        .catch(error => console.warn('[TicketReply] Reply could not be sent', error instanceof Error ? error.message : error));

    let commentId: string;
    try {
        const quote = await io.quote(inbound.phone, inbound.quotedIds);
        if (quote?.workflow !== TICKET_REPLY_WORKFLOW) return NOT_HANDLED;
        commentId = quote.conversation_id;
    } catch (error) {
        // Passing this on could turn a ticket reply into a new ticket draft, so stop here and ask them to resend.
        console.error('[TicketReply] Reply context unavailable', error instanceof Error ? error.message : error);
        await answer(replies.failed);
        return { handled: true };
    }

    try {
        const ticket = await io.ticketOfComment(commentId);
        if (!ticket) { await answer(replies.gone); return { handled: true }; }
        const number = ticket.ticket_number || 'N/A';

        const user = await io.findUser(inbound.phone);
        if (!user || (user.id !== ticket.raised_by && user.id !== ticket.assigned_to)) {
            await answer(replies.notOnTicket(number));
            return { handled: true };
        }
        // Nothing half-done: a caption alone ("see attached") would be misleading without its file.
        if (inbound.hasFile || !text(inbound.text)) {
            await answer(replies.fileNotAdded(number));
            return { handled: true };
        }

        const outcome = await io.addComment({ ticketId: ticket.id, userId: user.id, text: text(inbound.text),
            messageId: inbound.messageId, repliedToCommentId: commentId });
        if (outcome === 'added') await answer(replies.added(number));
    } catch (error) {
        console.error('[TicketReply] Reply could not be added', error instanceof Error ? error.message : error);
        await answer(replies.failed);
    }
    return { handled: true };
}

async function liveDeps(): Promise<TicketReplyDeps> {
    const [{ supabaseAdmin }, { lookupQuotedContext }, { findWhatsAppUser }, { sendSessionReply }] = await Promise.all([
        import('@/backend/lib/supabase/admin'),
        import('./interpreter/context'),
        import('./assistant/access'),
        import('./interpreter/delivery.mjs'),
    ]);
    return {
        quote: lookupQuotedContext as TicketReplyDeps['quote'],
        findUser: findWhatsAppUser,
        async ticketOfComment(commentId) {
            const { data, error } = await supabaseAdmin.from('ticket_comments')
                .select('ticket:tickets(id, ticket_number, raised_by, assigned_to)')
                .eq('id', commentId)
                .maybeSingle();
            if (error) throw error;
            return (data?.ticket as unknown as TicketReplyTicket | null) || null;
        },
        async addComment({ ticketId, userId, text: comment, messageId, repliedToCommentId }) {
            const { error } = await supabaseAdmin.from('ticket_comments').insert({
                ticket_id: ticketId,
                user_id: userId,
                comment,
                is_internal: false,
                metadata: { source: 'whatsapp', replied_to_comment_id: repliedToCommentId, ...(messageId ? { whatsapp_message_id: messageId } : {}) },
            });
            if (error?.code === '23505') return 'duplicate';
            if (error) throw error;
            return 'added';
        },
        async send(phone, message, inboundAt) {
            const result = await sendSessionReply(phone, message, inboundAt);
            if (!result.success) throw new Error(result.error || 'send failed');
        },
    };
}

/**
 * Called after a queue row is sent. Links the WhatsApp message to its comment so a swipe-reply can find the ticket.
 * Returns at once for every other kind of message. Never throws: a send that worked must stay a send that worked.
 */
export async function rememberTicketReplyMessage(
    row: { event_type?: string | null; phone?: string | null; entity_id?: string | null },
    messageIds?: string[],
): Promise<void> {
    if (row.event_type !== TICKET_REPLY_EVENT) return;
    const projectId = process.env.AISENSY_PROJECT_ID;
    if (!messageIds?.length) {
        // Without an id a swipe on this message cannot be matched; it goes to the bots like any other message.
        console.warn('[TicketReply] AiSensy returned no message id; swipe-reply will not match this message');
        return;
    }
    if (!projectId || !row.entity_id) return;
    try {
        const { supabaseAdmin } = await import('@/backend/lib/supabase/admin');
        const phone = canonicalPhone(row.phone);
        const expires = new Date(Date.now() + SWIPE_WINDOW_DAYS * 86_400_000).toISOString();
        const { error } = await supabaseAdmin.from('whatsapp_outgoing_context').upsert(messageIds.map(alias => ({
            project_id: projectId, phone, message_alias: alias, workflow: TICKET_REPLY_WORKFLOW,
            conversation_id: row.entity_id, revision: 0, expires_at: expires,
        })), { onConflict: 'project_id,phone,message_alias', ignoreDuplicates: true });
        if (error) throw error;
    } catch (error) {
        console.warn('[TicketReply] Message link could not be saved', error instanceof Error ? error.message : error);
    }
}
