import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from './load-ts.mjs';

test('DEFAULT_VISION_MODEL defaults to multimodal deepseek-v4.1-flash and overrides text-only models', () => {
    const { DEFAULT_VISION_MODEL, ENGY_VISION_MODELS } = loadTs('backend/lib/ocr/vision.ts');
    assert.equal(DEFAULT_VISION_MODEL, 'deepseek-v4.1-flash', 'Default vision model must be deepseek-v4.1-flash');
    assert.ok(ENGY_VISION_MODELS.includes('deepseek-v4.1-flash'), 'ENGY_VISION_MODELS must include deepseek-v4.1-flash');
    assert.ok(ENGY_VISION_MODELS.includes('kimi-k3'), 'ENGY_VISION_MODELS must include kimi-k3');
    assert.ok(!ENGY_VISION_MODELS.includes('glm-5.3-flash'), 'glm-5.3-flash must not be in ENGY_VISION_MODELS (text-only on Engy)');
});

test('priceOf includes deepseek-v4.1-flash with exact rates', () => {
    const { priceOf } = loadTs('backend/lib/council/llm.ts');
    const price = priceOf('deepseek-v4.1-flash');
    assert.equal(price.input, 0.06);
    assert.equal(price.output, 0.24);
});

test('aiCatalog defaults for ocr_vision specifies multimodal models', () => {
    const { AI_JOBS } = loadTs('task-manager/ai/aiCatalog.ts');
    const ocrVision = AI_JOBS.find(j => j.key === 'ocr_vision');
    assert.ok(ocrVision, 'ocr_vision job must exist in catalog');
    assert.ok(ocrVision.defaults.includes('deepseek-v4.1-flash'), 'ocr_vision defaults must include deepseek-v4.1-flash');
    assert.ok(!ocrVision.defaults.includes('qwen3.8-27b'), 'ocr_vision defaults must not include text-only qwen3.8-27b');
});

test('visionExtract prioritizes Engy keys across ENGY_API_KEY, engy, and COUNCIL_API_KEY', async () => {
    // 1. With ENGY_API_KEY
    process.env.ENGY_API_KEY = 'sk-engy-test-key';
    const { visionExtract } = loadTs('backend/lib/ocr/vision.ts');
    let result = await visionExtract({ pages: [], instruction: 'test' });
    assert.equal(result.provider, 'engy', 'Provider must resolve to engy via ENGY_API_KEY');
    delete process.env.ENGY_API_KEY;

    // 2. With lowercase engy
    process.env.engy = 'sk-engy-test-key-2';
    result = await visionExtract({ pages: [], instruction: 'test' });
    assert.equal(result.provider, 'engy', 'Provider must resolve to engy via engy');
    delete process.env.engy;

    // 3. With COUNCIL_API_KEY
    process.env.COUNCIL_API_KEY = 'sk-engy-test-key-3';
    process.env.COUNCIL_BASE_URL = 'https://api.engy.ai/v1';
    result = await visionExtract({ pages: [], instruction: 'test' });
    assert.equal(result.provider, 'engy', 'Provider must resolve to engy via COUNCIL_API_KEY');
    delete process.env.COUNCIL_API_KEY;
    delete process.env.COUNCIL_BASE_URL;
});
