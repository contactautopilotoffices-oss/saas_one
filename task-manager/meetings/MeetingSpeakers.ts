import type { SpeakerResult, VoiceSegment } from '../voice/VoiceIdClient';
import type { TranscriptLine } from './MeetingTranscriber';

/**
 * LiveVoice ID — the meeting side of speaker naming, as pure functions (no database, no network) so it is easy to test.
 *
 *   segmentsFor()   transcript lines (one timeline across recordings) → per-recording segments for the voice service
 *   applyNames()    the voice service's answer → transcript lines with the person's name, keeping the original label
 *
 * A line keeps "Speaker N" unless that voice was matched with confidence. Plan: docs/LIVEVOICE_ID_PLAN.md (3.2)
 */

/** Which recording a moment on the joined timeline belongs to (offsets[i] = where recording i starts). */
export function fileIndexFor(start: number, offsets: number[]): number {
    let idx = 0;
    for (let i = 0; i < offsets.length; i++) if (start >= offsets[i]) idx = i;
    return idx;
}

/** Lines with a diarization label → segments in each recording's own time. Lines without a label are skipped. */
export function segmentsFor(lines: TranscriptLine[], offsets: number[]): VoiceSegment[] {
    const out: VoiceSegment[] = [];
    const starts = offsets.length ? offsets : [0];
    for (const l of lines) {
        const label = l.voiceLabel ?? l.speaker;
        if (!label || !(l.end > l.start)) continue;
        const file = fileIndexFor(l.start, starts);
        const base = starts[file] ?? 0;
        out.push({ file, start: Math.max(0, l.start - base), end: Math.max(0, l.end - base), speaker: label });
    }
    return out;
}

export interface SpeakerMapping {
    speaker: string;
    userId: string | null;
    score: number | null;
    second: number | null;
    secondsUsed: number;
    reason: SpeakerResult['reason'];
}

/**
 * Puts names on the lines whose voice was matched. `voiceLabel` keeps Sarvam's "Speaker N" so a reviewer can correct a
 * whole voice at once, and so running this again never matches a name against a name.
 */
export function applyNames(lines: TranscriptLine[], results: SpeakerResult[], nameOf: Map<string, string>): {
    lines: TranscriptLine[];
    mapping: SpeakerMapping[];
    matched: number;
} {
    const userFor = new Map<string, string>();
    for (const r of results) if (r.reason === 'matched' && r.match && nameOf.has(r.match)) userFor.set(r.speaker, r.match);
    const named = lines.map(l => {
        const label = l.voiceLabel ?? l.speaker;
        if (!label) return l;
        const userId = userFor.get(label) ?? null;
        return { ...l, voiceLabel: label, speaker: userId ? nameOf.get(userId)! : label, speakerUserId: userId };
    });
    const mapping = results.map(r => ({
        speaker: r.speaker, userId: userFor.get(r.speaker) ?? null, score: r.score, second: r.second,
        secondsUsed: r.seconds_used, reason: r.reason,
    }));
    return { lines: named, mapping, matched: userFor.size };
}

/** Distinct diarization labels in a transcript ("Speaker 1", "Speaker 2", …). */
export function voiceLabels(lines: TranscriptLine[]): string[] {
    return [...new Set(lines.map(l => l.voiceLabel ?? l.speaker).filter((s): s is string => !!s))];
}
