import { parseBookingDate } from './protocol.mjs';

const clean = value => String(value || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const pad = value => String(value).padStart(2, '0');
const asTime = minutes => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
function minutes(hour, minute, meridiem, explicit24 = false) {
    hour = Number(hour); minute = Number(minute || 0);
    if (minute > 59 || hour > 23) return null;
    if (meridiem) {
        if (hour < 1 || hour > 12) return null;
        return (hour % 12 + (meridiem.toLowerCase() === 'pm' ? 12 : 0)) * 60 + minute;
    }
    return explicit24 || hour > 12 || hour === 0 ? hour * 60 + minute : null;
}

export function isBookingRequest(text) {
    return /\b(book|reserve|schedule)\b.*\b(room|meeting|boardroom)\b/i.test(text);
}

/** Extract explicit common booking phrases; ambiguous values stay missing. No model guesses. */
export function parseBookingMessage(text, now) {
    const source = String(text).toLowerCase().replace(/\b(a|p)\.?m\.?\b/g, '$1m');
    const today = parseBookingDate('today', now);
    const dateOptions = new Set([...source.matchAll(/\b(?:day after tomorrow|today|tomorrow|\d{4}-\d{2}-\d{2}|\d{2}-\d{2}-\d{4}|sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/g)].map(match => match[0]));
    let dateToken = source.match(/\b\d{4}-\d{2}-\d{2}\b|\b\d{2}-\d{2}-\d{4}\b/)?.[0];
    if (!dateToken) dateToken = source.match(/\b(today|tomorrow)\b/)?.[0];
    if (/\bday after tomorrow\b/.test(source)) dateToken = new Date(Date.parse(today + 'T00:00:00Z') + 2 * 86400000).toISOString().slice(0, 10);
    if (!dateToken) {
        const weekdays = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
        const weekday = weekdays.find(day => new RegExp(`\\b${day}\\b`).test(source));
        if (weekday) {
            const delta = (weekdays.indexOf(weekday) - new Date(today + 'T00:00Z').getUTCDay() + 7) % 7;
            dateToken = new Date(Date.parse(today + 'T00:00Z') + (delta || 7) * 86400000).toISOString().slice(0, 10);
        }
    }
    // Only a range is considered here, so room numbers and calendar dates are not times.
    const timeSource = source.replace(/\b\d{4}-\d{2}-\d{2}\b|\b\d{2}-\d{2}-\d{4}\b/g, '');
    const ranges = [...timeSource.matchAll(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:to|until|till|[-–])\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/g)];
    const durations = [...timeSource.matchAll(/\b(?:at|from)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s+for\s+(\d+(?:\.\d+)?)\s*(hours?|hrs?|minutes?|mins?)\b/g)];
    const singles = [...timeSource.matchAll(/\b(from|at|until|till|start(?:ing)?(?: at)?|end(?:ing)?(?: at)?)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/g)];
    const standaloneTimes = singles.filter(match => {
        const clockIndex = match.index + match[0].search(/\d/);
        return ![...ranges, ...durations].some(major => clockIndex >= major.index && clockIndex < major.index + major[0].length);
    });
    if (ranges.length + durations.length + standaloneTimes.length > 1) {
        return { date: dateToken && dateOptions.size <= 1 ? parseBookingDate(dateToken, now) : null,
            dateMentioned: !!dateToken, times: null, timeMentioned: true };
    }
    const range = ranges.length === 1 ? ranges[0] : null;
    let times = null;
    let timeMentioned = ranges.length > 0;
    if (range) {
        const start = minutes(range[1], range[2], range[3] || range[6], !!range[2]);
        const end = minutes(range[4], range[5], range[6] || range[3], !!range[5]);
        if (start !== null && end !== null && end > start) times = { startTime: asTime(start), endTime: asTime(end) };
    } else if (!timeMentioned) {
        if (durations.length > 1) timeMentioned = true;
        const duration = durations.length === 1 ? durations[0] : null;
        if (duration) {
            timeMentioned = true;
            const start = minutes(duration[1], duration[2], duration[3], !!duration[2]);
            const length = Number(duration[4]) * (/^(hour|hr)/.test(duration[5]) ? 60 : 1);
            if (start !== null && length > 0 && Number.isInteger(length) && start + length < 1440) {
                times = { startTime: asTime(start), endTime: asTime(start + length) };
            }
        }
    }
    if (!timeMentioned) {
        if (singles.length > 1) timeMentioned = true;
        const single = singles.length === 1 ? singles[0] : null;
        if (single) {
            timeMentioned = true;
            const value = minutes(single[2], single[3], single[4], !!single[3]);
            if (value !== null) times = { [/^(until|till|end)/.test(single[1]) ? 'endTime' : 'startTime']: asTime(value) };
        }
    }
    return { date: dateToken && dateOptions.size <= 1 ? parseBookingDate(dateToken, now) : null, dateMentioned: !!dateToken, times, timeMentioned };
}

function named(text, items) {
    const source = ` ${clean(text)} `;
    const occurrences = [];
    for (const item of items) {
        const name = clean(item.name);
        if (!name) continue;
        let offset = 0;
        while (offset < source.length) {
            const index = source.indexOf(` ${name} `, offset);
            if (index < 0) break;
            occurrences.push({ item, start: index + 1, end: index + 1 + name.length });
            offset = index + 1;
        }
    }
    // Suppress only a name occurrence physically contained within a longer occurrence.
    const explicit = occurrences.filter(match => !occurrences.some(other => other.start <= match.start && other.end >= match.end &&
        other.end - other.start > match.end - match.start));
    const matches = items.filter(item => explicit.some(match => match.item.id === item.id));
    return matches.length === 1 ? matches[0] : null;
}

const labels = items => items.slice(0, 10).map((item, index) => `${index + 1}. ${item.name}`).join('; ');
const problem = (session, reason, alternatives = 'Reply with another room, date or time, or MENU to start again.') =>
    ({ session, reply: { key: 'booking_update', params: [session?.property?.name || 'your property', reason, alternatives] } });

export async function advanceBooking(input, current, deps) {
    const user = await deps.findUser(input.phone);
    if (!user) return problem(null, 'Your WhatsApp number is not registered or approved. Contact your property manager.');
    const properties = await deps.properties(user.id);
    if (!properties.length) return problem(null, 'You have no active property access.');
    const session = current?.step === 'booking_request' ? structuredClone(current) : { step: 'booking_request', id: input.requestId };
    const existing = await deps.findBooking?.(session.id, user.id);
    if (existing) {
        if (existing.user_id !== user.id || !properties.some(item => item.id === existing.property_id)) return problem(null, 'Your access to the existing booking has changed.');
        return { session: null, reply: null };
    }
    if (session.property && !properties.some(item => item.id === session.property.id)) return problem(null, 'Your property access has changed.');
    const text = input.text.trim();
    if (/\b(don.t|do not|dont|cancel)\b.*\b(book|booking|reserve)\b/i.test(text)) return problem(null, 'No booking was created. Reply MENU to start again.');
    if (!session.property && isBookingRequest(text)) session.roomHint = text;
    const number = /^[1-9]\d*$/.test(text) ? Number(text) - 1 : -1;
    const property = named(text, properties) || (session.awaiting === 'property' ? properties.find(item => item.id === session.options?.[number]?.id) : null);
    if (!property && properties.some(item => ` ${clean(text)} `.includes(` ${clean(item.name)} `))) { delete session.property; delete session.room; }
    if (property && property.id !== session.property?.id) { session.property = property; delete session.room; }
    const location = text.match(/\b(?:at|in)\s+([a-z][a-z0-9 ]+?)(?=\b(?:today|tomorrow|from|on|at|for)\b|$)/i)?.[1];
    const unknownLocation = location && !named(location, properties) && !/\b(room|boardroom)\b/i.test(location);
    if (unknownLocation) { delete session.property; delete session.room; }
    if (!session.property && properties.length === 1 && !unknownLocation) session.property = properties[0];
    const bareTime = /^(?:\d{1,2}(?::\d{2})?\s*(?:am|pm)|\d{1,2}:\d{2})$/i.test(text);
    const timeText = bareTime && (!!session.startTime !== !!session.endTime) ? `${session.startTime ? 'until' : 'from'} ${text}` : text;
    const parsed = parseBookingMessage(timeText, deps.now());
    if (parsed.dateMentioned) session.date = parsed.date;
    if (parsed.timeMentioned) {
        if (!parsed.times) { delete session.startTime; delete session.endTime; }
        else Object.assign(session, parsed.times);
    }
    if (session.startTime && session.endTime && session.endTime <= session.startTime) delete session.endTime;
    const missing = [];
    if (!session.property) missing.push(`the property (${labels(properties)})`);
    let rooms = [];
    if (session.property) {
        rooms = await deps.rooms(session.property.id);
        if (!rooms.length) return problem(session, 'There are no active meeting rooms at this property.');
        if (session.room && !rooms.some(item => item.id === session.room.id)) delete session.room;
        const room = named(text, rooms) || named(session.roomHint, rooms) || (session.awaiting === 'room' ? rooms.find(item => item.id === session.options?.[number]?.id) : null);
        delete session.roomHint;
        if (room) session.room = room;
        else if (/\b(room|boardroom)\b/i.test(text)) delete session.room;
    }
    if (!session.date) missing.push('the date (today, tomorrow, or DD-MM-YYYY)');
    if (!session.startTime || !session.endTime) missing.push(`${!session.startTime && !session.endTime ? 'both start and end time' : !session.startTime ? 'the start time' : 'the end time (later than the start time)'} with AM/PM (for example, 2 PM to 3 PM)`);
    if (session.date && session.startTime && new Date(`${session.date}T${session.startTime}:00+05:30`) <= deps.now()) {
        session.date = null;
        missing.push('a future date/time; the requested start time has already passed');
    }
    let available = rooms;
    if (session.property && session.date && session.startTime && session.endTime) {
        available = await deps.availableRooms(session.property.id, session.date, session.startTime, session.endTime);
        if (!available.length) return problem(session, 'No room is available for this interval within the configured booking slots.');
        if (session.room && !available.some(item => item.id === session.room.id)) {
            delete session.room;
            session.awaiting = 'room'; session.options = available;
            return problem(session, 'The requested room is unavailable.', `Choose an available room: ${labels(available)}`);
        }
    }
    if (!session.room && session.property) missing.push(`the meeting room (${labels(available)})`);
    if (missing.length) {
        session.awaiting = !session.property ? 'property' : !session.room ? 'room' : session.startTime && !session.endTime ? 'end' : session.endTime && !session.startTime ? 'start' : 'details';
        session.options = session.awaiting === 'property' ? properties : available;
        const summary = [session.room?.name, session.date, session.startTime && session.endTime ? `${session.startTime} to ${session.endTime} IST` : null].filter(Boolean).join(', ') || 'No date, time or room confirmed yet';
        return { session, reply: { key: 'booking_update', params: [session.property?.name || 'your property', summary, `Please send ${missing.join('; ')}.`] } };
    }
    try {
        await deps.bookRange({ userId: user.id, propertyId: session.property.id, roomId: session.room.id,
            date: session.date, startTime: session.startTime, endTime: session.endTime, requestId: session.id });
        // Existing event_outbox owns the successful booking notification.
        return { session: null, reply: null };
    } catch (error) {
        if (error.code === 'SLOT_UNAVAILABLE') return problem(session, 'This room was just booked by someone else. Please choose another room or time.');
        if (error.code === 'INSUFFICIENT_CREDITS') return problem(session, 'Your allocated meeting-room credits are insufficient for this duration. Contact your property manager or choose a shorter duration.');
        throw error;
    }
}
