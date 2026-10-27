import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const ORG = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PROP = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const USER = '11111111-1111-4111-8111-111111111111';
const REQ = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const CAT_A = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1';
const CAT_B = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2';
const KEY_1 = 'ffffffff-ffff-4fff-8fff-fffffffffff1';
const KEY_2 = 'ffffffff-ffff-4fff-8fff-fffffffffff2';
const KEY_3 = 'ffffffff-ffff-4fff-8fff-fffffffffff3';

// The parts of the live schema the migration builds on (stock_reports_module,
// stock_decimal_quantity, stock_movements_preserve_on_delete, barcode support).
const BASE_SCHEMA = `
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT current_setting('test.user_id', true)::uuid $$;
    -- Supabase's auth.role() reads the request JWT; here a session setting stands in for it.
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT nullif(current_setting('test.role', true), '') $$;
    -- Like Supabase: new functions in public are executable by anon and authenticated
    -- unless a migration revokes it explicitly.
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated;
    CREATE FUNCTION public.is_master_admin_v2() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
    CREATE FUNCTION public.is_org_admin_v2(uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
    CREATE FUNCTION public.is_property_member_v2(uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
    CREATE TABLE users(id uuid PRIMARY KEY);
    CREATE TABLE organizations(id uuid PRIMARY KEY);
    CREATE TABLE properties(id uuid PRIMARY KEY, organization_id uuid, code text);
    CREATE TABLE procurement_catalog(id uuid PRIMARY KEY, organization_id uuid, name text);
    CREATE TABLE property_monthly_requisitions(id uuid PRIMARY KEY, organization_id uuid, property_id uuid, status varchar(50), notes text);
    CREATE TABLE stock_items(
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), property_id uuid NOT NULL, organization_id uuid NOT NULL,
        item_code text NOT NULL, name text NOT NULL, category text, unit text DEFAULT 'units',
        quantity numeric NOT NULL DEFAULT 0, catalog_item_id uuid REFERENCES procurement_catalog(id), barcode text,
        updated_at timestamptz DEFAULT now(), UNIQUE(property_id, item_code));
    CREATE TABLE stock_movements(
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), item_id uuid REFERENCES stock_items(id) ON DELETE SET NULL,
        property_id uuid NOT NULL, organization_id uuid NOT NULL,
        action text NOT NULL CHECK (action IN ('add', 'remove', 'adjust', 'initial')),
        quantity_change numeric NOT NULL, quantity_before numeric NOT NULL, quantity_after numeric NOT NULL,
        user_id uuid, notes text, created_at timestamptz DEFAULT now());
    INSERT INTO users VALUES ('${USER}');
    INSERT INTO organizations VALUES ('${ORG}');
    INSERT INTO properties VALUES ('${PROP}', '${ORG}', 'SSP');
    INSERT INTO procurement_catalog VALUES ('${CAT_A}', '${ORG}', 'Bleach 5 Ltr'), ('${CAT_B}', '${ORG}', 'Toilet Roll');
    INSERT INTO property_monthly_requisitions VALUES ('${REQ}', '${ORG}', '${PROP}', 'approved', '{}');
    -- An old stock row that predates the switch, already linked by the removed name sync.
    INSERT INTO stock_items(property_id, organization_id, item_code, name, quantity, catalog_item_id)
        VALUES ('${PROP}', '${ORG}', 'OLD-1', 'Bleach 5L', 40, '${CAT_A}');
`;

const migrations = ['20261026100001_stock_from_requisition.sql', '20261026100002_stock_list_guards.sql'];
async function migrate(db) {
    for (const file of migrations) {
        await db.exec(await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8'));
    }
}

const confirm = (key, lines, extra = {}) => ({
    sql: `SELECT public.confirm_requisition_delivery($1, $2, $3, $4, $5, $6, $7, $8::jsonb) AS d`,
    params: [USER, extra.requisition || REQ, extra.number || 'DC-1', '2026-10-26', extra.file ?? 'https://files/dc.pdf', 'dc.pdf', key, JSON.stringify(lines)],
});

const line = (catalog, ordered, received) => ({ catalog_item_id: catalog, item_name: catalog === CAT_A ? 'Bleach 5 Ltr' : 'Toilet Roll', unit: 'pcs', ordered_qty: ordered, received_qty: received });

test('delivery challans add to requisition-item stock only, once, and never past what was ordered', async () => {
    const db = new PGlite();
    try {
        await db.exec(BASE_SCHEMA);
        await migrate(db);

        // Existing rows become the old list; nothing about them changes.
        const old = (await db.query(`SELECT item_source, quantity FROM stock_items WHERE item_code = 'OLD-1'`)).rows[0];
        assert.equal(old.item_source, 'legacy');
        assert.equal(Number(old.quantity), 40);

        // Requisition-item rows sit next to the old row with the same catalog id without clashing.
        await db.exec(`INSERT INTO stock_items(property_id, organization_id, item_code, name, catalog_item_id, item_source)
            VALUES ('${PROP}', '${ORG}', 'REQ-A', 'Bleach 5 Ltr', '${CAT_A}', 'catalog'),
                   ('${PROP}', '${ORG}', 'REQ-B', 'Toilet Roll', '${CAT_B}', 'catalog')`);
        await assert.rejects(
            db.exec(`INSERT INTO stock_items(property_id, organization_id, item_code, name, catalog_item_id, item_source)
                VALUES ('${PROP}', '${ORG}', 'REQ-A2', 'Bleach again', '${CAT_A}', 'catalog')`),
            /uq_stock_items_catalog_per_property/
        );
        await assert.rejects(
            db.exec(`UPDATE stock_items SET item_source = 'other' WHERE item_code = 'REQ-A'`),
            /stock_items_item_source_check/
        );

        // Only the service role (the API) can post a challan, despite Supabase's default grants.
        for (const role of ['authenticated', 'anon']) {
            await db.exec(`SET ROLE ${role}`);
            const c0 = confirm(KEY_1, [line(CAT_A, 10, 6)]);
            await assert.rejects(db.query(c0.sql, c0.params), /permission denied/, `${role} must not run the challan function`);
            await db.exec('RESET ROLE');
        }
        await db.exec(`SET test.role = 'service_role'`);

        // First challan: 6 of 10 bleach, 0 toilet roll.
        const c1 = confirm(KEY_1, [line(CAT_A, 10, 6), line(CAT_B, 5, 0)]);
        const first = (await db.query(c1.sql, c1.params)).rows[0].d;
        assert.equal(first.total_items, 1);
        assert.equal(Number(first.total_qty), 6);

        const qty = async code => Number((await db.query(`SELECT quantity FROM stock_items WHERE item_code = $1`, [code])).rows[0].quantity);
        assert.equal(await qty('REQ-A'), 6);
        assert.equal(await qty('OLD-1'), 40, 'The old row must never be touched');

        const mv = (await db.query(`SELECT action, quantity_before, quantity_after, delivery_id FROM stock_movements`)).rows;
        assert.equal(mv.length, 1);
        assert.equal(mv[0].action, 'add');
        assert.equal(Number(mv[0].quantity_before), 0);
        assert.equal(Number(mv[0].quantity_after), 6);
        assert.equal(mv[0].delivery_id, first.id);

        // Same submit again (double click / retry): same challan back, nothing added.
        const again = (await db.query(c1.sql, c1.params)).rows[0].d;
        assert.equal(again.id, first.id);
        assert.equal(await qty('REQ-A'), 6);

        // More than is still pending is refused, and nothing from that challan is kept.
        const c2 = confirm(KEY_2, [line(CAT_B, 5, 5), line(CAT_A, 10, 5)], { number: 'DC-2' });
        await assert.rejects(db.query(c2.sql, c2.params), /more than what is pending \(4\)/);
        assert.equal(await qty('REQ-B'), 0, 'A failed challan must roll back every line');
        assert.equal((await db.query(`SELECT count(*)::int AS n FROM requisition_deliveries`)).rows[0].n, 1);

        // The rest arrives on a second challan.
        const c3 = confirm(KEY_2, [line(CAT_A, 10, 4), line(CAT_B, 5, 5)], { number: 'DC-2' });
        await db.query(c3.sql, c3.params);
        assert.equal(await qty('REQ-A'), 10);
        assert.equal(await qty('REQ-B'), 5);

        // Listing the same item twice on one challan cannot sneak past the limit.
        await db.exec(`UPDATE property_monthly_requisitions SET status = 'ordered'`);
        const c4 = confirm(KEY_3, [line(CAT_A, 12, 1), line(CAT_A, 12, 2)], { number: 'DC-3' });
        await assert.rejects(db.query(c4.sql, c4.params), /more than what is pending \(1\)/);

        // Not approved, no file, no quantities: refused.
        await db.exec(`UPDATE property_monthly_requisitions SET status = 'pending_approval'`);
        const c5 = confirm(KEY_3, [line(CAT_A, 20, 1)]);
        await assert.rejects(db.query(c5.sql, c5.params), /not approved/);
        await db.exec(`UPDATE property_monthly_requisitions SET status = 'approved'`);
        const c6 = confirm(KEY_3, [line(CAT_A, 20, 1)], { file: '' });
        await assert.rejects(db.query(c6.sql, c6.params), /Challan file is required/);
        const c7 = confirm(KEY_3, [line(CAT_A, 20, 0)]);
        await assert.rejects(db.query(c7.sql, c7.params), /at least one item/);

        // A catalog item without a requisition-list stock row is refused, not guessed.
        await db.exec(`DELETE FROM stock_items WHERE item_code = 'REQ-B'`);
        const c8 = confirm(KEY_3, [line(CAT_B, 9, 1)]);
        await assert.rejects(db.query(c8.sql, c8.params), /Stock item missing/);

        // Running the migrations a second time is harmless.
        await db.exec(`SET test.role = ''`);
        await migrate(db);
        assert.equal(await qty('REQ-A'), 10);
    } finally { await db.close(); }
});

test('browser writes cannot break the stock list rules; server writes are unaffected', async () => {
    const db = new PGlite();
    try {
        await db.exec(BASE_SCHEMA);
        await migrate(db);
        await db.exec(`INSERT INTO stock_items(property_id, organization_id, item_code, name, catalog_item_id, item_source, quantity)
            VALUES ('${PROP}', '${ORG}', 'REQ-A', 'Bleach 5 Ltr', '${CAT_A}', 'catalog', 5)`);

        const asUser = sql => db.exec(`SET test.role = 'authenticated'; ${sql}; SET test.role = ''`)
            .catch(async e => { await db.exec(`SET test.role = ''`); throw e; });
        const qty = async code => Number((await db.query(`SELECT quantity FROM stock_items WHERE item_code = $1`, [code])).rows[0].quantity);

        // Property still on its old list: the old list works as before.
        await asUser(`UPDATE stock_items SET quantity = 41 WHERE item_code = 'OLD-1'`);
        assert.equal(await qty('OLD-1'), 41);
        await asUser(`INSERT INTO stock_items(property_id, organization_id, item_code, name) VALUES ('${PROP}', '${ORG}', 'OLD-2', 'Broom')`);
        await asUser(`DELETE FROM stock_items WHERE item_code = 'OLD-2'`);
        await assert.rejects(
            asUser(`INSERT INTO stock_items(property_id, organization_id, item_code, name, item_source) VALUES ('${PROP}', '${ORG}', 'X', 'X', 'catalog')`),
            /added automatically/
        );
        await assert.rejects(asUser(`UPDATE stock_items SET quantity = 9 WHERE item_code = 'REQ-A'`), /no longer uses/);

        // Switch the property to requisition items.
        await db.exec(`INSERT INTO property_stock_settings(property_id, organization_id, item_source) VALUES ('${PROP}', '${ORG}', 'catalog')`);

        await asUser(`UPDATE stock_items SET quantity = 7 WHERE item_code = 'REQ-A'`);
        assert.equal(await qty('REQ-A'), 7, 'Counting requisition items still works from the browser');
        await assert.rejects(asUser(`UPDATE stock_items SET quantity = 0 WHERE item_code = 'OLD-1'`), /no longer uses/);
        await assert.rejects(asUser(`DELETE FROM stock_items WHERE item_code = 'OLD-1'`), /no longer uses/);
        await assert.rejects(asUser(`UPDATE stock_items SET name = 'Renamed' WHERE item_code = 'REQ-A'`), /come from Manage Items/);
        await assert.rejects(asUser(`UPDATE stock_items SET unit = 'kg' WHERE item_code = 'REQ-A'`), /come from Manage Items/);
        await assert.rejects(asUser(`UPDATE stock_items SET catalog_item_id = '${CAT_B}' WHERE item_code = 'REQ-A'`), /cannot be moved/);
        await assert.rejects(asUser(`UPDATE stock_items SET item_source = 'legacy' WHERE item_code = 'REQ-A'`), /cannot be moved/);
        await assert.rejects(asUser(`DELETE FROM stock_items WHERE item_code = 'REQ-A'`), /cannot be deleted/);
        await assert.rejects(
            asUser(`INSERT INTO stock_items(property_id, organization_id, item_code, name) VALUES ('${PROP}', '${ORG}', 'OLD-3', 'Mop')`),
            /cannot be added here/
        );
        assert.equal(await qty('OLD-1'), 41, 'Old stock is untouched');

        // Server-side writes (service role, SQL editor) are not restricted.
        await db.exec(`SET test.role = 'service_role'; UPDATE stock_items SET name = 'Bleach Chemical 5 Ltr' WHERE item_code = 'REQ-A'; SET test.role = ''`);
        await db.exec(`UPDATE stock_items SET quantity = 40 WHERE item_code = 'OLD-1'`);
        assert.equal(await qty('OLD-1'), 40);
    } finally { await db.close(); }
});
