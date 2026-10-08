import assert from 'node:assert/strict';
import test from 'node:test';
import { extractMessageText, isGreetingMessage } from '../backend/lib/whatsapp/greeting.ts';
import { AiSensyService } from '../backend/services/AiSensyService.ts';

test('recognizes standalone greetings including typo, punctuation and case', () => {
    for (const text of ['hi', 'Hello!', 'heelo', 'HEY 👋', 'good morning', 'Good evening!', 'namaste', 'hii', 'hello there']) {
        assert.equal(isGreetingMessage(text), true, text);
    }
    for (const text of ['', 'hi AC is broken', 'hello, water is leaking', 'this', 'high pressure', '123', 'good morning please fix the lift']) {
        assert.equal(isGreetingMessage(text), false, text);
    }
});

test('extracts text from flat and nested AiSensy messages without returning objects', () => {
    for (const payload of [{ message: 'hi' }, { message: { text: 'hi' } }, { message: { text: { body: 'hi' } } }, { messages: [{ text: { body: 'hi' } }] }, { text: { body: 'hi' } }]) {
        assert.equal(extractMessageText(payload, {}), 'hi');
    }
    assert.equal(extractMessageText({ message: { type: 'image' } }, {}), '');
    assert.equal(extractMessageText({}, { message: 'hello' }), 'hello');
});

test('sends greeting campaign through configured AiSensy API without template variables', async () => {
    const oldFetch = globalThis.fetch;
    const oldKey = process.env.AISENSY_API_KEY;
    const oldCampaign = process.env.AISENSY_GREETING_CAMPAIGN_NAME;
    process.env.AISENSY_API_KEY = 'test-key';
    process.env.AISENSY_GREETING_CAMPAIGN_NAME = 'approved-greeting';
    let request;
    globalThis.fetch = async (url, options) => {
        request = { url, ...JSON.parse(options.body) };
        return new Response('{"success":true}', { status: 200 });
    };
    try {
        assert.deepEqual(await AiSensyService.sendGreeting('9876543210'), { success: true });
        assert.equal(request.campaignName, 'approved-greeting');
        assert.equal(request.destination, '919876543210');
        assert.equal(request.apiKey, 'test-key');
        assert.deepEqual(request.templateParams, []);
        globalThis.fetch = async () => new Response('{"success":false,"message":"Campaign inactive"}');
        assert.equal((await AiSensyService.sendGreeting('9876543210')).success, false);
    } finally {
        globalThis.fetch = oldFetch;
        if (oldKey === undefined) delete process.env.AISENSY_API_KEY; else process.env.AISENSY_API_KEY = oldKey;
        if (oldCampaign === undefined) delete process.env.AISENSY_GREETING_CAMPAIGN_NAME; else process.env.AISENSY_GREETING_CAMPAIGN_NAME = oldCampaign;
    }
});


test('AiSensy permanent campaign errors are distinguished from temporary delivery failures', async () => {
    const oldFetch = globalThis.fetch;
    const oldKey = process.env.AISENSY_API_KEY;
    process.env.AISENSY_API_KEY = 'test-key';
    try {
        for (const status of [400, 401, 403, 404, 422]) {
            globalThis.fetch = async () => new Response('Campaign not found', { status });
            assert.equal((await AiSensyService.sendGreeting('9876543210')).retryable, false, String(status));
        }
        for (const status of [408, 409, 429, 500, 503]) {
            globalThis.fetch = async () => new Response('Temporarily unavailable', { status });
            assert.notEqual((await AiSensyService.sendGreeting('9876543210')).retryable, false, String(status));
        }
        globalThis.fetch = async () => new Response('{"success":false,"message":"Campaign inactive"}');
        assert.equal((await AiSensyService.sendGreeting('9876543210')).retryable, false);
    } finally {
        globalThis.fetch = oldFetch;
        if (oldKey === undefined) delete process.env.AISENSY_API_KEY; else process.env.AISENSY_API_KEY = oldKey;
    }
});
