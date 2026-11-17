import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from '../petty-cash/load-ts.mjs';

function setup({ insertError = null, throws = false } = {}) {
    const rows = [];
    const db = { from: (t) => ({ insert: async (row) => { if (throws) throw new Error('db down'); if (insertError) return { error: insertError }; rows.push({ table: t, ...row }); return { error: null }; } }) };
    const mod = loadTs('backend/lib/ocr/activity.ts', { '@/backend/lib/supabase/admin': { supabaseAdmin: db } });
    return { rows, ...mod };
}
const ok = (r) => ({ ok: r.ok, path: 'pdf_text' });

test('one operation is one row, with every step collected from the layers underneath', async () => {
    const { rows, withOcrActivity, ocrStep, ocrTimed } = setup();
    const r = await withOcrActivity({ source: 'invoice', orgId: 'o1', referenceId: 'inv1', filename: 'a.pdf', bytes: 1234 }, async () => {
        await ocrTimed('pdf_text_layer', async () => 'x'.repeat(10), (t) => `${t.length} characters`);
        ocrStep({ step: 'text_model', ms: 3000, ok: true, model: 'deepseek-v4-flash-0731', tokens_in: 1000, tokens_out: 400, cost_usd: 0.0001 });
        ocrStep({ step: 'vision_model', ms: 9000, ok: true, model: 'qwen3.8-27b', tokens_in: 2000, tokens_out: 500, cost_usd: 0.0003 });
        return { ok: true };
    }, ok);
    assert.equal(r.ok, true);
    assert.equal(rows.length, 1);
    const row = rows[0];
    assert.equal(row.table, 'ocr_activity_log');
    assert.equal(row.source, 'invoice'); assert.equal(row.organization_id, 'o1'); assert.equal(row.reference_id, 'inv1'); assert.equal(row.file_bytes, 1234);
    assert.equal(row.ok, true); assert.equal(row.path, 'pdf_text');
    assert.equal(row.steps.length, 3);
    assert.equal(row.tokens_in, 3000); assert.equal(row.tokens_out, 900);
    assert.equal(Math.round(row.cost_usd * 1e6), 400);
    assert.equal(row.steps[0].step, 'pdf_text_layer'); assert.equal(row.steps[0].note, '10 characters');
});

test('a read inside another read does not write a second row', async () => {
    const { rows, withOcrActivity, ocrStep } = setup();
    await withOcrActivity({ source: 'meter' }, async () => {
        await withOcrActivity({ source: 'document_bank' }, async () => { ocrStep({ step: 'vision_model', ms: 1, ok: true }); return { ok: true }; }, ok);
        return { ok: true };
    }, ok);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].source, 'meter');
    assert.equal(rows[0].steps.length, 1);
});

test('a failure is recorded, with the error, and still thrown to the caller', async () => {
    const { rows, withOcrActivity, ocrStep } = setup();
    await assert.rejects(() => withOcrActivity({ source: 'invoice' }, async () => { ocrStep({ step: 'text_model', ms: 5, ok: false, note: 'HTTP 500' }); throw new Error('model down'); }, ok), /model down/);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].ok, false);
    assert.match(rows[0].error, /model down/);
    assert.equal(rows[0].steps[0].ok, false);
});

test('a result that reports ok:false is logged as a failure, with its own message', async () => {
    const { rows, withOcrActivity } = setup();
    await withOcrActivity({ source: 'electricity' }, async () => ({ ok: false, error: 'pdf text extraction failed: no worker' }), (r) => ({ ok: r.ok, error: r.error }));
    assert.equal(rows[0].ok, false);
    assert.match(rows[0].error, /no worker/);
});

test('logging can never break a read: a missing table, a database error and a thrown error are all swallowed', async () => {
    for (const opts of [{ insertError: { message: 'relation "ocr_activity_log" does not exist' } }, { insertError: { message: 'permission denied' } }, { throws: true }]) {
        const { withOcrActivity } = setup(opts);
        const r = await withOcrActivity({ source: 'invoice' }, async () => ({ ok: true, value: 42 }), ok);
        assert.equal(r.value, 42);
    }
});

test('a step outside any operation is ignored, and a failure before the read can be logged directly', async () => {
    const { rows, ocrStep, logOcr } = setup();
    ocrStep({ step: 'vision_model', ms: 1, ok: true });   // no context: nothing happens, nothing throws
    await logOcr({ source: 'invoice', referenceId: 'inv9' }, { ok: false, error: 'The stored file could not be read.' });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].ok, false);
    assert.equal(rows[0].reference_id, 'inv9');
});

test('step notes are capped, so a long error can never fill the table', async () => {
    const { rows, withOcrActivity, ocrStep } = setup();
    await withOcrActivity({ source: 'invoice' }, async () => { ocrStep({ step: 'text_model', ms: 1, ok: false, note: 'x'.repeat(5000) }); return { ok: false }; }, (r) => ({ ok: r.ok, error: 'e'.repeat(5000) }));
    assert.ok(rows[0].steps[0].note.length <= 200);
    assert.ok(rows[0].error.length <= 500);
});
