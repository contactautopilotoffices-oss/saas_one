/**
 * MAIL ARCHIVE — intake. Every email in the rostered mailboxes, past and future,
 * read into mail_archive_* with nobody exporting anything.
 * -----------------------------------------------------------------------------
 * One run, every 15 minutes, in two phases:
 *
 *   A. LIST (cheap — 200 emails per call, under a second). Per mailbox:
 *      · sweep:   everything newer than the live bookmark, minus an overlap.
 *      · history: the next pages walking backwards, from a saved position.
 *        When a page comes back short the mailbox's history is complete.
 *   B. BODIES (dear — one call per email, ~1.4s). Round-robin across mailboxes,
 *      newest first, until the run's time is spent. An email whose key is
 *      already stored is marked done without a call: the same mail CC'd to four
 *      people is fetched once.
 *
 * Everything is a bookmark in the database, so a run that is cut off, rate
 * limited or crashes simply resumes next time. Overlaps are free because every
 * write is "insert if new".
 *
 * NO AI here. This is a workflow, not an agent (doctrine L1): the pathway is
 * known ahead of time and edge cases are few [BAA p.104]. Understanding the mail comes later,
 * on top of an archive that has proved it stays current — retrieval before
 * memory, per doctrine L7 [BAA p.103].
 */

import crypto from 'crypto';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { grantForMailbox, noteMailAccountResult } from '@/backend/lib/mail/accounts';
import { ZohoMailService, grantOwning, type MailSource, type ZohoMailListItem } from '@/backend/services/zohoMailService';

const PAGE = 200;
/** Resume this many emails before the saved position, so deletions between runs cannot skip mail. */
const HISTORY_OVERLAP = 100;
const MAX_HISTORY_PAGES_PER_RUN = 10;               // ~2,000 emails, ~10 s per mailbox
const SWEEP_OVERLAP_MS = 2 * 3600_000;
const MAX_SWEEP_PAGES = 15;
const BODY_BATCH = 6;                               // fetched in parallel
const BODY_MAX_ATTEMPTS = 3;
const MAX_BODY_CHARS = 100_000;
const LEASE_MS = 6 * 60_000;

/** Not mail anyone sent or received in earnest. Never stored. */
const SKIP_FOLDERS = new Set(['spam', 'trash', 'drafts', 'templates', 'outbox']);
/** Stored as headers only; the text is not worth a call each. */
const NO_BODY_FOLDERS = new Set(['newsletter', 'notification']);

export type MailboxState = 'ok' | 'waiting' | 'busy' | 'rate_limited' | 'error';

export interface MailboxRunResult {
    address: string;
    state: MailboxState;
    listed: number;
    historyPages: number;
    historyDone: boolean;
    bodiesFetched: number;
    bodiesDeduped: number;
    bodiesFailed: number;
    error?: string;
}

interface RosterRow {
    id: string;
    organization_id: string;
    address: string;
    newest_received_at: string | null;
    backfill_offset: number;
    backfill_oldest_at: string | null;
    backfill_done_at: string | null;
}

interface Live {
    row: RosterRow;
    source: MailSource;
    grantAddress: string | null;
    folders: Map<string, string>;
    result: MailboxRunResult;
    drained: boolean;
}

const ms = (iso: string | null | undefined) => (iso ? Date.parse(iso) : NaN);
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 400);
const isRateLimited = (e: unknown) => /\b429\b|too.?many|rate.?limit|throttl/i.test(errText(e));

/**
 * Who can read this address. A console connection (the owner consented) wins.
 * The env grant is global — one refresh token, not tied to any organisation —
 * so it may only serve the organisation it is pinned to, or a second tenant
 * could enrol purchase@ and archive another company's mail.
 */
async function sourceFor(orgId: string, address: string): Promise<{ source: MailSource; grantAddress: string | null } | null> {
    const connected = await grantForMailbox(orgId, address);
    if (connected) {
        return { source: { grant: { refreshToken: connected.refreshToken, dc: connected.dc } }, grantAddress: connected.address };
    }
    if (orgId !== process.env.ZOHO_MAIL_ORG_ID) return null;
    const prefix = await grantOwning(address);
    return prefix ? { source: { prefix }, grantAddress: null } : null;
}

/**
 * The same value for every copy of one email in every mailbox: sender, Zoho's
 * sent-time field, and the subject. Zoho's list does not carry the standard
 * Message-ID, and fetching it costs a call per email.
 *
 * sentDateInGMT is NOT a usable date: measured 2026-10-06 it is the email's
 * own Date header shifted by exactly +7h (the US data centre's offset), on an
 * account set to India time. So it is used only as an opaque fingerprint and
 * never stored as a time. If that offset moves with US daylight saving, copies
 * listed either side of the change get different keys — the cost is a
 * duplicate body, never a lost email.
 */
function emailKey(mailboxId: string, m: ZohoMailListItem): string {
    if (!m.sentHeaderMs || !m.fromAddress) return `zoho:${mailboxId}:${m.messageId}`;
    const subject = m.subject.toLowerCase().replace(/\s+/g, ' ').trim();
    return 'k1:' + crypto.createHash('sha256')
        .update(`${m.fromAddress.toLowerCase()}|${m.sentHeaderMs}|${subject}`).digest('hex');
}

function htmlToText(html: string): string {
    return html
        .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, ' ')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(p|div|tr|li|h[1-6]|blockquote)>/gi, '\n')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
        .replace(/[ \t\f\v]+/g, ' ')
        .replace(/ *\n */g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
        .slice(0, MAX_BODY_CHARS);
}

/** Insert the emails not already held for this mailbox. Returns how many were offered. */
async function store(row: RosterRow, folders: Map<string, string>, items: ZohoMailListItem[]): Promise<number> {
    const rows = [];
    for (const m of items) {
        const folder = (m.folderId && folders.get(m.folderId)) || '';
        if (SKIP_FOLDERS.has(folder)) continue;
        rows.push({
            organization_id: row.organization_id,
            mailbox_id: row.id,
            zoho_message_id: m.messageId,
            folder_id: m.folderId,
            folder_name: folder || null,
            thread_id: m.threadId || null,
            email_key: emailKey(row.id, m),
            subject: m.subject.slice(0, 1000) || null,
            from_address: m.fromAddress || null,
            from_name: m.fromName,
            to_addresses: m.toAddress,
            cc_addresses: m.ccAddress,
            received_at: m.sentAt,                       // toMessage() puts receivedTime here
            has_attachment: m.hasAttachment,
            size_bytes: m.sizeBytes,
            summary: m.summary.slice(0, 500) || null,
            body_state: NO_BODY_FOLDERS.has(folder) ? 'skipped' : 'pending',
        });
    }
    if (!rows.length) return 0;
    const { error } = await supabaseAdmin.from('mail_archive_messages')
        .upsert(rows, { onConflict: 'mailbox_id,zoho_message_id', ignoreDuplicates: true });
    if (error) throw new Error(`archive write failed: ${error.message}`);
    return rows.length;
}

async function saveRow(id: string, patch: Record<string, unknown>): Promise<void> {
    const { error } = await supabaseAdmin.from('mail_archive_mailboxes').update(patch).eq('id', id);
    if (error) throw new Error(`bookmark write failed: ${error.message}`);
}

/** New mail since the live bookmark. Skipped on a mailbox's first run: history covers the newest too. */
async function sweep(live: Live, deadline: number): Promise<void> {
    const { row, source, folders, result } = live;
    const prevNewest = ms(row.newest_received_at);
    if (!Number.isFinite(prevNewest)) return;

    const floor = prevNewest - SWEEP_OVERLAP_MS;
    let newest = prevNewest;
    let arrived = 0;
    let start = 1;
    for (let p = 0; p < MAX_SWEEP_PAGES && Date.now() < deadline; p++) {
        const { items, fetched } = await ZohoMailService.listPage(source, { start, address: row.address });
        const fresh = items.filter((m) => Date.parse(m.sentAt) >= floor);
        result.listed += await store(row, folders, fresh);
        for (const m of fresh) {
            const t = Date.parse(m.sentAt);
            if (t > prevNewest) arrived++;
            newest = Math.max(newest, t);
        }
        if (fresh.length < items.length || fetched < PAGE) break;
        start += fetched;
    }

    // New mail pushes every older email further down the list, so the history
    // walker's position moves by the same amount or it re-reads them.
    const patch: Record<string, unknown> = { newest_received_at: new Date(newest).toISOString() };
    if (!row.backfill_done_at && arrived) patch.backfill_offset = row.backfill_offset + arrived;
    await saveRow(row.id, patch);
    Object.assign(row, patch);
}

/** The next pages of history, walking backwards from the saved position. */
async function history(live: Live, deadline: number): Promise<void> {
    const { row, source, folders, result } = live;
    if (row.backfill_done_at) { result.historyDone = true; return; }

    let offset = row.backfill_offset > 0 ? Math.max(0, row.backfill_offset - HISTORY_OVERLAP) : 0;
    let oldest = Number.isFinite(ms(row.backfill_oldest_at)) ? ms(row.backfill_oldest_at) : Infinity;
    let newest = Number.isFinite(ms(row.newest_received_at)) ? ms(row.newest_received_at) : 0;
    let done = false;

    for (let p = 0; p < MAX_HISTORY_PAGES_PER_RUN && Date.now() < deadline - 60_000; p++) {
        const { items, fetched } = await ZohoMailService.listPage(source, { start: offset + 1, address: row.address });
        result.listed += await store(row, folders, items);
        result.historyPages++;
        for (const m of items) {
            const t = Date.parse(m.sentAt);
            oldest = Math.min(oldest, t);
            newest = Math.max(newest, t);
        }
        offset += fetched;
        if (fetched < PAGE) { done = true; break; }
    }
    if (!result.historyPages) return;

    const patch: Record<string, unknown> = {
        backfill_offset: offset,
        backfill_oldest_at: Number.isFinite(oldest) ? new Date(oldest).toISOString() : row.backfill_oldest_at,
        newest_received_at: newest ? new Date(newest).toISOString() : row.newest_received_at,
    };
    if (done) patch.backfill_done_at = new Date().toISOString();
    await saveRow(row.id, patch);
    Object.assign(row, patch);
    result.historyDone = done;
}

/** One batch of email text for one mailbox. Returns false when its queue is empty or it must stop. */
async function bodies(live: Live): Promise<boolean> {
    const { row, source, result } = live;
    const { data: queue, error } = await supabaseAdmin.from('mail_archive_messages')
        .select('id, zoho_message_id, folder_id, email_key, body_attempts')
        .eq('mailbox_id', row.id).eq('body_state', 'pending')
        .order('received_at', { ascending: false })
        .limit(BODY_BATCH * 3);
    if (error) throw new Error(`body queue read failed: ${error.message}`);
    if (!queue?.length) return false;

    // Already stored under the same key — another mailbox's copy, or this one's Sent copy.
    const keys = [...new Set(queue.map((q) => q.email_key as string))];
    const { data: have, error: haveErr } = await supabaseAdmin.from('mail_archive_bodies')
        .select('email_key').eq('organization_id', row.organization_id).in('email_key', keys);
    if (haveErr) throw new Error(`body lookup failed: ${haveErr.message}`);
    const stored = new Set((have ?? []).map((h) => h.email_key as string));

    const dupes = queue.filter((q) => stored.has(q.email_key));
    if (dupes.length) {
        await supabaseAdmin.from('mail_archive_messages')
            .update({ body_state: 'done', body_error: null }).in('id', dupes.map((d) => d.id));
        result.bodiesDeduped += dupes.length;
    }

    // One fetch per key, BODY_BATCH keys per round.
    const byKey = new Map<string, typeof queue>();
    for (const q of queue) {
        if (stored.has(q.email_key)) continue;
        const list = byKey.get(q.email_key);
        if (list) list.push(q); else byKey.set(q.email_key, [q]);
    }
    const batch = [...byKey.entries()].slice(0, BODY_BATCH);
    if (!batch.length) return true;

    const settled = await Promise.allSettled(batch.map(([, copies]) =>
        ZohoMailService.getMessageContentFrom(source, copies[0].zoho_message_id, copies[0].folder_id, row.address)));

    let limited = false;
    for (let i = 0; i < batch.length; i++) {
        const [key, copies] = batch[i];
        const outcome = settled[i];
        if (outcome.status === 'fulfilled') {
            const text = htmlToText(outcome.value.content);
            const { error: insErr } = await supabaseAdmin.from('mail_archive_bodies').upsert({
                organization_id: row.organization_id, email_key: key,
                body_text: text, body_chars: text.length,
                fetched_from: row.id, fetched_message_id: copies[0].zoho_message_id,
            }, { onConflict: 'organization_id,email_key', ignoreDuplicates: true });
            if (insErr) throw new Error(`body write failed: ${insErr.message}`);
            await supabaseAdmin.from('mail_archive_messages')
                .update({ body_state: 'done', body_error: null }).in('id', copies.map((c) => c.id));
            result.bodiesFetched++;
            continue;
        }
        // Being told to slow down is not the email's fault: no attempt is spent.
        if (isRateLimited(outcome.reason)) { limited = true; continue; }
        const first = copies[0];
        const attempts = Number(first.body_attempts ?? 0) + 1;
        const failed = attempts >= BODY_MAX_ATTEMPTS;
        await supabaseAdmin.from('mail_archive_messages').update({
            body_attempts: attempts,
            body_error: errText(outcome.reason),
            ...(failed ? { body_state: 'failed' } : {}),
        }).in('id', copies.map((c) => c.id));
        if (failed) result.bodiesFailed += copies.length;
    }
    if (limited) { result.state = 'rate_limited'; return false; }
    return true;
}

async function claim(id: string): Promise<boolean> {
    const now = new Date().toISOString();
    const { data } = await supabaseAdmin.from('mail_archive_mailboxes')
        .update({ locked_until: new Date(Date.now() + LEASE_MS).toISOString() })
        .eq('id', id)
        .or(`locked_until.is.null,locked_until.lt.${now}`)
        .select('id');
    return Boolean(data?.length);
}

async function finish(row: RosterRow, result: MailboxRunResult, grantAddress: string | null): Promise<void> {
    const worked = result.state === 'ok' || result.state === 'rate_limited';
    const now = new Date().toISOString();
    await supabaseAdmin.from('mail_archive_mailboxes').update({
        locked_until: null,
        last_run_at: now,
        last_run_stats: result,
        ...(worked ? { last_ok_at: now } : {}),
        last_error: result.state === 'ok' ? null
            : result.state === 'rate_limited' ? 'Zoho asked us to slow down. The next run carries on from here.'
                : result.error ?? null,
    }).eq('id', row.id);
    // The console's "Last read" for the connection this ran through.
    if (grantAddress) await noteMailAccountResult(row.organization_id, grantAddress, worked ? null : result.error ?? 'read failed');
}

/**
 * One pass over every active mailbox on the roster. Never throws for a single
 * mailbox's failure: each one's outcome is recorded on its own row, so one
 * revoked connection cannot stop the others.
 */
export async function runMailArchive(opts: { budgetMs: number; orgId?: string }): Promise<MailboxRunResult[]> {
    const deadline = Date.now() + opts.budgetMs;
    let q = supabaseAdmin.from('mail_archive_mailboxes')
        .select('id, organization_id, address, newest_received_at, backfill_offset, backfill_oldest_at, backfill_done_at')
        .eq('is_active', true)
        .order('added_at', { ascending: true });
    if (opts.orgId) q = q.eq('organization_id', opts.orgId);
    const { data, error } = await q;
    if (error) throw new Error(error.message);

    const results: MailboxRunResult[] = [];
    const live: Live[] = [];

    // Phase A — list new mail, then history.
    for (const row of (data ?? []) as RosterRow[]) {
        const result: MailboxRunResult = {
            address: row.address, state: 'ok', listed: 0, historyPages: 0, historyDone: Boolean(row.backfill_done_at),
            bodiesFetched: 0, bodiesDeduped: 0, bodiesFailed: 0,
        };
        results.push(result);
        if (!(await claim(row.id))) { result.state = 'busy'; continue; }

        let grantAddress: string | null = null;
        try {
            const src = await sourceFor(row.organization_id, row.address);
            if (!src) {
                result.state = 'waiting';
                result.error = `Not connected yet: the owner of ${row.address} needs to press "Connect a mailbox" and sign in to Zoho as themselves.`;
                await finish(row, result, null);
                continue;
            }
            grantAddress = src.grantAddress;
            const folders = new Map((await ZohoMailService.listFolders(src.source, row.address))
                .map((f) => [f.folderId, f.folderName.toLowerCase()] as const));
            const entry: Live = { row, source: src.source, grantAddress, folders, result, drained: false };
            await sweep(entry, deadline);
            await history(entry, deadline);
            live.push(entry);
        } catch (e) {
            result.state = isRateLimited(e) ? 'rate_limited' : 'error';
            result.error = errText(e);
            await finish(row, result, grantAddress);
        }
    }

    // Phase B — email text, round-robin so no mailbox starves the others.
    let turn = live.filter((l) => l.result.state === 'ok');
    while (turn.length && Date.now() < deadline - 15_000) {
        for (const l of turn) {
            if (Date.now() >= deadline - 15_000) break;
            try {
                if (!(await bodies(l))) l.drained = true;
            } catch (e) {
                l.result.state = 'error';
                l.result.error = errText(e);
            }
        }
        turn = turn.filter((l) => !l.drained && l.result.state === 'ok');
    }

    for (const l of live) await finish(l.row, l.result, l.grantAddress);
    return results;
}
