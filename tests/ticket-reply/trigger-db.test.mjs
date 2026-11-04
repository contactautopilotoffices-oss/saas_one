import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// Runs the REAL migration, so these are the rules the database will actually apply.
const migration = () => readFile(new URL('../../supabase/migrations/20261104000003_ticket_reply_notifications.sql', import.meta.url), 'utf8');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const LOHIT = id(1), RAHUL = id(2), ADMIN = id(3), TICKET = id(10), UNASSIGNED = id(11), SELF = id(12), NO_ORG = id(13), ORG = id(20), PROP = id(21);

async function database() {
    const db = new PGlite();
    await db.exec(`
        CREATE TABLE properties(id uuid primary key, organization_id uuid);
        CREATE TABLE tickets(id uuid primary key, ticket_number text, title text, property_id uuid, organization_id uuid, raised_by uuid, assigned_to uuid);
        CREATE TABLE ticket_comments(id uuid primary key default gen_random_uuid(), ticket_id uuid not null, user_id uuid not null, comment text not null, is_internal boolean default false, created_at timestamptz default now());
        CREATE TABLE event_outbox(id uuid primary key default gen_random_uuid(), event_type varchar(255) not null, entity_id uuid, payload jsonb not null);
        CREATE TABLE whatsapp_outgoing_context(project_id text not null, phone text not null, message_alias text not null,
            workflow text not null CHECK (workflow IN ('menu','booking','ticket','task')), conversation_id text not null,
            revision integer not null default 0, created_at timestamptz not null default now(), expires_at timestamptz not null default now() + interval '24 hours',
            PRIMARY KEY(project_id,phone,message_alias));
        INSERT INTO properties VALUES ('${PROP}', '${ORG}');
        INSERT INTO tickets VALUES
          ('${TICKET}','TICK-1042','Company emails creation','${PROP}','${ORG}','${LOHIT}','${RAHUL}'),
          ('${UNASSIGNED}','TICK-2','No assignee','${PROP}','${ORG}','${LOHIT}',NULL),
          ('${SELF}','TICK-3','Raised and assigned to one person','${PROP}','${ORG}','${LOHIT}','${LOHIT}'),
          ('${NO_ORG}','TICK-4','Org only on the property','${PROP}',NULL,'${LOHIT}','${RAHUL}');
    `);
    await db.exec(await migration());
    return db;
}

const comment = (db, ticket, user, text = 'hello', extra = {}) => db.query(
    `INSERT INTO ticket_comments(ticket_id,user_id,comment,is_internal,metadata) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [ticket, user, text, extra.is_internal ?? false, extra.metadata ? JSON.stringify(extra.metadata) : null]);
const events = async db => (await db.query(`SELECT event_type, entity_id, payload FROM event_outbox`)).rows;

test('assignee replies: the raiser is notified, keyed by the comment id', async () => {
    const db = await database();
    const { rows: [saved] } = await comment(db, TICKET, RAHUL, 'I need the approval first');
    const [event, ...rest] = await events(db);
    assert.equal(rest.length, 0);
    assert.equal(event.event_type, 'TICKET_REPLY');
    assert.equal(event.entity_id, saved.id);
    assert.equal(event.payload.recipient_id, LOHIT);
    assert.equal(event.payload.recipient_role, 'requester');
    assert.equal(event.payload.sender_id, RAHUL);
    assert.equal(event.payload.ticket_number, 'TICK-1042');
    assert.equal(event.payload.message, 'I need the approval first');
    assert.equal(event.payload.organization_id, ORG);
});

test('raiser replies: the assignee is notified', async () => {
    const db = await database();
    await comment(db, TICKET, LOHIT);
    const [event] = await events(db);
    assert.equal(event.payload.recipient_id, RAHUL);
    assert.equal(event.payload.recipient_role, 'assignee');
});

test('two quick replies on one ticket are two separate events, so dedup keeps both', async () => {
    const db = await database();
    await comment(db, TICKET, RAHUL, 'one');
    await comment(db, TICKET, RAHUL, 'two');
    const all = await events(db);
    assert.equal(all.length, 2);
    assert.notEqual(all[0].entity_id, all[1].entity_id);
});

for (const [name, ticket, user, extra] of [
    ['a third person', TICKET, ADMIN, {}],
    ['an internal note', TICKET, RAHUL, { is_internal: true }],
    ['an automatic system comment', TICKET, RAHUL, { metadata: { system_update: true } }],
    ['a ticket with no assignee', UNASSIGNED, LOHIT, {}],
    ['someone who raised and is assigned the ticket', SELF, LOHIT, {}],
]) {
    test(`no notification for ${name}, and the comment still saves`, async () => {
        const db = await database();
        await comment(db, ticket, user, 'hello', extra);
        assert.equal((await events(db)).length, 0);
        assert.equal((await db.query('SELECT 1 FROM ticket_comments')).rows.length, 1);
    });
}

test('a WhatsApp reply notifies the other person, like any comment', async () => {
    const db = await database();
    await comment(db, TICKET, LOHIT, 'Attached', { metadata: { source: 'whatsapp', whatsapp_message_id: 'wamid.1' } });
    assert.equal((await events(db))[0].payload.recipient_id, RAHUL);
});

test('the organisation is read from the property when the ticket has none', async () => {
    const db = await database();
    await comment(db, NO_ORG, RAHUL);
    assert.equal((await events(db))[0].payload.organization_id, ORG);
});

test('re-running the migration leaves one trigger: one comment, one event', async () => {
    const db = await database();
    await db.exec(await migration());
    const { rows } = await db.query(`SELECT tgname FROM pg_trigger WHERE tgrelid='public.ticket_comments'::regclass AND NOT tgisinternal`);
    assert.deepEqual(rows.map(row => row.tgname), ['trg_ticket_comments_outbox']);
    await comment(db, TICKET, RAHUL);
    assert.equal((await events(db)).length, 1);
});

test('the same WhatsApp message cannot add its comment twice', async () => {
    const db = await database();
    await comment(db, TICKET, LOHIT, 'x', { metadata: { whatsapp_message_id: 'wamid.same' } });
    await assert.rejects(comment(db, TICKET, LOHIT, 'x', { metadata: { whatsapp_message_id: 'wamid.same' } }), error => error.code === '23505');
    await comment(db, TICKET, LOHIT, 'web one'); // comments with no WhatsApp id are not limited
    await comment(db, TICKET, LOHIT, 'web two');
});

test('a broken outbox never costs the person their comment', async () => {
    const db = await database();
    await db.exec('DROP TABLE event_outbox');
    await comment(db, TICKET, RAHUL);
    assert.equal((await db.query('SELECT 1 FROM ticket_comments')).rows.length, 1);
});

test('the swipe link table accepts ticket_reply and keeps the old workflows', async () => {
    const db = await database();
    for (const [index, workflow] of ['menu', 'booking', 'ticket', 'task', 'ticket_reply'].entries()) {
        await db.query(`INSERT INTO whatsapp_outgoing_context(project_id,phone,message_alias,workflow,conversation_id) VALUES ('p','919876543210',$1,$2,'c')`, [`m${index}`, workflow]);
    }
    await assert.rejects(db.query(`INSERT INTO whatsapp_outgoing_context(project_id,phone,message_alias,workflow,conversation_id) VALUES ('p','919876543210','bad','nonsense','c')`));
});
