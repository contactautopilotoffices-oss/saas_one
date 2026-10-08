export async function runAssistantChecks(engine, protocol) {
    const passed = [];
    function assert(value, message) { if (!value) throw new Error(message); }
    const input = (text, extra = {}) => ({ phone: '919876543210', messageId: 'message-1', text, mediaUrl: null, mediaType: 'text', ...extra });
    const properties = [{ id: 'p1', name: 'Hub One', organization_id: 'o1' }, { id: 'p2', name: 'Hub Two', organization_id: 'o1' }];
    const created = [];
    const booked = [];
    const deps = {
        now: () => new Date('2026-10-01T03:00:00Z'),
        findUser: async () => ({ id: 'u1' }),
        properties: async () => properties,
        rooms: async () => [{ id: 'r1', name: 'Boardroom', property_id: 'p1' }],
        slots: async () => [{ id: 's1', start_time: '10:00:00', end_time: '11:00:00' }],
        creditSummary: async () => '2 hours remaining',
        createTicket: async (request) => { created.push(request); return { id: 't1', ticket_number: 'TKT-1', title: request.title, photo_before_url: request.mediaUrl }; },
        bookRoom: async (request) => { booked.push(request); return { id: 'b1' }; },
    };
    assert(typeof engine.advance === 'function', 'conversation implementation is missing');
    for (const greeting of ['Hi!', 'heelo', 'hello', 'hey', 'Good morning']) {
        const result = await engine.advance(input(greeting), null, deps);
        assert(result.session.step === 'menu' && result.reply.key === 'menu', 'greeting must show menu: ' + greeting);
    }
    passed.push('greetings show the two-action menu');
    let result = await engine.advance(input('Create Ticket'), { id: 'session-1', step: 'menu' }, deps);
    assert(result.session.step === 'property' && result.reply.key === 'select', 'multiple properties must prompt');
    result = await engine.advance(input('9'), result.session, deps);
    assert(result.session.step === 'property' && created.length === 0, 'invalid choice must not create ticket');
    result = await engine.advance(input('1'), result.session, deps);
    assert(result.session.step === 'ticket_title' && result.session.property.id === 'p1', 'select correct property');
    result = await engine.advance(input('AC is leaking'), result.session, deps);
    assert(result.session.step === 'ticket_photo_choice' && created.length === 0, 'title waits for optional photo choice');
    result = await engine.advance(input('Submit Ticket'), result.session, deps);
    assert(result.reply.key === 'ticket_created' && result.session === null, 'text-only ticket completes');
    assert(created[0].title === 'AC is leaking' && !created[0].mediaUrl && created[0].propertyId === 'p1', 'text-only submission payload');
    passed.push('multi-property text-only ticket uses explicit submit');
    const single = { ...deps, properties: async () => [properties[0]] };
    result = await engine.advance(input('Create Ticket'), null, single);
    assert(result.session.step === 'ticket_title', 'one property skips selection');
    result = await engine.advance(input('Lift stuck', { mediaType: 'image', mediaUrl: 'https://example.com/photo.jpg' }), result.session, single);
    assert(result.reply.key === 'ticket_created' && created.at(-1).title === 'Lift stuck' && created.at(-1).mediaUrl, 'photo caption is title');
    passed.push('captioned photo creates ticket with attachment');
    result = await engine.advance(input('Create Ticket'), null, single);
    result = await engine.advance(input('', { mediaType: 'image', mediaUrl: 'https://example.com/photo.jpg' }), result.session, single);
    assert(result.session.step === 'ticket_title' && result.session.mediaUrl, 'uncaptioned photo waits for title');
    result = await engine.advance(input('Water leak'), result.session, single);
    assert(result.reply.key === 'ticket_created' && created.at(-1).title === 'Water leak', 'pending photo uses next title');
    passed.push('uncaptioned photo waits for title');
    result = await engine.advance(input('Create Ticket'), null, single);
    result = await engine.advance(input('Broken chair'), result.session, single);
    result = await engine.advance(input('Add Photo'), result.session, single);
    assert(result.session.step === 'ticket_photo', 'add photo enters photo step');
    result = await engine.advance(input('Submit Ticket'), result.session, single);
    assert(result.reply.key === 'ticket_created' && !created.at(-1).mediaUrl, 'photo can still be skipped');
    passed.push('photo remains optional after Add Photo');
    result = await engine.advance(input('Book Meeting Room'), null, single);
    assert(result.session.step === 'booking_date', 'booking asks date first');
    result = await engine.advance(input('Tomorrow'), result.session, single);
    assert(result.session.date === '2026-10-02' && result.session.step === 'booking_room', 'tomorrow is IST');
    result = await engine.advance(input('1'), result.session, single);
    assert(result.session.step === 'booking_slot', 'room selection lists slots');
    result = await engine.advance(input('1'), result.session, single);
    assert(result.session.step === 'booking_confirm' && result.reply.key === 'booking_review' && booked.length === 0, 'review before booking');
    result = await engine.advance(input('Confirm Booking'), result.session, single);
    assert(result.reply.key === 'booking_created' && booked[0].roomId === 'r1' && booked[0].slotId === 's1' && booked[0].propertyId === 'p1', 'confirmed booking uses correct scope');
    passed.push('booking date room slot review confirmation flow');
    result = await engine.advance(input('Book Meeting Room'), null, single);
    result = await engine.advance(input('2026-02-31'), result.session, single);
    assert(result.session.step === 'booking_date', 'impossible dates rejected');
    result = await engine.advance(input('2026-09-30'), result.session, single);
    assert(result.session.step === 'booking_date', 'past dates rejected');
    passed.push('past and impossible dates rejected');
    const denied = { ...single, properties: async () => [] };
    result = await engine.advance(input('Submit Ticket'), { id: 'x', step: 'ticket_photo_choice', action: 'ticket', property: properties[0], title: 'Issue' }, denied);
    assert(result.reply.key === 'notice' && result.session === null, 'revoked access fails closed');
    passed.push('live property access checked before submission');
    result = await engine.advance(input('cancel'), { step: 'booking_confirm' }, deps);
    assert(result.session === null && result.reply.key === 'notice', 'cancel clears flow');
    result = await engine.advance(input('MENU'), { step: 'ticket_title' }, deps);
    assert(result.session.step === 'menu', 'menu resets flow');
    passed.push('menu and cancel reset conversation');
    result = await engine.advance(input('Create Ticket'), null, { ...deps, findUser: async () => null });
    assert(result.session === null && result.reply.key === 'notice', 'unregistered number denied');
    passed.push('unregistered user cannot create or book');
    const many = { ...deps, properties: async () => Array.from({ length: 13 }, (_, i) => ({ id: 'p' + i, name: 'Property ' + i, organization_id: 'o1' })) };
    result = await engine.advance(input('Create Ticket'), null, many);
    result = await engine.advance(input('NEXT'), result.session, many);
    assert(result.session.page === 1 && result.reply.params[2].includes('Property 5'), 'next page shows more properties');
    result = await engine.advance(input('1'), result.session, many);
    assert(result.session.property.id === 'p5', 'page selection uses correct property');
    passed.push('long property lists paginate');
    const event = protocol.normalizeInbound({ topic: 'message.sender.user', data: { phone: '+91 98765 43210', messageId: 'w1', message: { type: 'image', image: { url: 'https://example.com/a.jpg', caption: 'Broken AC' } } } });
    assert(event.phone === '919876543210' && event.text === 'Broken AC' && event.mediaType === 'image' && event.mediaUrl, 'nested caption normalized');
    const click = protocol.normalizeInbound({ topic: 'message.sender.user', data: { phone: '919876543210', messageId: 'w2', message: { type: 'button', button: { payload: 'create_ticket', text: 'Create Ticket' } } } });
    assert(click.text === 'create_ticket', 'quick reply payload normalized');
    assert(protocol.normalizeInbound({ topic: 'message.sent.business', data: { phone: '919876543210', message: 'Hello' } }) === null, 'outbound event ignored');
    assert(protocol.normalizeInbound({ topic: 'message.sender.user', data: { fromMe: true, phone: '919876543210', message: 'Hello' } }) === null, 'self echo ignored');
    assert(protocol.normalizeInbound({ type: 'text', phone: '919876543210', message: { text: { body: 'Hi' } }, messageId: 'w3' }).text === 'Hi', 'flat type text accepted');
    assert(protocol.normalizeInbound({ topic: 'message.received', data: { phone: '9876543210', message: 'Hi', messageId: 'w4' } }).phone === '919876543210', 'Indian number canonicalized');
    passed.push('text image button and inbound event payloads normalized');
    assert(protocol.parseBookingDate('today', new Date('2026-09-30T20:00:00Z')) === '2026-10-01', 'IST date across UTC midnight');
    assert(protocol.parseBookingDate('31-02-2026', new Date('2026-01-01')) === null, 'invalid DD-MM-YYYY rejected');
    passed.push('IST date parsing independent of server timezone');
    return passed;
}

