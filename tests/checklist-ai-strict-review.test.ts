import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// The helper module creates a Supabase admin client at import time; give it dummy, offline values.
process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:1';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const ROUTES = 'app/api/properties/[propertyId]/sop/completions/[completionId]';
const read = (p: string) => readFile(new URL(`../${p}`, import.meta.url), 'utf8');

test('normalizeParamKey makes the same parameter match across checklists', async () => {
    const { normalizeParamKey } = await import('../lib/sop/checklistAiReview');
    assert.equal(normalizeParamKey('  Mirror   Clean '), 'mirror clean');
    assert.equal(normalizeParamKey('MIRROR CLEAN'), normalizeParamKey('mirror clean'));
});

test('formatFeedbackRules renders checker corrections as standing rules', async () => {
    const { formatFeedbackRules } = await import('../lib/sop/checklistAiReview');
    assert.equal(formatFeedbackRules([]), '');
    const block = formatFeedbackRules([
        { parameter_name: 'Tap', scope: 'this_step', ai_status: 'pass', verdict: 'incorrect', corrected_status: 'fail', guidance: 'Water marks count as fail' },
        { parameter_name: 'Dustbin', scope: 'similar_steps', ai_status: 'not_visible', verdict: 'correct', corrected_status: null, guidance: null },
    ]);
    assert.match(block, /CHECKER CORRECTIONS/);
    assert.match(block, /\[this step\] "Tap": AI said "pass" but checker corrected it to "fail"\. Checker note: Water marks count as fail/);
    assert.match(block, /\[a similar step\] "Dustbin": checker confirmed "not visible" was right/);
});

test('loadImageBuffer refuses relative URLs it cannot resolve instead of throwing', async () => {
    const { loadImageBuffer } = await import('../lib/sop/checklistAiReview');
    assert.equal(await loadImageBuffer('relative/photo.webp'), null);
    assert.equal(await loadImageBuffer(null), null);
});

test('score-photo is strict: unseen parameters are flagged, photos load through storage', async () => {
    const src = await read(`${ROUTES}/score-photo/route.ts`);
    // old lenient rule is gone
    assert.doesNotMatch(src, /MUST NEVER reduce/);
    // images go through the storage-aware loader, not a bare fetch of a relative URL
    assert.doesNotMatch(src, /await fetch\(b\.url\)/);
    assert.doesNotMatch(src, /await fetch\(p\.url\)/);
    assert.match(src, /loadImageBuffer\(b\.url\)/);
    assert.match(src, /loadImageBuffer\(p\.url\)/);
    // every configured parameter is mapped back, missing ones flagged for review
    assert.match(src, /parameterScores = stepParamNames\.map/);
    assert.match(src, /AI did not report on this parameter/);
    assert.match(src, /ai_needs_review: needsReview/);
    // corrections feed the prompt; threshold comes from settings
    assert.match(src, /loadFeedbackRules\(/);
    assert.match(src, /passThreshold/);
});

test('approve-step accepts the fields the UI sends and checks the reviewer', async () => {
    const src = await read(`${ROUTES}/approve-step/route.ts`);
    assert.match(src, /body\.step_approval_status \?\? body\.status/);
    assert.match(src, /body\.step_approval_notes \?\? body\.notes/);
    assert.match(src, /canReviewChecklist\(user\.id, completion\.property_id\)/);
    assert.match(src, /completion_approval_status: overallApprovalStatus/);
});

test('ai-feedback rejects unknown parameters and statuses before writing', async () => {
    const src = await read(`${ROUTES}/ai-feedback/route.ts`);
    assert.match(src, /This parameter was not scored by the AI on this step/);
    assert.match(src, /correctedStatus must be one of/);
    assert.match(src, /canReviewChecklist/);
});

test('feedback migration is additive and server-write only', async () => {
    const sql = await read('supabase/migrations/20261112000001_checklist_ai_parameter_feedback.sql');
    assert.match(sql, /ADD COLUMN IF NOT EXISTS ai_needs_review boolean NOT NULL DEFAULT false/);
    assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.sop_ai_feedback/);
    assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
    assert.doesNotMatch(sql, /\bDROP TABLE\b|\bTRUNCATE\b|\bDELETE FROM\b/i);
    assert.doesNotMatch(sql, /FOR (INSERT|UPDATE|DELETE|ALL)/i);
});
