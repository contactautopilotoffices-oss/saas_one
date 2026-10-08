import test from 'node:test';
import assert from 'node:assert/strict';
import { id, setup, call, create, paid } from './database.mjs';

for (const enumRoles of [true, false]) {
    test(`petty cash installs and preserves role authorization with ${enumRoles ? 'enum' : 'text'} memberships`, async () => {
        const db = await setup({ enumRoles });
        try {
            await db.query('insert into organization_memberships(user_id,organization_id,role) values ($1,$2,null)', [id(19), id(1)]);
            assert.equal(await call(db, 'pc_internal', [id(19), id(1)]), false);
            assert.equal(await call(db, 'pc_internal', [id(15), id(1), id(3)]), false);
            assert.equal(await call(db, 'pc_super', [id(10), id(1)]), true);
            assert.equal(await call(db, 'pc_finance', [id(14), id(1), id(3)]), true);
            await assert.rejects(call(db, 'pc_configure', [id(10), id(3), id(15), id(13)]), /eligible/i);
            const request = await paid(db);
            assert.equal(request.status, 'paid');
            assert.equal(Number((await call(db, 'pc_wallet', [id(11), id(1)])).balance), 100);
            await assert.rejects(create(db), /balance/i);
        } finally {
            await db.close();
        }
    });
}
