/**
 * Owner 2026-10-20: greetings / menu words and ticket / room requests must reach the old bot (menu, tickets, rooms) even
 * for people whose department has Smart chat ON; plain "I want to raise a ticket" starts the ticket flow.
 * Offline: fake Supabase env, and the smart-chat IO throws if anything tries to read the database.
 * Run: npx tsx task-manager/tests/test_menu_facility_routing.ts
 */
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:1';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-key-offline-test';

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
    console.log(`${ok ? '  ✓' : '  ✗'} ${name}${ok ? '' : ` — ${JSON.stringify(detail)}`}`);
    if (!ok) failures++;
}

async function main() {
    const { claimSmartChat, isMenuOrFacilityMessage } = await import('../brain/live');
    const { isDirectTicketRequest } = await import('../../backend/lib/whatsapp/interpreter/coordinator.mjs');

    console.log('Smart chat lets these go to the old bot:');
    for (const text of ['Hi', 'hello!', 'menu', 'good morning', 'Raise ticket', 'I want to raise a ticket', 'create a complaint',
        'book a meeting room', 'please create a new ticket', 'reserve the conference room tomorrow 3pm', 'Create Ticket', 'Book Meeting Room']) {
        check(JSON.stringify(text), isMenuOrFacilityMessage(text) === true);
    }
    console.log('Smart chat keeps these:');
    for (const text of ['add task: clean the meeting room', 'create a task to raise ticket for AC', 'done 2', 'what are my tasks',
        'hi, how many tasks do I have?', 'follow up on the ticket with vendor']) {
        check(JSON.stringify(text), isMenuOrFacilityMessage(text) === false);
    }

    // No database or AI is touched for a menu / facility message: every IO call would throw.
    const io = new Proxy({}, { get: () => () => { throw new Error('IO must not be called'); } }) as never;
    const body = (text: string) => ({ topic: 'message.sender.user', data: { messages: [{ phone_number: '919000000000', id: `m-${text}`, message_type: 'text', text: { body: text } }] } });
    check('claimSmartChat("hi") is not handled, with no IO', (await claimSmartChat(body('hi'), io)).handled === false);
    check('claimSmartChat("I want to raise a ticket") is not handled, with no IO', (await claimSmartChat(body('I want to raise a ticket'), io)).handled === false);

    console.log('The ticket bot starts a ticket from plain wording:');
    for (const text of ['I want to raise a ticket', 'raise ticket', 'Please create a new ticket', 'log a complaint', 'new ticket']) {
        check(JSON.stringify(text), isDirectTicketRequest(text) === true);
    }
    for (const text of ['do not raise a ticket', 'ticket status', 'raise a ticket for my task', 'the AC is leaking, raise a ticket and book a room', 'close ticket']) {
        check(`not ${JSON.stringify(text)}`, isDirectTicketRequest(text) === false);
    }

    if (failures) {
        console.log(`\n❌ ${failures} check(s) failed`);
        process.exit(1);
    }
    console.log('\nnothing in this test touched the network\n\n🎉 MENU / FACILITY ROUTING TESTS PASSED');
}

void main();
