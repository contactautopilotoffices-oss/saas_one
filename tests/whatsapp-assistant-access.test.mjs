import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { canonicalPhone } from '../backend/lib/whatsapp/assistant/protocol.mjs';
import { PGlite } from '@electric-sql/pglite';

const source = await readFile(new URL('../backend/lib/whatsapp/assistant/access.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

function access(errorCode = 'PGRST202') {
    const tables = {
        users: [{ id: 'u1', is_approved: true }, { id: 'u2', is_approved: true }, { id: 'u3', is_approved: false }],
        organization_memberships: [{ user_id: 'u1', organization_id: 'o1', role: 'ops_super_admin', is_active: true }],
        property_memberships: [{ user_id: 'u2', property_id: 'p1', is_active: true }, { user_id: 'u2', property_id: 'p2', is_active: true }],
        properties: [
            { id: 'p1', name: 'Hub One', organization_id: 'o1', is_active: true },
            { id: 'p2', name: 'Hub Two', organization_id: 'o1', is_active: true },
            { id: 'p3', name: 'Other Org', organization_id: 'o2', is_active: true },
            { id: 'p4', name: 'Inactive', organization_id: 'o1', is_active: false },
        ],
    };
    const db = {
        rpc: async () => ({ data: null, error: { code: errorCode, message: 'RPC error' } }),
        from(table) {
            let rows = tables[table];
            return {
                select() { return this; },
                eq(key, value) { rows = rows.filter(row => row[key] === value); return this; },
                in(key, values) { rows = rows.filter(row => values.includes(row[key])); return this; },
                order() { return this; },
                maybeSingle: async () => ({ data: rows[0] || null, error: null }),
                then(resolve, reject) { return Promise.resolve({ data: rows, error: null }).then(resolve, reject); },
            };
        },
    };
    const exports = {};
    vm.runInNewContext(compiled, { exports, Map,
        require: name => name.endsWith('/admin') ? { supabaseAdmin: db } : { canonicalPhone },
    });
    return exports;
}

test('legacy fallback preserves scoped ops and multiple property-admin memberships', async () => {
    const resolver = access();
    assert.deepEqual(Array.from(await resolver.getWhatsAppProperties('u1', true), row => row.id), ['p1','p2']);
    assert.deepEqual(Array.from(await resolver.getWhatsAppProperties('u2', true), row => row.id), ['p1','p2']);
    assert.equal((await resolver.getWhatsAppProperties('u3', true)).length, 0);
});

test('assistant requires its migration and legacy fallback never masks network failures', async () => {
    await assert.rejects(access().getWhatsAppProperties('u1'), error => error.code === 'PGRST202');
    await assert.rejects(access('NETWORK_ERROR').getWhatsAppProperties('u1', true), error => error.code === 'NETWORK_ERROR');
});

test('approved phone lookup handles stored formatting and still rejects duplicates and different numbers',async()=>{
    const db=new PGlite();
    try {
        await db.exec('CREATE TABLE users(id text,phone text,is_approved boolean,approval_status text);');
        await db.query('INSERT INTO users VALUES ($1,$2,true,$3)',['u1','+91 70282 32515','approved']);
        const admin={from:()=>({select(){return this;},async or(expression){
            const terms=expression.split(',');const exact=terms.find(term=>term.startsWith('phone.eq.'))?.slice('phone.eq.'.length);
            const pattern=terms.find(term=>term.startsWith('phone.ilike.'))?.slice('phone.ilike.'.length);
            return {data:(await db.query('SELECT * FROM users WHERE phone=$1 OR phone ILIKE $2',[exact,pattern])).rows,error:null};
        }})};
        const exports={};vm.runInNewContext(compiled,{exports,require:name=>name.endsWith('/admin')?{supabaseAdmin:admin}:{canonicalPhone}});
        for(const phone of ['+91 70282 32515','70282-32515','+917028232515 ']) {
            await db.query('UPDATE users SET phone=$1',[phone]);
            assert.equal((await exports.findWhatsAppUser('917028232515'))?.id,'u1');
        }
        await db.query('INSERT INTO users VALUES ($1,$2,true,$3)',['duplicate','7028232515','approved']);
        assert.equal(await exports.findWhatsAppUser('917028232515'),null);
        await db.exec("DELETE FROM users WHERE id='duplicate';UPDATE users SET phone='17028232515';");
        assert.equal(await exports.findWhatsAppUser('917028232515'),null);
        await db.exec("UPDATE users SET phone='7028232515',is_approved=false,approval_status='pending';");
        assert.equal(await exports.findWhatsAppUser('917028232515'),null);
    } finally {await db.close();}
});
