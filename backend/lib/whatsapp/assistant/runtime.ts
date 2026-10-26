import { randomUUID, createHash } from 'node:crypto';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { processIncomingMessage } from '@/backend/lib/whatsapp/processMessage';
import { AiSensyService } from '@/backend/services/AiSensyService';
import { NotificationService } from '@/backend/services/NotificationService';
import { getBookingDateTimeIST } from '@/backend/utils/timezone';
import { findWhatsAppUser, getWhatsAppProperties } from './access';
import { advance } from './engine.mjs';
import { drainPhone } from './worker.mjs';
import { advanceConversation } from '../interpreter/coordinator.mjs';
import { interpretTurn } from '../interpreter/interpret.mjs';
import { sendSessionReply } from '../interpreter/delivery.mjs';
import { organizationSettings, lookupQuotedContext, recordOutgoingContext } from '../interpreter/context';
import { TaskDatabaseService } from '@/task-manager/TaskDatabaseService';
import { fetchPhoto } from '../interpreter/media.mjs';
import { summarizeBookingCredits } from '../interpreter/booking-credits.mjs';
import sharp from 'sharp';

async function rpc(name: string, args: Record<string, unknown>) {
    const { data, error } = await supabaseAdmin.rpc(name, args);
    if (error) throw error;
    return data;
}

interface EventClaim {
    token: string;
    event: { id: string; payload: Record<string, unknown>; snapshot: unknown; reply: unknown };
}

const store = {
    async claim(phone: string): Promise<EventClaim | null> {
        const token = randomUUID();
        const event = await rpc('whatsapp_assistant_claim', { p_phone: phone, p_token: token });
        return event ? { event, token } : null;
    },
    async save(claim: EventClaim, state: unknown, reply: unknown) {
        await rpc('whatsapp_assistant_save', { p_id: claim.event.id, p_token: claim.token, p_state: state, p_reply: reply });
    },
    async fail(claim: EventClaim, error: string) {
        await rpc('whatsapp_assistant_fail', { p_id: claim.event.id, p_token: claim.token, p_error: error });
    },
    async finish(claim: EventClaim, error: string | null) {
        await rpc('whatsapp_assistant_finish', { p_id: claim.event.id, p_token: claim.token, p_error: error });
    },
};

async function rooms(propertyId: string) {
    const { data, error } = await supabaseAdmin.from('meeting_rooms').select('id,name,property_id')
        .eq('property_id', propertyId).eq('status', 'active').order('name').order('id');
    if (error) throw error;
    return data || [];
}

async function slots(propertyId: string, roomId: string, date: string) {
    if (!(await rooms(propertyId)).some(room => room.id === roomId)) return [];
    const [slotResult, bookingResult] = await Promise.all([
        supabaseAdmin.from('meeting_room_slots').select('id,start_time,end_time').order('start_time').order('id'),
        supabaseAdmin.from('meeting_room_bookings').select('start_time,end_time')
            .eq('property_id', propertyId).eq('meeting_room_id', roomId).eq('booking_date', date).eq('status', 'confirmed'),
    ]);
    if (slotResult.error) throw slotResult.error;
    if (bookingResult.error) throw bookingResult.error;
    return (slotResult.data || []).filter(slot => slot.end_time > slot.start_time &&
        getBookingDateTimeIST(date, slot.start_time).getTime() > Date.now() &&
        !(bookingResult.data || []).some(booking => booking.start_time < slot.end_time && booking.end_time > slot.start_time));
}

async function availableRooms(propertyId: string, date: string, startTime: string, endTime: string) {
    const [roomList, booked, configured] = await Promise.all([
        rooms(propertyId),
        supabaseAdmin.from('meeting_room_bookings').select('meeting_room_id').eq('property_id', propertyId)
            .eq('booking_date', date).eq('status', 'confirmed').lt('start_time', endTime).gt('end_time', startTime),
        supabaseAdmin.from('meeting_room_slots').select('start_time,end_time').order('start_time'),
    ]);
    if (booked.error) throw booked.error;
    if (configured.error) throw configured.error;
    // Check union coverage; the transactional RPC checks it again before inserting.
    let coveredUntil = startTime;
    for (const slot of configured.data || []) {
        if (slot.start_time.slice(0, 5) <= coveredUntil && slot.end_time.slice(0, 5) > coveredUntil) coveredUntil = slot.end_time.slice(0, 5);
    }
    if (coveredUntil < endTime) return [];
    return roomList.filter(room => !(booked.data || []).some(booking => booking.meeting_room_id === room.id));
}

async function creditSummary(userId: string, propertyId: string, slot: { start_time: string; end_time: string }) {
    return summarizeBookingCredits(supabaseAdmin, userId, propertyId, slot);
}

const dependencies = {
    now: () => new Date(), findUser: findWhatsAppUser, properties: getWhatsAppProperties, rooms, slots, creditSummary, availableRooms,
    async createTicket(request: { phone: string; userId: string; propertyId: string; title: string; mediaUrl: string | null; messageId: string; requestId: string; interpreter?: boolean }) {
        let mediaBuffer: Buffer | undefined;
        let interpreterInputHash: string | undefined;
        let storedPhoto: string | null = null;
        if (request.interpreter) {
            interpreterInputHash = createHash('sha256').update(JSON.stringify([request.userId,request.propertyId,request.title,request.mediaUrl || null])).digest('hex');
            const { data: existing, error } = await supabaseAdmin.from('tickets').select('id,photo_before_url,wa_assistant_completed,wa_assistant_input_hash')
                .eq('wa_assistant_request_id',request.requestId).eq('raised_by',request.userId).maybeSingle();
            if (error) throw error;
            // A resource insert is an irreversible outcome for this operation ID. Corrections cannot repurpose it.
            if (existing && existing.wa_assistant_input_hash !== interpreterInputHash) throw Object.assign(new Error('An earlier ticket was already created for this request'), {code:'OPERATION_ALREADY_CREATED'});
            if (existing?.wa_assistant_completed) return existing;
            storedPhoto = existing?.photo_before_url || null;
        }
        if (request.interpreter && request.mediaUrl && !storedPhoto) {
            let stage = 'download';
            try {
                const downloaded = await fetchPhoto(request.mediaUrl);
                stage = 'decode';
                mediaBuffer = await sharp(downloaded, {limitInputPixels:20_000_000}).resize(1280,1280,{fit:'inside',withoutEnlargement:true}).jpeg({quality:85}).toBuffer();
            } catch (error) {
                const failure = error as {mediaReason?:string;httpStatus?:number}|null;
                const reason = stage === 'decode' ? 'decode_failed' :
                    (typeof failure?.mediaReason === 'string' && /^[a-z_]{1,40}$/.test(failure.mediaReason) ? failure.mediaReason : 'download_failed');
                let hostname: string | null = null;
                try { hostname = new URL(request.mediaUrl).hostname; } catch { /* Do not log the raw URL. */ }
                console.warn('[WhatsAppInterpreter] Ticket photo rejected', {stage,reason,hostname,
                    httpStatus:typeof failure?.httpStatus === 'number' ? failure.httpStatus : null});
                throw Object.assign(new Error('Photo could not be accepted'), {code:'INVALID_MEDIA',mediaReason:reason});
            }
        }
        const ticket = await processIncomingMessage(request.phone, request.title, request.mediaUrl, null, !!request.mediaUrl,
            null, null, false, request.propertyId, request.messageId,
            { userId: request.userId, requestId: request.requestId, suppressReply: true, throwOnError: true, skipTaskRouting: true, mediaBuffer, interpreterInputHash });
        if (ticket?.id && request.interpreter) {
            const { error } = await supabaseAdmin.from('tickets').update({ wa_assistant_completed: true }).eq('id', ticket.id);
            if (error) throw error;
        }
        return ticket;
    },
    async findTicket(requestId: string, userId: string, expected?: {propertyId:string;title:string;mediaUrl:string|null}) {
        const { data, error } = await supabaseAdmin.from('tickets').select('id,property_id,wa_assistant_input_hash')
            .eq('wa_assistant_request_id', requestId).eq('raised_by', userId).eq('wa_assistant_completed', true).maybeSingle();
        if (error) throw error;
        if (data && expected && data.wa_assistant_input_hash !== createHash('sha256').update(JSON.stringify([userId,expected.propertyId,expected.title,expected.mediaUrl || null])).digest('hex')) return null;
        return data;
    },
    async findBooking(requestId: string, userId: string, expected?: string) {
        const { data, error } = await supabaseAdmin.from('meeting_room_bookings')
            .select('id,user_id,property_id,meeting_room_id,booking_date,start_time,end_time,comment').eq('wa_assistant_request_id', requestId).eq('user_id', userId).maybeSingle();
        if (error) throw error;
        if (data && expected) {
            const tuple = JSON.parse(expected);
            if (data.property_id !== tuple[0] || data.meeting_room_id !== tuple[2] || data.booking_date !== tuple[4] || data.start_time.slice(0,5) !== tuple[5] || data.end_time.slice(0,5) !== tuple[6]) return null;
            if (tuple.length > 7 && (data.comment || null) !== (tuple[7] || null)) return null;
        }
        return data;
    },
    async bookRange(request: { userId: string; propertyId: string; roomId: string; date: string; startTime: string; endTime: string; requestId: string; interpreter?:boolean; purpose?:string|null }) {
        try {
            const purpose = request.purpose?.trim() || null;
            if (purpose && purpose.length > 500) throw Object.assign(new Error('Invalid booking purpose'), {code:'INVALID_BOOKING'});
            if (request.interpreter) {
                const { data: existing, error } = await supabaseAdmin.from('meeting_room_bookings').select('id,property_id,meeting_room_id,booking_date,start_time,end_time,comment')
                    .eq('wa_assistant_request_id',request.requestId).eq('user_id',request.userId).maybeSingle();
                if (error) throw error;
                if (existing) {
                    if (existing.property_id !== request.propertyId || existing.meeting_room_id !== request.roomId || existing.booking_date !== request.date || existing.start_time.slice(0,5) !== request.startTime || existing.end_time.slice(0,5) !== request.endTime) throw Object.assign(new Error('An earlier booking exists for this request'), {code:'OPERATION_ALREADY_CREATED'});
                    if ('purpose' in request && (existing.comment || null) !== purpose) throw Object.assign(new Error('An earlier booking exists with different notes'), {code:'OPERATION_ALREADY_CREATED'});
                    return existing;
                }
            }
            const booking = await rpc('whatsapp_assistant_book_range', { p_user_id: request.userId, p_property_id: request.propertyId,
                p_room_id: request.roomId, p_date: request.date, p_start_time: request.startTime, p_end_time: request.endTime,
                p_request_id: request.requestId, ...('purpose' in request ? {p_purpose:purpose} : {}) });
            await NotificationService.afterRoomBooked(booking.id).catch(error => console.error('[WhatsAppAssistant] Booking notification failed', error));
            return booking;
        } catch (error) {
            const failure = error as { code?: string; message?: string };
            if (failure.code === '23P01' || failure.message?.includes('SLOT_UNAVAILABLE')) throw Object.assign(new Error('Slot unavailable'), { code: 'SLOT_UNAVAILABLE' });
            if (failure.message?.includes('INSUFFICIENT_CREDITS')) throw Object.assign(new Error('Insufficient credits'), { code: 'INSUFFICIENT_CREDITS' });
            if (failure.message?.includes('Multiple companies')) throw Object.assign(new Error('Multiple companies'), { code: 'MULTIPLE_COMPANIES' });
            if (failure.message?.includes('No active access')) throw Object.assign(new Error('Access revoked'), { code: 'ACCESS_REVOKED' });
            if (failure.message?.includes('OPERATION_ALREADY_CREATED')) throw Object.assign(new Error('An earlier booking exists for this request'), {code:'OPERATION_ALREADY_CREATED'});
            if (/Invalid or past interval|Outside configured booking slots|Room is not active|Invalid booking purpose/.test(failure.message || '')) throw Object.assign(new Error('Booking configuration changed'), { code: 'INVALID_BOOKING' });
            throw error;
        }
    },
    async bookRoom(request: { userId: string; propertyId: string; roomId: string; slotId: string; date: string; requestId: string }) {
        try {
            const booking = await rpc('whatsapp_assistant_book', { p_user_id: request.userId, p_property_id: request.propertyId,
                p_room_id: request.roomId, p_slot_id: request.slotId, p_date: request.date, p_request_id: request.requestId });
            // Existing booking outbox triggers handle email; retain the app's notification hook.
            await NotificationService.afterRoomBooked(booking.id).catch(error => console.error('[WhatsAppAssistant] Booking notification failed', error));
            return booking;
        } catch (error) {
            const failure = error as { code?: string; message?: string };
            if (failure.code === '23P01' || failure.message?.includes('SLOT_UNAVAILABLE')) {
                throw Object.assign(new Error('Slot unavailable'), { code: 'SLOT_UNAVAILABLE' });
            }
            if (failure.message?.includes('INSUFFICIENT_CREDITS')) {
                throw Object.assign(new Error('Insufficient credits'), { code: 'INSUFFICIENT_CREDITS' });
            }
            throw error;
        }
    },
};

export async function enqueueAssistantMessage(payload: Record<string, unknown>) {
    return rpc('whatsapp_assistant_enqueue', { p_payload: payload });
}

export async function drainWhatsAppPhone(phone: string) {
    return drainPhone(phone, { store, advance: async (input: Record<string, unknown>, current: unknown, deps: typeof dependencies) => {
        if (!input.interpreter) return advance(input, current, deps);
        if (process.env.WHATSAPP_LLM_INTERPRETER_ENABLED !== 'true') return { session: null,
            reply: { key: 'notice', params: ['This pilot has been paused. Send HI to use the standard menu.'] } };
        return advanceConversation(input, current, { ...deps, bookRange: dependencies.bookRange,
            settings: organizationSettings, interpret: async (turn: {workflow:string;text:string;pending?:string[]}) => {
                const started = Date.now();
                const result = await interpretTurn(turn);
                console.info('[WhatsAppInterpreter]', {workflow:turn.workflow,accepted:result.ok,reason:'reason' in result ? result.reason : 'intent' in result ? result.intent : 'unknown',durationMs:Date.now()-started});
                return result;
            }, quote: lookupQuotedContext,
            hasTaskContext: async (destination: string) => !!(await TaskDatabaseService.getConversationContext(destination, 'TASK_MANAGER')) });
    }, dependencies: { ...dependencies,
        bookRange: process.env.AISENSY_MESSAGE_BOOKING_ENABLED === 'true' ? dependencies.bookRange : undefined },
        send: async (destination: string, reply: { key: string; params: string[]; text?: string; lastInboundAt?: string; workflow?: string; conversationId?: string; revision?: number }) => {
            let result = reply.text ? await sendSessionReply(destination, reply.text, reply.lastInboundAt) : await AiSensyService.sendAssistantReply(destination, reply);
            // Only the approved notice template carries this same one-parameter factual message.
            if (reply.text && !result.success && result.retryable === false) result = await AiSensyService.sendAssistantReply(destination, reply);
            if (result.success && result.messageIds?.length && reply.workflow && reply.conversationId) {
                await recordOutgoingContext(destination, result.messageIds, { workflow: reply.workflow, conversationId: reply.conversationId, revision: reply.revision })
                    .catch(() => console.warn('[WhatsAppInterpreter] Outgoing context could not be saved; quoted replies will require clarification'));
            }
            return result;
        },
        log: (entry: Record<string, unknown>) => console.info('[WhatsAppAssistant]', JSON.stringify(entry)),
    });
}

export async function retryWhatsAppAssistant() {
    if (process.env.WHATSAPP_LLM_INTERPRETER_ENABLED === 'true') {
        const { error: cleanupError } = await supabaseAdmin.from('whatsapp_outgoing_context').delete().lt('expires_at', new Date().toISOString());
        if (cleanupError) console.warn('[WhatsAppInterpreter] Expired reply aliases could not be cleaned up');
    }
    const { data, error } = await supabaseAdmin.from('whatsapp_assistant_events').select('phone')
        .in('status', ['pending','processing','ready']).order('created_at').limit(100);
    if (error) throw error;
    const phones = [...new Set((data || []).map(event => event.phone))].slice(0, 10);
    let processed = 0;
    for (let i = 0; i < phones.length; i += 3) {
        const results = await Promise.allSettled(phones.slice(i, i + 3).map(drainWhatsAppPhone));
        for (const result of results) {
            if (result.status === 'fulfilled') processed += result.value;
            else console.error('[WhatsAppAssistant] Retry failed', result.reason);
        }
    }
    return { phones: phones.length, processed };
}
