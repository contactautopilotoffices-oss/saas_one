// No database, no model key, no network and no WhatsApp: every dependency below is a fake.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseBrainSettings, type BrainSettings } from '../../backend/lib/aiLayer/brain/config';
import { nextHandle, stageInbound, type MediaDeps } from '../../backend/lib/aiLayer/brain/channels/media';
import { claimBrain, type BrainInbound, type BrainWhatsAppDeps } from '../../backend/lib/aiLayer/brain/channels/whatsapp';
import { offerToBrains } from '../../task-manager/voice/VoiceIntake';
import type { TurnOutput } from '../../backend/lib/aiLayer/brain/loop/turn';
import type { AttachmentRef, BrainModel } from '../../backend/lib/aiLayer/brain/types';
import type { ActorContext } from '../../backend/lib/aiLayer/types';
import { FILE_1, FakeAudit, FakeBrainData, NOW, ORG, PAREL, ScriptedModel, USER, actor, brainSettings, photo, ticket, turnDeps, call } from './brain-helpers';

const PHONE = '919876543210';
const msg = (text: string, over: Partial<BrainInbound> = {}): BrainInbound => ({ phone: PHONE, text, messageId: `wamid.${Math.random()}`, ...over });
const create = call('ticket_create', { description: 'AC leaking', description_source: 'person', location: 'cabin 4', property: null, urgent: false, attachment: null });

/** A whole fake WhatsApp side: who the phone is, the stored thread, staged files, what was sent and recorded. */
function world(over: { settings?: BrainSettings; model?: BrainModel; actor?: ActorContext | null; data?: FakeBrainData } = {}) {
    const w = {
        settings: over.settings ?? brainSettings({ audience: 'pilot', pilotUserIds: [USER] }),
        actor: over.actor === undefined ? actor() : over.actor,
        data: over.data ?? new FakeBrainData(),
        model: over.model ?? new ScriptedModel([]) as BrainModel,
        audit: new FakeAudit(),
        threads: new Map<string, unknown>(),
        files: [] as AttachmentRef[],
        sent: [] as Array<{ phone: string; text: string }>,
        recorded: [] as Array<{ shadow: boolean; out: TurnOutput; hadFile: boolean; userText: string | null }>,
        order: [] as string[],
        calls: { findUser: 0, loadActor: 0, stage: 0 },
        anyOn: true, busy: false, user: { id: USER, is_master_admin: false } as { id: string; is_master_admin?: boolean } | null,
        orgs: [ORG], stageFails: false, env: {} as Record<string, string | undefined>,
    };
    const deps: BrainWhatsAppDeps = {
        get env() { return w.env; },
        anyOrgOn: async () => w.anyOn,
        findUser: async () => { w.calls.findUser++; return w.user; },
        orgsForUser: async () => w.orgs,
        loadActor: async () => { w.calls.loadActor++; return w.actor; },
        loadSettings: async () => ({ settings: w.settings, aliases: {} }),
        importBusy: async () => w.busy,
        captionMentionsTasks: text => /\btasks?\b|task\s*list|to[\s-]?do/i.test(text),
        loadThread: async (o, u, shadow) => w.threads.get(`${o}:${u}:${shadow}`) ?? null,
        saveThread: async (o, u, shadow, state) => { w.order.push('save'); w.threads.set(`${o}:${u}:${shadow}`, state); },
        listOpenFiles: async () => w.files,
        stage: async () => {
            w.calls.stage++;
            if (w.stageFails) return { ok: false, reason: 'download_failed' };
            const a = photo();
            if (!w.files.some(f => f.id === a.id)) w.files.push(a);
            return { ok: true, attachment: a, image: { handle: 'A1', mime: 'image/jpeg', base64: 'AAAA' } };
        },
        turnDeps: () => turnDeps(w.data, w.model, w.audit),
        record: async r => { w.order.push('record'); w.recorded.push({ shadow: r.shadow, out: r.out, hadFile: r.hadFile, userText: r.userText }); },
        sendReply: async (phone, text) => { w.order.push('send'); w.sent.push({ phone, text }); return true; },
    };
    return { w, deps };
}

describe('WhatsApp: when the brain does NOT take a message', () => {
    it('off everywhere: one cached check, nobody is looked up', async () => {
        const { w, deps } = world(); w.anyOn = false;
        assert.deepEqual(await claimBrain(deps, msg('show my tickets')), { handled: false, why: 'off' });
        assert.equal(w.calls.findUser, 0);
    });

    it('the kill switch, an empty message, a video or document, a photo captioned as a task list', async () => {
        const { w, deps } = world();
        w.env = { AI_BRAIN_DISABLED: 'true' };
        assert.equal((await claimBrain(deps, msg('hi there'))).handled, false);
        w.env = {};
        assert.deepEqual(await claimBrain(deps, msg('')), { handled: false, why: 'empty' });
        assert.deepEqual(await claimBrain(deps, msg('', { mediaUrl: 'https://cdn.example/v.mp4', mediaType: 'video' })), { handled: false, why: 'media_kind' });
        assert.deepEqual(await claimBrain(deps, msg('', { mediaUrl: 'https://cdn.example/a.xlsx', mediaType: 'document' })), { handled: false, why: 'media_kind' });
        assert.deepEqual(await claimBrain(deps, msg('my task list for today', { mediaUrl: 'https://cdn.example/p.jpg', mediaType: 'image' })), { handled: false, why: 'task_photo' });
        assert.equal(w.calls.findUser, 0);
    });

    it('an unknown number, a master admin, two organisations, someone outside the pilot', async () => {
        let t = world(); t.w.user = null;
        assert.deepEqual(await claimBrain(t.deps, msg('show my tickets')), { handled: false, why: 'unknown_sender' });
        t = world(); t.w.user = { id: USER, is_master_admin: true };
        assert.deepEqual(await claimBrain(t.deps, msg('show my tickets')), { handled: false, why: 'unknown_sender' });
        t = world(); t.w.orgs = [ORG, '99999999-9999-4999-8999-999999999999'];
        assert.deepEqual(await claimBrain(t.deps, msg('show my tickets')), { handled: false, why: 'several_orgs' });
        t = world({ settings: brainSettings({ audience: 'pilot', pilotUserIds: [] }) });
        assert.deepEqual(await claimBrain(t.deps, msg('show my tickets')), { handled: false, why: 'not_enabled' });
        assert.equal(t.w.sent.length, 0);
    });

    it('the task importer is in the middle of something: its messages are left alone', async () => {
        const { w, deps } = world(); w.busy = true;
        assert.deepEqual(await claimBrain(deps, msg('yes')), { handled: false, why: 'import_busy' });
    });

    it('"yes" with nothing of the brain\'s waiting goes on to the other bots, with no model call', async () => {
        const model = new ScriptedModel([]);
        const { w, deps } = world({ model });
        const claim = await claimBrain(deps, msg('yes'));
        assert.equal(claim.handled, false);
        assert.equal(model.calls.length, 0);
        assert.equal(w.sent.length, 0);
        assert.equal((claim as { after?: unknown }).after, undefined);
    });

    it('a task request is passed to Smart chat, and the AI Action Layer is told not to read it again', async () => {
        const { w, deps } = world({ model: new ScriptedModel([call('handoff', { to: 'tasks_assistant', reason: 'mark done' })]) });
        const claim = await claimBrain(deps, msg('mark the DG set task done'));
        assert.equal(claim.handled, false);
        assert.equal((claim as { skipAiLayer?: boolean }).skipAiLayer, true);
        assert.equal(w.sent.length, 0);
        await (claim as { after?: () => Promise<void> }).after?.();
        assert.equal(w.recorded.length, 1);
    });

    it('every model down: the existing bots answer, nothing is sent by the brain', async () => {
        const { w, deps } = world({ model: new ScriptedModel([new Error('down'), new Error('down')]) });
        const claim = await claimBrain(deps, msg('show my open tickets'));
        assert.equal(claim.handled, false);
        assert.equal(w.sent.length, 0);
    });

    it('a photo that cannot be taken in is left to the existing flow', async () => {
        const { w, deps } = world(); w.stageFails = true;
        const claim = await claimBrain(deps, msg('', { mediaUrl: 'https://cdn.example/p.jpg', mediaType: 'image' }));
        assert.deepEqual(claim, { handled: false, why: 'error' });
        assert.equal(w.sent.length, 0);
    });

    it('an error anywhere inside never breaks the webhook', async () => {
        const { deps } = world();
        deps.findUser = async () => { throw new Error('db down'); };
        assert.deepEqual(await claimBrain(deps, msg('show my tickets')), { handled: false, why: 'error' });
    });
});

describe('WhatsApp: shadow', () => {
    it('never takes the message and never sends; afterwards it records what it would have said, in a separate thread', async () => {
        const data = new FakeBrainData(); data.tickets = [ticket()];
        const model = new ScriptedModel([call('tickets_list', { period: 'any', status: 'open', priority: null, property: null, raised_by_me: true }), 'TKT-101 is still open.']);
        const { w, deps } = world({ settings: brainSettings({ mode: 'shadow', audience: 'pilot', pilotUserIds: [USER] }), data, model });
        const claim = await claimBrain(deps, msg('what happened to my AC complaint'));
        assert.equal(claim.handled, false);
        assert.equal(model.calls.length, 0); // nothing ran before the webhook answered
        await (claim as { after: () => Promise<void> }).after();
        assert.equal(w.sent.length, 0);
        assert.equal(w.recorded.length, 1);
        assert.equal(w.recorded[0].shadow, true);
        assert.match(w.recorded[0].out.reply!.text, /TKT-101/);
        assert.ok(w.threads.has(`${ORG}:${USER}:true`));
        assert.ok(!w.threads.has(`${ORG}:${USER}:false`));
        assert.equal(w.audit.rows.length, 0);
    });

    it('a proposal in shadow changes nothing, even if a later "yes" arrives', async () => {
        const data = new FakeBrainData();
        const { w, deps } = world({ settings: brainSettings({ mode: 'shadow', audience: 'pilot', pilotUserIds: [USER] }), data, model: new ScriptedModel([create]) });
        await (await claimBrain(deps, msg('AC leaking in cabin 4')) as { after: () => Promise<void> }).after();
        await (await claimBrain(deps, msg('yes')) as { after: () => Promise<void> }).after();
        assert.equal(data.created.length, 0);
        assert.equal(w.sent.length, 0);
    });
});

describe('WhatsApp: live for the pilot', () => {
    it('answers, saving the thread BEFORE the reply goes out, and records the turn', async () => {
        const data = new FakeBrainData(); data.tickets = [ticket()];
        const model = new ScriptedModel([call('tickets_list', { period: 'any', status: 'open', priority: null, property: null, raised_by_me: true }), 'TKT-101 is still open.']);
        const { w, deps } = world({ data, model });
        const claim = await claimBrain(deps, msg('what happened to my AC complaint'));
        assert.equal(claim.handled, true);
        assert.equal(w.sent.length, 0); // nothing is sent until the background job runs
        await (claim as { background: () => Promise<void> }).background();
        assert.deepEqual(w.order, ['save', 'send', 'record']);
        assert.deepEqual(w.sent, [{ phone: PHONE, text: 'TKT-101 is still open.' }]);
        assert.equal(w.recorded[0].shadow, false);
    });

    it('a card, then "yes" in the next message: one ticket, and access is loaded again for the Yes', async () => {
        const data = new FakeBrainData();
        const { w, deps } = world({ data, model: new ScriptedModel([create]) });
        await (await claimBrain(deps, msg('AC leaking in cabin 4')) as { background: () => Promise<void> }).background();
        assert.match(w.sent[0].text, /Please check before I raise the ticket/);
        assert.equal(data.created.length, 0);
        const before = w.calls.loadActor;
        await (await claimBrain(deps, msg('yes')) as { background: () => Promise<void> }).background();
        assert.ok(w.calls.loadActor > before);
        assert.equal(data.created.length, 1);
        assert.match(w.sent[1].text, /TKT-901/);
    });

    it('access removed between the card and the Yes: nothing is created', async () => {
        const data = new FakeBrainData();
        const { w, deps } = world({ data, model: new ScriptedModel([create]) });
        await (await claimBrain(deps, msg('AC leaking in cabin 4')) as { background: () => Promise<void> }).background();
        w.actor = actor({ propertyIds: [PAREL] });
        await (await claimBrain(deps, msg('yes')) as { background: () => Promise<void> }).background();
        assert.equal(data.created.length, 0);
        assert.match(w.sent[1].text, /access changed/);
    });

    it('a photo with no words is taken in, shown to the model, and attached on Yes without being sent again', async () => {
        const data = new FakeBrainData();
        const model = new ScriptedModel([call('ticket_create', { description: 'Water dripping from the AC unit', description_source: 'photo', location: null, property: null, urgent: false, attachment: 'A1' })]);
        const { w, deps } = world({ data, model });
        await (await claimBrain(deps, msg('', { mediaUrl: 'https://cdn.example/p.jpg', mediaType: 'image' })) as { background: () => Promise<void> }).background();
        assert.equal(w.calls.stage, 1);
        assert.equal((model as ScriptedModel).calls[0].messages.at(-1)!.blocks.filter(b => b.type === 'image').length, 1);
        assert.match(w.sent[0].text, /written from your photo/);
        assert.equal(w.recorded[0].hadFile, true);
        await (await claimBrain(deps, msg('yes')) as { background: () => Promise<void> }).background();
        assert.equal(w.calls.stage, 1); // not downloaded again
        assert.ok(data.created[0].photo);
        assert.deepEqual(data.used.map(u => u.id), [FILE_1]);
    });

    it('a photo, then the words in a second message: the photo rides along', async () => {
        const data = new FakeBrainData();
        const model = new ScriptedModel([
            call('ask_user', { question: 'What would you like to do with this photo?', options: ['Report an issue', 'Attach to a task'] }),
            call('ticket_create', { description: 'AC leaking', description_source: 'person', location: 'cabin 4', property: null, urgent: false, attachment: 'A1' }),
        ]);
        const { w, deps } = world({ data, model });
        await (await claimBrain(deps, msg('', { mediaUrl: 'https://cdn.example/p.jpg', mediaType: 'image' })) as { background: () => Promise<void> }).background();
        await (await claimBrain(deps, msg('AC leaking in cabin 4')) as { background: () => Promise<void> }).background();
        assert.match(w.sent[1].text, /1 photo attached/);
        await (await claimBrain(deps, msg('haan')) as { background: () => Promise<void> }).background();
        assert.ok(data.created[0].photo);
    });

    it('"nothing is switched on for your role" is not sent on WhatsApp: the other bots answer', async () => {
        const off = brainSettings({ audience: 'pilot', pilotUserIds: [USER], grid: { property_admin: { tickets: 'off', rooms: 'off', tasks: 'off', electricity: 'off', knowledge: 'off', memory: 'off' } } });
        const { w, deps } = world({ settings: off });
        assert.equal((await claimBrain(deps, msg('show my tickets'))).handled, false);
        assert.equal(w.sent.length, 0);
    });
});

describe('file intake', () => {
    const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
    function media(over: Partial<MediaDeps> = {}) {
        const saved: Array<{ handle: string; kind: string; mime: string; extension: string; caption: string | null }> = [];
        const open: AttachmentRef[] = [];
        const deps: MediaDeps = {
            fetchMedia: async () => ({ ok: true, buffer: JPEG, contentType: 'application/octet-stream' }),
            sniff: buf => (buf[0] === 0xff ? { kind: 'image', mimeType: 'image/jpeg' } : buf.slice(0, 4).toString('latin1') === '%PDF' ? { kind: 'pdf' } : { kind: 'unknown' }),
            toJpeg: async buf => Buffer.concat([buf, Buffer.from('re-encoded')]),
            listOpen: async () => open,
            findOpenBySha: async () => null,
            save: async input => { saved.push({ handle: input.handle, kind: input.kind, mime: input.mime, extension: input.extension, caption: input.caption }); const a = photo({ handle: input.handle, id: `id-${saved.length}`, kind: input.kind, mime: input.mime, caption: input.caption }); open.push(a); return a; },
            ...over,
        };
        return { deps, saved, open };
    }
    const input = { orgId: ORG, userId: USER, url: 'https://cdn.example/p', caption: null, channel: 'whatsapp' as const, messageId: 'm1' };

    it('a photo is re-encoded, given the next handle, and handed to the model as an image', async () => {
        const { deps, saved } = media();
        const a = await stageInbound(deps, input);
        assert.ok(a.ok && a.attachment.handle === 'A1' && a.image?.mime === 'image/jpeg');
        assert.ok(a.ok && Buffer.from(a.image!.base64, 'base64').toString('latin1').endsWith('re-encoded'));
        const b = await stageInbound(deps, { ...input, caption: '  lobby wall  ' });
        assert.ok(b.ok && b.attachment.handle === 'A2');
        assert.deepEqual(saved.map(s => [s.handle, s.kind, s.extension, s.caption]), [['A1', 'image', 'jpg', null], ['A2', 'image', 'jpg', 'lobby wall']]);
    });

    it('the same bytes again are the same file, not a second one', async () => {
        const existing = photo({ handle: 'A1' });
        const { deps, saved } = media({ findOpenBySha: async () => existing });
        const again = await stageInbound(deps, input);
        assert.ok(again.ok && again.attachment.id === existing.id);
        assert.equal(saved.length, 0);
    });

    it('what a file IS comes from its bytes: a PDF is a document, anything unknown is refused', async () => {
        const pdf = await stageInbound(media({ fetchMedia: async () => ({ ok: true, buffer: Buffer.from('%PDF-1.7 ...'), contentType: 'image/jpeg' }) }).deps, input);
        assert.ok(pdf.ok && pdf.attachment.kind === 'document' && pdf.image === null);
        const exe = await stageInbound(media({ fetchMedia: async () => ({ ok: true, buffer: Buffer.from('MZ\u0090\u0000 not a picture'), contentType: 'image/jpeg' }) }).deps, input);
        assert.deepEqual(exe, { ok: false, reason: 'unsupported', detail: 'unknown' });
    });

    it('too large, a failed download and a failed store are each reported, never thrown', async () => {
        assert.deepEqual(await stageInbound(media({ fetchMedia: async () => ({ ok: false, error: 'file too large' }) }).deps, input), { ok: false, reason: 'too_large', detail: 'file too large' });
        assert.deepEqual(await stageInbound(media({ fetchMedia: async () => ({ ok: false, error: 'HTTP 404' }) }).deps, input), { ok: false, reason: 'download_failed', detail: 'HTTP 404' });
        const failed = await stageInbound(media({ save: async () => { throw new Error('bucket missing'); } }).deps, input);
        assert.deepEqual(failed, { ok: false, reason: 'store_failed', detail: 'bucket missing' });
        const unreadable = await stageInbound(media({ toJpeg: async () => { throw new Error('bad image'); } }).deps, input);
        assert.equal(unreadable.ok, false);
    });

    it('handles count up over the open files and are never reused while one is open', () => {
        assert.equal(nextHandle([]), 'A1');
        assert.equal(nextHandle([{ handle: 'A1' }, { handle: 'A3' }]), 'A4');
    });
});

describe('sending', () => {
    it('the live sender refuses to send while a test is running', async () => {
        const realFetch = globalThis.fetch;
        const net: string[] = [];
        globalThis.fetch = (async (url: unknown) => { net.push(String(url)); throw new Error('the network must not be used in this test'); }) as typeof fetch;
        try {
            const { inTestRun, sendBrainReply } = await import('../../backend/lib/aiLayer/brain/channels/send');
            assert.equal(inTestRun(), true, 'this process must be recognised as a test run');
            assert.equal(inTestRun({ NODE_TEST_CONTEXT: 'child-v8' }), true);
            assert.equal(inTestRun({ AI_BRAIN_NO_SEND: 'true' }), true);
            assert.equal(inTestRun({}), false);
            assert.equal(await sendBrainReply(PHONE, 'this must never arrive'), false);
            assert.deepEqual(net, []);
        } finally { globalThis.fetch = realFetch; }
    });

    it('settings parse the same way the channel reads them', () => {
        assert.equal(parseBrainSettings({ mode: 'live', channels: { whatsapp: true, app_chat: false }, pilotUserIds: [USER] }).channels.whatsapp, true);
        assert.ok(NOW instanceof Date);
    });
});

describe('WhatsApp: failure handling (review 2026-11-14)', () => {
    it('a thread that cannot be saved does not stop the reply: the action is done, so the person is told', async () => {
        const data = new FakeBrainData();
        const { w, deps } = world({ data, model: new ScriptedModel([create]) });
        await (await claimBrain(deps, msg('AC leaking in cabin 4')) as { background: () => Promise<void> }).background();
        const claim = await claimBrain(deps, msg('yes'));
        deps.saveThread = async () => { throw new Error('db down'); };
        await assert.doesNotReject((claim as { background: () => Promise<void> }).background());
        assert.equal(data.created.length, 1);
        assert.match(w.sent[1].text, /TKT-901/);
    });

    it('the same delivery arriving twice on this server is taken once: one model run, one reply', async () => {
        const data = new FakeBrainData(); data.tickets = [ticket()];
        const model = new ScriptedModel([call('tickets_list', { period: 'any', status: 'open', priority: null, property: null, raised_by_me: true }), 'TKT-101 is still open.']);
        const { w, deps } = world({ data, model });
        const seen = new Set<string>();
        deps.seenBefore = id => seen.has(id);
        deps.markSeen = id => { seen.add(id); };
        const same = msg('what happened to my AC complaint', { messageId: 'wamid.same' });
        await (await claimBrain(deps, same) as { background: () => Promise<void> }).background();
        const again = await claimBrain(deps, same);
        assert.equal(again.handled, true); // taken, so no other bot answers it either
        await (again as { background: () => Promise<void> }).background();
        assert.equal(model.calls.length, 2);
        assert.equal(w.sent.length, 1);
    });

    it('shadow looks at a photo without storing it, so nothing staged in shadow can appear once the org goes live', async () => {
        const model = new ScriptedModel([call('ticket_create', { description: 'Water dripping from the AC unit', description_source: 'photo', location: null, property: null, urgent: false, attachment: 'A1' })]);
        const { w, deps } = world({ settings: brainSettings({ mode: 'shadow', audience: 'pilot', pilotUserIds: [USER] }), model });
        let peeked = 0; let listed = 0;
        deps.peekImage = async () => { peeked++; return { mime: 'image/jpeg', base64: 'AAAA' }; };
        deps.listOpenFiles = async () => { listed++; return []; };
        await (await claimBrain(deps, msg('', { mediaUrl: 'https://cdn.example/p.jpg', mediaType: 'image' })) as { after: () => Promise<void> }).after();
        assert.equal(w.calls.stage, 0);
        assert.equal(listed, 0);
        assert.equal(peeked, 1);
        assert.equal(w.files.length, 0);
        assert.equal(w.recorded[0].out.outcome, 'propose');
        assert.equal(w.recorded[0].hadFile, true);
        assert.equal(w.sent.length, 0);
    });
});

describe('WhatsApp: a voice note reaches the brain as the words that were heard (owner 2026-11-14)', () => {
    const heard = '🎙️ I heard: "AC leaking in cabin 4"';

    it('the "I heard" line sits above the brain\'s own card, so the person answers one question, not two', async () => {
        const data = new FakeBrainData();
        const { w, deps } = world({ data, model: new ScriptedModel([create]) });
        const claim = await claimBrain(deps, msg('AC leaking in cabin 4', { replyPrefix: heard }));
        assert.equal(claim.handled, true);
        await (claim as { background: () => Promise<void> }).background();
        assert.equal(w.sent.length, 1);
        assert.ok(w.sent[0].text.startsWith(`${heard}\n\n`));
        assert.match(w.sent[0].text, /Please check before I raise the ticket/);
        assert.equal(data.created.length, 0); // nothing is raised by speaking; the card still waits for a Yes
    });

    it('one typed Yes after it raises the ticket once, with no "I heard" line on that reply', async () => {
        const data = new FakeBrainData();
        const { w, deps } = world({ data, model: new ScriptedModel([create]) });
        await (await claimBrain(deps, msg('AC leaking in cabin 4', { replyPrefix: heard })) as { background: () => Promise<void> }).background();
        await (await claimBrain(deps, msg('yes')) as { background: () => Promise<void> }).background();
        assert.equal(data.created.length, 1);
        assert.match(w.sent[1].text, /TKT-901/);
        assert.ok(!w.sent[1].text.includes('I heard'));
    });

    it('a spoken task request is not the brain\'s: nothing is sent, so the task assistant can answer it', async () => {
        const { w, deps } = world({ model: new ScriptedModel([call('handoff', { to: 'tasks_assistant', reason: 'wants to mark a task done' })]) });
        const claim = await claimBrain(deps, msg('mark the DG set task done', { replyPrefix: '🎙️ I heard: "mark the DG set task done"' }));
        assert.equal(claim.handled, false);
        assert.equal(w.sent.length, 0);
    });

    it('for someone the brain is not live for, a voice note is not taken and nothing is sent', async () => {
        const { w, deps } = world({ settings: brainSettings({ mode: 'live', audience: 'pilot', pilotUserIds: [] }), model: new ScriptedModel([create]) });
        const claim = await claimBrain(deps, msg('AC leaking in cabin 4', { replyPrefix: heard }));
        assert.equal(claim.handled, false);
        assert.equal(w.sent.length, 0);
    });

    it('an empty prefix changes nothing', async () => {
        const { w, deps } = world({ model: new ScriptedModel([create]) });
        await (await claimBrain(deps, msg('AC leaking in cabin 4', { replyPrefix: '   ' })) as { background: () => Promise<void> }).background();
        assert.ok(w.sent[0].text.startsWith('Please check before I raise the ticket'));
    });
});

describe('voice notes: which assistant is offered the words', () => {
    const note = { phone: PHONE, messageId: 'wamid.voice', text: 'AC leaking in cabin 4', prefix: '🎙️ I heard: "AC leaking in cabin 4"' };

    it('the brain is offered them first; if it takes them, the task assistant is not asked', async () => {
        const asked: string[] = [];
        const took = await offerToBrains(note, { unified: async () => { asked.push('brain'); return true; }, tasks: async () => { asked.push('tasks'); return true; } });
        assert.equal(took, true); assert.deepEqual(asked, ['brain']);
    });

    it('if the brain does not take them, the task assistant is offered them exactly as before', async () => {
        const asked: string[] = [];
        const took = await offerToBrains(note, { unified: async () => { asked.push('brain'); return false; }, tasks: async i => { asked.push(`tasks:${i.text}`); return true; } });
        assert.equal(took, true); assert.deepEqual(asked, ['brain', 'tasks:AC leaking in cabin 4']);
    });

    it('a failure in the brain never loses a voice note: the task assistant still gets it', async () => {
        const took = await offerToBrains(note, { unified: async () => { throw new Error('boom'); }, tasks: async () => true });
        assert.equal(took, true);
    });

    it('if neither takes them, the voice flow falls back to its own "I heard … YES?"', async () => {
        assert.equal(await offerToBrains(note, { unified: async () => false, tasks: async () => false }), false);
    });
});

describe('WhatsApp: several quick messages get ONE reply (2026-11-18)', () => {
    /** A fake inbox: the first calls are "deferred" (a newer message answers), the last one gets the whole batch. */
    function batching(deps: BrainWhatsAppDeps, w: ReturnType<typeof world>['w'], texts: string[]) {
        const finished: string[] = [];
        let n = 0;
        deps.batch = async () => (++n < texts.length ? { kind: 'deferred' } : { kind: 'batch', texts, messageIds: texts.map((_, i) => `m${i}`), token: 'tok-1' });
        deps.finishBatch = async token => { w.order.push('finish'); finished.push(token); };
        return finished;
    }

    it('three messages typed together: one model turn reading all three lines, one reply', async () => {
        const model = new ScriptedModel(['You can raise a ticket here, and I can check meeting rooms for you.']);
        const { w, deps } = world({ model });
        const texts = ['hi', 'can i raise a ticket here?', 'and book a room?'];
        const finished = batching(deps, w, texts);
        const claims = [];
        for (const t of texts) claims.push(await claimBrain(deps, msg(t)));
        assert.deepEqual(claims.map(c => c.handled), [true, true, true]);
        for (const c of claims) if (c.handled) await c.background();
        assert.equal(model.calls.length, 1);
        assert.match(model.lastUserText(), /<message>\nhi\ncan i raise a ticket here\?\nand book a room\?\n<\/message>/);
        assert.equal(w.sent.length, 1, 'one reply, not three');
        assert.deepEqual(finished, ['tok-1']);
        assert.deepEqual(w.order.filter(x => x !== 'record'), ['save', 'finish', 'send'], 'the next batch may start only after the thread is saved');
    });

    it('a batch the brain passes on carries ALL its words to the other bots, and the batch is released', async () => {
        const { w, deps } = world({ model: new ScriptedModel([call('handoff', { to: 'tasks_assistant', reason: 'tasks' })]) });
        const finished = batching(deps, w, ['my tasks', 'for today']);
        await claimBrain(deps, msg('my tasks'));
        const claim = await claimBrain(deps, msg('for today'));
        assert.equal(claim.handled, false);
        assert.equal((claim as { rewriteText?: string }).rewriteText, 'my tasks\nfor today');
        assert.deepEqual(finished, ['tok-1']);
        assert.equal(w.sent.length, 0);
    });

    it('"yes" sent together with another question while a card waits: the card is answered first, then the question, in one reply', async () => {
        const data = new FakeBrainData();
        const model = new ScriptedModel([create, 'There are no meeting rooms set up here.']);
        const { w, deps } = world({ model, data });
        const first = await claimBrain(deps, msg('AC leaking in cabin 4'));
        assert.ok(first.handled); await first.background();
        batching(deps, w, ['yes', 'is the board room free?']);
        await claimBrain(deps, msg('yes'));
        const claim = await claimBrain(deps, msg('is the board room free?'));
        assert.ok(claim.handled); await claim.background();
        assert.equal(data.created.length, 1, 'the ticket was raised');
        const reply = w.sent.at(-1)!.text;
        assert.match(reply, /✅ Ticket TKT-901 raised[\s\S]*\n\nThere are no meeting rooms set up here\./);
    });

    it('the inbox not available (or failing): every message is answered on its own, as before', async () => {
        const { w, deps } = world({ model: new ScriptedModel(['Hello!']) });
        deps.batch = async () => { throw new Error('db down'); };
        const claim = await claimBrain(deps, msg('hi there'));
        assert.ok(claim.handled); await claim.background();
        assert.equal(w.sent.length, 1);
    });
});

describe('WhatsApp: two turns saving at once never lose an exchange (2026-11-18)', () => {
    it('a save that finds the thread changed reads it again and merges, instead of overwriting', async () => {
        const { w, deps } = world({ model: new ScriptedModel(['You have no open tickets.']) });
        const key = `${ORG}:${USER}:false`;
        let conflicts = 0;
        deps.saveThreadIf = async (o, u, shadow, state, expectedRev) => {
            const stored = w.threads.get(key) as { rev?: number } | undefined;
            const rev = stored ? stored.rev ?? 0 : null;
            if (rev !== expectedRev) { conflicts++; return 'conflict'; }
            w.threads.set(key, state); return 'ok';
        };
        const claim = await claimBrain(deps, msg('any open tickets?'));
        assert.ok(claim.handled);
        // Meanwhile another turn of the same person saved its own exchange.
        w.threads.set(key, { rev: 1, lastActiveAt: NOW.toISOString(), history: [{ role: 'user', text: 'my lan wire is broken', at: NOW.toISOString() }, { role: 'assistant', text: 'Please check before I raise the ticket', at: NOW.toISOString() }] });
        await claim.background();
        assert.equal(conflicts, 1);
        const saved = w.threads.get(key) as { rev: number; history: Array<{ text: string }> };
        assert.deepEqual(saved.history.map(h => h.text), ['my lan wire is broken', 'Please check before I raise the ticket', 'any open tickets?', 'You have no open tickets.']);
        assert.equal(saved.rev, 2);
    });

    it('a store that cannot do a checked save falls back to the plain save', async () => {
        const { w, deps } = world({ model: new ScriptedModel(['Hello!']) });
        deps.saveThreadIf = async () => { throw new Error('filter not supported'); };
        const claim = await claimBrain(deps, msg('hi there'));
        assert.ok(claim.handled); await claim.background();
        assert.ok(w.threads.get(`${ORG}:${USER}:false`));
        assert.equal(w.sent.length, 1);
    });
});

describe('WhatsApp: swipe-replies (2026-11-18)', () => {
    it('a sent reply keeps its WhatsApp id, and a later swipe on it reaches the model with the quoted words', async () => {
        const model = new ScriptedModel(['Your AC ticket is assigned to Suresh.', 'Okay, noted.']);
        const { w, deps } = world({ model });
        deps.sendReplyTracked = async (phone, text) => { w.sent.push({ phone, text }); return { sent: true, messageIds: ['wamid.OUT1'] }; };
        const first = await claimBrain(deps, msg('status of my ac ticket'));
        assert.ok(first.handled); await first.background();
        const saved = w.threads.get(`${ORG}:${USER}:false`) as { history: Array<{ role: string; ids?: string[] }> };
        assert.deepEqual(saved.history.find(h => h.role === 'assistant')!.ids, ['wamid.OUT1']);
        const swipe = await claimBrain(deps, msg('who is suresh?', { quotedIds: ['wamid.OUT1'] }));
        assert.ok(swipe.handled); await swipe.background();
        assert.match(model.lastUserText(), /replying_to: the person swiped to reply to your message[\s\S]*Your AC ticket is assigned to Suresh\./);
    });

    it('a swipe-reply is answered on its own, never folded into a batch', async () => {
        const { deps } = world({ model: new ScriptedModel(['Okay.']) });
        let asked = 0;
        deps.batch = async () => { asked++; return { kind: 'unavailable' }; };
        const claim = await claimBrain(deps, msg('this one', { quotedIds: ['wamid.X'] }));
        assert.ok(claim.handled);
        assert.equal(asked, 0);
    });
});

// 2026-11-20 (owner: "fix both"): an HR/CRM/IT/Design/Tech login with no property login is served for meeting rooms
// only, and only while the task assistant answers their tasks, so their task messages reach it exactly as before.
describe('WhatsApp: a login with no property login, for meeting rooms', () => {
    const hr = (): ActorContext => ({ ...actor({ propertyIds: [], propertyNames: {} }), roles: ['hr'], roomsOnly: true, roomPropertyIds: [PAREL], roomPropertyNames: { [PAREL]: 'C Mafatlal Chambers' } });

    it('"Tasks through the task assistant" off: left alone, exactly as before', async () => {
        const model = new ScriptedModel([]);
        const { w, deps } = world({ actor: hr(), model, settings: brainSettings({ taskEngine: false }) });
        assert.deepEqual(await claimBrain(deps, msg('book a meeting room at C Mafatlal tomorrow 4 to 5')), { handled: false, why: 'rooms_only_task_engine_off' });
        assert.equal(model.calls.length, 0);
        assert.equal(w.sent.length, 0);
    });

    it('switch on: the brain answers a room question, with only the room tools', async () => {
        const data = new FakeBrainData(); data.rooms = [{ id: 'r-c1', name: 'Conference room 1', propertyId: PAREL }];
        const model = new ScriptedModel([call('rooms_list', { property: null }), 'C Mafatlal Chambers has Conference room 1.']);
        const { w, deps } = world({ actor: hr(), model, data, settings: brainSettings({ taskEngine: true }) });
        const claim = await claimBrain(deps, msg('which meeting rooms are there'));
        assert.equal(claim.handled, true);
        await (claim as { background: () => Promise<void> }).background();
        const tools = model.calls[0].tools.map(t => t.name);
        assert.ok(tools.includes('rooms_list') && tools.includes('room_book'));
        assert.ok(!tools.some(n => n.startsWith('ticket') || n.startsWith('electricity') || n === 'properties_mine'), tools.join(','));
        assert.match(model.toolResults()[0], /Meeting rooms at C Mafatlal Chambers/);
        assert.equal(w.sent.length, 1);
    });
});
