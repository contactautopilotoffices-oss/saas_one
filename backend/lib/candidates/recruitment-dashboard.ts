/**
 * The recruitment dashboard (owner 2026-11-21; spec "Dashboard views": Today for the recruiter, Roles for the HR Head
 * and Director, Funnel for the HR Head). Counts come straight from the records, so they match them exactly (scenario 25).
 *   Today  : interviews today (India time), scorecards still empty after their interview, people waiting over 2 days in
 *            the early rounds, offers waiting for an answer or an approval.
 *   Roles  : open positions with age against the target, recruiter, people in the pipeline and the next action; ageing
 *            roles first (A21).
 *   Funnel : people per board column across the open positions, with how many were rejected in each.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { listPositions } from "./positions";
import { boardColumns, findStage } from "./stage-list";
import { loadStages } from "./stages";
import type { InterviewStatus, OfferStatus, RecruitmentDashboard } from "./types";

const DAY = 86_400_000;

export async function recruitmentDashboard(client: SupabaseClient, orgId: string, now = new Date()): Promise<RecruitmentDashboard> {
  const [{ stages }, positions] = await Promise.all([loadStages(client, orgId), listPositions(client, orgId, "open")]);
  const columns = boardColumns(stages, () => true);
  const columnOf = new Map(columns.flatMap((c, i) => c.stages.map((s) => [s.key, i] as const)));
  const titleOf = new Map(positions.map((p) => [p.id, p.title]));
  const positionIds = positions.map((p) => p.id);

  // Today in India: midnight to midnight IST.
  const ist = new Date(now.getTime() + 5.5 * 3_600_000);
  const start = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()) - 5.5 * 3_600_000);
  const end = new Date(start.getTime() + DAY);

  const [ivs, cards, members, offers] = await Promise.all([
    client.from("recruitment_interviews").select("id, candidate_id, position_id, round, at, mode, status").eq("organization_id", orgId).gte("at", start.toISOString()).lt("at", end.toISOString()).neq("status", "cancelled").order("at"),
    client.from("recruitment_scorecards").select("interview_id, panel_name").eq("organization_id", orgId).is("submitted_at", null).limit(500),
    positionIds.length ? client.from("candidate_position_members").select("candidate_id, position_id, stage, stage_changed_at").eq("organization_id", orgId).in("position_id", positionIds).is("deleted_at", null) : Promise.resolve({ data: [], error: null }),
    client.from("recruitment_offers").select("id, candidate_id, position_id, status, level_entered_at, released_at").eq("organization_id", orgId).in("status", ["pending", "released"]),
  ]);
  const memberRows = (members.data ?? []) as { candidate_id: string; position_id: string; stage: string; stage_changed_at: string }[];
  const cardRows = (cards.error ? [] : cards.data ?? []) as { interview_id: string; panel_name: string | null }[];
  const cardInterviews = cardRows.length
    ? ((await client.from("recruitment_interviews").select("id, candidate_id, round, at, status").in("id", [...new Set(cardRows.map((c) => c.interview_id))]).lt("at", now.toISOString())).data ?? []) as { id: string; candidate_id: string; round: string | null; at: string; status: InterviewStatus }[]
    : [];
  const ivRows = (ivs.error ? [] : ivs.data ?? []) as { id: string; candidate_id: string; position_id: string | null; round: string | null; at: string; mode: string | null; status: InterviewStatus }[];
  const offerRows = (offers.error ? [] : offers.data ?? []) as { id: string; candidate_id: string; position_id: string | null; status: OfferStatus; level_entered_at: string | null; released_at: string | null }[];
  const early = memberRows.filter((m) => {
    const s = findStage(stages, m.stage);
    return s?.kind === "progress" && (columnOf.get(m.stage) ?? 99) < 2 && now.getTime() - new Date(m.stage_changed_at).getTime() > 2 * DAY;
  });

  const ids = [...new Set([...ivRows.map((r) => r.candidate_id), ...cardInterviews.map((r) => r.candidate_id), ...early.map((m) => m.candidate_id), ...offerRows.map((o) => o.candidate_id)])];
  const names = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await client.from("candidates").select("id, full_name").in("id", ids.slice(i, i + 200));
    for (const p of (data ?? []) as { id: string; full_name: string }[]) names.set(p.id, p.full_name);
  }
  const name = (id: string) => names.get(id) ?? "Candidate";
  const days = (v: string | null) => (v ? Math.max(0, Math.floor((now.getTime() - new Date(v).getTime()) / DAY)) : 0);
  const pastInterview = new Map(cardInterviews.filter((r) => r.status !== "cancelled" && r.status !== "no_show").map((r) => [r.id, r]));

  const inPipeline = (positionId: string) => memberRows.filter((m) => m.position_id === positionId && findStage(stages, m.stage)?.kind !== "rejected").length;
  const roles = positions.map((p) => {
    const n = inPipeline(p.id);
    const ageing = p.daysOpen > p.targetDays;
    const nextAction = !p.recruiterId ? "Assign a recruiter" : n === 0 ? "Source candidates (search the database first)" : offerRows.some((o) => o.position_id === p.id) ? "Follow up the offer" : "Move the pipeline on";
    return { id: p.id, title: p.title, location: p.location, recruiterName: p.recruiterName, daysOpen: p.daysOpen, targetDays: p.targetDays, ageing, inPipeline: n, nextAction };
  }).sort((a, b) => Number(b.ageing) - Number(a.ageing) || b.daysOpen - a.daysOpen);

  const funnel = columns.map((c) => ({
    column: c.name,
    count: memberRows.filter((m) => c.stages.some((s) => s.key === m.stage && s.kind !== "rejected")).length,
    rejected: memberRows.filter((m) => c.stages.some((s) => s.key === m.stage && s.kind === "rejected")).length,
  }));

  return {
    today: {
      interviews: ivRows.map((r) => ({ id: r.id, candidateName: name(r.candidate_id), round: r.round, positionTitle: r.position_id ? titleOf.get(r.position_id) ?? null : null, at: r.at, mode: r.mode, status: r.status })),
      scorecardsPending: cardRows.filter((c) => pastInterview.has(c.interview_id)).map((c) => {
        const r = pastInterview.get(c.interview_id)!;
        return { interviewId: c.interview_id, candidateName: name(r.candidate_id), panelName: c.panel_name, round: r.round, at: r.at };
      }),
      waiting: early.map((m) => ({ candidateName: name(m.candidate_id), positionTitle: titleOf.get(m.position_id) ?? "—", stageName: findStage(stages, m.stage)?.name ?? m.stage, days: days(m.stage_changed_at) })).sort((a, b) => b.days - a.days),
      offersAwaiting: offerRows.map((o) => ({ id: o.id, candidateName: name(o.candidate_id), positionTitle: o.position_id ? titleOf.get(o.position_id) ?? null : null, status: o.status, days: days(o.status === "released" ? o.released_at : o.level_entered_at) })),
    },
    roles,
    funnel,
  };
}
