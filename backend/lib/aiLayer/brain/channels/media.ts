/**
 * File intake (guardrail G13): a photo or file a person sends is taken in by CODE, before the model is involved, and
 * held for 24 hours, so it can be attached to the ticket or task they describe next and never has to be sent again.
 *
 * - Downloaded at once (provider links expire), https only, at most 10 MB, redirects followed safely.
 * - What it IS comes from its bytes, never from its name or the payload's claim.
 * - Photos are re-encoded to JPEG (at most 1280 px), which also drops camera metadata such as location.
 * - The model is given a handle (A1, A2…), never a path or a link.
 * Pure over injected dependencies.
 */
import { createHash } from 'node:crypto';
import type { AttachmentRef, BrainChannel } from '../types';

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
/** Claude's per-image limit is about 3.75 MB of bytes; a re-encoded photo is far below it. */
export const MAX_MODEL_IMAGE_BYTES = 3_500_000;

export type Fetched = { ok: true; buffer: Buffer; contentType: string } | { ok: false; error: string };
export type Sniffed = { kind: 'excel' } | { kind: 'image'; mimeType: string } | { kind: 'pdf' } | { kind: 'old_excel' } | { kind: 'unknown' };

export interface MediaDeps {
    fetchMedia(url: string): Promise<Fetched>;
    sniff(buffer: Buffer): Sniffed;
    /** Re-encode a photo to a bounded JPEG. */
    toJpeg(buffer: Buffer): Promise<Buffer>;
    listOpen(orgId: string, userId: string): Promise<AttachmentRef[]>;
    findOpenBySha(orgId: string, userId: string, sha256: string): Promise<AttachmentRef | null>;
    save(input: { orgId: string; userId: string; handle: string; kind: 'image' | 'document'; mime: string; bytes: Buffer; sha256: string; caption: string | null; channel: BrainChannel; messageId: string | null; extension: string }): Promise<AttachmentRef>;
}

export interface StageInput { orgId: string; userId: string; url: string; caption: string | null; channel: BrainChannel; messageId: string | null }

export type Staged =
    | { ok: true; attachment: AttachmentRef; /** For the model to look at, this turn only. */ image: { handle: string; mime: string; base64: string } | null }
    | { ok: false; reason: 'download_failed' | 'too_large' | 'unsupported' | 'store_failed'; detail?: string };

/** The next free handle: A1, A2… counted over the person's open files, so a handle is never reused while it is open. */
export function nextHandle(open: Array<Pick<AttachmentRef, 'handle'>>): string {
    const used = open.map(a => Number(a.handle.replace(/^A/i, ''))).filter(Number.isFinite);
    return `A${(used.length ? Math.max(...used) : 0) + 1}`;
}

export async function stageInbound(deps: MediaDeps, input: StageInput): Promise<Staged> {
    const got = await deps.fetchMedia(input.url);
    if (!got.ok) return { ok: false, reason: /too large/i.test(got.error) ? 'too_large' : 'download_failed', detail: got.error };
    if (got.buffer.length > MAX_FILE_BYTES) return { ok: false, reason: 'too_large' };

    const what = deps.sniff(got.buffer);
    let bytes: Buffer; let kind: 'image' | 'document'; let mime: string; let extension: string;
    if (what.kind === 'image') {
        try { bytes = await deps.toJpeg(got.buffer); } catch { return { ok: false, reason: 'unsupported', detail: 'the photo could not be read' }; }
        kind = 'image'; mime = 'image/jpeg'; extension = 'jpg';
    } else if (what.kind === 'pdf') {
        bytes = got.buffer; kind = 'document'; mime = 'application/pdf'; extension = 'pdf';
    } else if (what.kind === 'excel') {
        bytes = got.buffer; kind = 'document'; mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'; extension = 'xlsx';
    } else {
        return { ok: false, reason: 'unsupported', detail: what.kind };
    }

    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const caption = input.caption && input.caption.trim() ? input.caption.trim().slice(0, 300) : null;
    try {
        // The same bytes again (a retried delivery, a double send) are the same file.
        const attachment = (await deps.findOpenBySha(input.orgId, input.userId, sha256))
            ?? await deps.save({ orgId: input.orgId, userId: input.userId, handle: nextHandle(await deps.listOpen(input.orgId, input.userId)), kind, mime, bytes, sha256, caption, channel: input.channel, messageId: input.messageId, extension });
        const image = kind === 'image' && bytes.length <= MAX_MODEL_IMAGE_BYTES ? { handle: attachment.handle, mime, base64: bytes.toString('base64') } : null;
        return { ok: true, attachment, image };
    } catch (err) {
        return { ok: false, reason: 'store_failed', detail: err instanceof Error ? err.message : String(err) };
    }
}
