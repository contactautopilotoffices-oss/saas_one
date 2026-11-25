/**
 * The hiring manager's view (owner 2026-11-24, product safety; 23 Nov meeting: "the hiring manager's opinion stays
 * unbiased"). The manager who raised a hiring request, and the head of its department, see the candidates in that
 * role's pipeline: where each one stands, their experience and current role, the interviews, the panel's scorecards and
 * the assignment they submitted. Never shown here: any salary figure (current, expected or offered CTC), the AI's
 * assignment score, contact details, or the HR team's notes.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { interviewExtras } from "./hiring";
import { listMembers } from "./positions";
import { headOfDepartment, loadRecruitmentConfig } from "./requisitions";
import { loadStages } from "./stages";

export interface HmCandidate {
  memberId: string; name: string; stage: string; stageName: string; stageChangedAt: string;
  currentDesignation: string | null; currentOrganization: string | null; totalExpYears: number | null; noticePeriodDays: number | null;
  location: string | null;
  interviews: { round: string | null; at: string; mode: string | null; status: string; scorecards: { panelName: string | null; overall: number | null; recommendation: string | null; comments: string | null }[] }[];
  assignment: { title: string; status: string; submittedAt: string | null; submissionLink: string | null } | null;
}
export interface HmPosition { id: string; title: string; location: string | null; status: string; requisitionNo: string | null; candidates: HmCandidate[] }

/** The positions this person may follow: from the requests they raised, and (as its head) their department's. */
async function positionsFor(client: SupabaseClient, orgId: string, userId: string): Promise<{ id: string; title: string; location: string | null; status: string; requisitionNo: string | null }[]> {
  const [config, { data: reqs }] = await Promise.all([
    loadRecruitmentConfig(client, orgId),
    client.from("recruitment_requisitions").select("position_id, requisition_no, raised_by, department").eq("organization_id", orgId).not("position_id", "is", null).is("deleted_at", null).limit(500),
  ]);
  const mine = ((reqs ?? []) as { position_id: string; requisition_no: string | null; raised_by: string | null; department: string | null }[])
    .filter((r) => r.raised_by === userId || headOfDepartment(config, r.department) === userId);
  if (!mine.length) return [];
  const reqNo = new Map(mine.map((r) => [r.position_id, r.requisition_no]));
  const { data: pos } = await client.from("candidate_positions").select("id, title, location, status").eq("organization_id", orgId).in("id", [...reqNo.keys()]).is("deleted_at", null);
  return ((pos ?? []) as { id: string; title: string; location: string | null; status: string }[]).map((p) => ({ ...p, requisitionNo: reqNo.get(p.id) ?? null }));
}

export async function hiringManagerView(client: SupabaseClient, orgId: string, userId: string): Promise<HmPosition[]> {
  const positions = await positionsFor(client, orgId, userId);
  if (!positions.length) return [];
  const { stages } = await loadStages(client, orgId);
  const stageName = new Map(stages.map((s) => [s.key, s.name]));
  const out: HmPosition[] = [];
  for (const p of positions) {
    const members = await listMembers(client, orgId, p.id);
    const candidateIds = members.map((m) => m.candidateId);
    const [{ data: ivs }, { data: asg }] = candidateIds.length ? await Promise.all([
      client.from("recruitment_interviews").select("id, candidate_id, round, at, mode, status").eq("organization_id", orgId).eq("position_id", p.id).in("candidate_id", candidateIds).order("at", { ascending: true }),
      client.from("recruitment_assignments").select("candidate_id, title, status, submitted_at, submission_link, sent_at").eq("organization_id", orgId).eq("position_id", p.id).in("candidate_id", candidateIds).neq("status", "cancelled").order("sent_at", { ascending: false }),
    ]) : [{ data: [] }, { data: [] }];
    const interviews = (ivs ?? []) as { id: string; candidate_id: string; round: string | null; at: string; mode: string | null; status: string }[];
    const extras = interviews.length ? await interviewExtras(client, orgId, interviews.map((i) => i.id)) : new Map();
    const assignments = new Map<string, { title: string; status: string; submitted_at: string | null; submission_link: string | null }>();
    for (const a of (asg ?? []) as { candidate_id: string; title: string; status: string; submitted_at: string | null; submission_link: string | null }[]) if (!assignments.has(a.candidate_id)) assignments.set(a.candidate_id, a);
    out.push({
      ...p,
      candidates: members.map((m) => {
        const r = m.record;
        const a = assignments.get(m.candidateId) ?? null;
        return {
          memberId: m.id, name: r?.fullName ?? "Candidate", stage: m.stage, stageName: stageName.get(m.stage) ?? m.stage, stageChangedAt: m.stageChangedAt,
          currentDesignation: r?.currentDesignation ?? null, currentOrganization: r?.currentOrganization ?? null,
          totalExpYears: r?.totalExpMonths != null ? Math.round((r.totalExpMonths / 12) * 10) / 10 : null, noticePeriodDays: r?.noticePeriodDays ?? null,
          location: r?.location ?? null,
          interviews: interviews.filter((i) => i.candidate_id === m.candidateId).map((i) => ({
            round: i.round, at: i.at, mode: i.mode, status: extras.get(i.id)?.status ?? i.status,
            scorecards: (extras.get(i.id)?.scorecards ?? []).filter((c: { submittedAt: string | null }) => c.submittedAt).map((c: { panelName: string | null; overall: number | null; recommendation: string | null; comments: string | null }) => ({ panelName: c.panelName, overall: c.overall, recommendation: c.recommendation, comments: c.comments })),
          })),
          assignment: a ? { title: a.title, status: a.status, submittedAt: a.submitted_at, submissionLink: a.submission_link } : null,
        };
      }),
    });
  }
  return out;
}
