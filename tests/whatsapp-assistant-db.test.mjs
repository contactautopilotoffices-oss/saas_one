import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';

const uuid = number => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;

async function database(withPurpose=true) {
    const db = new PGlite({ extensions: { btree_gist } });
    await db.exec(`
        CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
        CREATE TABLE users(id uuid primary key, is_master_admin boolean default false, is_approved boolean default true, approval_status text default 'approved');
        CREATE TABLE properties(id uuid primary key, name text, organization_id uuid, is_active boolean default true, deleted_at timestamptz);
        CREATE TABLE organization_memberships(user_id uuid, organization_id uuid, role text, is_active boolean default true);
        CREATE TABLE property_memberships(user_id uuid, property_id uuid, role text, is_active boolean default true);
        CREATE TABLE tickets(id uuid primary key default gen_random_uuid());
        CREATE TABLE meeting_rooms(id uuid primary key, property_id uuid, name text, status text default 'active');
        CREATE TABLE meeting_room_slots(id uuid primary key, start_time time, end_time time);
        CREATE TABLE companies(id uuid primary key, property_id uuid);
        CREATE TABLE company_members(user_id uuid, company_id uuid);
        CREATE TABLE meeting_room_credits(id uuid primary key, property_id uuid, user_id uuid, company_id uuid, remaining_hours numeric, updated_at timestamptz);
        CREATE TABLE meeting_room_bookings(id uuid primary key default gen_random_uuid(), meeting_room_id uuid, property_id uuid, organization_id uuid, user_id uuid, company_id uuid, booking_date date, start_time time, end_time time, status text, comment text);
        CREATE TABLE meeting_room_credit_log(id uuid primary key default gen_random_uuid(), credit_id uuid, user_id uuid, company_id uuid, action text, hours_changed numeric, hours_after numeric, booking_id uuid, performed_by uuid, notes text, created_at timestamptz);
    `);
    // Use the real existing credit-deduction implementation, not a stub.
    const creditSql = await readFile(new URL('../backend/db/migrations/20260521_fix_meeting_room_bugs.sql', import.meta.url), 'utf8');
    const deduct = creditSql.slice(creditSql.indexOf('CREATE OR REPLACE FUNCTION deduct_meeting_room_credit('), creditSql.indexOf('-- Function: Atomically refund'));
    await db.exec(deduct);
    await db.exec(await readFile(new URL('../supabase/migrations/20261001000001_whatsapp_assistant.sql', import.meta.url), 'utf8'));
    await db.exec(await readFile(new URL('../supabase/migrations/20261002000001_whatsapp_assistant_permanent_failures.sql', import.meta.url), 'utf8'));
    await db.exec(await readFile(new URL('../supabase/migrations/20261003000001_whatsapp_message_booking.sql', import.meta.url), 'utf8'));
    await db.exec(await readFile(new URL('../supabase/migrations/20261006000001_whatsapp_tenant_booking_credits.sql', import.meta.url), 'utf8'));
    if (withPurpose) await db.exec(await readFile(new URL('../supabase/migrations/20261006000002_whatsapp_booking_purpose.sql', import.meta.url), 'utf8'));
    await db.exec(`
        INSERT INTO users(id) VALUES ('${uuid(1)}'),('${uuid(2)}'),('${uuid(3)}');
        INSERT INTO properties(id,name,organization_id) VALUES ('${uuid(10)}','Hub One','${uuid(20)}'),('${uuid(11)}','Hub Two','${uuid(20)}'),('${uuid(12)}','Other Org','${uuid(21)}');
        INSERT INTO organization_memberships(user_id,organization_id,role) VALUES ('${uuid(1)}','${uuid(20)}','ops_super_admin');
        INSERT INTO property_memberships(user_id,property_id,role) VALUES ('${uuid(2)}','${uuid(10)}','tenant'),('${uuid(3)}','${uuid(11)}','property_admin');
        INSERT INTO meeting_rooms(id,property_id,name) VALUES ('${uuid(30)}','${uuid(10)}','Boardroom'),('${uuid(31)}','${uuid(11)}','Meeting Room');
        INSERT INTO meeting_room_slots(id,start_time,end_time) VALUES ('${uuid(40)}','10:00','11:00'),('${uuid(41)}','11:00','12:00'),('${uuid(42)}','10:30','11:30');
        INSERT INTO companies(id,property_id) VALUES ('${uuid(50)}','${uuid(10)}'),('${uuid(51)}','${uuid(11)}');
        INSERT INTO company_members VALUES ('${uuid(2)}','${uuid(50)}'),('${uuid(2)}','${uuid(51)}');
        INSERT INTO meeting_room_credits(id,property_id,company_id,remaining_hours) VALUES ('${uuid(60)}','${uuid(10)}','${uuid(50)}',2),('${uuid(61)}','${uuid(11)}','${uuid(51)}',9);
    `);
    return db;
}

test('migration and booking RPC enforce property scope, credits, idempotency, and overlap', async () => {
    const db = await database();
    try {
        const adminProps = await db.query('select id from whatsapp_assistant_properties($1)', [uuid(1)]);
        assert.equal(adminProps.rows.length, 2);
        const siteProps = await db.query('select id from whatsapp_assistant_properties($1)', [uuid(3)]);
        assert.deepEqual(siteProps.rows.map(row => row.id), [uuid(11)]);
        const book = (user, room, slot, request) => db.query('select whatsapp_assistant_book($1,$2,$3,$4,$5,$6) as booking', [uuid(user), uuid(10), uuid(room), uuid(slot), '2099-10-01', uuid(request)]);
        const first = await book(2, 30, 40, 100);
        const replay = await book(2, 30, 40, 100);
        assert.equal(first.rows[0].booking.id, replay.rows[0].booking.id);
        assert.equal(Number((await db.query('select remaining_hours from meeting_room_credits where id=$1', [uuid(60)])).rows[0].remaining_hours), 1);
        assert.equal(Number((await db.query('select remaining_hours from meeting_room_credits where id=$1', [uuid(61)])).rows[0].remaining_hours), 9);
        assert.equal((await db.query('select count(*)::int as n from meeting_room_credit_log')).rows[0].n, 1);
        await assert.rejects(book(1, 30, 42, 101), /SLOT_UNAVAILABLE/);
        await assert.rejects(db.query(`insert into meeting_room_bookings(meeting_room_id,property_id,user_id,booking_date,start_time,end_time,status) values ($1,$2,$3,'2099-10-01','10:15','10:45','confirmed')`, [uuid(30), uuid(10), uuid(1)]), /exclusion constraint/);
        await assert.rejects(book(3, 30, 41, 102), /No active access/);
        await assert.rejects(book(1, 31, 41, 103), /Room is not active/);
        await db.exec(`UPDATE meeting_room_credits SET remaining_hours = 0 WHERE id = '${uuid(60)}'`);
        await assert.rejects(book(2, 30, 41, 104), /INSUFFICIENT_CREDITS/);
        assert.equal((await db.query('select count(*)::int as n from meeting_room_bookings')).rows[0].n, 1);
        await db.exec(`UPDATE property_memberships SET is_active = false WHERE user_id = '${uuid(2)}'`);
        await assert.rejects(book(2, 30, 40, 100), /No active access/);
    } finally { await db.close(); }
});

test('production readiness SQL verifies the installed assistant and pilot migrations',async()=>{
    const db=await database();
    try {
        await db.exec(`CREATE TABLE organizations(id uuid PRIMARY KEY);
            CREATE TABLE conversation_context(id uuid); CREATE TABLE task_audit_logs(id uuid);
            CREATE SCHEMA auth; CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT NULL::uuid$$;`);
        await db.exec(await readFile(new URL('../supabase/migrations/20261005000002_whatsapp_llm_interpreter.sql',import.meta.url),'utf8'));
        const sql=await readFile(new URL('../docs/sql/whatsapp_llm_production_checks.sql',import.meta.url),'utf8');
        const ready=await db.query(sql);
        assert.equal(ready.rows.length,23);assert.deepEqual(ready.rows.filter(row=>!row.ready),[]);
        await db.exec(`DROP FUNCTION whatsapp_assistant_properties(uuid);
            ALTER TABLE tickets DROP CONSTRAINT tickets_wa_assistant_request_id_key;
            ALTER TABLE meeting_room_bookings DROP CONSTRAINT meeting_room_bookings_wa_assistant_request_id_key;
            ALTER TABLE meeting_room_bookings DROP CONSTRAINT meeting_room_no_overlap;
            ALTER TABLE tickets DROP COLUMN wa_assistant_input_hash;`);
        assert.deepEqual((await db.query(sql)).rows.filter(row=>!row.ready).map(row=>row.check_name),[
            'assistant property access RPC','booking idempotency uniqueness','booking overlap protection','ticket idempotency uniqueness','ticket immutable input']);
    } finally {await db.close();}
});

test('event RPCs deduplicate, serialize a sender, persist prompts, and expire sessions', async () => {
    const db = await database();
    try {
        const payload = { phone: '919876543210', messageId: 'w1', text: 'hi', mediaType: 'text' };
        const enqueue = () => db.query('select whatsapp_assistant_enqueue($1) as id', [payload]);
        const id = (await enqueue()).rows[0].id;
        assert.equal((await enqueue()).rows[0].id, null);
        const claim = async token => (await db.query('select whatsapp_assistant_claim($1,$2) as event', [payload.phone, token])).rows[0].event;
        const event = await claim(uuid(200));
        assert.equal(event.id, id);
        assert.equal(await claim(uuid(201)), null);
        await db.query('select whatsapp_assistant_save($1,$2,$3,$4)', [id, uuid(200), { id, step: 'menu' }, { key: 'menu', params: [] }]);
        await assert.rejects(db.query('select whatsapp_assistant_finish($1,$2,null)', [id, uuid(201)]), /lease lost/);
        await db.query('select whatsapp_assistant_finish($1,$2,$3)', [id, uuid(200), 'provider temporarily unavailable']);
        const retry = await claim(uuid(202));
        assert.deepEqual(retry.reply, { key: 'menu', params: [] });
        assert.equal(retry.snapshot, null);
        await db.exec(`UPDATE whatsapp_assistant_sessions SET expires_at = now() - interval '21 minutes'`);
        await db.query('select whatsapp_assistant_finish($1,$2,null)', [id, uuid(202)]);
        assert.equal((await db.query('select expires_at > now() as active from whatsapp_assistant_sessions')).rows[0].active, true);
        assert.equal(await claim(uuid(203)), null);
        await db.exec(`UPDATE whatsapp_assistant_sessions SET expires_at = now() - interval '1 minute'`);
        await db.query('select whatsapp_assistant_enqueue($1)', [{ ...payload, messageId: 'w2' }]);
        assert.equal((await claim(uuid(204))).snapshot, null);
        const grants = await db.query("select has_function_privilege('authenticated','whatsapp_assistant_book(uuid,uuid,uuid,uuid,date,uuid)','EXECUTE') as allowed");
        assert.equal(grants.rows[0].allowed, false);
    } finally { await db.close(); }
});


test('permanent reply failure releases the sender for the next greeting and requires its lease', async () => {
    const db = await database();
    try {
        const phone = '919876543210';
        const first = (await db.query('select whatsapp_assistant_enqueue($1) as id', [{ phone, messageId: 'missing-template', text: 'Create Ticket' }])).rows[0].id;
        const second = (await db.query('select whatsapp_assistant_enqueue($1) as id', [{ phone, messageId: 'new-hi', text: 'Hi' }])).rows[0].id;
        await db.query('select whatsapp_assistant_claim($1,$2)', [phone, uuid(300)]);
        await db.query('select whatsapp_assistant_save($1,$2,$3,$4)', [first, uuid(300), { step: 'property' }, { key: 'select', params: [] }]);
        await assert.rejects(db.query('select whatsapp_assistant_fail($1,$2,$3)', [first, uuid(301), 'Campaign not found']), /lease lost/);
        await db.query('select whatsapp_assistant_fail($1,$2,$3)', [first, uuid(300), 'Campaign not found']);
        assert.equal((await db.query('select status from whatsapp_assistant_events where id=$1', [first])).rows[0].status, 'failed');
        assert.equal((await db.query('select whatsapp_assistant_claim($1,$2) as event', [phone, uuid(302)])).rows[0].event.id, second);
        assert.equal((await db.query("select has_function_privilege('authenticated','whatsapp_assistant_fail(uuid,uuid,text)','EXECUTE') as allowed")).rows[0].allowed, false);
    } finally { await db.close(); }
});

test('natural time-range booking is atomic, scoped, idempotent and covered by configured slots', async () => {
    const db = await database();
    try {
        const book = (user, start, end, request, room = 30) => db.query('select whatsapp_assistant_book_range($1,$2,$3,$4,$5,$6,$7) as booking',
            [uuid(user), uuid(10), uuid(room), '2099-10-01', start, end, uuid(request)]);
        const first = (await book(2, '10:30', '11:30', 400)).rows[0].booking;
        assert.equal(first.start_time, '10:30:00');
        assert.equal((await book(2, '10:30', '11:30', 400)).rows[0].booking.id, first.id);
        assert.equal(Number((await db.query('select remaining_hours from meeting_room_credits where id=$1', [uuid(60)])).rows[0].remaining_hours), 1);
        await assert.rejects(book(2, '11:00', '12:00', 401), /SLOT_UNAVAILABLE/);
        await assert.rejects(book(3, '11:30', '12:00', 402), /No active access/);
        await assert.rejects(book(2, '11:30', '12:00', 403, 31), /Room is not active/);
        await assert.rejects(book(2, '12:00', '13:00', 404), /Outside configured booking slots/);
        await assert.rejects(book(2, '11:00', '10:00', 405), /Invalid or past interval/);
        await db.exec(`update meeting_room_credits set remaining_hours=0 where id='${uuid(60)}'`);
        await assert.rejects(book(2, '11:30', '12:00', 406), /INSUFFICIENT_CREDITS/);
        assert.equal((await db.query('select count(*)::int as n from meeting_room_bookings')).rows[0].n, 1);
        assert.equal((await db.query("select has_function_privilege('authenticated','whatsapp_assistant_book_range(uuid,uuid,uuid,date,time,time,uuid)','EXECUTE') as allowed")).rows[0].allowed, false);
    } finally { await db.close(); }
});
test('WhatsApp bookings charge only tenant roles at the selected property, never staff or admins',async()=>{
    const db=await database();
    try {
        const book=(user,request,range=false)=>range
            ? db.query('select whatsapp_assistant_book_range($1,$2,$3,$4,$5,$6,$7) as booking',[uuid(user),uuid(10),uuid(30),'2099-10-02','10:00','11:00',uuid(request)])
            : db.query('select whatsapp_assistant_book($1,$2,$3,$4,$5,$6) as booking',[uuid(user),uuid(10),uuid(30),uuid(40),'2099-10-01',uuid(request)]);
        await db.exec(`INSERT INTO company_members VALUES('${uuid(1)}','${uuid(50)}'); UPDATE meeting_room_credits SET remaining_hours=0 WHERE id='${uuid(60)}';`);
        assert.ok((await book(1,700)).rows[0].booking.id,'admin ignores even an existing company credit allocation');
        assert.ok((await book(1,701,true)).rows[0].booking.id);
        assert.equal((await db.query('select count(*)::int as n from meeting_room_credit_log')).rows[0].n,0);
        await db.exec(`UPDATE meeting_room_credits SET remaining_hours=2 WHERE id='${uuid(60)}';
            UPDATE property_memberships SET role='staff' WHERE user_id='${uuid(2)}';`);
        assert.ok((await db.query('select whatsapp_assistant_book_range($1,$2,$3,$4,$5,$6,$7) as booking',[uuid(2),uuid(10),uuid(30),'2099-10-03','10:00','11:00',uuid(702)])).rows[0].booking.id);
        assert.equal(Number((await db.query('select remaining_hours from meeting_room_credits where id=$1',[uuid(60)])).rows[0].remaining_hours),2);
        assert.equal((await db.query('select count(*)::int as n from meeting_room_credit_log')).rows[0].n,0);
    } finally {await db.close();}
});
test('tenant bookings without an allocation are rejected; tenant role in another property does not charge admins',async()=>{
    const db=await database();
    try {
        await db.exec(`DELETE FROM meeting_room_credits WHERE id='${uuid(60)}';`);
        await assert.rejects(db.query('select whatsapp_assistant_book($1,$2,$3,$4,$5,$6)',[uuid(2),uuid(10),uuid(30),uuid(40),'2099-10-01',uuid(710)]),/INSUFFICIENT_CREDITS/);
        await assert.rejects(db.query('select whatsapp_assistant_book_range($1,$2,$3,$4,$5,$6,$7)',[uuid(2),uuid(10),uuid(30),'2099-10-02','10:00','11:00',uuid(711)]),/INSUFFICIENT_CREDITS/);
        await db.exec(`INSERT INTO property_memberships VALUES('${uuid(3)}','${uuid(10)}','tenant',true);`);
        assert.ok((await db.query('select whatsapp_assistant_book_range($1,$2,$3,$4,$5,$6,$7) as booking',[uuid(3),uuid(11),uuid(31),'2099-10-02','10:00','11:00',uuid(712)])).rows[0].booking.id);
        assert.equal((await db.query('select count(*)::int as n from meeting_room_credit_log')).rows[0].n,0);
    } finally {await db.close();}
});
test('tenant credit policy respects selected-property roles and active org admin overrides; migration is repeatable',async()=>{
    const db=await database();
    try {
        const requires=async(user,property=10)=>(await db.query('select whatsapp_assistant_requires_credits($1,$2) as required',[uuid(user),uuid(property)])).rows[0].required;
        assert.equal(await requires(2),true);assert.equal(await requires(2,11),false);
        for(const role of ['super_tenant','tenant_user']) {
            await db.query('update property_memberships set role=$1 where user_id=$2',[role,uuid(2)]);assert.equal(await requires(2),true);
        }
        await db.exec(`INSERT INTO organization_memberships VALUES('${uuid(2)}','${uuid(21)}','org_super_admin',true);`);
        assert.equal(await requires(2),true,'org admin in another organization does not waive tenant charges');
        await db.exec(`INSERT INTO organization_memberships VALUES('${uuid(2)}','${uuid(20)}','org_super_admin',true);`);
        assert.equal(await requires(2),false);
        await db.exec(`UPDATE organization_memberships SET is_active=false WHERE user_id='${uuid(2)}' AND organization_id='${uuid(20)}';`);
        assert.equal(await requires(2),true);
        await db.exec(`UPDATE users SET is_master_admin=true WHERE id='${uuid(2)}';`);assert.equal(await requires(2),false);
        await db.exec(await readFile(new URL('../supabase/migrations/20261006000001_whatsapp_tenant_booking_credits.sql',import.meta.url),'utf8'));
        assert.equal(Number((await db.query('select remaining_hours from meeting_room_credits where id=$1',[uuid(60)])).rows[0].remaining_hours),2);
        assert.equal((await db.query("select has_function_privilege('authenticated','whatsapp_assistant_requires_credits(uuid,uuid)','EXECUTE') as allowed")).rows[0].allowed,false);
    } finally {await db.close();}
});

test('booking purpose is inserted atomically, remains optional, and cannot be overwritten on retry',async()=>{
    const db=await database();
    try {
        await db.exec('CREATE TABLE event_outbox(event_type text,entity_id uuid,payload jsonb);');
        const outboxSql=await readFile(new URL('../supabase/migrations/20260822000002_master_all_outbox_triggers.sql',import.meta.url),'utf8');
        await db.exec(outboxSql.slice(outboxSql.indexOf('CREATE OR REPLACE FUNCTION public.fn_meeting_room_bookings_outbox()'),outboxSql.indexOf('DROP TRIGGER IF EXISTS tr_meeting_room_outbox_insert')));
        await db.exec('CREATE TRIGGER booking_outbox AFTER INSERT OR UPDATE OR DELETE ON meeting_room_bookings FOR EACH ROW EXECUTE FUNCTION fn_meeting_room_bookings_outbox();');
        const book=async(purpose,request=800,date='2099-10-05')=>(await db.query('select whatsapp_assistant_book_range($1,$2,$3,$4,$5,$6,$7,$8) as booking',
            [uuid(2),uuid(10),uuid(30),date,'10:00','11:00',uuid(request),purpose])).rows[0].booking;
        const first=await book('tech team');assert.equal(first.comment,'tech team');
        assert.equal((await db.query('select payload from event_outbox')).rows[0].payload.comment,'tech team');
        assert.equal((await book('tech team')).id,first.id);
        await assert.rejects(book('BD'),/OPERATION_ALREADY_CREATED/);
        await assert.rejects(book(null),/OPERATION_ALREADY_CREATED/);
        assert.equal((await db.query('select comment from meeting_room_bookings where id=$1',[first.id])).rows[0].comment,'tech team');
        assert.equal((await db.query('select count(*)::int as n from meeting_room_credit_log')).rows[0].n,1);
        assert.equal(Number((await db.query('select remaining_hours from meeting_room_credits where id=$1',[uuid(60)])).rows[0].remaining_hours),1);
        const empty=await book(null,801,'2099-10-06');assert.equal(empty.comment,null);
        await assert.rejects(book('x'.repeat(501),802,'2099-10-07'),/Invalid booking purpose/);
        assert.equal((await db.query('select count(*)::int as n from meeting_room_bookings')).rows[0].n,2);
        assert.equal((await db.query('select count(*)::int as n from event_outbox')).rows[0].n,2);
        await db.exec(await readFile(new URL('../supabase/migrations/20261006000002_whatsapp_booking_purpose.sql',import.meta.url),'utf8'));
        assert.equal((await db.query('select comment from meeting_room_bookings where id=$1',[first.id])).rows[0].comment,'tech team');
        assert.equal((await db.query("select has_function_privilege('authenticated','whatsapp_assistant_book_range(uuid,uuid,uuid,date,time,time,uuid,text)','EXECUTE') as allowed")).rows[0].allowed,false);
    } finally {await db.close();}
});

test('legacy seven-argument retries survive the notes migration without rewriting an old comment',async()=>{
    const db=await database(false);
    try {
        const args=[uuid(2),uuid(10),uuid(30),'2099-10-05','10:00','11:00',uuid(900)];
        const book=async values=>(await db.query('select whatsapp_assistant_book_range($1,$2,$3,$4,$5,$6,$7) as booking',values)).rows[0].booking;
        const first=await book(args);assert.equal(first.comment,'Booked via Autopilot WhatsApp');
        await db.exec(await readFile(new URL('../supabase/migrations/20261006000002_whatsapp_booking_purpose.sql',import.meta.url),'utf8'));
        const retry=await book(args);assert.equal(retry.id,first.id);assert.equal(retry.comment,first.comment);
        await assert.rejects(book(args.map((value,index)=>index===4?'10:30':value)),/OPERATION_ALREADY_CREATED/);
        assert.equal((await db.query('select count(*)::int as n from meeting_room_credit_log')).rows[0].n,1);
        const fresh=await book(args.map((value,index)=>index===3?'2099-10-06':index===6?uuid(901):value));assert.equal(fresh.comment,null);
    } finally {await db.close();}
});
