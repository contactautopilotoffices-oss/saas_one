const firstText = (...values) => values.find(value => typeof value === 'string' && value.trim())?.trim() || '';

export function canonicalPhone(value) {
    const digits = String(value || '').replace(/\D/g, '');
    return digits.length === 10 ? '91' + digits : digits;
}

export function normalizeInbound(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
    const data = body.data || body.payload || body;
    const msg = data.messages?.[0] || data.message || {};
    const topic = firstText(body.topic, body.event, /[.]|inbound/i.test(body.type || '') ? body.type : '').toLowerCase();
    const inbound = ['message.sender.user', 'message.sent.user', 'message.received', 'messages.received', 'inbound_message'];
    if (topic && !inbound.includes(topic)) return null;
    if (body.fromMe || body.direction === 'outbound' || data.fromMe || data.key?.fromMe || msg.fromMe || data.direction === 'outbound' || msg.direction === 'outbound') return null;
    const phone = canonicalPhone(firstText(
        String(data.phone || data.mobile || data.mobileNumber || data.mobile_number || data.phoneNumber || data.phone_number || ''),
        data.userPhone, data.user_phone, data.customerPhone, data.senderPhone, data.sender_phone,
        data.waId, data.wa_id, data.from, data.sender?.phone, data.sender?.mobile,
        data.user?.phone, data.contact?.phone, data.contacts?.[0]?.wa_id, msg.phone_number, msg.phoneNumber, msg.from,
        body.phone, body.mobile, body.from,
    ));
    if (!/^\d{11,15}$/.test(phone)) return null;
    const mediaType = firstText(data.messageType, data.message_type, msg.message_type, msg.messageType, msg.type,
        !/[.]|inbound/i.test(data.type || '') ? data.type : '', body.messageType, body.message_type,
        !/[.]|inbound/i.test(body.type || '') ? body.type : '', 'text').toLowerCase();
    const image = msg.image || data.image || {};
    const video = msg.video || data.video || {};
    const buttonIds = [msg.interactive?.button_reply?.id, msg.interactive?.list_reply?.id,
        msg.button?.payload, data.button?.payload, data.buttonReply?.id];
    const knownAction = buttonIds.find(value => typeof value === 'string' &&
        /^(create ticket|book meeting room|submit ticket|add photo|confirm booking|cancel|today|tomorrow|menu)$/
            .test(value.toLowerCase().replace(/_/g, ' ').trim()));
    const text = firstText(
        knownAction,
        msg.interactive?.button_reply?.title, msg.interactive?.list_reply?.title,
        msg.button?.text, data.button?.text, data.buttonReply?.title,
        ...buttonIds,
        msg.message_content?.text, msg.message_content?.caption, msg.text?.body, msg.text, msg.body, image.caption, video.caption, msg.caption,
        data.caption, data.text?.body, data.text, data.messageText, data.message_text,
        data.message, data.content, body.message, body.text,
    );
    const mediaUrl = firstText(data.mediaUrl, data.media_url, data.media?.url,
        image.url, video.url, msg.message_content?.url, msg.message_content?.media?.url, msg.mediaUrl, msg.url, data.url, body.mediaUrl) || null;
    const messageId = firstText(data.messageId, data.message_id, data.wamid, msg.messageId, msg.message_id, msg.id, data.id, body.messageId, body.id);
    if (!text && !mediaUrl) return null;
    /** @type {{phone:string,messageId:string,text:string,mediaUrl:string|null,mediaType:string,quotedIds?:string[],projectId?:string,inboundAt?:string}} */
    const envelope = { phone, messageId, text, mediaUrl, mediaType: mediaType === 'photo' ? 'image' : mediaType };
    const context = msg.context || data.context;
    const quotedIds = [...new Set([context?.id, context?.submitted_message_id].filter(value => typeof value === 'string' && value.length <= 512))];
    if (quotedIds.length) envelope.quotedIds = quotedIds;
    const projectId = firstText(body.project_id, data.project_id, msg.project_id);
    if (projectId) envelope.projectId = projectId;
    const stamp = msg.sent_at ?? msg.timestamp ?? data.timestamp;
    if (stamp !== undefined && stamp !== null) {
        const numeric = Number(stamp);
        const millis = Number.isFinite(numeric) ? numeric * (numeric < 1e12 ? 1000 : 1) : Date.parse(stamp);
        if (Number.isFinite(millis) && millis > 0) envelope.inboundAt = new Date(millis).toISOString();
    }
    return envelope;
}

export function parseBookingDate(text, now = new Date()) {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
    const normalized = text.trim().toLowerCase();
    if (normalized === 'today' || normalized === '1') return today;
    if (normalized === 'tomorrow' || normalized === '2') {
        return new Date(Date.parse(today + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10);
    }
    let date = normalized;
    const local = /^(\d{2})-(\d{2})-(\d{4})$/.exec(date);
    if (local) date = `${local[3]}-${local[2]}-${local[1]}`;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
    const parsed = new Date(date + 'T00:00:00Z');
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date || date < today) return null;
    return date;
}
