import { parseBookingDate } from './protocol.mjs';
import { advanceBooking, isBookingRequest } from './booking-request.mjs';

const PAGE_SIZE = 5;
const normalize = text => text.toLowerCase().replace(/[_\p{P}\p{S}]+/gu, ' ').replace(/\s+/g, ' ').trim();
const isGreeting = text => /^(hi+|hey+|hello|helo|heelo|hello there|hi there|good morning|good afternoon|good evening|namaste|namaskar|greetings|salaam)$/.test(normalize(text));
const actionName = action => action === 'ticket' ? 'Create Ticket' : 'Book Meeting Room';
const slotLabel = slot => `${slot.start_time.slice(0, 5)}–${slot.end_time.slice(0, 5)} IST`;
const result = (session, key, params = []) => ({ session, reply: { key, params } });
const notice = (text, session = null) => result(session, 'notice', [text]);

function selection(session, kind) {
    const page = session.page || 0;
    const items = session.options.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
    const list = items.map((item, i) => `${i + 1}. ${String(item.label || item.name).slice(0, 80)}`).join('; ');
    return result(session, 'select', [actionName(session.action), kind, list]);
}

function choose(text, session) {
    const input = normalize(text);
    const page = session.page || 0;
    const total = Math.ceil(session.options.length / PAGE_SIZE);
    if (input === 'next') return { page: Math.min(page + 1, total - 1) };
    if (input === 'previous' || input === 'prev') return { page: Math.max(page - 1, 0) };
    const items = session.options.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
    if (/^[1-5]$/.test(input)) return { item: items[Number(input) - 1] };
    const matches = items.filter(item => normalize(item.label || item.name) === input);
    return { item: matches.length === 1 ? matches[0] : undefined };
}

async function availableSlots(session, deps) {
    const slots = await deps.slots(session.property.id, session.room.id, session.date);
    if (!slots.length) return notice('No available slots for this room and date. Reply MENU to choose another room or date.');
    const next = { ...session, step: 'booking_slot', page: 0, options: slots.map(slot => ({ ...slot, label: slotLabel(slot) })) };
    return selection(next, 'an available time slot');
}

async function submitTicket(input, session, user, deps) {
    const ticket = await deps.createTicket({
        phone: input.phone, userId: user.id, propertyId: session.property.id,
        title: session.title, mediaUrl: session.mediaUrl || null,
        messageId: session.requestMessageId || input.messageId, requestId: session.id,
    });
    if (!ticket) throw new Error('Ticket creation returned no ticket');
    return result(null, 'ticket_created', [ticket.ticket_number, session.property.name, ticket.title]);
}

async function propertyChosen(input, session, user, deps) {
    if (session.action === 'booking') return result({ ...session, step: 'booking_date' }, 'booking_date', [session.property.name]);
    if (session.title && session.mediaUrl) return submitTicket(input, session, user, deps);
    if (session.title) return result({ ...session, step: 'ticket_photo_choice' }, 'ticket_photo_choice', [session.property.name, session.title]);
    return result({ ...session, step: 'ticket_title' }, 'ticket_title', [session.property.name]);
}

/** One deterministic step. IO is supplied by the server adapter; no AI conversation model. */
export async function advance(input, current, deps) {
    const text = normalize(input.text);
    if (!input.mediaUrl && (text === 'cancel' || text === 'cancel booking')) return notice('Your current request has been cancelled. Reply MENU to start again.');
    if (!input.mediaUrl && (text === 'menu' || isGreeting(input.text))) return result({ step: 'menu' }, 'menu');
    if (deps.bookRange && !input.mediaUrl && (current?.step === 'booking_request' || isBookingRequest(input.text) ||
        (current?.step === 'menu' && text === '2'))) {
        return advanceBooking(input, current, deps);
    }
    const user = await deps.findUser(input.phone);
    if (!user) return notice('Your WhatsApp number is not registered or approved. Please contact your property manager.');
    const properties = await deps.properties(user.id);
    if (!properties.length) return notice('You have no active property access. Please contact your property manager.');
    let session = current ? structuredClone(current) : null;
    let action = !input.mediaUrl && text === 'create ticket' ? 'ticket' : !input.mediaUrl && text === 'book meeting room' ? 'booking' : null;
    if (session?.step === 'menu') {
        if (text === '1') action = 'ticket';
        if (text === '2') action = 'booking';
        if (!action) return result(session, 'menu');
    }
    if (!session && !action && !input.mediaUrl && /^(submit ticket|submit|add photo|confirm booking|confirm|next|previous|prev|[0-9]+)$/.test(text)) {
        return notice('There is no active request, or your session has expired. Reply MENU to start again.');
    }
    if (action || !session) {
        action ||= 'ticket';
        const draft = !['create ticket', 'book meeting room', '1', '2'].includes(text);
        session = { id: input.requestId, action, step: 'property', page: 0, options: properties,
            title: draft ? input.text.trim().slice(0, 100) : '',
            mediaUrl: draft && input.mediaType === 'image' ? input.mediaUrl : null,
            requestMessageId: input.messageId };
        if (input.mediaUrl && input.mediaType !== 'image') return notice('Please send a text description or a photo for your ticket.');
        if (properties.length > 1) return selection(session, 'a property');
        session.property = properties[0];
        return propertyChosen(input, session, user, deps);
    }
    // Always use current membership and current property name, including on confirmation.
    if (session.property) {
        const property = properties.find(item => item.id === session.property.id);
        if (!property) return notice('Your access to this property has changed. Reply MENU to start again.');
        session.property = property;
    }
    if (session.action === 'booking' && input.mediaUrl) return notice('Please use the choices shown or send a date as text.', session);
    if (session.step === 'property') {
        if (session.action === 'ticket' && input.mediaType === 'image' && input.mediaUrl) {
            session.mediaUrl = input.mediaUrl;
            if (input.text.trim()) session.title = input.text.trim().slice(0, 100);
            return selection(session, 'a property');
        }
        // Keep the displayed option order; remove revoked properties at selection time.
        const selected = choose(input.text, session);
        if (selected.page !== undefined) return selection({ ...session, page: selected.page }, 'a property');
        const property = properties.find(item => item.id === selected.item?.id);
        if (!property) return selection(session, 'a property');
        session.property = property;
        return propertyChosen(input, session, user, deps);
    }
    if (session.step === 'ticket_title') {
        if (input.mediaUrl && input.mediaType !== 'image') return notice('Please send a photo or a text title.', session);
        if (input.mediaUrl) session.mediaUrl = input.mediaUrl;
        if (!input.text.trim()) return result(session, 'ticket_title', [session.property.name]);
        session.title = input.text.trim().slice(0, 100);
        if (session.mediaUrl) return submitTicket(input, session, user, deps);
        return result({ ...session, step: 'ticket_photo_choice' }, 'ticket_photo_choice', [session.property.name, session.title]);
    }
    if (session.step === 'ticket_photo_choice' || session.step === 'ticket_photo') {
        if (!input.mediaUrl && (text === 'submit ticket' || text === 'submit' || text === '1')) return submitTicket(input, session, user, deps);
        if (input.mediaType === 'image' && input.mediaUrl) {
            session.mediaUrl = input.mediaUrl;
            if (input.text.trim()) session.title = input.text.trim().slice(0, 100);
            return submitTicket(input, session, user, deps);
        }
        if (text === 'add photo' || text === '2') return result({ ...session, step: 'ticket_photo' }, 'ticket_photo', [session.property.name]);
        return result(session, session.step === 'ticket_photo' ? 'ticket_photo' : 'ticket_photo_choice',
            session.step === 'ticket_photo' ? [session.property.name] : [session.property.name, session.title]);
    }
    if (session.step === 'booking_date') {
        const date = parseBookingDate(input.text, deps.now());
        if (!date) return result(session, 'booking_date', [session.property.name]);
        const rooms = await deps.rooms(session.property.id);
        if (!rooms.length) return notice('No active meeting rooms are available at this property. Reply MENU to start again.');
        return selection({ ...session, date, step: 'booking_room', options: rooms, page: 0 }, 'a meeting room');
    }
    if (session.step === 'booking_room' || session.step === 'booking_slot') {
        const kind = session.step === 'booking_room' ? 'a meeting room' : 'an available time slot';
        const selected = choose(input.text, session);
        if (selected.page !== undefined) return selection({ ...session, page: selected.page }, kind);
        if (!selected.item) return selection(session, kind);
        if (session.step === 'booking_room') {
            const room = (await deps.rooms(session.property.id)).find(item => item.id === selected.item.id);
            if (!room) return notice('This room is no longer available. Reply MENU to try another room.');
            return availableSlots({ ...session, room }, deps);
        }
        const slot = (await deps.slots(session.property.id, session.room.id, session.date)).find(item => item.id === selected.item.id);
        if (!slot) return availableSlots(session, deps);
        const credit = await deps.creditSummary(user.id, session.property.id, slot);
        return result({ ...session, step: 'booking_confirm', slot }, 'booking_review',
            [session.property.name, session.room.name, session.date, slotLabel(slot), credit || 'Not applicable']);
    }
    if (session.step === 'booking_confirm') {
        if (text !== 'confirm booking' && text !== 'confirm' && text !== '1') {
            return result(session, 'booking_review', [session.property.name, session.room.name, session.date, slotLabel(session.slot),
                await deps.creditSummary(user.id, session.property.id, session.slot) || 'Not applicable']);
        }
        // Database transaction revalidates the room, availability, memberships and credits.
        try {
            const booking = await deps.bookRoom({ userId: user.id, propertyId: session.property.id,
                roomId: session.room.id, slotId: session.slot.id, date: session.date, requestId: session.id });
            return result(null, 'booking_created', [booking.id, session.property.name, session.room.name, session.date, slotLabel(session.slot)]);
        } catch (error) {
            if (error.code === 'SLOT_UNAVAILABLE') return availableSlots(session, deps);
            if (error.code === 'INSUFFICIENT_CREDITS') return notice('You do not have enough meeting-room credits for this slot. Contact your property manager or reply MENU to choose a shorter slot.');
            throw error;
        }
    }
    return result({ step: 'menu' }, 'menu');
}
