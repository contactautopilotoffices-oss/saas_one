import test from 'node:test';
import assert from 'node:assert/strict';

import { fetchAllExecutivePropertyTickets } from '../frontend/components/shared/executiveSummaryTickets.ts';

test('fetchAllExecutivePropertyTickets paginates past 1000 rows with deterministic ordering', async () => {
    const totalRows = 1713;
    const dataset = Array.from({ length: totalRows }, (_, i) => ({
        id: `t-${i}`,
        category: 'Electrical',
        status: i % 2 === 0 ? 'closed' : 'assigned',
        created_at: new Date(Date.UTC(2026, 10, 12, 0, 0, totalRows - i)).toISOString(),
        resolved_at: null,
        internal: i % 3 === 0,
        floor_number: '1',
        issue_category: { name: 'Electrical' },
    }));

    const calls = [];
    const mockSupabase = {
        from(table) {
            assert.equal(table, 'tickets');
            const orders = [];
            const q = {
                select() { return q; },
                eq(col, val) {
                    assert.equal(col, 'property_id');
                    assert.equal(val, 'prop-1');
                    return q;
                },
                order(col, opts) {
                    orders.push([col, opts]);
                    return q;
                },
                range(from, to) {
                    calls.push({ from, to, orders: [...orders] });
                    return Promise.resolve({
                        data: dataset.slice(from, to + 1),
                        error: null,
                    });
                },
            };
            return q;
        },
    };

    const rows = await fetchAllExecutivePropertyTickets(mockSupabase, 'prop-1', 1000);
    assert.equal(rows.length, 1713);
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0], {
        from: 0,
        to: 999,
        orders: [
            ['created_at', { ascending: false }],
            ['id', { ascending: false }],
        ],
    });
    assert.deepEqual(calls[1], {
        from: 1000,
        to: 1999,
        orders: [
            ['created_at', { ascending: false }],
            ['id', { ascending: false }],
        ],
    });
});

test('fetchAllExecutivePropertyTickets propagates query errors', async () => {
    const mockSupabase = {
        from() {
            const q = {
                select() { return q; },
                eq() { return q; },
                order() { return q; },
                range() {
                    return Promise.resolve({ data: null, error: { message: 'db timeout' } });
                },
            };
            return q;
        },
    };

    await assert.rejects(
        () => fetchAllExecutivePropertyTickets(mockSupabase, 'prop-1'),
        /db timeout/
    );
});
