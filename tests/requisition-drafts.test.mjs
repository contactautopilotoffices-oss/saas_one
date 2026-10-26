import test from 'node:test';
import assert from 'node:assert/strict';

test('draft validation preserves incomplete lines and isolates user/property storage', async () => {
    const { draftSchema, draftStorageKey, newestDraft } = await import('../frontend/lib/requisitionDrafts.ts');
    const payload = { floorTag: 'Ground Floor', month: 10, year: 2026, siteNotes: 'Finish later',
        items: [{ id: 'line-1', category: 'HK', name: '', brand: '', details: '', requested_qty: 0,
            available_stock_qty: 4, unit: 'Piece', unit_price: 0 }] };
    assert.equal(draftSchema.parse(payload).items[0].available_stock_qty, 4);
    assert.notEqual(draftStorageKey('u1', 'o1', 'p1'), draftStorageKey('u2', 'o1', 'p1'));
    assert.notEqual(draftStorageKey('u1', 'o1', 'p1'), draftStorageKey('u1', 'o1', 'p2'));
    assert.equal(newestDraft([{ payload, updated_at: '2026-10-05T09:00:00Z' },
        { payload: { ...payload, siteNotes: 'Latest' }, updated_at: '2026-10-05T10:00:00Z' }]).payload.siteNotes, 'Latest');
    assert.equal(draftSchema.safeParse({ ...payload, month: 13 }).success, false);
    assert.equal(draftSchema.safeParse({ ...payload, items: [{ ...payload.items[0], requested_qty: -1 }] }).success, false);
});

test('drafts preserve catalog categories outside the four menu labels', async () => {
    const { draftSchema } = await import('../frontend/lib/requisitionDrafts.ts');
    const payload = { floorTag: 'All Floors', month: 10, year: 2026, siteNotes: '',
        items: ['Custom', 'Housekeeping', 'HK / Stationery', 'Pantry', ''].map((category, i) => ({
            id: `cat-${i}`, category, name: '', brand: '', details: '', requested_qty: 4,
            available_stock_qty: 2, unit: '', unit_price: 0,
        })) };
    assert.deepEqual(draftSchema.parse(payload), payload, 'Saving an unfinished sheet must not rewrite or reject catalog categories');
});
