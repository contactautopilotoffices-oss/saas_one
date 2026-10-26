import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import React from 'react';
import ts from 'typescript';
import * as draftHelpers from '../frontend/lib/requisitionDrafts.ts';

const require = createRequire(import.meta.url);
const { create, act } = require(process.env.REACT_TEST_RENDERER_PATH || 'react-test-renderer');
const source = await readFile(new URL('../frontend/hooks/useRequisitionDraft.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const hookModule = { exports: {} };
new Function('require', 'module', 'exports', compiled)(name => name === 'react' ? React : draftHelpers, hookModule, hookModule.exports);
const { useRequisitionDraft } = hookModule.exports;

const initial = { month: 10, year: 2026, floorTag: 'All Floors', siteNotes: '', items: [] };

test('autosave preserves edits with existing free-text catalog categories and restores them from the cloud', async () => {
    const previous = { fetch: globalThis.fetch, storage: globalThis.localStorage, act: globalThis.IS_REACT_ACT_ENVIRONMENT };
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    const values = new Map();
    globalThis.localStorage = { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value) };
    const catalog = { ...initial, items: [{ id: 'cat-existing', category: 'Custom', name: 'Soap', brand: '', details: '',
        requested_qty: 0, available_stock_qty: 0, unit: 'Piece', unit_price: 5 }] };
    let saved;
    globalThis.fetch = async (_url, options = {}) => {
        if (options.method === 'PUT') {
            const parsed = draftHelpers.draftSchema.safeParse(JSON.parse(options.body).payload);
            if (!parsed.success) return Response.json({ error: 'Invalid draft data' }, { status: 400 });
            saved = { payload: parsed.data, updated_at: '2026-10-05T12:00:00.000Z' };
            return Response.json({ draft: saved });
        }
        return Response.json({ drafts: saved ? [saved] : [] });
    };
    let controls;
    function Harness({ month = 10 }) {
        const [payload, setPayload] = React.useState({ ...catalog, month });
        const onRestore = React.useCallback(value => setPayload(value), []);
        controls = { ...useRequisitionDraft({ userId: 'u1', orgId: 'o1', propertyId: 'p1', ready: true, payload, onRestore }), payload, setPayload };
        return null;
    }
    let tree;
    try {
        await act(async () => { tree = create(React.createElement(Harness)); });
        const edited = { ...catalog, items: [{ ...catalog.items[0], requested_qty: 12, available_stock_qty: 3 }] };
        await act(async () => { controls.setPayload(edited); });
        await act(async () => { await new Promise(resolve => setTimeout(resolve, 900)); });
        assert.deepEqual(saved?.payload, edited, 'Typing quantities must save automatically with real catalog metadata');
        assert.match(controls.status, /Draft saved at/);
        await act(async () => { tree.unmount(); });
        values.clear(); // Simulate returning on another browser after logout, without its local backup.
        await act(async () => { tree = create(React.createElement(Harness, { month: 11 })); });
        assert.deepEqual(controls.payload, edited, 'Returning in November must restore October from the cloud with the original category and quantities');
        assert.equal(controls.drafts.length, 1);
    } finally {
        if (tree) await act(async () => { tree.unmount(); });
        globalThis.fetch = previous.fetch;
        if (previous.storage === undefined) delete globalThis.localStorage; else globalThis.localStorage = previous.storage;
        globalThis.IS_REACT_ACT_ENVIRONMENT = previous.act;
    }
});

test('actual draft hook restores unsaved browser edits after leaving and saves changes online', async () => {
    const previous = { fetch: globalThis.fetch, storage: globalThis.localStorage, act: globalThis.IS_REACT_ACT_ENVIRONMENT };
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    const values = new Map();
    globalThis.localStorage = { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value) };
    const online = new Map();
    let writes = 0;
    globalThis.fetch = async (_url, options = {}) => {
        if (options.method === 'PUT') {
            writes++;
            const body = JSON.parse(options.body);
            const draft = { payload: body.payload, updated_at: '2026-10-05T12:00:00.000Z' };
            online.set(draftHelpers.draftPeriodKey(body.payload), draft);
            return Response.json({ draft });
        }
        if (options.method === 'DELETE') {
            assert.equal(new URL(String(_url), 'https://example.com').searchParams.get('expected_updated_at'), '2026-10-05T12:00:00.000Z');
            online.clear(); return Response.json({ success: true });
        }
        return Response.json({ drafts: [...online.values()] });
    };
    let controls;
    function Harness({ propertyId = 'p1' }) {
        const [payload, setPayload] = React.useState(initial);
        const onRestore = React.useCallback(value => setPayload(value), []);
        const draft = useRequisitionDraft({ userId: 'u1', orgId: 'o1', propertyId, ready: true, payload, onRestore });
        controls = { ...draft, payload, setPayload };
        return null;
    }
    let tree;
    try {
        await act(async () => { tree = create(React.createElement(Harness)); });
        await act(async () => { controls.setPayload({ ...initial, siteNotes: 'Continue tomorrow' }); });
        assert.equal(JSON.parse(values.get(draftHelpers.draftStorageKey('u1', 'o1', 'p1')))[0].payload.siteNotes, 'Continue tomorrow');
        await act(async () => { tree.unmount(); });
        assert.equal(writes, 0, 'Leaving before the debounce keeps browser edits without submitting');
        await act(async () => { tree = create(React.createElement(Harness)); });
        assert.equal(controls.payload.siteNotes, 'Continue tomorrow');
        await act(async () => { await controls.save(); });
        assert.equal(writes, 1);
        assert.equal(online.get('2026:10:All Floors').payload.siteNotes, 'Continue tomorrow');
        await act(async () => { controls.setPayload({ ...initial, siteNotes: 'Changed after saving' }); });
        await act(async () => { await controls.save(); });
        await act(async () => { controls.setPayload({ ...initial, siteNotes: 'Continue tomorrow' }); });
        await act(async () => { await new Promise(resolve => setTimeout(resolve, 900)); });
        assert.equal(online.get('2026:10:All Floors').payload.siteNotes, 'Continue tomorrow', 'Reverting saved fields must persist the reverted value');
        await act(async () => { tree.update(React.createElement(Harness, { propertyId: 'p2' })); });
        // Simulated online store is property-independent; actual API/RLS isolation
        // is exercised by database tests. Browser keys must remain separate.
        assert.equal(values.has(draftHelpers.draftStorageKey('u1', 'o1', 'p2')), true);
        await act(async () => { await controls.clearAfterSubmit(); });
        assert.equal(JSON.parse(values.get(draftHelpers.draftStorageKey('u1', 'o1', 'p2'))).length, 0);
        assert.equal(online.size, 0);
        await act(async () => { tree.unmount(); tree = create(React.createElement(Harness)); });
        await act(async () => { controls.setPayload({ ...initial, siteNotes: 'Submitted snapshot' }); });
        await act(async () => { await controls.save(); });
        const backupKey = draftHelpers.draftStorageKey('u1', 'o1', 'p1');
        values.set(backupKey, JSON.stringify([{ payload: { ...initial, siteNotes: 'Other tab offline edits' },
            updated_at: new Date().toISOString(), base_updated_at: '2026-10-05T12:00:00.000Z' }]));
        await act(async () => { await controls.clearAfterSubmit(controls.payload); });
        assert.equal(JSON.parse(values.get(backupKey))[0].payload.siteNotes, 'Other tab offline edits');
        assert.equal(online.size, 1, 'Keep the cloud base version when another tab has newer browser edits');
    } finally {
        if (tree) await act(async () => { tree.unmount(); });
        globalThis.fetch = previous.fetch;
        if (previous.storage === undefined) delete globalThis.localStorage; else globalThis.localStorage = previous.storage;
        globalThis.IS_REACT_ACT_ENVIRONMENT = previous.act;
    }
});

test('a conflicting save preserves edits and explicit reload recovers the online draft', async () => {
    const previous = { fetch: globalThis.fetch, storage: globalThis.localStorage, act: globalThis.IS_REACT_ACT_ENVIRONMENT };
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    const values = new Map();
    globalThis.localStorage = { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value) };
    const remote = { payload: { ...initial, siteNotes: 'Other tab edits' }, updated_at: '2026-10-05T12:00:00.000Z' };
    globalThis.fetch = async (_url, options = {}) => options.method === 'PUT'
        ? Response.json({ error: 'Draft changed in another session' }, { status: 409 })
        : Response.json({ drafts: [remote] });
    let controls;
    function Harness() {
        const [payload, setPayload] = React.useState(initial);
        const onRestore = React.useCallback(value => setPayload(value), []);
        controls = { ...useRequisitionDraft({ userId: 'u1', orgId: 'o1', propertyId: 'p1', ready: true, payload, onRestore }), payload, setPayload };
        return null;
    }
    let tree;
    try {
        await act(async () => { tree = create(React.createElement(Harness)); });
        await act(async () => { controls.setPayload({ ...initial, siteNotes: 'My edits' }); });
        await act(async () => { assert.equal(await controls.save(), false); });
        assert.match(controls.status, /another session/);
        assert.equal(controls.payload.siteNotes, 'My edits');
        await act(async () => { await controls.reloadSaved(); });
        assert.equal(controls.payload.siteNotes, 'Other tab edits');
    } finally {
        if (tree) await act(async () => { tree.unmount(); });
        globalThis.fetch = previous.fetch;
        if (previous.storage === undefined) delete globalThis.localStorage; else globalThis.localStorage = previous.storage;
        globalThis.IS_REACT_ACT_ENVIRONMENT = previous.act;
    }
});

test('autosave keeps quantities during a network failure and manual retry saves the full draft', async () => {
    const previous = { fetch: globalThis.fetch, storage: globalThis.localStorage, act: globalThis.IS_REACT_ACT_ENVIRONMENT };
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    const values = new Map();
    globalThis.localStorage = { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value) };
    let online = false;
    let saved;
    globalThis.fetch = async (_url, options = {}) => {
        if (options.method !== 'PUT') return Response.json({ drafts: [] });
        if (!online) throw new Error('Offline');
        saved = JSON.parse(options.body);
        return Response.json({ draft: { payload: saved.payload, updated_at: '2026-10-05T12:00:00.000Z' } });
    };
    let controls;
    function Harness() {
        const [payload, setPayload] = React.useState(initial);
        const onRestore = React.useCallback(value => setPayload(value), []);
        controls = { ...useRequisitionDraft({ userId: 'u1', orgId: 'o1', propertyId: 'p1', ready: true, payload, onRestore }), setPayload };
        return null;
    }
    let tree;
    try {
        await act(async () => { tree = create(React.createElement(Harness)); });
        const edits = { ...initial, siteNotes: 'Need these items', items: [{ id: 'custom-1', category: 'HK', name: 'Soap',
            brand: '', details: '', requested_qty: 9, available_stock_qty: 2, unit: 'Piece', unit_price: 5 }] };
        await act(async () => { controls.setPayload(edits); });
        await act(async () => { await new Promise(resolve => setTimeout(resolve, 900)); });
        assert.match(controls.status, /remain in this browser/);
        assert.equal(JSON.parse(values.get(draftHelpers.draftStorageKey('u1', 'o1', 'p1')))[0].payload.items[0].requested_qty, 9);
        online = true;
        await act(async () => { assert.equal(await controls.save(), true); });
        assert.deepEqual(saved.payload, edits);
    } finally {
        if (tree) await act(async () => { tree.unmount(); });
        globalThis.fetch = previous.fetch;
        if (previous.storage === undefined) delete globalThis.localStorage; else globalThis.localStorage = previous.storage;
        globalThis.IS_REACT_ACT_ENVIRONMENT = previous.act;
    }
});
