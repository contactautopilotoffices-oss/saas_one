/**
 * Real dependencies for the brain's WhatsApp channel (channels/whatsapp.ts). Server only.
 * Sending lives in channels/send.ts, which refuses to send while a test is running.
 */
import sharp from 'sharp';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { findWhatsAppUser } from '@/backend/lib/whatsapp/assistant/access';
import { checkRateLimit } from '@/frontend/utils/rate-limiter';
import { loadActor } from '../../scope';
import { liveTurnDeps, loadAliases, loadBrainSettings, recordTurn, supabaseAttachmentStore, supabaseThreadStore, sweepBrain } from '../server';
import { stageInbound } from './media';
import { sendBrainReply, sendBrainReplyTracked } from './send';
import { claimBrain, type BrainClaim, type BrainInbound, type BrainPerson, type BrainWhatsAppDeps } from './whatsapp';

async function orgsForUser(userId: string): Promise<string[]> {
    const [orgs, props] = await Promise.all([
        supabaseAdmin.from('organization_memberships').select('organization_id').eq('user_id', userId).eq('is_active', true),
        supabaseAdmin.from('property_memberships').select('properties!inner(organization_id)').eq('user_id', userId).eq('is_active', true),
    ]);
    if (orgs.error) throw new Error(orgs.error.message);
    if (props.error) throw new Error(props.error.message);
    const ids = new Set<string>();
    for (const r of (orgs.data || []) as Array<{ organization_id: string | null }>) if (r.organization_id) ids.add(r.organization_id);
    for (const r of (props.data || []) as unknown as Array<{ properties: { organization_id: string } | { organization_id: string }[] | null }>) {
        const p = Array.isArray(r.properties) ? r.properties[0] : r.properties;
        if (p?.organization_id) ids.add(p.organization_id);
    }
    return [...ids];
}

/** Is the brain on for WhatsApp in ANY org? Checked once a minute, so while it is off the webhook does one cached read. */
let anyOn: { value: boolean; at: number } | null = null;
async function anyOrgOn(): Promise<boolean> {
    if (anyOn && Date.now() - anyOn.at < 60_000) return anyOn.value;
    const { data, error } = await supabaseAdmin.from('ai_brain_settings').select('organization_id')
        .in('config->>mode', ['shadow', 'live']).eq('config->channels->>whatsapp', 'true').limit(1);
    const value = !error && (data || []).length > 0; // a missing table means "off"
    anyOn = { value, at: Date.now() };
    return value;
}

/** phone → who it is and in which org (or null = not enabled), for 60 s. The actor and the settings are never cached. */
const people = new Map<string, { at: number; person: BrainPerson | null }>();
const cachedPerson = {
    get(phone: string) { const hit = people.get(phone); return hit && Date.now() - hit.at < 60_000 ? hit.person : undefined; },
    set(phone: string, person: BrainPerson | null) { if (people.size > 5000) people.clear(); people.set(phone, { at: Date.now(), person }); },
};

const BUSY = new Set(['IMPORT_AWAITING', 'IMPORT_PROCESSING', 'IMPORT_PREVIEW', 'IMPORT_PHOTO_CHOICE']);

/** WhatsApp message ids this server already took, for 15 minutes (the stale-delivery window of the webhook). */
const taken = new Map<string, number>();
const TAKEN_MS = 15 * 60_000;

// The same bounds the ticket photo path uses: at most 1280 px, JPEG quality 85. Re-encoding also drops camera metadata.
const toJpeg = (buffer: Buffer) => sharp(buffer, { limitInputPixels: 40_000_000 }).rotate().resize(1280, 1280, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();

export function liveBrainWhatsAppDeps(): BrainWhatsAppDeps {
    const threads = supabaseThreadStore(supabaseAdmin);
    const files = supabaseAttachmentStore(supabaseAdmin);
    return {
        env: process.env,
        anyOrgOn,
        findUser: phone => findWhatsAppUser(phone),
        orgsForUser,
        loadActor: (userId, orgId) => loadActor(supabaseAdmin, userId, orgId),
        loadSettings: async orgId => {
            const [brain, aliases] = await Promise.all([loadBrainSettings(supabaseAdmin, orgId), loadAliases(supabaseAdmin, orgId)]);
            return { settings: brain.settings, aliases };
        },
        cachedPerson,
        async importBusy(phone) {
            try {
                const { TaskDatabaseService } = await import('@/task-manager/TaskDatabaseService');
                const ctx = await TaskDatabaseService.getConversationContext(phone, 'TASK_MANAGER');
                return !!ctx && BUSY.has(String(ctx.context_type));
            } catch { return false; }
        },
        captionMentionsTasks: text => /\btasks?\b|task\s*list|to[\s-]?do/i.test(text),
        async taskBotWaiting(phone, userId) {
            // The task assistant's own record of a question it asked (task-manager/brain/live.ts) and any open reminder
            // ping waiting for this person's reply. Read failures count as waiting: the task assistant then answers.
            const { TaskDatabaseService } = await import('@/task-manager/TaskDatabaseService');
            const { LIVE_STATE_TYPE, normalizeState } = await import('@/task-manager/brain/live');
            const { SuperuserPingService } = await import('@/task-manager/SuperuserPingService');
            const ctx = await TaskDatabaseService.getConversationContext(phone, 'TASK_MANAGER');
            if (ctx && ctx.context_type === LIVE_STATE_TYPE && normalizeState(ctx.context_data).pending) return true;
            return (await SuperuserPingService.openPingTasksFor(userId)).length > 0;
        },
        loadThread: (orgId, userId, shadow) => threads.load(orgId, userId, shadow),
        saveThread: (orgId, userId, shadow, state) => threads.save(orgId, userId, shadow, state),
        saveThreadIf: (orgId, userId, shadow, state, expectedRev) => threads.saveIf(orgId, userId, shadow, state, expectedRev),
        // Batching (2026-11-18): the inbox Smart chat already uses. Switch: AI_BRAIN_BATCHING=false turns it off.
        async batch(input) {
            if (process.env.AI_BRAIN_BATCHING === 'false') return { kind: 'unavailable' };
            const { collectBatch, defaultInboxIO, inboxMaybeAvailable } = await import('@/task-manager/SmartChatInbox');
            if (!inboxMaybeAvailable()) return { kind: 'unavailable' };
            return collectBatch({ phone: input.phone, messageId: input.messageId, text: input.text, io: await defaultInboxIO() });
        },
        async finishBatch(token) {
            const { defaultInboxIO } = await import('@/task-manager/SmartChatInbox');
            await (await defaultInboxIO()).finish(token);
        },
        listOpenFiles: (orgId, userId) => files.listOpen(orgId, userId),
        async stage(input) {
            const { fetchMediaSafely, sniffKind } = await import('@/task-manager/TaskImportInbound');
            return stageInbound({
                fetchMedia: url => fetchMediaSafely(url),
                sniff: buffer => sniffKind(buffer),
                toJpeg,
                listOpen: files.listOpen, findOpenBySha: files.findOpenBySha, save: files.save,
            }, { ...input, channel: 'whatsapp' });
        },
        turnDeps: ctx => liveTurnDeps(supabaseAdmin, {
            orgId: ctx.orgId, userId: ctx.userId, channel: 'whatsapp', phone: ctx.phone, episodeDays: ctx.settings.memory.episodeDays, keyOrder: ctx.settings.keys.order,
            allowMessage: (key, perHour) => checkRateLimit(key, { maxRequests: perHour, windowMs: 3_600_000 }).allowed,
        }),
        record: r => recordTurn(supabaseAdmin, { ...r, channel: 'whatsapp' }),
        sendReply: (phone, text) => sendBrainReply(phone, text),
        sendReplyTracked: (phone, text) => sendBrainReplyTracked(phone, text),
        sweep: (orgId, settings) => sweepBrain(supabaseAdmin, orgId, settings),
        seenBefore: id => { const at = taken.get(id); return at !== undefined && Date.now() - at < TAKEN_MS; },
        markSeen: id => { if (taken.size > 5000) taken.clear(); taken.set(id, Date.now()); },
        async peekImage(url) {
            const { fetchMediaSafely, sniffKind } = await import('@/task-manager/TaskImportInbound');
            const got = await fetchMediaSafely(url);
            if (!got.ok || sniffKind(got.buffer).kind !== 'image') return null;
            return { mime: 'image/jpeg', base64: (await toJpeg(got.buffer)).toString('base64') };
        },
    };
}

/**
 * A voice note, already turned into words by the voice intake (task-manager/voice/VoiceIntake.ts), handed to the brain
 * as if the person had typed it, with the "I heard" line above the reply. true = the brain took it and has replied
 * (its answer, its question, or its confirmation card, so there is one Yes at most). false = not the brain's (the
 * brain is off or not live for this person, a task request, an error): the voice intake carries on exactly as before,
 * with the task assistant and then its own "I heard … YES?". Never throws.
 */
export async function handVoiceToBrain(input: { phone: string; messageId: string; text: string; prefix: string }): Promise<boolean> {
    try {
        const claim = await claimBrainWhatsApp({ phone: input.phone, text: input.text, messageId: input.messageId || null, replyPrefix: input.prefix });
        if (!claim.handled) {
            // Shadow, or a turn the brain passed on: keep its record, send nothing.
            if (claim.after) await claim.after().catch(() => undefined);
            return false;
        }
        // The same never-silent cover a typed message gets: if the reply cannot be sent, the watchdog apologises.
        if (input.messageId) {
            const { markRoute } = await import('@/task-manager/InboundLedger');
            await markRoute(input.messageId, 'brain', input.phone, null).catch(() => undefined);
        }
        await claim.background();
        return true;
    } catch (err) {
        console.warn('[Brain] a voice note was not taken; the voice flow carries on as before:', err instanceof Error ? err.message : 'error');
        return false;
    }
}

/** Called by the AiSensy webhook. Never throws; { handled: false } = carry on exactly as before. */
export async function claimBrainWhatsApp(input: BrainInbound | null): Promise<BrainClaim> {
    if (process.env.AI_BRAIN_DISABLED === 'true') return { handled: false, why: 'kill_switch' };
    try {
        if (!(await anyOrgOn())) return { handled: false, why: 'off' };
    } catch {
        return { handled: false, why: 'error' };
    }
    return claimBrain(liveBrainWhatsAppDeps(), input);
}
