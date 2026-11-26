import type { SupabaseClient } from '@supabase/supabase-js';
import { CandidateActionError } from './records';

const TABLE = 'interview_analysis_consents';

export async function hasInterviewConsent(db: SupabaseClient, orgId: string, candidateId: string, meetingId: string) {
  const { data, error } = await db.from(TABLE).select('meeting_id').eq('organization_id', orgId)
    .eq('candidate_id', candidateId).eq('meeting_id', meetingId).maybeSingle();
  return !error && !!data;
}

export async function saveInterviewConsent(db: SupabaseClient, orgId: string, candidateId: string, meetingId: string, witness?: string) {
  const { error } = await db.from(TABLE).insert({ organization_id: orgId, candidate_id: candidateId, meeting_id: meetingId,
    source: witness ? 'in_person_verbal' : 'candidate_invite', witnessed_by: witness ?? null });
  if (error?.code === '23505' && await hasInterviewConsent(db, orgId, candidateId, meetingId)) return;
  if (error) throw new CandidateActionError(503, 'Interview analysis consent could not be saved. Please retry.');
}

/** Manual calls predate meeting links and keep their existing consent policy. */
export async function callMayRun(db: SupabaseClient, orgId: string, callId: string, candidateId: string | null) {
  const read = (columns: string) => db.from('call_analyses').select(columns).eq('organization_id', orgId).eq('id', callId).maybeSingle();
  let result = await read('meeting_id');
  if (result.error && ['42703', 'PGRST204'].includes(result.error.code) && /meeting_id/.test(result.error.message)) result = await read('*');
  const data = result.data as { meeting_id?: string | null } | null;
  if (result.error || !data) return false;
  return !data.meeting_id || (!!candidateId && await hasInterviewConsent(db, orgId, candidateId, data.meeting_id));
}
