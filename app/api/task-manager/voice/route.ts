import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { TaskManagerAuth } from '../_shared/adminGuard';
import { TaskDatabaseService } from '@/task-manager/TaskDatabaseService';
import { TaskAccessService } from '@/task-manager/TaskAccessService';
import { isMissingSchema } from '@/task-manager/TaskLinks';
import { embed, health } from '@/task-manager/voice/VoiceIdClient';

export const dynamic = 'force-dynamic';
export const maxDuration = 90;

/**
 * LiveVoice ID (owner 2026-11-02): "My voice" in Settings. ANY signed-in person may set up, replace or delete their OWN
 * voice; nobody can do it for someone else (the person always comes from the session, never from the request).
 *
 *   GET      my voice (set up or not), the voice server's state, and whether meetings I start use voices
 *   POST     { clips: [base64 audio x 3], consent: true, consentVersion }   make my voiceprint and save it
 *   DELETE   delete my voiceprint
 *
 * The audio clips are passed to the voice server once and never stored. Only the voiceprint (numbers) is saved.
 * Plan: docs/LIVEVOICE_ID_PLAN.md
 */

const CONSENT_VERSION = 'voice-v1-2026-11-03';
const MAX_CLIP_CHARS = 2_800_000;   // ~2 MB of audio once decoded; a 6-second clip from the browser is far smaller

const NOT_READY = 'Voice setup is not ready yet. Please ask the admin to apply the latest database update (voice_id).';
const fail = (status: number, error: string, extra: Record<string, unknown> = {}) => NextResponse.json({ success: false, error, ...extra }, { status });

const REASONS: Record<string, string> = {
    clip_quality: 'Some recordings were not clear enough. Please record those again.',
    clips_disagree: 'The recordings did not sound like the same voice. Please record all three again in a quiet place.',
    server_unavailable: 'The voice server is waking up. Please wait a minute and press Save again.',
    not_configured: 'The voice server is not set up yet. Please ask the admin.',
    model_not_loaded: 'The voice server is still starting. Please wait a minute and press Save again.',
    decode_failed: 'A recording could not be read. Please record it again.',
};

export async function GET() {
    const user = await TaskManagerAuth.currentUser();
    if (!user) return fail(401, 'Unauthorized');
    const [profile, server, employee, switches] = await Promise.all([
        supabaseAdmin.from('voice_profiles').select('clip_agreement, updated_at').eq('user_id', user.id).maybeSingle(),
        health(),
        TaskDatabaseService.getEmployeeById(user.id).catch(() => null),
        TaskAccessService.getVoiceIdDepartments(),
    ]);
    const setupMissing = !!profile.error && isMissingSchema(profile.error);
    if (profile.error && !setupMissing) console.error('[VoiceAPI] read failed:', profile.error.message);
    return NextResponse.json({
        success: true,
        setupMissing,
        me: profile.data ? { enrolled: true, updatedAt: profile.data.updated_at, clipAgreement: profile.data.clip_agreement } : { enrolled: false },
        server: { state: server.state, detail: server.state === 'online' ? null : server.detail ?? null },
        // Meetings I start name who spoke (my department has the switch ON)
        meetingVoiceOn: !!employee?.department_id && switches.departments.has(employee.department_id),
        consentVersion: CONSENT_VERSION,
    });
}

export async function POST(request: Request) {
    const user = await TaskManagerAuth.currentUser();
    if (!user) return fail(401, 'Unauthorized');
    const body = (await request.json().catch(() => null)) as { clips?: unknown; consent?: unknown; consentVersion?: unknown } | null;
    if (body?.consent !== true || body.consentVersion !== CONSENT_VERSION) return fail(400, 'Please read and accept how your voice is used first.');
    const clips = Array.isArray(body.clips) ? body.clips : [];
    if (clips.length !== 3 || clips.some(c => typeof c !== 'string' || c.length < 100 || c.length > MAX_CLIP_CHARS)) {
        return fail(400, 'Please record all three sentences.');
    }

    const result = await embed(clips as string[]);
    if (!result.ok) {
        // `clips` says which recording had which problem, so the screen can ask for just those again
        return fail(result.reason === 'server_unavailable' || result.reason === 'not_configured' ? 503 : 422,
            REASONS[result.reason] ?? 'Your voice could not be set up. Please try again.', { reason: result.reason, clips: result.clips ?? null });
    }

    const now = new Date().toISOString();
    const { error } = await supabaseAdmin.from('voice_profiles').upsert({
        user_id: user.id, voiceprint: result.voiceprint, model: result.model, model_revision: result.revision,
        clip_agreement: result.clipAgreement, consent_version: CONSENT_VERSION, consented_at: now, updated_at: now,
    }, { onConflict: 'user_id' });
    if (error) {
        if (isMissingSchema(error)) return fail(503, NOT_READY);
        console.error('[VoiceAPI] save failed:', error.message);
        return fail(500, 'Your voice could not be saved. Please try again.');
    }
    await TaskDatabaseService.logAudit({ eventType: 'voice_profile_saved', actorId: user.id, details: { clipAgreement: Math.round(result.clipAgreement * 100) / 100 } });
    return NextResponse.json({ success: true, me: { enrolled: true, updatedAt: now, clipAgreement: result.clipAgreement } });
}

export async function DELETE() {
    const user = await TaskManagerAuth.currentUser();
    if (!user) return fail(401, 'Unauthorized');
    const { error } = await supabaseAdmin.from('voice_profiles').delete().eq('user_id', user.id);
    if (error) {
        if (isMissingSchema(error)) return fail(503, NOT_READY);
        console.error('[VoiceAPI] delete failed:', error.message);
        return fail(500, 'Your voice could not be deleted. Please try again.');
    }
    await TaskDatabaseService.logAudit({ eventType: 'voice_profile_deleted', actorId: user.id, details: {} });
    return NextResponse.json({ success: true, me: { enrolled: false } });
}
