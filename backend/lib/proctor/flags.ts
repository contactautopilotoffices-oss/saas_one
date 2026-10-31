import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { EVIDENCE_BUCKET, type ProctorQuestion } from '@/backend/lib/proctor/access';
import { grade } from '@/backend/lib/proctor/grade';

/**
 * One proctoring flag — from the server's camera check or from the detector
 * running in the candidate's browser — turned into a warning, and maybe a
 * strike. Both sources come through here, so they count the same way:
 *   · every flag warns the taker;
 *   · at most one flag in STRIKE_GAP_MS counts as a strike, so the taker sees
 *     each problem straight away and has time to put it right;
 *   · at the test's strike limit (default 3) the attempt closes, and the
 *     answers autosaved so far are graded as a partial score;
 *   · the frame is kept as evidence for the reviewer.
 */

export type FlagCategory = 'multiple_faces' | 'phone' | 'no_face' | 'looking_away';

export const WARNING_CATEGORIES: FlagCategory[] = ['no_face', 'multiple_faces', 'phone', 'looking_away'];

/** Owner 2026-10-31: every warning keeps its frame, so the reviewer can see each one for themselves. */
const EVIDENCE_CATEGORIES: FlagCategory[] = ['no_face', 'multiple_faces', 'phone', 'looking_away'];

export const STRIKE_GAP_MS = 20_000;

export const WARNING_MESSAGE: Record<FlagCategory, string> = {
    no_face: 'Your face is not visible — look into the camera',
    multiple_faces: 'Only you should be in view — someone else was seen on camera',
    phone: 'Put away phones and other devices',
    looking_away: 'Keep your head and eyes on the screen',
};

export const isFlagCategory = (c: unknown): c is FlagCategory => WARNING_CATEGORIES.includes(c as FlagCategory);

type CountedDetail = { category?: string; counted?: boolean } | null;
const countsAsStrike = (d: CountedDetail) =>
    // Flags from before the 20s gap existed carry no "counted"; they all counted.
    isFlagCategory(d?.category) && d?.counted !== false;

export async function recordFlag(opts: {
    attemptId: string;
    test: { questions: ProctorQuestion[]; look_away_strikes: number };
    answers: Record<string, unknown> | null;
    category: FlagCategory;
    /** Stored on the event: the model's verdict, or what the device detector measured. */
    detail: Record<string, unknown>;
    /** JPEG data URL; kept only for categories a reviewer must judge. */
    image?: string | null;
}) {
    const { attemptId: id, test, category } = opts;

    let evidencePath: string | null = null;
    if (opts.image && EVIDENCE_CATEGORIES.includes(category)) {
        const path = `${id}/${Date.now()}-${category}.jpg`;
        const { error } = await supabaseAdmin.storage
            .from(EVIDENCE_BUCKET)
            .upload(path, Buffer.from(opts.image.split(',')[1] || '', 'base64'), { contentType: 'image/jpeg', upsert: false });
        if (error) console.error('[proctor] evidence upload failed:', error.message);
        else evidencePath = path;
    }

    // Strikes are counted from the event log, so a reload or a second tab can't reset them.
    const { data: flagRows } = await supabaseAdmin.from('proctor_events').select('detail, created_at').eq('attempt_id', id).eq('kind', 'ai_flag');
    let priorStrikes = 0;
    let lastStrikeAt = 0;
    for (const r of flagRows || []) {
        if (countsAsStrike(r.detail as CountedDetail)) {
            priorStrikes++;
            lastStrikeAt = Math.max(lastStrikeAt, new Date(r.created_at).getTime());
        }
    }
    let counted = Date.now() - lastStrikeAt >= STRIKE_GAP_MS;

    const [{ data: inserted }] = await Promise.all([
        supabaseAdmin.from('proctor_events')
            .insert({ attempt_id: id, kind: 'ai_flag', detail: { ...opts.detail, category, evidence_path: evidencePath, counted } })
            .select('id, created_at')
            .single(),
        supabaseAdmin.rpc('proctor_bump_ai_counts', { p_attempt_id: id, p_flagged: true }),
    ]);

    // The camera check and the device detector can flag at the same moment. Only the first
    // counted flag inside the gap keeps its strike; a later one becomes a reminder.
    if (counted && inserted) {
        const since = new Date(new Date(inserted.created_at).getTime() - STRIKE_GAP_MS).toISOString();
        const { data: recent } = await supabaseAdmin
            .from('proctor_events')
            .select('id, detail, created_at')
            .eq('attempt_id', id)
            .eq('kind', 'ai_flag')
            .gte('created_at', since)
            .order('created_at', { ascending: true })
            .order('id', { ascending: true });
        const first = (recent || []).find((r) => (r.detail as CountedDetail)?.counted === true);
        if (first && first.id !== inserted.id) {
            counted = false;
            await supabaseAdmin.from('proctor_events')
                .update({ detail: { ...opts.detail, category, evidence_path: evidencePath, counted: false } })
                .eq('id', inserted.id);
        }
    }

    const strikes = priorStrikes + (counted ? 1 : 0);
    const allowed = test.look_away_strikes || 3;
    const message = WARNING_MESSAGE[category];

    if (counted && strikes >= allowed) {
        const { data: closed } = await supabaseAdmin
            .from('proctor_attempts')
            .update({
                status: 'terminated',
                termination_reason: 'looking_away',
                ...grade(test.questions || [], (opts.answers || {}) as Record<string, number>),
                ended_at: new Date().toISOString(),
            })
            .eq('id', id)
            .eq('status', 'in_progress')
            .select('id')
            .maybeSingle();
        if (closed) {
            await supabaseAdmin.from('proctor_events').insert({ attempt_id: id, kind: 'looking_away', detail: { strikes, allowed } });
        }
        return { ok: true, warn: true, status: 'terminated', message, strikes, strikes_allowed: allowed };
    }

    // counted false: inside the 20s gap — the taker is reminded, but it isn't a new strike.
    return { ok: true, warn: true, counted, message, strikes, strikes_allowed: allowed };
}
