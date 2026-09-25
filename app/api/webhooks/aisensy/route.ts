import { NextRequest, NextResponse, after } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { processIncomingMessage } from '@/backend/lib/whatsapp/processMessage';

/**
 * POST /api/webhooks/aisensy
 * 
 * Production endpoint to receive webhooks from Aisensy.
 * Event/Topic: "message.sender.user" (or "message.sent.user" / "message.received")
 * 
 * Standard Aisensy webhook payload shapes handled:
 * Shape A (nested data):
 * {
 *   "topic": "message.sender.user",
 *   "data": {
 *     "phone": "919876543210",
 *     "userName": "John Doe",
 *     "message": "AC is not working on 2nd floor",
 *     "messageType": "text" | "image" | "document" | "video",
 *     "mediaUrl": "https://...",
 *     "messageId": "wamid.HBgL..."
 *   }
 * }
 * 
 * Shape B (flat structure):
 * {
 *   "topic": "message.sender.user",
 *   "phone": "919876543210",
 *   "message": "AC is not working on 2nd floor",
 *   "type": "image",
 *   "mediaUrl": "https://...",
 *   "messageId": "wamid.HBgL..."
 * }
 */

export async function GET(req: NextRequest) {
    return NextResponse.json({
        status: 'ok',
        service: 'Aisensy Inbound Webhook Handler',
        endpoint: '/api/webhooks/aisensy',
        timestamp: new Date().toISOString(),
    });
}

export async function POST(req: NextRequest) {
    try {
        // ── 1. Security check (Optional secret verification) ─────────────────
        const configuredSecret = process.env.AISENSY_WEBHOOK_SECRET;
        if (configuredSecret) {
            const url = new URL(req.url);
            const secretQuery = url.searchParams.get('secret');
            const secretHeader = req.headers.get('x-aisensy-secret') || req.headers.get('x-webhook-secret') || req.headers.get('authorization');

            if (secretQuery !== configuredSecret && secretHeader !== configuredSecret && secretHeader !== `Bearer ${configuredSecret}`) {
                console.warn('[AISENSY WEBHOOK] Unauthorized request received - Invalid secret token');
                return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
            }
        }

        // ── 2. Parse JSON body ───────────────────────────────────────────────
        let body: any;
        try {
            body = await req.json();
        } catch (parseErr) {
            console.error('[AISENSY WEBHOOK] Invalid JSON payload:', parseErr);
            return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
        }

        console.log('[AISENSY WEBHOOK] Received payload:', JSON.stringify(body, null, 2));

        // ── 3. Validate Event Topic ──────────────────────────────────────────
        const topic = (body.topic || body.event || body.type || '').toLowerCase();
        
        // Accept inbound message topics (message.sender.user, message.sent.user, message.received, inbound_message)
        const isInboundTopic = 
            !topic || 
            topic.includes('message.sender.user') || 
            topic.includes('message.sent.user') || 
            topic.includes('messages.received') || 
            topic.includes('inbound');

        if (!isInboundTopic) {
            console.log(`[AISENSY WEBHOOK] Ignored topic "${topic}" (not an inbound user message event)`);
            return NextResponse.json({ ok: true, ignored: true, topic });
        }

        // ── 4. Extract Payload Details ───────────────────────────────────────
        const dataObj = body.data || body.payload || body;

        const senderPhone = extractSenderPhone(dataObj, body);

        if (!senderPhone || senderPhone.length < 10) {
            console.warn('[AISENSY WEBHOOK] Payload missing valid sender phone number. Data:', JSON.stringify(dataObj));
            return NextResponse.json({ ok: true, warning: 'No valid phone number found', receivedData: dataObj });
        }

        const messageText: string = extractMessageText(dataObj, body);

        const rawType: string = (
            dataObj.messageType || 
            dataObj.message_type || 
            dataObj.type || 
            dataObj.message?.type || 
            dataObj.messages?.[0]?.type || 
            body.messageType || 
            body.type || 
            'text'
        ).toLowerCase();

        const mediaUrl: string | null = 
            dataObj.mediaUrl || 
            dataObj.media_url || 
            dataObj.media?.url || 
            dataObj.url || 
            dataObj.message?.mediaUrl || 
            dataObj.message?.url || 
            dataObj.messages?.[0]?.image?.url || 
            dataObj.messages?.[0]?.document?.url || 
            dataObj.messages?.[0]?.video?.url || 
            body.mediaUrl || 
            null;

        const messageId: string | null = 
            dataObj.messageId || 
            dataObj.message_id || 
            dataObj.id || 
            dataObj.wamid || 
            dataObj.message?.id || 
            dataObj.messages?.[0]?.id || 
            body.messageId || 
            body.id || 
            null;

        const isImage = rawType === 'image' || rawType === 'photo' || (!!mediaUrl && !rawType.includes('video'));
        const isVideo = rawType === 'video';

        if (!messageText && !mediaUrl) {
            console.log('[AISENSY WEBHOOK] Empty message text and media - skipping. Data:', JSON.stringify(dataObj));
            return NextResponse.json({ ok: true });
        }

        // ── 5. Deduplication check via messageId ──────────────────────────────
        if (messageId) {
            const { data: existingTicket } = await supabaseAdmin
                .from('tickets')
                .select('id')
                .eq('wa_message_id', messageId)
                .maybeSingle();

            if (existingTicket) {
                console.log(`[AISENSY WEBHOOK] Duplicate message ID ${messageId} already processed as ticket ${existingTicket.id}`);
                return NextResponse.json({ ok: true, duplicate: true });
            }
        }

        // ── 6. Process message in background using after() ───────────────────
        after(
            processIncomingMessage(
                senderPhone,
                messageText,
                isImage ? mediaUrl : null,
                null, // mediaKey not needed for Aisensy (direct HTTPS media URL)
                isImage,
                isVideo ? mediaUrl : null,
                null, // videoKey not needed
                isVideo,
                null, // propertyId auto-resolved from user
                messageId
            ).catch(err => {
                console.error('[AISENSY WEBHOOK] Error processing incoming message:', err);
            })
        );

        // ── 7. Immediate 200 OK Response ─────────────────────────────────────
        return NextResponse.json({
            success: true,
            message: 'Webhook received and queued for processing',
            topic: topic || 'message.sender.user',
            phone: senderPhone,
        });

    } catch (err: any) {
        console.error('[AISENSY WEBHOOK] Unhandled internal error:', err);
        return NextResponse.json({ error: 'Internal server error', details: err?.message }, { status: 500 });
    }
}

// ── Helper Extractors ────────────────────────────────────────────────────────
function extractSenderPhone(dataObj: any, body: any): string {
    const candidate = 
        dataObj?.phone || 
        dataObj?.mobile || 
        dataObj?.mobileNumber || 
        dataObj?.mobile_number || 
        dataObj?.phoneNumber || 
        dataObj?.phone_number || 
        dataObj?.userPhone || 
        dataObj?.user_phone || 
        dataObj?.customerPhone || 
        dataObj?.customer_phone || 
        dataObj?.senderPhone || 
        dataObj?.sender_phone || 
        dataObj?.waId || 
        dataObj?.wa_id || 
        dataObj?.from || 
        dataObj?.sender?.phone || 
        dataObj?.sender?.mobile || 
        dataObj?.sender?.phone_number || 
        dataObj?.sender?.mobileNumber || 
        dataObj?.user?.phone || 
        dataObj?.user?.mobile || 
        dataObj?.contact?.phone || 
        dataObj?.contacts?.[0]?.wa_id || 
        dataObj?.contacts?.[0]?.phone || 
        dataObj?.messages?.[0]?.from || 
        body?.phone || 
        body?.mobile || 
        body?.from || 
        body?.wa_id || 
        '';

    let cleaned = String(candidate || '').replace(/\D/g, '');
    if (cleaned.length >= 10 && cleaned.length <= 15) {
        return cleaned;
    }

    const recursivePhone = findPhoneInObject(dataObj) || findPhoneInObject(body);
    if (recursivePhone) {
        return recursivePhone.replace(/\D/g, '');
    }

    return '';
}

function findPhoneInObject(obj: any, depth = 0): string | null {
    if (!obj || typeof obj !== 'object' || depth > 4) return null;
    
    for (const key of Object.keys(obj)) {
        const val = obj[key];
        const lowerKey = key.toLowerCase();
        
        if (typeof val === 'string' || typeof val === 'number') {
            const digits = String(val).replace(/\D/g, '');
            if (
                (lowerKey.includes('phone') || lowerKey.includes('mobile') || lowerKey.includes('wa_id') || lowerKey.includes('from') || lowerKey.includes('sender')) &&
                digits.length >= 10 && digits.length <= 15
            ) {
                return digits;
            }
        } else if (typeof val === 'object' && val !== null) {
            const nested = findPhoneInObject(val, depth + 1);
            if (nested) return nested;
        }
    }
    return null;
}

function extractMessageText(dataObj: any, body: any): string {
    return (
        dataObj?.message || 
        dataObj?.text || 
        dataObj?.caption || 
        dataObj?.messageText || 
        dataObj?.message_text || 
        dataObj?.body || 
        dataObj?.content || 
        dataObj?.message?.text || 
        dataObj?.message?.body || 
        dataObj?.message?.caption || 
        dataObj?.messages?.[0]?.text?.body || 
        dataObj?.messages?.[0]?.caption || 
        body?.message || 
        body?.text || 
        ''
    );
}

