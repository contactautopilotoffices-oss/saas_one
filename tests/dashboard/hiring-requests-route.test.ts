import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NextRequest } from 'next/server';
import { proxy } from '../../proxy';

test('Hiring requests has a clean URL and client navigation keeps its explicit organisation', async t => {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    t.after(() => { if (supabaseUrl !== undefined) process.env.NEXT_PUBLIC_SUPABASE_URL = supabaseUrl; });
    const org = '00000000-0000-0000-0000-000000000001';
    const url = `https://app.test/${org}/hiring-requests?check=1`;
    const fullRequest = await proxy(new NextRequest(url));
    assert.equal(fullRequest.headers.get('location'), 'https://app.test/hiring-requests?check=1');
    assert.equal(fullRequest.cookies.get('saas_org_id')?.value, org);

    const clientRequest = await proxy(new NextRequest(url, { headers: { rsc: '1' } }));
    assert.equal(clientRequest.headers.get('location'), null);
    assert.equal(clientRequest.headers.get('x-middleware-rewrite'), null);
});
