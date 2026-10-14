import { NextRequest, NextResponse, after } from 'next/server';
import { normalizeInbound } from '@/backend/lib/whatsapp/assistant/protocol.mjs';
import { enqueueAssistantMessage, drainWhatsAppPhone } from '@/backend/lib/whatsapp/assistant/runtime';
import { processIncomingMessage } from '@/backend/lib/whatsapp/processMessage';
import { isGreetingMessage } from '@/backend/lib/whatsapp/greeting';
import { AiSensyService } from '@/backend/services/AiSensyService';
import { handleFreeformTest } from '@/whatsapp-test/freeformTest';
import { TaskMessageRouter } from '@/task-manager/TaskMessageRouter';
import { TaskIdempotencyService } from '@/task-manager/TaskIdempotencyService';
import { claimTaskImport } from '@/task-manager/TaskImportInbound';
import { scheduleShadow } from '@/task-manager/brain/shadow';
import { claimSmartChat } from '@/task-manager/brain/live';
import { claimVoiceNote } from '@/task-manager/voice/VoiceIntake';
import { markRoute, recordInbound } from '@/task-manager/InboundLedger';
import { apologiseAfterCrash } from '@/task-manager/NeverSilentWatchdog';
import { appendTurn } from '@/task-manager/ConversationMemory';
import { isInterpreterPilot, lookupQuotedContext, getConversationRoutingState } from '@/backend/lib/whatsapp/interpreter/context';
import { isExplicitTaskCommand, isDirectBookingRequest } from '@/backend/lib/whatsapp/interpreter/coordinator.mjs';

export const runtime = 'nodejs';
export const maxDuration = 120;

// Log field names and types only: never sender numbers, message text, or credentials.
// Bound traversal so unexpected provider payloads cannot create oversized logs.
function payloadShape(value: unknown, depth = 0): unknown {
    if (value === null) return 'null';
    if (Array.isArray(value)) return depth >= 5 ? 'array' : value.slice(0, 1).map(item => payloadShape(item, depth + 1));
    if (typeof value !== 'object') return typeof value;
    if (depth >= 5) return 'object';
    return Object.fromEntries(Object.entries(value).slice(0, 30)
        .map(([key, item]) => [key, payloadShape(item, depth + 1)]));
}

/** The kind of message for the ledger — never its content: "text", "audio", "button", … plus "+reply" when it quotes one. */
function messageKind(input: { mediaType?: string; quotedIds?: string[] }): string {
    return `${input.mediaType || 'text'}${input.quotedIds?.length ? '+reply' : ''}`;
}

export async function GET() {
    return NextResponse.json({ status: 'ok', service: 'AiSensy inbound webhook',
        assistantEnabled: process.env.AISENSY_ASSISTANT_ENABLED === 'true',
        interpreterEnabled: process.env.WHATSAPP_LLM_INTERPRETER_ENABLED === 'true',
        routingVersion: 'ticket-photo-submit-v1' });
}

export async function POST(req: NextRequest) {
    const receivedAt = new Date().toISOString(); // conversation memory orders the person's message by when it ARRIVED
    const enabled = process.env.AISENSY_ASSISTANT_ENABLED === 'true';
    let body: unknown;
    try { body = await req.json(); }
    catch { return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 }); }
    // "Never silent" ledger (switch OFF → returns 'unknown' at once, nothing written): note the message BEFORE any route
    // runs, so a reply sent while routing is matched to it. No message text is stored. Never throws.
    // The same write spots a RE-DELIVERY of a message already received (same WhatsApp id, even hours later): it is
    // dropped here, before voice / routing, so nobody gets a second reply or a repeated action.
    const arrived = normalizeInbound(body);
    const seen = await recordInbound(arrived?.messageId, arrived?.phone, arrived && messageKind(arrived));
    if (seen === 'duplicate') {
        console.info('[AiSensyWebhook] Duplicate delivery ignored', JSON.stringify({ type: arrived && messageKind(arrived) }));
        return NextResponse.json({ success: true, ignored: 'duplicate' });
    }
    // Voice notes (switch VOICE_NOTES_ENABLED, OFF by default → returns at once, nothing loaded). A voice note is turned into
    // tidy text in the background. A YES to "🎙️ I heard …" carries on below as that text, exactly as if it had been typed.
    const voice = await claimVoiceNote(body);
    if (voice.kind === 'handled') {
        if (voice.background) after(async () => { await voice.background!(); });
        return NextResponse.json({ success: true, routedTo: 'VOICE_NOTE' });
    }
    if (voice.kind === 'rewrite') body = voice.body;
    let input = normalizeInbound(body);
    console.info('[AiSensyWebhook] Payload inspected', JSON.stringify({
        assistantEnabled: enabled,
        normalized: !!input,
        hasMessageId: !!input?.messageId,
        hasText: !!input?.text,
        hasMedia: !!input?.mediaUrl,
        shape: payloadShape(body),
    }));
    // Conversation memory (WHATSAPP_MEMORY_ENABLED, OFF by default → returns at once): the person's message is stored only once a
    // Task Manager route has taken it — for Smart chat AFTER the AI has read the memory, so it never sees this message twice.
    const remember = () => appendTurn(input?.phone, 'person', input?.text, receivedAt);
    // A Task Manager background job that crashes gets an immediate apology instead of silence (no-op while the switch is OFF).
    const guarded = (job: () => Promise<void>) => async () => {
        try { await job(); }
        catch (error) {
            console.error('[AiSensyWebhook] Task Manager background job failed', error instanceof Error ? error.message : error);
            await apologiseAfterCrash(input?.messageId, input?.phone);
        }
    };

    // Task Import: a task list sent as an Excel file / image / text. Anything that is not an import (or while the
    // switch is OFF) comes back handled:false and the code below runs exactly as before.
    const taskImport = await claimTaskImport(body);
    if (taskImport.handled) {
        if (taskImport.background) {
            await markRoute(input?.messageId, 'task_import', input?.phone, input?.text);
            await remember();
            after(guarded(taskImport.background));
        }
        return NextResponse.json({ success: true, routedTo: 'TASK_IMPORT' });
    }
    // Group 3 (2026-10-13): a caption-less photo the person said is for a facility issue ("ticket") → carry on with THAT
    // photo, exactly as if it had just arrived, so the facility assistant handles it as before.
    if (taskImport.rewrite) { body = taskImport.rewrite; input = normalizeInbound(body); }

    // Smart chat (Phase 4): for people in a department with Smart chat ON, the brain answers plain-language messages. Anything it
    // does not take (rooms / tickets, the AI being down, an older conversation still open) comes back handled:false and the old
    // bot answers exactly as before. The slow part (carrying out, replying) runs after this webhook has answered.
    const smartChat = await claimSmartChat(body);
    if (smartChat.handled) {
        if (smartChat.background) {
            await markRoute(input?.messageId, 'smart_chat', input?.phone, input?.text);
            await remember();
            after(guarded(smartChat.background));
        }
        return NextResponse.json({ success: true, routedTo: 'SMART_CHAT' });
    }

    // Task Brain shadow mode (Phase 3): beside the old bot, for the sandbox numbers only, the brain reads the message and only
    // LOGS what it would have done. It never replies and never changes anything; any failure is swallowed.
    if (input?.text) scheduleShadow({ phone: input.phone, text: input.text, messageId: input.messageId });

    if (!input) return NextResponse.json({ ok: true, ignored: true });

    let interpreter = false;
    try { interpreter = await isInterpreterPilot(input); }
    catch {
        // An enabled pilot cannot silently fall through into the old default-ticket handler.
        return NextResponse.json({ error: 'Assistant configuration unavailable; retry delivery' }, { status: 503 });
    }
    if (interpreter && input.mediaUrl) {
        try { if (new URL(input.mediaUrl).protocol !== 'https:') throw new Error(); }
        catch { return NextResponse.json({ error: 'Media must use an HTTPS URL' }, { status: 400 }); }
    }
    let explicitTask = interpreter && !input.mediaUrl && (isExplicitTaskCommand(input.text) || (!!input.quotedIds?.length && /^cancel$/i.test(input.text.trim())));
    if (explicitTask && input.quotedIds?.length) {
        // Task numbering is owned by today's Task Manager list, not an old quoted digest.
        // Quoted mutations require resource-aware task routing in a future adapter.
        try { explicitTask = /^(tasks?|task manager|my tasks|view tasks|status|today'?s? tasks|cancel|cancel tasks)$/i.test(input.text.trim()) &&
            (await lookupQuotedContext(input.phone, input.quotedIds))?.workflow === 'task'; }
        catch { return NextResponse.json({ error: 'Reply context unavailable; retry delivery' }, { status: 503 }); }
    }
    if (interpreter && !explicitTask && !input.mediaUrl && input.quotedIds?.length && /^[12]$/.test(input.text.trim())) {
        try {
            const quote = await lookupQuotedContext(input.phone,input.quotedIds);
            if (quote?.workflow === 'task') {
                const contexts = await getConversationRoutingState(input.phone);
                // These only choose a system; they cannot complete or assign a task.
                explicitTask = contexts.taskChoicePending && !contexts.facilityActive;
            }
        } catch { return NextResponse.json({error:'Reply context unavailable; retry delivery'},{status:503}); }
    }
    if (interpreter && !explicitTask && !input.mediaUrl && !input.quotedIds?.length && !isDirectBookingRequest(input.text) &&
        !/^(hi|hello|hey|menu|help|options|create ticket|book meeting room|confirm booking|submit ticket|add photo|no photo|remove photo|without photo)$/i.test(input.text.trim())) {
        try {
            const contexts = await getConversationRoutingState(input.phone);
            if (/^(facility|fms|helpdesk|facility\s*bot)$/i.test(input.text.trim()) || ((contexts.taskActive || contexts.nlGateway) && !contexts.facilityActive)) {
                const classification = await TaskMessageRouter.classifyMessage(input.phone,input.text);
                explicitTask = classification.system !== 'FACILITY' || classification.isExplicitSwitch;
            }
        } catch { return NextResponse.json({error:'Conversation routing unavailable; retry delivery'},{status:503}); }
    }
    if (interpreter && !explicitTask) {
        if (!input.messageId) return NextResponse.json({ error: 'A stable inbound messageId is required' }, { status: 400 });
        try {
            const eventId = await enqueueAssistantMessage({ ...input, interpreter: true, inboundAt: input.inboundAt || new Date().toISOString() });
            after(async () => {
                try { await drainWhatsAppPhone(input.phone); }
                catch { console.error('[WhatsAppInterpreter] Processing deferred; durable event will retry'); }
            });
            return NextResponse.json({ success: true, queued: !!eventId, duplicate: !eventId });
        } catch { return NextResponse.json({ error: 'Message could not be accepted; retry delivery' }, { status: 503 }); }
    }

    // Idempotency: Ignore duplicate webhook deliveries (Phase 19)
    if (input.messageId && await TaskIdempotencyService.isDuplicateWebhook(input.messageId)) {
        console.info('[AiSensyWebhook] Duplicate delivery ignored', { messageId: input.messageId });
        return NextResponse.json({ success: true, duplicate: true });
    }
    if (input.messageId && !interpreter) {
        TaskIdempotencyService.recordProcessedWebhook(input.messageId);
    }

    if (await handleFreeformTest(input)) return NextResponse.json({ success: true, test: true });
    if (input.mediaUrl) {
        try { if (new URL(input.mediaUrl).protocol !== 'https:') throw new Error('Invalid protocol'); }
        catch { return NextResponse.json({ error: 'Media must use an HTTPS URL' }, { status: 400 }); }
    }

    // Task Manager WhatsApp Routing (Phase 6)
    if (input.text) {
        try {
            const routeResult = await TaskMessageRouter.routeInboundMessage({
                phone: input.phone,
                text: interpreter && /^cancel\s+tasks$/i.test(input.text.trim()) ? 'cancel' : input.text,
                messageId: input.messageId || undefined
            });

            if (routeResult.handledByTaskManager) {
                await markRoute(input.messageId, 'task_router', input.phone, input.text); // "never silent": the reply (already sent above) is matched to it
                await remember(); // ordered by arrival time, so it still sits BEFORE the reply that was already sent
                if (interpreter && input.messageId) TaskIdempotencyService.recordProcessedWebhook(input.messageId);
                console.info('[AiSensyWebhook] Inbound routed to TASK_MANAGER', {
                    phoneMasked: input.phone.replace(/(\d{4})\d+(\d{2})/, '$1****$2'),
                    command: routeResult.taskResult?.command
                });
                return NextResponse.json({ success: true, routedTo: 'TASK_MANAGER' });
            }
        } catch (routeError) {
            if (interpreter) {
                console.error('[WhatsAppInterpreter] Task routing failed; facility execution blocked');
                return NextResponse.json({error:'Task Manager could not process this message'},{status:503});
            }
            console.error('[AiSensyWebhook] Task routing error, falling back to facility:', routeError);
        }
    }

    if (interpreter) {
        // A task command that was declined must never become a default facility ticket.
        if (!input.messageId) return NextResponse.json({ error: 'A stable inbound messageId is required' }, { status: 400 });
        try {
            const eventId = await enqueueAssistantMessage({ ...input, interpreter:true, inboundAt:input.inboundAt || new Date().toISOString() });
            after(async () => { await drainWhatsAppPhone(input.phone).catch(() => console.error('[WhatsAppInterpreter] Deferred processing failed')); });
            return NextResponse.json({success:true,queued:!!eventId,duplicate:!eventId});
        } catch { return NextResponse.json({error:'Message could not be accepted; retry delivery'},{status:503}); }
    }

    if (!enabled) {
        after(async () => {
            try {
                if (!input.mediaUrl && isGreetingMessage(input.text)) await AiSensyService.sendGreeting(input.phone);
                else await processIncomingMessage(input.phone, input.text,
                    input.mediaType === 'image' ? input.mediaUrl : null, null, input.mediaType === 'image',
                    input.mediaType === 'video' ? input.mediaUrl : null, null, input.mediaType === 'video', null, input.messageId || null);
            } catch (error) { console.error('[AiSensyWebhook] Legacy processing failed', error); }
        });
        return NextResponse.json({ success: true });
    }
    if (!input.messageId) return NextResponse.json({ error: 'A stable inbound messageId is required' }, { status: 400 });
    try {
        // Persist first, then acknowledge immediately. No scheduled queue wait on this path.
        const eventId = await enqueueAssistantMessage(input);
        console.info('[AiSensyWebhook] Received', { eventId, receivedAt: new Date().toISOString(), duplicate: !eventId });
        after(async () => {
            try { await drainWhatsAppPhone(input.phone); }
            catch (error) { console.error('[AiSensyWebhook] Deferred processing failed; cron will retry', error); }
        });
        return NextResponse.json({ success: true, queued: !!eventId, duplicate: !eventId });
    } catch (error) {
        console.error('[AiSensyWebhook] Could not persist message', error);
        return NextResponse.json({ error: 'Message could not be accepted; retry delivery' }, { status: 503 });
    }
}
