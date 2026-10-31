import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { EVIDENCE_BUCKET } from '@/backend/lib/proctor/access';

/**
 * Removes the camera frames kept for these attempts from the private bucket.
 * Call before deleting the attempts: once their events are gone, nothing
 * points at the files any more. A storage failure is logged, not thrown, so a
 * delete HR asked for still goes through.
 */
export async function removeEvidence(attemptIds: string[]) {
    if (!attemptIds.length) return;
    const { data: events } = await supabaseAdmin.from('proctor_events').select('detail').in('attempt_id', attemptIds);
    const paths = (events || [])
        .map((e) => (e.detail as { evidence_path?: string } | null)?.evidence_path)
        .filter(Boolean) as string[];
    if (!paths.length) return;
    const { error } = await supabaseAdmin.storage.from(EVIDENCE_BUCKET).remove(paths);
    if (error) console.error('[proctor] could not remove evidence frames:', error.message);
}
