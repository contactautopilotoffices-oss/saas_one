/**
 * Voice Note Intake — Phase 2: the WhatsApp side (100% OFFLINE: a fake IO and a fake database client; no network, no real
 * database, no message can be sent from this file).
 * Run: npx tsx task-manager/tests/test_voice_phase2.ts
 */
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:1';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-key-offline-test';
delete process.env.VOICE_NOTES_ENABLED;

import type { VoiceIO, VoiceState, Sender } from '../voice/VoiceIntake';
import type { TranscribeResult } from '../voice/VoiceTranscriber';
import type { CleanupResult } from '../voice/VoiceCleanup';
import type { MediaFetchResult } from '../TaskImportInbound';

let failures = 0;
const check = (n: string, ok: boolean, x?: unknown) => { if (ok) console.log(`  ✓ ${n}`); else { failures++; console.error(`  ✗ ${n}`, x ?? ''); } };

const PHONE = '918433649199';
const T0 = Date.parse('2026-10-09T12:00:00Z');

/** The real AiSensy voice-note shape from the server log of 2026-10-09 (values invented). */
const voiceBody = (id = 'wamid.VOICE1', over: Record<string, unknown> = {}) => ({
    id: 'evt1', created_at: '2026-10-09T12:23:28Z', topic: 'message.sender.user', project_id: 'p1', delivery_attempt: '1',
    data: { message: {
        type: 'audio', id: 'm1', meta_data: [], project_id: 'p1', phone_number: PHONE, contact_id: 'c1', campaign: null, sender: 'USER',
        message_content: { url: 'https://cdn.aisensy.example/voice/abc.ogg', urlExpiry: '2026-10-09T13:23:28Z', mimeType: 'audio/ogg; codecs=opus' },
        message_type: 'AUDIO', status: 'received', is_HSM: false, sent_at: 1791548608, context: null, messageId: id, ...over,
    } },
});
const textBody = (text: string, id = 'wamid.TEXT1') => ({ topic: 'message.sender.user', data: { message: { phone_number: PHONE, message_type: 'TEXT', message_content: { text }, messageId: id } } });

interface Rec { replies: string[]; audits: Array<Record<string, unknown>>; states: VoiceState[]; downloads: number; transcribes: number; recognised: number }

function fakeIO(o: {
    enabled?: boolean; sender?: Sender | null; state?: unknown; now?: number;
    download?: MediaFetchResult; transcribe?: TranscribeResult; cleanup?: CleanupResult | Error;
    getStateThrows?: boolean; recogniseThrows?: boolean; replyThrows?: boolean; replyBlocked?: boolean;
} = {}) {
    const rec: Rec = { replies: [], audits: [], states: [], downloads: 0, transcribes: 0, recognised: 0 };
    let stored: unknown = o.state ?? null;
    let clock = o.now ?? T0;
    const io: VoiceIO = {
        enabled: () => o.enabled ?? true,
        async recognise() { rec.recognised++; if (o.recogniseThrows) throw new Error('db down'); return o.sender === undefined ? { employeeId: 'e1', userId: null } : o.sender; },
        async download() { rec.downloads++; return o.download ?? { ok: true, buffer: Buffer.from('OggS-fake-audio'), contentType: 'audio/ogg' }; },
        async transcribe() { rec.transcribes++; return o.transcribe ?? { ok: true, text: 'um Rahul ko kal ka AC filter task do', language: 'hindi', durationSec: 6, model: 'whisper-large-v3', failures: [] }; },
        async cleanup() {
            if (o.cleanup instanceof Error) throw o.cleanup;
            return o.cleanup ?? { text: 'Rahul ko kal ka AC filter task do.', cleaned: true, language: 'hinglish', unclear: false, model: 'qwen3.8-27b', failures: [], tokensIn: 300, tokensOut: 40 };
        },
        // Phase 2 covers the "I heard … YES?" path: the brain never takes the note here (Phase 3 tests the brain path).
        async tryBrain() { return false; },
        async getState() { if (o.getStateThrows) throw new Error('db down'); return stored; },
        async setState(_p, s) { rec.states.push(JSON.parse(JSON.stringify(s))); stored = s; },
        async reply(_p, t) { if (o.replyThrows) throw new Error('send failed'); if (o.replyBlocked) return false; rec.replies.push(t); return true; },
        async audit(d) { rec.audits.push(d); },
        now: () => clock,
    };
    return { io, rec, stored: () => stored as VoiceState | null, tick: (ms: number) => { clock += ms; } };
}

async function run() {
    const net: string[] = [];
    globalThis.fetch = (async (u: RequestInfo | URL) => { net.push(String(u)); throw new Error('network must not be used'); }) as typeof fetch;
    const warned: string[] = [];
    const warn = console.warn; console.warn = (...a: unknown[]) => { warned.push(a.map(String).join(' ')); };

    const V = await import('../voice/VoiceIntake');
    const { normalizeInbound } = await import('../../backend/lib/whatsapp/assistant/protocol.mjs');

    console.log('\n1. Spotting a voice note in the AiSensy payload');
    let ref = V.extractVoiceNote(voiceBody());
    check('the real AiSensy shape → phone, message id, audio URL, mime type', ref?.phone === PHONE && ref.messageId === 'wamid.VOICE1'
        && ref.audioUrl === 'https://cdn.aisensy.example/voice/abc.ogg' && ref.mimeType === 'audio/ogg; codecs=opus', ref);
    ref = V.extractVoiceNote(voiceBody('wamid.V2', { message_type: 'SOMETHING_NEW', type: 'x' }));
    check('an unexpected message_type still counts when the mime type is audio', ref?.messageId === 'wamid.V2', ref);
    ref = V.extractVoiceNote({ topic: 'message.sender.user', data: { message: { phone_number: PHONE, message_type: 'voice', id: 'w3', voice: { url: 'https://cdn.example/v.ogg' } } } });
    check('other shapes: voice.url + type "voice", no mime → still a voice note', ref?.audioUrl === 'https://cdn.example/v.ogg' && ref.mimeType === null, ref);
    check('an image is not a voice note', V.extractVoiceNote(voiceBody('w', { message_content: { url: 'https://cdn.example/p.jpg', mimeType: 'image/jpeg' }, message_type: 'IMAGE' })) === null);
    check('a PDF is not a voice note', V.extractVoiceNote(voiceBody('w', { message_content: { url: 'https://cdn.example/f.pdf', mimeType: 'application/pdf' }, message_type: 'DOCUMENT' })) === null);
    check('a text message is not a voice note', V.extractVoiceNote(textBody('hello')) === null);
    check('garbage / outbound / no phone → null', V.extractVoiceNote(null) === null && V.extractVoiceNote([1]) === null
        && V.extractVoiceNote({ ...voiceBody(), fromMe: true }) === null && V.extractVoiceNote({ data: { message: { message_content: { url: 'https://x.example/a.ogg', mimeType: 'audio/ogg' } } } }) === null);
    const t = V.extractTextReply(textBody('Haan'));
    check('a text reply → phone, id, text; a voice note is not a text reply', t?.text === 'Haan' && t.phone === PHONE && t.messageId === 'wamid.TEXT1' && V.extractTextReply(voiceBody()) === null, t);

    console.log('\n2. YES / NO');
    const yes = ['yes', 'YES!', 'y', 'ok.', 'okay', 'haan', 'Haan ji', 'ha', 'theek hai', 'sahi hai', 'ji', 'go ahead'];
    const no = ['no', 'No.', 'nahi', 'nahin', 'cancel', 'galat', 'nope'];
    const other = ['haan but make it 5 pm', 'what are my tasks', 'yes please assign it to Vidya', 'hello'];
    check(`yes words: ${yes.join(', ')}`, yes.every(w => V.parseVoiceAnswer(w) === 'yes'), yes.filter(w => V.parseVoiceAnswer(w) !== 'yes'));
    check(`no words: ${no.join(', ')}`, no.every(w => V.parseVoiceAnswer(w) === 'no'), no.filter(w => V.parseVoiceAnswer(w) !== 'no'));
    check('anything longer is neither (treated as a new message)', other.every(w => V.parseVoiceAnswer(w) === null), other.filter(w => V.parseVoiceAnswer(w) !== null));

    console.log('\n3. Stored state is cleaned on read');
    const st = V.normalizeVoiceState({ pending: { text: 'x', voiceMessageId: 'v', expiresAt: T0 - 1 }, recentAt: [T0 - 2 * 3600_000, T0 - 60_000, 'bad'], recentIds: Array.from({ length: 15 }, (_, i) => `id${i}`) }, T0);
    check('expired pending dropped, notes older than 1 hour dropped, ids capped at 10', st.pending === null && st.recentAt.length === 1 && st.recentIds.length === 10 && st.recentIds[9] === 'id14', st);
    check('junk → empty state', JSON.stringify(V.normalizeVoiceState('junk', T0)) === JSON.stringify({ pending: null, recentAt: [], recentIds: [], answered: null }));
    const ans = (at: number) => V.normalizeVoiceState({ answered: { messageId: 'y1', result: 'yes', body: { phone: PHONE, messageId: 'y1', text: 't' }, at } }, T0).answered;
    check('a remembered YES lasts 10 minutes, then is forgotten; junk answers dropped', ans(T0 - 9 * 60_000)?.body?.text === 't' && ans(T0 - 11 * 60_000) === null
        && V.normalizeVoiceState({ answered: { messageId: 'y1', result: 'maybe', at: T0 } }, T0).answered === null);

    console.log('\n3b. Sandbox');
    const cfg = (enabled: boolean) => ({ enabled, manager: { name: 'M', phone: '+91 98200 11111' }, employees: [{ name: 'S', phone: '8433649199' }] });
    check('sandbox OFF → everyone', V.passesSandbox(cfg(false), '919999999999'));
    check('sandbox ON → sandbox employee and manager pass (any formatting)', V.passesSandbox(cfg(true), PHONE) && V.passesSandbox(cfg(true), '919820011111'));
    check('voice allowlist unset / empty / junk → no limit', V.passesVoiceAllowlist(undefined, PHONE) && V.passesVoiceAllowlist('', PHONE) && V.passesVoiceAllowlist(' , abc', PHONE));
    check('voice allowlist set → only those numbers, any formatting', V.passesVoiceAllowlist('+91 84336-49199, 9820011111', PHONE) && V.passesVoiceAllowlist('8433649199', '+918433649199')
        && !V.passesVoiceAllowlist('9820011111', PHONE));
    check('sandbox ON → anyone else is ignored', !V.passesSandbox(cfg(true), '919999999999') && !V.passesSandbox({ enabled: true, employees: [] }, PHONE));

    console.log('\n4. Switch, unknown numbers, errors → the old flow, untouched');
    let f = fakeIO({ enabled: false });
    let c = await V.claimVoiceNote(voiceBody(), f.io);
    check('switch OFF → pass, nothing read', c.kind === 'pass' && f.rec.recognised === 0 && f.rec.states.length === 0, c);
    // The switch now lives in the Task Manager settings ("Voice notes" in the Task Access panel): stub that one read.
    const { TaskDatabaseService: VDB } = await import('../TaskDatabaseService');
    const { resetBotSwitchCache } = await import('../BotSwitches');
    const realCfg = (VDB as any).getTestingConfig; let cfgReads = 0;
    (VDB as any).getTestingConfig = async () => { cfgReads++; return { voiceNotesEnabled: false }; };
    resetBotSwitchCache();
    c = await V.claimVoiceNote(voiceBody());
    check('switch OFF (settings) and no IO given → pass; only the (cached) settings read happens', c.kind === 'pass' && cfgReads === 1, cfgReads);
    (VDB as any).getTestingConfig = realCfg; resetBotSwitchCache();
    f = fakeIO({ sender: null });
    c = await V.claimVoiceNote(voiceBody(), f.io);
    check('unknown number → pass, nothing stored, nothing downloaded', c.kind === 'pass' && f.rec.states.length === 0 && f.rec.downloads === 0, c);
    f = fakeIO({ recogniseThrows: true });
    c = await V.claimVoiceNote(voiceBody(), f.io);
    check('a database error before claiming → pass', c.kind === 'pass', c);
    f = fakeIO();
    c = await V.claimVoiceNote({ topic: 'message.sender.user', data: { message: { phone_number: PHONE, message_content: { url: 'https://x.example/p.jpg', mimeType: 'image/jpeg' }, messageId: 'i1' } } }, f.io);
    check('an image → pass (not read, not recognised)', c.kind === 'pass' && f.rec.recognised === 0, c);

    console.log('\n5. A voice note, start to finish');
    f = fakeIO();
    c = await V.claimVoiceNote(voiceBody(), f.io);
    check('claimed in the quick part, slow part handed back', c.kind === 'handled' && typeof (c as { background?: unknown }).background === 'function', c);
    check('quick part already counted it (hourly limit + repeat guard)', f.rec.states.length === 1 && f.rec.states[0].recentAt.length === 1 && f.rec.states[0].recentIds[0] === 'wamid.VOICE1' && f.rec.downloads === 0);
    if (c.kind === 'handled') await c.background?.();
    const s = f.stored();
    check('downloaded once, transcribed once', f.rec.downloads === 1 && f.rec.transcribes === 1);
    check('reply: 🎙️ I heard "<tidy text>" + YES / NO', f.rec.replies.length === 1 && f.rec.replies[0].includes('I heard: "Rahul ko kal ka AC filter task do."') && /Reply \*YES\*/.test(f.rec.replies[0]) && !/weren't clear/.test(f.rec.replies[0]), f.rec.replies);
    check('pending saved for 10 minutes, with the voice note id; hourly count kept', s?.pending?.text === 'Rahul ko kal ka AC filter task do.' && s.pending.expiresAt === T0 + 10 * 60_000 && s.pending.voiceMessageId === 'wamid.VOICE1' && s.recentAt.length === 1, s);
    const a0 = f.rec.audits[0] ?? {};
    check('audit: transcribed, raw + tidy text kept (owner decision), models, tokens, no audio', f.rec.audits.length === 1 && a0.outcome === 'transcribed' && a0.rawText === 'um Rahul ko kal ka AC filter task do'
        && a0.text === 'Rahul ko kal ka AC filter task do.' && a0.whisperModel === 'whisper-large-v3' && a0.cleanupModel === 'qwen3.8-27b' && a0.tokensIn === 300 && a0.messageId === 'wamid.VOICE1' && !('audio' in a0), a0);

    c = await V.claimVoiceNote(voiceBody(), f.io);
    check('the same voice note delivered again → handled, nothing done twice', c.kind === 'handled' && !(c as { background?: unknown }).background && f.rec.downloads === 1 && f.rec.replies.length === 1, c);

    console.log('\n6. Answering "I heard …"');
    const pendingState = (expiresAt = T0 + 5 * 60_000) => ({ pending: { text: 'Rahul ko kal ka AC filter task do.', voiceMessageId: 'wamid.VOICE1', expiresAt }, recentAt: [T0 - 60_000], recentIds: ['wamid.VOICE1'] });
    f = fakeIO({ state: pendingState() });
    c = await V.claimVoiceNote(textBody('Haan', 'wamid.YES1'), f.io);
    check('YES (haan) → rewrite: the tidy text, as if typed, under the YES message id', c.kind === 'rewrite' && c.body.text === 'Rahul ko kal ka AC filter task do.' && c.body.phone === PHONE && c.body.messageId === 'wamid.YES1', c);
    if (c.kind === 'rewrite') {
        const n = normalizeInbound(c.body);
        check('the rewritten body reads as ordinary text to the shared parser', n?.text === 'Rahul ko kal ka AC filter task do.' && n.phone === PHONE && n.messageId === 'wamid.YES1' && n.mediaUrl === null && n.mediaType === 'text', n);
    }
    f = fakeIO({ state: pendingState() });
    const yesWithProject = { topic: 'message.sender.user', project_id: 'proj-42', data: { message: { phone_number: PHONE, message_type: 'TEXT', message_content: { text: 'yes' }, messageId: 'wamid.YES2', sent_at: 1791548700 } } };
    const typedSame = { ...yesWithProject, data: { message: { ...yesWithProject.data.message, message_content: { text: 'Rahul ko kal ka AC filter task do.' } } } };
    const rw = await V.claimVoiceNote(yesWithProject, f.io);
    const nRw = rw.kind === 'rewrite' ? normalizeInbound(rw.body) : null;
    const nTyped = normalizeInbound(typedSame);
    check('the rewritten body routes like the same words typed: same phone, id, text, project id and time',
        !!nRw && JSON.stringify(nRw) === JSON.stringify(nTyped) && nRw.projectId === 'proj-42' && nRw.inboundAt === new Date(1791548700 * 1000).toISOString(), { nRw, nTyped });
    f = fakeIO({ state: pendingState() });
    await V.claimVoiceNote(textBody('Haan', 'wamid.YES1'), f.io);
    check('pending cleared (never offered twice), hourly count kept; audit: confirmed', f.stored()?.pending === null && f.stored()?.recentAt.length === 1 && f.rec.audits[0]?.outcome === 'confirmed' && f.rec.audits[0]?.voiceMessageId === 'wamid.VOICE1');
    check('YES sends no reply of its own (the normal flow answers)', f.rec.replies.length === 0);

    f = fakeIO({ state: pendingState() });
    c = await V.claimVoiceNote(textBody('nahi'), f.io);
    if (c.kind === 'handled') await c.background?.();
    check('NO (nahi) → cancelled reply, pending cleared, audit: declined', c.kind === 'handled' && f.rec.replies[0] === V.VOICE_TEXT.cancelled && f.stored()?.pending === null && f.rec.audits[0]?.outcome === 'declined', { c, r: f.rec });

    f = fakeIO({ state: pendingState() });
    c = await V.claimVoiceNote(textBody('what are my tasks today'), f.io);
    check('anything else → pass (handled as a new message), pending dropped, audit: dropped', c.kind === 'pass' && f.stored()?.pending === null && f.rec.audits[0]?.outcome === 'dropped' && f.rec.replies.length === 0, c);

    f = fakeIO({ state: pendingState() });
    const first = await V.claimVoiceNote(textBody('yes', 'wamid.YES9'), f.io);
    const writes = f.rec.states.length, audits = f.rec.audits.length;
    const again = await V.claimVoiceNote(textBody('yes', 'wamid.YES9'), f.io);
    check('the SAME YES delivered again (after a 503 "retry") → the same transcript again, not a bare "yes"', first.kind === 'rewrite' && again.kind === 'rewrite'
        && JSON.stringify(again.body) === JSON.stringify(first.body) && again.body.text === 'Rahul ko kal ka AC filter task do.', { first, again });
    check('…with nothing new stored or audited', f.rec.states.length === writes && f.rec.audits.length === audits);
    const laterYes = await V.claimVoiceNote(textBody('yes', 'wamid.YES10'), f.io);
    check('a DIFFERENT, later "yes" is not captured (the note was already answered) → old flow', laterYes.kind === 'pass', laterYes);
    f = fakeIO({ state: pendingState() });
    c = await V.claimVoiceNote(textBody('no', 'wamid.NO9'), f.io);
    if (c.kind === 'handled') await c.background?.();
    c = await V.claimVoiceNote(textBody('no', 'wamid.NO9'), f.io);
    check('the same NO delivered again → handled quietly, "cancelled" not sent twice', c.kind === 'handled' && !(c as { background?: unknown }).background && f.rec.replies.length === 1, f.rec.replies);

    f = fakeIO({ state: pendingState(T0 - 1) });
    c = await V.claimVoiceNote(textBody('yes'), f.io);
    check('YES after 10 minutes → pass (expired), nothing written', c.kind === 'pass' && f.rec.states.length === 0 && f.rec.recognised === 0, c);
    f = fakeIO();
    c = await V.claimVoiceNote(textBody('yes'), f.io);
    check('a text with no voice note waiting → pass after one read, no lookup of the sender', c.kind === 'pass' && f.rec.recognised === 0 && f.rec.states.length === 0, c);
    f = fakeIO({ state: pendingState(), getStateThrows: true });
    c = await V.claimVoiceNote(textBody('yes'), f.io);
    check('state unreadable → pass (old flow)', c.kind === 'pass', c);
    f = fakeIO({ state: pendingState(), sender: null });
    c = await V.claimVoiceNote(textBody('yes'), f.io);
    check('a pending row for an unrecognised number → pass, untouched', c.kind === 'pass' && f.rec.states.length === 0, c);

    console.log('\n7. Limits and failures → one friendly reply');
    f = fakeIO({ state: { pending: null, recentAt: Array.from({ length: 20 }, (_, i) => T0 - i * 60_000), recentIds: [] } });
    c = await V.claimVoiceNote(voiceBody('wamid.V21'), f.io);
    if (c.kind === 'handled') await c.background?.();
    check('21st note in an hour → hourly-limit reply, not downloaded, not counted', c.kind === 'handled' && f.rec.downloads === 0 && f.rec.replies[0] === V.VOICE_TEXT.hourlyLimit
        && f.stored()?.recentAt.length === 20 && f.stored()?.recentIds.includes('wamid.V21') === true && f.rec.audits[0]?.outcome === 'hourly_limit', f.rec);
    f = fakeIO({ state: { pending: null, recentAt: Array.from({ length: 20 }, (_, i) => T0 - 3600_000 - i * 60_000), recentIds: [] } });
    c = await V.claimVoiceNote(voiceBody('wamid.V22'), f.io);
    if (c.kind === 'handled') await c.background?.();
    check('20 notes more than an hour ago do not count', f.rec.downloads === 1 && f.rec.replies[0]?.includes('I heard'), f.rec.replies);

    const cases: Array<[string, Parameters<typeof fakeIO>[0], string, string]> = [
        ['download fails (link expired)', { download: { ok: false, error: 'HTTP 403' } }, V.VOICE_TEXT.failed, 'failed'],
        ['download over 10 MB', { download: { ok: false, error: 'file too large' } }, V.VOICE_TEXT.tooLong, 'failed'],
        ['over 2 minutes', { transcribe: { ok: false, reason: 'too_long', detail: 'audio is 150 s', failures: [] } }, V.VOICE_TEXT.tooLong, 'too_long'],
        ['silence', { transcribe: { ok: false, reason: 'silent', detail: 'no speech detected', failures: [] } }, V.VOICE_TEXT.silent, 'silent'],
        ['Groq rate limit', { transcribe: { ok: false, reason: 'rate_limited', detail: 'HTTP 429', failures: [] } }, V.VOICE_TEXT.busy, 'failed'],
        ['no Groq key', { transcribe: { ok: false, reason: 'no_key', detail: 'not configured', failures: [] } }, V.VOICE_TEXT.failed, 'failed'],
        ['clean-up crashes', { cleanup: new Error('boom') }, V.VOICE_TEXT.failed, 'failed'],
    ];
    for (const [name, opts, reply, outcome] of cases) {
        f = fakeIO(opts);
        c = await V.claimVoiceNote(voiceBody(), f.io);
        if (c.kind === 'handled') await c.background?.();
        check(`${name} → "${reply.slice(3, 40)}…", audit ${outcome}, nothing pending`, f.rec.replies.length === 1 && f.rec.replies[0] === reply && f.rec.audits[0]?.outcome === outcome && !f.stored()?.pending, { replies: f.rec.replies, audits: f.rec.audits });
    }
    f = fakeIO({ cleanup: { text: 'rahul ko kal ka task do', cleaned: false, language: 'unknown', unclear: false, model: null, failures: [{ model: 'all', error: 'x' }], tokensIn: 0, tokensOut: 0 } });
    c = await V.claimVoiceNote(voiceBody(), f.io);
    if (c.kind === 'handled') await c.background?.();
    check('tidy-up failed → raw text shown with "some words weren\'t clear"', /weren't clear/.test(f.rec.replies[0] ?? '') && f.rec.replies[0].includes('"rahul ko kal ka task do"') && f.rec.audits[0]?.cleaned === false, f.rec.replies);
    f = fakeIO({ replyBlocked: true });
    c = await V.claimVoiceNote(voiceBody(), f.io);
    if (c.kind === 'handled') await c.background?.();
    check('"I heard … YES?" blocked by the send gate → no YES is waited for (their next "yes" is not captured)', !f.stored()?.pending && f.rec.audits[0]?.promptSent === false, { s: f.stored(), a: f.rec.audits[0] });
    f = fakeIO({ replyThrows: true });
    c = await V.claimVoiceNote(voiceBody(), f.io);
    let threw = false;
    try { if (c.kind === 'handled') await c.background?.(); } catch { threw = true; }
    check('WhatsApp send failing never crashes the slow part', !threw && f.rec.audits[0]?.outcome === 'transcribed');

    console.log('\n8. The state row (fake database client)');
    type Q = { table: string; ops: Array<[string, unknown[]]> };
    const queries: Q[] = [];
    const fakeDb = (result: { data?: unknown; error?: unknown }) => ({
        from(table: string) {
            const q: Q = { table, ops: [] }; queries.push(q);
            const chain: Record<string, unknown> = {};
            for (const m of ['select', 'eq', 'gt']) chain[m] = (...args: unknown[]) => { q.ops.push([m, args]); return chain; };
            chain.maybeSingle = async () => { q.ops.push(['maybeSingle', []]); return result; };
            chain.upsert = async (...args: unknown[]) => { q.ops.push(['upsert', args]); return result; };
            return chain;
        },
    });
    check('key: VOICE:<digits only>', V.voiceStateKey('+91 84336-49199') === 'VOICE:918433649199');
    let store = V.makeVoiceStore(fakeDb({ data: { context_data: { pending: null } }, error: null }), () => T0);
    const got = await store.get(PHONE);
    const gq = queries[queries.length - 1];
    check('get: conversation_context, own VOICE key, TASK_MANAGER, not expired', gq.table === 'conversation_context' && JSON.stringify(gq.ops).includes('["eq",["phone_number","VOICE:918433649199"]]')
        && JSON.stringify(gq.ops).includes('["eq",["system","TASK_MANAGER"]]') && JSON.stringify(gq.ops).includes(`["gt",["expires_at","${new Date(T0).toISOString()}"]]`) && JSON.stringify(got) === '{"pending":null}', gq.ops);
    check('get never touches the sender\'s real row (their bare number)', !JSON.stringify(gq.ops).includes(`"phone_number","${PHONE}"`));
    await store.set(PHONE, { pending: null, recentAt: [T0], recentIds: ['a'], answered: null });
    const sq = queries[queries.length - 1].ops.find(o => o[0] === 'upsert')?.[1] as [Record<string, unknown>, Record<string, unknown>];
    check('set: upsert VOICE key, VOICE_CONFIRM, 60-minute row, same conflict key as the table', sq?.[0].phone_number === 'VOICE:918433649199' && sq[0].system === 'TASK_MANAGER' && sq[0].context_type === 'VOICE_CONFIRM'
        && sq[0].expires_at === new Date(T0 + 60 * 60_000).toISOString() && sq[1].onConflict === 'phone_number,system', sq);
    store = V.makeVoiceStore(fakeDb({ data: null, error: { message: 'boom' } }), () => T0);
    let e1 = '', e2 = '';
    try { await store.get(PHONE); } catch (e) { e1 = (e as Error).message; }
    try { await store.set(PHONE, { pending: null, recentAt: [], recentIds: [], answered: null }); } catch (e) { e2 = (e as Error).message; }
    check('database errors are thrown (so the claim falls back to the old flow)', e1 === 'voice state unavailable' && e2 === 'voice state could not be saved');

    console.log('\n9. Isolation');
    check('nothing reached the real network', net.length === 0, net);
    check('no log line contains what was said', !warned.some(w => /rahul|filter|kal ka/i.test(w)), warned);

    console.warn = warn;
    console.log(failures === 0 ? '\nALL VOICE PHASE 2 CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
    process.exit(failures === 0 ? 0 : 1);
}

run().catch(err => { console.error(err); process.exit(1); });
