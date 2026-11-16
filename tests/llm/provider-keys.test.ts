// The shared AI provider keys (owner 2026-11-15). No network and no real key: every fetch below is a fake.
import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import {
    KEY_REST_MS, NoProviderKeyError, PROVIDER_KEY_NAMES, _resetKeyRests, fetchWithKeys, geminiKeys, groqKeys, hasProviderKey, providerKeys, restKey, withProviderKeys,
} from '../../backend/lib/llm/providerKeys';

const ENV = { GROQ_API_KEY: 'g1', GROQ_API_KEY_2: 'g2', GROQ_API_KEY_3: 'g3' };
const answer = (status: number) => new Response(status === 200 ? '{"ok":true}' : '{}', { status });
/** A fake fetch that answers each key with the status given for it (200 when not listed), and records the keys used. */
function fakeFetch(byKey: Record<string, number>) {
    const used: string[] = [];
    const f = (async (_url: string, init?: RequestInit) => {
        const key = String((init?.headers as Record<string, string>).Authorization).slice('Bearer '.length);
        used.push(key);
        return answer(byKey[key] ?? 200);
    }) as unknown as typeof fetch;
    return { f, used };
}
const init = (key: string): RequestInit => ({ method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: '{}' });

beforeEach(() => _resetKeyRests());

describe('which keys, in which order', () => {
    it('Groq: GROQ_API_KEY → _2 → _3; Gemini: GEMINI_API_KEY → _2 → _3, then the older GOOGLE_AI_API_KEY', () => {
        assert.deepEqual(PROVIDER_KEY_NAMES.groq, ['GROQ_API_KEY', 'GROQ_API_KEY_2', 'GROQ_API_KEY_3']);
        assert.deepEqual(PROVIDER_KEY_NAMES.gemini, ['GEMINI_API_KEY', 'GEMINI_API_KEY_2', 'GEMINI_API_KEY_3', 'GOOGLE_AI_API_KEY']);
        assert.deepEqual(groqKeys({ GROQ_API_KEY_3: 'c', GROQ_API_KEY: 'a', GROQ_API_KEY_2: 'b' }), ['a', 'b', 'c']);
        assert.deepEqual(geminiKeys({ GOOGLE_AI_API_KEY: 'old', GEMINI_API_KEY_2: 'b' }), ['b', 'old']);
    });

    it('empty and repeated values are skipped; the old per-job names are never read', () => {
        assert.deepEqual(groqKeys({ GROQ_API_KEY: '  ', GROQ_API_KEY_2: 'x', GROQ_API_KEY_3: 'x' }), ['x']);
        assert.deepEqual(groqKeys({ WHATSAPP_BOT_GROQ_API_KEY: 'a', GROQ_VOICE_API_KEY: 'b', GROQ_TASK_CHAT_API_KEY: 'c', GROQ_LAYOUT_API_KEY: 'd' }), []);
        assert.deepEqual(geminiKeys({ GEMINI_AUTOTUNE_API_KEY: 'a' }), []);
        assert.equal(hasProviderKey('groq', {}), false);
        assert.equal(hasProviderKey('groq', { GROQ_API_KEY_3: 'z' }), true);
    });

    it('a rested key goes to the end, and comes back to its place when the rest is over', () => {
        const now = 1_000_000;
        restKey('groq', 'g1', ENV, now);
        assert.deepEqual(providerKeys('groq', ENV, now + 1).map(k => k.value), ['g2', 'g3', 'g1']);
        assert.deepEqual(providerKeys('groq', ENV, now + KEY_REST_MS + 1).map(k => k.value), ['g1', 'g2', 'g3']);
    });
});

describe('fetchWithKeys', () => {
    it('a used-up key (429) moves the call to the next key, and that key is rested', async () => {
        const { f, used } = fakeFetch({ g1: 429 });
        const res = await fetchWithKeys('groq', 'https://example.invalid', init, ENV, f);
        assert.equal(res.status, 200);
        assert.deepEqual(used, ['g1', 'g2']);
        assert.deepEqual(groqKeys(ENV), ['g2', 'g3', 'g1']);
    });

    it('a rejected or disabled key (401 / 403) moves on too', async () => {
        const { f, used } = fakeFetch({ g1: 401, g2: 403 });
        assert.equal((await fetchWithKeys('groq', 'https://example.invalid', init, ENV, f)).status, 200);
        assert.deepEqual(used, ['g1', 'g2', 'g3']);
    });

    it('any other answer (a bad request, a server error) is returned at once: the other keys are not spent on it', async () => {
        for (const status of [400, 404, 500]) {
            _resetKeyRests();
            const { f, used } = fakeFetch({ g1: status });
            assert.equal((await fetchWithKeys('groq', 'https://example.invalid', init, ENV, f)).status, status);
            assert.deepEqual(used, ['g1'], String(status));
            assert.deepEqual(groqKeys(ENV), ['g1', 'g2', 'g3'], 'nothing rested');
        }
    });

    it('every key used up: each is tried once and the last answer is returned', async () => {
        const { f, used } = fakeFetch({ g1: 429, g2: 429, g3: 429 });
        assert.equal((await fetchWithKeys('groq', 'https://example.invalid', init, ENV, f)).status, 429);
        assert.deepEqual(used, ['g1', 'g2', 'g3']);
    });

    it('no key at all: a clear error naming the keys to set, nothing sent', async () => {
        const { f, used } = fakeFetch({});
        await assert.rejects(fetchWithKeys('groq', 'https://example.invalid', init, {}, f), (e: Error) => e instanceof NoProviderKeyError && /GROQ_API_KEY, GROQ_API_KEY_2, GROQ_API_KEY_3/.test(e.message));
        assert.deepEqual(used, []);
    });

    it('a network error or timeout is thrown as it is', async () => {
        const f = (async () => { throw new Error('timeout'); }) as unknown as typeof fetch;
        await assert.rejects(fetchWithKeys('groq', 'https://example.invalid', init, ENV, f), /timeout/);
        assert.deepEqual(groqKeys(ENV), ['g1', 'g2', 'g3']);
    });
});

describe('withProviderKeys (SDK calls)', () => {
    const sdkError = (status: number) => Object.assign(new Error(`${status} error`), { status });

    it('an SDK error with 429 / 401 / 403 moves on to the next key', async () => {
        const used: string[] = [];
        const out = await withProviderKeys('gemini', async key => { used.push(key); if (key === 'a') throw sdkError(429); return `answered with ${key}`; }, { GEMINI_API_KEY: 'a', GEMINI_API_KEY_2: 'b' });
        assert.equal(out, 'answered with b');
        assert.deepEqual(used, ['a', 'b']);
    });

    it('a quota error that carries its status only in the message is recognised too (Google\'s SDK)', async () => {
        const used: string[] = [];
        await withProviderKeys('gemini', async key => { used.push(key); if (key === 'a') throw new Error('[GoogleGenerativeAI Error]: [429 Too Many Requests] quota'); return 'ok'; }, { GEMINI_API_KEY: 'a', GEMINI_API_KEY_2: 'b' });
        assert.deepEqual(used, ['a', 'b']);
    });

    it('any other error is thrown at once; every key used up throws the last error', async () => {
        const used: string[] = [];
        await assert.rejects(withProviderKeys('groq', async key => { used.push(key); throw sdkError(400); }, ENV), /400 error/);
        assert.deepEqual(used, ['g1']);
        await assert.rejects(withProviderKeys('groq', async () => { throw sdkError(429); }, ENV), /429 error/);
    });
});
