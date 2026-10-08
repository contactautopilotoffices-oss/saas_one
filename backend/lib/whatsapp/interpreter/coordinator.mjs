import { normalizeText, validateTurn } from './contracts.mjs';
import { parseBookingDate } from '../assistant/protocol.mjs';
import { audienceAllows } from './config.mjs';

const TTL = 20 * 60 * 1000;
const blank = () => ({ llmVersion: 1, active: null, drafts: {} });
const message = (heading, text) => `*${heading}*\n\n${text}`;
const displayClock = clock => {
    const [hour, minute] = clock.split(':').map(Number);
    return `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${hour >= 12 ? 'PM' : 'AM'}`;
};
const displayDate = date => new Intl.DateTimeFormat('en-GB', {day:'2-digit',month:'short',year:'numeric',timeZone:'Asia/Kolkata'})
    .format(new Date(`${date}T12:00:00+05:30`));
export const isExplicitTaskCommand = text => /^(?:tasks?|task\s*manager|my\s*tasks|view\s*tasks|status|today'?s?\s*tasks|cancel\s+tasks|(?:done|complete|finish)\s+\d+|done[-\s]*all|complete\s*all|finished\s*all|all\s*done|assign(?:\s+.*)?|team(?:\s*status)?|view\s*team\s*tasks|dept|department)$/i.test(text.trim());

function bookingInstructionText(text) {
    // Classify an explicit for-description beside a time range as metadata.
    // The model still receives the entire message, and access/target
    // validation still uses its source-backed fields. Separate commands stay
    // in the instruction so they cannot silently trigger an automatic booking.
    const separator = [...text.matchAll(/\bfor\s+/gi)].at(-1);
    if (!separator) return text;
    const prefix = text.slice(0,separator.index), tail = text.slice(separator.index+separator[0].length);
    const schedule = /\b(?:today|tomorrow|from\s+\d|between\s+\d|on\s+\d)/i.exec(tail);
    const description = schedule ? tail.slice(0,schedule.index) : tail;
    const instruction = prefix + (schedule ? tail.slice(schedule.index) : '');
    const clocks = instruction.replace(/\b([ap])\.m\./gi,'$1m').match(/\b(?:\d{1,2}(?:[:.]\d{2})?\s*(?:am|pm)|\d{1,2}:\d{2})\b/gi) || [];
    if (!description.trim() || clocks.length !== 2 || isExplicitTaskCommand(description) ||
        /(?:^|[;.!?,:\n]|\b(?:and|then)\s+)\s*(?:please\s+)?(?:create|raise|submit|complete|finish|done|assign|cancel|book|reserve|schedule)\b/i.test(description)) return text;
    return instruction;
}

// Starting an action requires an explicit booking instruction, not just a room
// mentioned in a task, question, cancellation or competing service request.
export function isDirectBookingRequest(text) {
    const normalized = normalizeText(text);
    if (/\b(?:do not|don t|dont|never|cancel|not|instead|or|if|unless|maybe)\b/.test(normalized) ||
        /\b(?:tasks?|tickets?)\b/.test(normalizeText(bookingInstructionText(text)))) return false;
    return /^(?:(?:hey|hi|hello|please|can you|could you|would you|i want to|i need to|i would like to)\s+)*(?:book|reserve|schedule)\s+(?:(?:a|an|the)\s+)?(?:meeting room|conference room|boardroom|room)\b/.test(normalized);
}

function competingBookingDetails(text) {
    const source = text.toLowerCase().replace(/\b([ap])\.m\./g, '$1m');
    const dates = new Set([...source.matchAll(/\b(?:day after tomorrow|today|tomorrow|sunday|monday|tuesday|wednesday|thursday|friday|saturday|\d{4}[-/]\d{2}[-/]\d{2}|\d{2}[-/]\d{2}[-/]\d{4})\b/g)].map(match => match[0]));
    const clocks = [...source.matchAll(/\b(?:\d{1,2}(?:[:.]\d{2})?\s*(?:am|pm)|\d{1,2}:\d{2})\b/g)];
    return dates.size > 1 || clocks.length > 2;
}

export function parseClock(value) {
    if (typeof value !== 'string') return null;
    const match = /^(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?$/i.exec(value.trim().replace(/a\.m\.|p\.m\./gi, v => v.replaceAll('.', '')));
    if (!match) return null;
    let hour = Number(match[1]);
    const minute = Number(match[2] || 0);
    if (minute > 59) return null;
    if (match[3]) {
        if (hour < 1 || hour > 12) return null;
        hour = hour % 12 + (match[3].toLowerCase() === 'pm' ? 12 : 0);
    } else if (!match[2] || hour > 23) return null;
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function exactChoice(expression, choices) {
    const name = normalizeText(expression);
    const matches = choices.filter(item => normalizeText(item.name) === name);
    return matches.length === 1 ? matches[0] : null;
}

function mentionedChoices(text, choices) {
    const source = ` ${normalizeText(text)} `, occurrences = [];
    for (const choice of choices) {
        const token = ` ${normalizeText(choice.name)} `;
        if (token === '  ') continue;
        for (let offset = 0; offset < source.length;) {
            const start = source.indexOf(token, offset);
            if (start < 0) break;
            occurrences.push({id:choice.id,start,end:start+token.length});
            offset = start + 1;
        }
    }
    // A name contained in a longer name is one target, not two alternatives.
    const explicit = occurrences.filter(item => !occurrences.some(other => other.start <= item.start && other.end >= item.end && other.end-other.start > item.end-item.start));
    return choices.filter(choice => explicit.some(item => item.id === choice.id));
}

function locationQualifier(text) {
    return text.match(/\b(?:at|in|for)\s+(?:the\s+)?(?:property\s+)?((?:[a-z]|\d+[a-z])[a-z0-9 '&,.-]*?)(?=\s+(?:today|tomorrow|from|on|at|for|starting|between|\d{1,2}[:.]\d{2}|\d{2}-\d{2}-\d{4}|\d{4}-\d{2}-\d{2})\b|$)/i)?.[1]?.trim() || null;
}

function withoutPurpose(text, purpose) {
    const source = ` ${normalizeText(text)} `;
    if (!purpose) return text;
    const phrase = ` ${normalizeText(purpose)} `, index = source.lastIndexOf(phrase);
    // Grounding alone does not prove a phrase is a note. Preserve explicit
    // in/at locations and room mentions if the model mislabeled them as purpose.
    return index < 0 || !/\bfor$/.test(source.slice(0,index))
        ? text : (source.slice(0,index) + ' ' + source.slice(index+phrase.length)).trim();
}

export async function advanceConversation(input, current, deps) {
    const now = deps.now();
    const state = current?.llmVersion === 1 ? structuredClone(current) : blank();
    const reply = (body, draft = null, heading = '💬 Autopilot') => {
        const text = message(heading, body);
        return { session: state, reply: { key: 'notice', params: [text], text,
        workflow: draft?.workflow || 'menu', conversationId: draft?.id || input.requestId,
        revision: draft?.revision || 0, lastInboundAt: input.inboundAt || now.toISOString() } };
    };
    const photoFailure = draft => reply('📷 The photo could not be downloaded or read. It has not been attached to a new ticket.\n\nSend a new JPG, PNG or WebP photo, or reply *No Photo* to continue without it.',draft,'📷 Photo needs attention');
    const user = await deps.findUser(input.phone);
    if (!user || (state.userId && state.userId !== user.id)) {
        return { session: null, reply: { key: 'notice', params: ['Your number could not be linked to an approved account. Contact your property manager.'], text: 'Your number could not be linked to an approved account. Contact your property manager.', lastInboundAt: input.inboundAt || now.toISOString() } };
    }
    state.userId = user.id;
    const properties = await deps.properties(user.id);
    const configs = new Map();
    for (const orgId of new Set(properties.map(p => p.organization_id))) configs.set(orgId, await deps.settings(orgId));
    const allowed = workflow => properties.filter(p => {
        const cfg = configs.get(p.organization_id);
        return audienceAllows(cfg, user.id) && cfg[workflow === 'booking' ? 'bookingEnabled' : 'ticketEnabled'];
    });
    const recovered = new Map();
    for (const [workflow, draft] of Object.entries(state.drafts)) {
        const accessible = draft.userId === user.id && (!draft.propertyId || allowed(workflow).some(p => p.id === draft.propertyId));
        if (accessible && state.active === workflow && (input.text.trim().toLowerCase() === (workflow === 'booking' ? 'confirm booking' : 'submit ticket') ||
            (workflow === 'ticket' && input.text.trim().toLowerCase() === 'submit' && draft.review) || (workflow === 'booking' && draft.autoBook && draft.review))) {
            const expected = workflow === 'ticket' ? {propertyId:draft.propertyId,title:draft.fields.issue?.trim(),mediaUrl:draft.mediaUrl || null} : draft.review?.fingerprint;
            const outcome = await (workflow === 'booking' ? deps.findBooking : deps.findTicket)(draft.id, user.id, expected);
            if (outcome?.id && (!outcome.property_id || outcome.property_id === draft.propertyId)) recovered.set(workflow,outcome);
        }
        if (!accessible || (draft.expiresAt <= now.getTime() && !recovered.has(workflow))) delete state.drafts[workflow];
    }
    if (state.active && !state.drafts[state.active]) state.active = null;
    if (!allowed('booking').length && !allowed('ticket').length) return reply('WhatsApp AI is not enabled for your account or you no longer have access. Contact your organization administrator.');
    const text = input.text.trim();
    const normalized = normalizeText(text);
    const menuSelection = ['create ticket','book meeting room'].includes(normalized) && !input.mediaUrl;
    const directBooking = !input.mediaUrl && !menuSelection && isDirectBookingRequest(text);
    // Quotes bind to the recipient and exact current draft. An old prompt cannot confirm a new action.
    if (input.quotedIds?.length) {
        const quote = await deps.quote?.(input.phone, input.quotedIds);
        if (!quote && !menuSelection) return reply('I cannot link that quoted message to an active request. Send MENU and choose a service, or reply to the latest prompt.');
        // A known menu action can safely start/resume collection even if the provider omitted its outbound ID.
        if (quote) {
        if (quote.workflow === 'task') return reply('That reply belongs to Task Manager. Send TASKS or DONE followed by the task number. Your facility request is still saved.');
        if (quote.workflow !== 'menu') {
            const draft = state.drafts[quote.workflow];
            if (!draft || draft.id !== quote.conversation_id || draft.revision !== quote.revision) return reply('That is an older or completed request. Please reply to the latest prompt or send MENU.');
            state.active = quote.workflow;
        } else if (!['create ticket', 'book meeting room', 'hi', 'hello', 'hey', 'menu'].includes(normalized)) {
            return reply('Please choose Create Ticket or Book Meeting Room from the menu.');
        }
        }
    }
    if (isExplicitTaskCommand(text)) return reply('This message belongs to Task Manager. Send TASKS to continue there. Your facility request is still saved.');
    if (!input.mediaUrl && /^(hi|hello|hey|menu|help|options)$/.test(normalized)) {
        state.active = null;
        return { session: state, reply: { key: 'menu', params: [], workflow: 'menu', conversationId: input.requestId, revision: 0, lastInboundAt: input.inboundAt || now.toISOString() } };
    }
    const selected = !input.mediaUrl && (normalized === 'create ticket' ? 'ticket' : normalized === 'book meeting room' || directBooking ? 'booking' : null);
    if (selected) {
        if (!allowed(selected).length) return reply('This service is not enabled for your account.');
        state.active = selected;
        state.drafts[selected] ||= { workflow: selected, id: input.requestId, userId: user.id, fields: {}, revision: 0 };
        if (menuSelection) delete state.drafts[selected].autoBook;
        // Carry only a legacy property choice, rechecked against current access.
        // Dates, rooms, times and operation IDs from that session are not reused.
        if (directBooking && current?.llmVersion !== 1 && (current?.step === 'booking_request' || current?.action === 'booking') &&
            allowed('booking').some(p => p.id === current?.property?.id)) state.drafts.booking.propertyId = current.property.id;
    }
    const draft = state.drafts[state.active];
    if (!draft) return reply('Please send HI and choose Create Ticket or Book Meeting Room first. For task updates, send TASKS.');
    if (directBooking) {
        // The persisted inbound event and operation ID are immutable. Recover a
        // committed action before another model call can change its interpretation.
        const existing = await deps.findBooking(draft.id,user.id);
        if (existing?.id && allowed('booking').some(p => p.id === existing.property_id)) {
            delete state.drafts.booking; state.active = null;
            return {session:state,reply:null};
        }
    }
    const serviceInstruction = draft.workflow === 'booking' ? bookingInstructionText(text) : text;
    if (!input.mediaUrl && (/\btasks?\b/i.test(serviceInstruction) || /^(?:done|completed|finished)(?:\s|$)/i.test(serviceInstruction)) && !menuSelection) return reply('This sounds like a task update. Send TASKS or DONE followed by the task number. Your facility request is still saved.', draft);
    if (!input.mediaUrl && /\b(?:do not|don['’]?t|never)\s+(?:create|raise|book|reserve|schedule|submit|confirm)\b/i.test(text)) {
        delete draft.autoBook;
        delete draft.review;
        return reply('I will not submit this request. Send a correction, or CANCEL to discard it.', draft);
    }
    if (draft.workflow === 'booking' && !input.mediaUrl && competingBookingDetails(text)) {
        return reply('Please send *one date and one start/end time range* for this booking. I will not choose between different dates or intervals.', draft, '📝 Clarify booking details');
    }
    if (draft.autoBook && /\b(?:if|unless|maybe)\b/.test(normalized)) {
        return reply('Please confirm your condition is satisfied, then send a clear booking instruction with the requested details.', draft, '📝 Clarify booking details');
    }
    if (!input.quotedIds?.length && !input.mediaUrl && /^(?:yes|no|done|cancel|submit|\d+)$/.test(normalized) &&
        (Object.keys(state.drafts).length > 1 || await deps.hasTaskContext?.(input.phone))) {
        return reply('That short reply could refer to more than one conversation. Reply to the latest service prompt, or send Confirm Booking / Submit Ticket. For task updates, send TASKS.', draft);
    }
    draft.expiresAt = now.getTime() + TTL;
    if (!input.mediaUrl && normalized === 'cancel') {
        delete state.drafts[state.active]; state.active = null;
        return reply('This request was cancelled. Send HI to start another request.');
    }
    if (!input.mediaUrl && draft.workflow === 'ticket' && draft.mediaRejected && /^(submit|submit ticket)$/.test(normalized)) return photoFailure(draft);
    const confirmation = !input.mediaUrl && ((draft.workflow === 'booking' ? /^confirm booking$/ : /^submit ticket$/).test(normalized) ||
        (draft.workflow === 'ticket' && normalized === 'submit' && draft.review?.revision === draft.revision));
    if (!confirmation && !input.mediaUrl && /^(yes|confirm|submit|no)$/.test(normalized)) return reply('Please use Confirm Booking or Submit Ticket for the selected request, or send a correction.', draft);
    const choices = allowed(draft.workflow);
    let changed = false;
    if (!input.mediaUrl && draft.workflow==='ticket' && /^(no photo|remove photo|without photo)$/.test(normalized)) {
        delete draft.mediaUrl;delete draft.mediaRejected;changed=true;
    } else if (!selected && !confirmation && !input.mediaUrl && /^\d+$/.test(text) && draft.choices) {
        const option = draft.choices.items[Number(text) - 1];
        if (!option) return reply('Please choose one of the option numbers shown in the latest message.', draft);
        if (draft.choices.kind === 'property') {draft.propertyId = option.id;delete draft.roomId;}
        else {draft.fields.room = option.name;draft.roomId = option.id;delete draft.roomEvidence;}
        changed = true;
    } else if ((!selected || directBooking) && !confirmation && !(normalized === 'add photo' && !input.mediaUrl)) {
        let pendingMedia = null;
        if (input.mediaUrl) {
            if (draft.workflow !== 'ticket' || input.mediaType !== 'image') return reply('Please send a photo only for a ticket, or send the booking details as text.', draft);
            try { if (new URL(input.mediaUrl).protocol !== 'https:') throw new Error(); }
            catch { return reply('The photo could not be accepted. Please send it again.', draft); }
            pendingMedia = input.mediaUrl;
        }
        if (text) {
            const result = await deps.interpret({ workflow: draft.workflow, text, pending: Object.keys(draft.fields) });
            const validated = result.ok ? validateTurn({ intent: result.intent, fields: result.fields }, draft.workflow, text) : result;
            if (!validated.ok || validated.intent !== 'details' || (draft.autoBook && !directBooking && Object.values(validated.fields).every(value => value === null))) return reply(draft.review
                ? `Your request is saved.\n\n✅ If the details in the latest review are correct, reply *${draft.workflow==='booking'?'Confirm Booking':'Submit Ticket'}*.\n✏️ Otherwise, send the details you want to change.\n\nFor task updates, send *TASKS*.`
                : `Please send the ${draft.workflow==='booking'?'booking details':'issue description'} requested above.\n\nFor task updates, send *TASKS*.`, draft, '💬 Let’s continue');
            if (directBooking) draft.autoBook = true;
            if (validated.fields.date !== null) {
                const receivedAt = new Date(input.inboundAt || now);
                draft.dateAnchor = {source:validated.fields.date,value:parseBookingDate(validated.fields.date,Number.isNaN(receivedAt.getTime()) ? now : receivedAt)};
            }
            for (const [field, value] of Object.entries(validated.fields)) if (value !== null) { draft.fields[field] = value; changed = true; }
            if (validated.fields.room) delete draft.roomId;
            if (validated.fields.property) {
                const property = exactChoice(validated.fields.property, choices);
                delete draft.propertyId;
                delete draft.roomId;
                if (property) draft.propertyId = property.id;
            }
            if (draft.autoBook) {
                // A null model field cannot erase an explicit location constraint.
                const targetingText = withoutPurpose(text,validated.fields.purpose);
                const qualifier = locationQualifier(targetingText);
                const propertyMentions = mentionedChoices(targetingText,choices);
                const explicitLocation = qualifier && !parseClock(qualifier) && !parseBookingDate(qualifier,now) && normalizeText(qualifier) !== normalizeText(validated.fields.room);
                if (propertyMentions.length > 1 || explicitLocation || (propertyMentions.length === 1 && (!validated.fields.property || exactChoice(validated.fields.property,choices)))) {
                    const property = propertyMentions.length > 1 ? null : explicitLocation ? exactChoice(qualifier,choices) : propertyMentions[0];
                    draft.fields.property = explicitLocation ? qualifier : property?.name || text;
                    if (property?.id !== draft.propertyId) delete draft.roomId;
                    delete draft.propertyId;
                    if (property) draft.propertyId = property.id;
                    changed = true;
                }
                if (validated.fields.room || /\b(?:room|boardroom)\b/i.test(targetingText)) draft.roomEvidence = targetingText;
            }
        }
        if (pendingMedia) { draft.mediaUrl = pendingMedia;delete draft.mediaRejected;changed = true; }
    }
    if (changed) { draft.revision++; delete draft.review; delete draft.choices; }
    if (!draft.propertyId && choices.length === 1 && !draft.fields.property) draft.propertyId = choices[0].id;
    const property = choices.find(p => p.id === draft.propertyId);
    if (!property) {
        // Never show another organization's data through a model-proposed property name.
        draft.choices = { kind: 'property', items: choices.slice(0, 20).map(p => ({ id:p.id, name:p.name })) };
        return reply(`Where would you like to ${draft.workflow==='booking'?'book a meeting room':'create a ticket'}?\n\n${draft.choices.items.map((p,i)=>`${i+1}. ${p.name}`).join('\n')}\n\n👉 Reply with the *property name or option number*.${choices.length>20 ? '\nMore properties are available; send the exact property name.' : ''}`, draft, '🏢 Choose a property');
    }
    const cfg = configs.get(property.organization_id);
    if (recovered.has(draft.workflow)) {
        delete state.drafts[draft.workflow]; state.active = null;
        return { session:state,reply:null };
    }
    const reviewMatches = fingerprint => draft.review?.revision === draft.revision && draft.review?.fingerprint === fingerprint;
    const setReview = fingerprint => {
        if (draft.review && draft.review.fingerprint !== fingerprint) draft.revision++;
        draft.review = {revision:draft.revision,fingerprint};
    };
    if (draft.workflow === 'ticket') {
        const issue = draft.fields.issue?.trim();
        if (!issue) return reply(`🏢 *Property:* ${property.name}\n\n📝 What is the issue? Send a short description.\n📷 You can also send a photo with the issue in its caption.\n\nA photo is *optional*.`, draft, '🎫 Create a ticket');
        if (draft.mediaRejected && normalized !== 'add photo') return photoFailure(draft);
        if (issue.length > 2000) return reply('Please shorten the issue description to 2,000 characters.', draft);
        if (normalized === 'add photo') return reply(`Send your photo now.\n\n✅ To continue without a photo, reply *${draft.mediaUrl?'No Photo':'Submit Ticket'}*.`, draft, '📷 Add a photo');
        const fingerprint = JSON.stringify([property.id,property.name,issue,draft.mediaUrl || null]);
        if (!confirmation || !reviewMatches(fingerprint)) {
            setReview(fingerprint);
            return reply(`🏢 *Property:* ${property.name}\n\n📝 *Issue:*\n${issue}\n\n📷 ${draft.mediaUrl ? 'Photo received; it will be checked when you submit.' : 'Photo is optional: send one now if needed.'}\n\n✅ Reply *Submit* or *Submit Ticket* to create it.\n✏️ Send a correction to change the details.`, draft, '🎫 Review ticket');
        }
        let ticket;
        try {
            ticket = await deps.createTicket({ phone: input.phone, userId: user.id, propertyId: property.id,
                title: issue, mediaUrl: draft.mediaUrl || null, messageId: input.messageId, requestId: draft.id, interpreter: true });
        } catch(error) {
            if(error.code==='OPERATION_ALREADY_CREATED') {
                delete state.drafts[draft.workflow];state.active=null;
                return reply('An earlier ticket was already created for this request. Check it in the app or contact your property manager. To create a ticket with different details, send HI and start a new request.');
            }
            if(error.code!=='INVALID_MEDIA')throw error;
            delete draft.review;
            draft.mediaRejected = true;
            return photoFailure(draft);
        }
        if (!ticket?.id) throw new Error('Ticket service did not return a stored ticket');
    } else {
        const roomList = await deps.rooms(property.id);
        let room = draft.roomId ? roomList.find(r=>r.id===draft.roomId) || null : draft.fields.room ? exactChoice(draft.fields.room, roomList) : !draft.autoBook && roomList.length === 1 ? roomList[0] : null;
        if (draft.autoBook && draft.roomEvidence) {
            const mentions = mentionedChoices(draft.roomEvidence,roomList);
            if (mentions.length > 1 || (room && mentions.length === 1 && room.id !== mentions[0].id)) room = null;
        }
        const date = draft.fields.date
            ? draft.autoBook && draft.dateAnchor?.source === draft.fields.date ? draft.dateAnchor.value : parseBookingDate(draft.fields.date, now)
            : !draft.autoBook && cfg.defaultDate === 'today' ? parseBookingDate('today',now) : null;
        const startTime = parseClock(draft.fields.start), endTime = parseClock(draft.fields.end);
        const missing = [];
        if (!date) missing.push('📅 *Date:* today, tomorrow, or DD-MM-YYYY');
        if (!room) missing.push('🚪 *Room:* choose from the list below');
        if (!startTime || !endTime) missing.push('🕒 *Time:* both start and end times with AM/PM (e.g. 2:30 PM to 3:00 PM) or 24-hour HH:MM');
        if (missing.length) {
            if (!room) draft.choices = {kind:'room',items:roomList.slice(0,20).map(r=>({id:r.id,name:r.name}))};
            const known=[date&&`📅 *Date:* ${displayDate(date)}`,room&&`🚪 *Room:* ${room.name}`,
                startTime&&endTime&&`🕒 *Time:* ${displayClock(startTime)} to ${displayClock(endTime)} IST`,
                draft.fields.purpose&&`📝 *Purpose:* ${draft.fields.purpose.trim()}`].filter(Boolean);
            return reply(`🏢 *Property:* ${property.name}${known.length?`\n${known.join('\n')}`:''}\n\nPlease send the missing details:\n${missing.join('\n')}${!room ? `\n\n*Available rooms:*\n${draft.choices.items.map((r,i)=>`${i+1}. ${r.name}`).join('\n') || 'No active rooms available.'}${roomList.length>20 ? '\nMore rooms are available; send the exact room name.' : ''}` : ''}\n\n👉 Reply with the details${!room?' or the room’s option number':''}.`, draft, '📝 Booking details');
        }
        const purpose = draft.fields.purpose?.trim() || null;
        const fingerprint = JSON.stringify([property.id,property.name,room.id,room.name,date,startTime,endTime,purpose]);
        if (draft.autoBook) {
            // A retry must find a committed booking before checking its occupied
            // slot or past start time. The lookup verifies owner and input tuple.
            const existing = await deps.findBooking(draft.id,user.id,fingerprint);
            if (existing?.id && (!existing.property_id || existing.property_id === property.id)) {
                delete state.drafts[draft.workflow]; state.active = null;
                return {session:state,reply:null};
            }
        }
        if (endTime <= startTime) { delete draft.review; return reply('The end time must be later than the start time on the same day. Please send both times again.', draft); }
        if (Date.parse(`${date}T${startTime}:00+05:30`) <= now.getTime()) { delete draft.review; return reply('The start time has passed. Please send a future date and time.', draft); }
        {
            const available = await deps.availableRooms(property.id,date,startTime,endTime);
            if (!available.some(r=>r.id === room.id)) { delete draft.review; return reply('That room is unavailable during the requested hours. Please choose another room or time.', draft); }
            const credit = await deps.creditSummary(user.id,property.id,{start_time:startTime,end_time:endTime});
            if (!draft.autoBook && (!confirmation || !reviewMatches(fingerprint))) {
                setReview(fingerprint);
                return reply(`🏢 *Property:* ${property.name}\n🚪 *Room:* ${room.name}\n📅 *Date:* ${displayDate(date)}\n🕒 *Time:* ${displayClock(startTime)} to ${displayClock(endTime)} IST${purpose?`\n📝 *Purpose:* ${purpose}`:''}${credit?`\n💳 *Credits:* ${credit}`:''}\n\n✅ Reply *Confirm Booking* to book.\n✏️ Send a correction to change the details.`, draft, '📋 Review booking');
            }
            if (draft.autoBook) setReview(fingerprint);
            try {
                const booking = await deps.bookRange({userId:user.id,propertyId:property.id,roomId:room.id,date,startTime,endTime,purpose,requestId:draft.id,interpreter:true});
                if (!booking?.id) throw new Error('Booking service did not return a stored booking');
            } catch (error) {
                if(error.code==='OPERATION_ALREADY_CREATED') {
                    delete state.drafts[draft.workflow];state.active=null;
                    return reply('An earlier booking was already created for this request. Check it in the app. To book different details, send HI and start a new request.');
                }
                if (!['SLOT_UNAVAILABLE','INSUFFICIENT_CREDITS','MULTIPLE_COMPANIES','ACCESS_REVOKED','INVALID_BOOKING'].includes(error.code)) throw error;
                delete draft.review;
                if (error.code === 'ACCESS_REVOKED') {delete state.drafts[draft.workflow];state.active=null;return reply('Your access changed. Please contact your property manager.');}
                if (error.code === 'INVALID_BOOKING') return reply('The room or booking hours changed. Please send a new room, date and time.',draft);
                return reply(error.code === 'INSUFFICIENT_CREDITS' ? 'You do not have enough meeting-room credits. Contact your property manager or choose a shorter duration.' : error.code === 'MULTIPLE_COMPANIES' ? 'Please contact your property manager to resolve your company account.' : 'That room is no longer available. Please choose another room or time.', draft);
            }
        }
    }
    // Existing omnichannel/outbox owns completion notifications. Never invent a success or send a duplicate campaign.
    delete state.drafts[draft.workflow]; state.active = null;
    return {session:state,reply:null};
}
