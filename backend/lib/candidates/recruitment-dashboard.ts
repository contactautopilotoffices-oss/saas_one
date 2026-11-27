/**
 * The recruitment dashboard (owner 2026-11-21; spec "Dashboard views": Today for the recruiter, Roles for the HR Head
 * and Director, Funnel for the HR Head). Counts come straight from the records, so they match them exactly (scenario 25).
 *   Today  : interviews today (India time), scorecards still empty after their interview, people waiting over 2 days in
 *            the early rounds, offers waiting for an answer or an approval.
 *   Roles  : open positions with age against the target, recruiter, people in the pipeline and the next action; ageing
 *            roles first (A21).
 *   Funnel : people per board column across the open positions, with how many were rejected in each.
 *   Metrics (owner 2026-11-24, the last 90 days): time to fill, offer acceptance, rejection reasons, approval
 *            turnaround (hiring requests and offers), and each recruiter's load.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { listPositions, memberScores } from "./positions";
import { boardColumns, findStage } from "./stage-list";
import { loadStages } from "./stages";
import { CandidateActionError, getRecordRows, toRecord } from "./records";
import type { CalendarInterview, InterviewStatus, OfferStatus, RecruitmentDashboard, RecruitmentMetrics, Stage } from "./types";

const DAY = 86_400_000;

export async function recruitmentDashboard(client: SupabaseClient, orgId: string, now = new Date(), includeSpotlight = false): Promise<RecruitmentDashboard> {
  const [{ stages }, positions] = await Promise.all([loadStages(client, orgId), listPositions(client, orgId, "open")]);
  const columns = boardColumns(stages, () => true);
  const columnOf = new Map(columns.flatMap((c, i) => c.stages.map((s) => [s.key, i] as const)));
  const byId = new Map(positions.map(p => [p.id, p]));
  const titleOf = new Map(positions.map((p) => [p.id, p.title]));
  const positionIds = positions.map((p) => p.id);

  // Today in India: midnight to midnight IST.
  const ist = new Date(now.getTime() + 5.5 * 3_600_000);
  const start = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()) - 5.5 * 3_600_000);
  const end = new Date(start.getTime() + DAY);
  const weekStart = start.getTime() - ((ist.getUTCDay() + 6) % 7) * DAY;

  const [ivs, cards, members, offers] = await Promise.all([
    client.from("recruitment_interviews").select("id, candidate_id, position_id, round, at, mode, status").eq("organization_id", orgId).gte("at", new Date(weekStart).toISOString()).lt("at", new Date(weekStart + 7 * DAY).toISOString()).neq("status", "cancelled").order("at"),
    client.from("recruitment_scorecards").select("interview_id, panel_name").eq("organization_id", orgId).is("submitted_at", null).limit(500),
    positionIds.length ? client.from("candidate_position_members").select("id, candidate_id, position_id, application_id, stage, stage_changed_at, added_at, remark").eq("organization_id", orgId).in("position_id", positionIds).is("deleted_at", null) : Promise.resolve({ data: [], error: null }),
    client.from("recruitment_offers").select("id, candidate_id, position_id, status, level_entered_at, released_at, created_at, joining_date").eq("organization_id", orgId).in("status", includeSpotlight ? ["pending", "released", "accepted"] : ["pending", "released"]).order("created_at", { ascending: false }),
  ]);
  if (members.error) throw members.error;
  const memberRows = (members.data ?? []) as { id: string; candidate_id: string; position_id: string; application_id: string | null; stage: Stage; stage_changed_at: string; added_at: string; remark: string | null }[];
  const cardRows = (cards.error ? [] : cards.data ?? []) as { interview_id: string; panel_name: string | null }[];
  const cardInterviews = cardRows.length
    ? ((await client.from("recruitment_interviews").select("id, candidate_id, round, at, status").eq("organization_id", orgId).in("id", [...new Set(cardRows.map((c) => c.interview_id))]).lt("at", now.toISOString())).data ?? []) as { id: string; candidate_id: string; round: string | null; at: string; status: InterviewStatus }[]
    : [];
  const weekRows = (ivs.error ? [] : ivs.data ?? []) as { id: string; candidate_id: string; position_id: string | null; round: string | null; at: string; mode: string | null; status: InterviewStatus }[];
  const ivRows = weekRows.filter(iv => { const at = Date.parse(iv.at); return at >= start.getTime() && at < end.getTime(); });
  const interviewWeek = Array.from({ length: 7 }, (_, i) => {
    const day = weekStart + i * DAY;
    return { date: new Date(day + 5.5 * 3_600_000).toISOString().slice(0, 10), count: weekRows.filter(iv => Math.floor((Date.parse(iv.at) - day) / DAY) === 0).length };
  });
  const offersInPlay = (offers.error ? [] : offers.data ?? []) as { id: string; candidate_id: string; position_id: string | null; status: OfferStatus; level_entered_at: string | null; released_at: string | null; created_at: string; joining_date: string | null }[];
  const offerRows = offersInPlay.filter(o => o.status !== "accepted");
  const early = memberRows.filter((m) => {
    const s = findStage(stages, m.stage);
    return s?.kind === "progress" && (columnOf.get(m.stage) ?? 99) < 2 && now.getTime() - new Date(m.stage_changed_at).getTime() > 2 * DAY;
  });

  const ids = [...new Set([...ivRows.map((r) => r.candidate_id), ...cardInterviews.map((r) => r.candidate_id), ...early.map((m) => m.candidate_id), ...offersInPlay.map((o) => o.candidate_id)])];
  const names = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await client.from("candidates").select("id, full_name").in("id", ids.slice(i, i + 200));
    for (const p of (data ?? []) as { id: string; full_name: string }[]) names.set(p.id, p.full_name);
  }
  const name = (id: string) => names.get(id) ?? "Candidate";
  const days = (v: string | null) => (v ? Math.max(0, Math.floor((now.getTime() - new Date(v).getTime()) / DAY)) : 0);
  const summarizeOffer = (o: typeof offerRows[number]) => ({
    id: o.id, candidateName: name(o.candidate_id), positionTitle: o.position_id ? titleOf.get(o.position_id) ?? null : null,
    status: o.status, days: days(o.status === "pending" ? o.level_entered_at : o.released_at),
  });
  const pastInterview = new Map(cardInterviews.filter((r) => r.status !== "cancelled" && r.status !== "no_show").map((r) => [r.id, r]));

  const inPipeline = (positionId: string) => memberRows.filter((m) => m.position_id === positionId && findStage(stages, m.stage)?.kind !== "rejected").length;
  const isRejected = (stage: string) => findStage(stages, stage)?.kind === "rejected";
  const active = memberRows.filter(m => findStage(stages, m.stage)?.kind === "progress");
  const recentDays = (dates: string[]) => {
    const buckets = new Array<number>(7).fill(0);
    for (const date of dates) {
      const i = Math.floor((+new Date(date) - start.getTime()) / DAY) + 6;
      if (i >= 0 && i < buckets.length) buckets[i]++;
    }
    return buckets;
  };
  let spotlight: RecruitmentDashboard["spotlight"];
  if (includeSpotlight) {
    // shortcut: show 12 recent applications, add paginated scoring if the hub needs a full ranking.
    const recent = active.filter(m => m.application_id).sort((a, b) => +new Date(b.stage_changed_at) - +new Date(a.stage_changed_at) || a.candidate_id.localeCompare(b.candidate_id));
    const seen = new Set<string>();
    const selected = recent.filter(m => {
      if (seen.has(m.candidate_id)) return false;
      seen.add(m.candidate_id);
      return true;
    }).slice(0, 12);
    const [records, ...scores] = await Promise.all([
      getRecordRows(client, orgId, selected.map(m => m.application_id!)),
      ...[...new Set(selected.map(m => m.position_id))].map(async positionId => [positionId, await memberScores(client, orgId, positionId, selected.filter(m => m.position_id === positionId).map(m => m.candidate_id))] as const),
    ]);
    const byPosition = new Map(scores);
    const byApplication = new Map(records.filter(r => !r.deleted_at).map(r => [r.id, toRecord(r)]));
    spotlight = selected.flatMap(m => {
      const record = byApplication.get(m.application_id!);
      const position = byId.get(m.position_id);
      if (!record || !position) return [];
      const score = byPosition.get(m.position_id)?.get(m.candidate_id) ?? null;
      return [{ record, position, column: columns[columnOf.get(m.stage) ?? -1]?.name ?? m.stage, member: {
        id: m.id, positionId: m.position_id, candidateId: m.candidate_id, applicationId: m.application_id, stage: m.stage,
        stageChangedAt: m.stage_changed_at, stageChangedByName: null, addedAt: m.added_at, remark: m.remark, record: null, score,
      } }];
    }).sort((a, b) => (b.member.score?.overall ?? -1) - (a.member.score?.overall ?? -1));
  }
  const roles = positions.map((p) => {
    const n = inPipeline(p.id);
    const ageing = p.daysOpen > p.targetDays;
    const nextAction = !p.recruiterId ? "Assign a recruiter" : n === 0 ? "Source candidates (search the database first)" : offerRows.some((o) => o.position_id === p.id) ? "Follow up the offer" : "Move the pipeline on";
    const mine = memberRows.filter((m) => m.position_id === p.id);
    const inColumn = (rejected: boolean) => columns.map((_, i) => mine.filter((m) => columnOf.get(m.stage) === i && isRejected(m.stage) === rejected).length);
    return { id: p.id, title: p.title, location: p.location, recruiterName: p.recruiterName, daysOpen: p.daysOpen, targetDays: p.targetDays, ageing, inPipeline: n, nextAction, byColumn: inColumn(false), rejectedByColumn: inColumn(true) };
  }).sort((a, b) => Number(b.ageing) - Number(a.ageing) || b.daysOpen - a.daysOpen);

  const sources = await pipelineSources(client, orgId, [...new Set(memberRows.map((m) => m.candidate_id))]).catch((error) => {
    console.error("[candidates] dashboard sources failed", error);
    return [];
  });

  const funnel = columns.map((c) => ({
    column: c.name,
    count: memberRows.filter((m) => c.stages.some((s) => s.key === m.stage && s.kind !== "rejected")).length,
    rejected: memberRows.filter((m) => c.stages.some((s) => s.key === m.stage && s.kind === "rejected")).length,
  }));

  const metrics = await recruitmentMetrics(client, orgId, now, roles, stages).catch((error) => {
    console.error("[candidates] dashboard metrics failed", error);
    return undefined;
  });

  return {
    activeCandidates: new Set(active.map(m => m.candidate_id)).size,
    interviewWeek,
    activity: includeSpotlight ? {
      openings: recentDays(positions.map(p => p.createdAt)),
      candidateMoves: recentDays(active.map(m => m.stage_changed_at)),
      offers: recentDays(offerRows.map(o => o.created_at)),
    } : undefined,
    spotlight,
    offersInPlay: includeSpotlight ? offersInPlay.map(o => ({ ...summarizeOffer(o), joiningDate: o.joining_date ? new Date(o.joining_date).toISOString().slice(0, 10) : null })) : undefined,
    metrics,
    today: {
      interviews: ivRows.map((r) => ({ id: r.id, candidateName: name(r.candidate_id), round: r.round, positionTitle: r.position_id ? titleOf.get(r.position_id) ?? null : null, at: r.at, mode: r.mode, status: r.status })),
      scorecardsPending: cardRows.filter((c) => pastInterview.has(c.interview_id)).map((c) => {
        const r = pastInterview.get(c.interview_id)!;
        return { interviewId: c.interview_id, candidateName: name(r.candidate_id), panelName: c.panel_name, round: r.round, at: r.at };
      }),
      waiting: early.map((m) => ({ candidateName: name(m.candidate_id), positionTitle: titleOf.get(m.position_id) ?? "—", stageName: findStage(stages, m.stage)?.name ?? m.stage, days: days(m.stage_changed_at) })).sort((a, b) => b.days - a.days),
      offersAwaiting: offerRows.map(summarizeOffer),
    },
    roles,
    funnel,
    sources,
  };
}

/** The longest span the calendar may ask for at once (a month view), in days. */
export const CALENDAR_MAX_DAYS = 42;

/**
 * Owner 2026-11-25 (Hub → Interviews): every interview from `from` up to `to` (ISO instants), across all candidates,
 * with the person's name, the position, and the panel from its scorecards. Cancelled ones are left out. Read-only.
 */
export async function interviewsBetween(client: SupabaseClient, orgId: string, from: Date, to: Date): Promise<CalendarInterview[]> {
  if (!(to > from) || to.getTime() - from.getTime() > CALENDAR_MAX_DAYS * DAY) throw new CandidateActionError(400, `Ask for up to ${CALENDAR_MAX_DAYS} days at a time.`);
  const { data, error } = await client.from("recruitment_interviews").select("id, candidate_id, application_id, position_id, round, at, mode, venue, status, join_path")
    .eq("organization_id", orgId).gte("at", from.toISOString()).lt("at", to.toISOString()).neq("status", "cancelled").order("at").limit(1000);
  if (error) throw error;
  const rows = (data ?? []) as { id: string; candidate_id: string; application_id: string | null; position_id: string | null; round: string | null; at: string; mode: string | null; venue: string | null; status: InterviewStatus; join_path: string | null }[];
  if (!rows.length) return [];
  const candidateIds = [...new Set(rows.map((r) => r.candidate_id))];
  const positionIds = [...new Set(rows.map((r) => r.position_id).filter((id): id is string => !!id))];
  const names = new Map<string, string>();
  for (let i = 0; i < candidateIds.length; i += 200) {
    const { data: people } = await client.from("candidates").select("id, full_name").in("id", candidateIds.slice(i, i + 200));
    for (const p of (people ?? []) as { id: string; full_name: string }[]) names.set(p.id, p.full_name);
  }
  const [positions, cards] = await Promise.all([
    positionIds.length ? client.from("candidate_positions").select("id, title").eq("organization_id", orgId).in("id", positionIds) : Promise.resolve({ data: [], error: null }),
    client.from("recruitment_scorecards").select("interview_id, panel_name").eq("organization_id", orgId).in("interview_id", rows.map((r) => r.id)),
  ]);
  const titles = new Map(((positions.data ?? []) as { id: string; title: string }[]).map((p) => [p.id, p.title]));
  const panel = new Map<string, string[]>();
  for (const c of (cards.error ? [] : cards.data ?? []) as { interview_id: string; panel_name: string | null }[]) {
    if (c.panel_name) panel.set(c.interview_id, [...(panel.get(c.interview_id) ?? []), c.panel_name]);
  }
  return rows.map((r) => ({
    id: r.id, candidateId: r.candidate_id, applicationId: r.application_id, joinPath: /^\/(?:meet\/[a-f0-9-]{36}|guest\/[\w-]{32})$/i.test(r.join_path ?? "") ? r.join_path : null, candidateName: names.get(r.candidate_id) ?? "Candidate",
    positionTitle: r.position_id ? titles.get(r.position_id) ?? null : null, round: r.round, at: new Date(r.at).toISOString(),
    mode: r.mode, venue: r.venue, status: r.status, panel: panel.get(r.id) ?? [],
  }));
}

/**
 * Where these people came from (owner 2026-11-25): the source on each person's newest candidate record, counted once
 * per person. A person can have several records (one per sheet); the newest one speaks for them.
 */
async function pipelineSources(client: SupabaseClient, orgId: string, candidateIds: string[]): Promise<RecruitmentDashboard["sources"]> {
  const newest = new Map<string, { source: string; at: string }>();
  for (let i = 0; i < candidateIds.length; i += 200) {
    const { data, error } = await client.from("candidate_records").select("candidate_id, candidate_source, updated_at")
      .eq("organization_id", orgId).in("candidate_id", candidateIds.slice(i, i + 200)).is("deleted_at", null);
    if (error) throw error;
    for (const r of (data ?? []) as { candidate_id: string; candidate_source: string | null; updated_at: string }[]) {
      const seen = newest.get(r.candidate_id);
      if (!seen || r.updated_at > seen.at) newest.set(r.candidate_id, { source: r.candidate_source?.trim() || "Not recorded", at: r.updated_at });
    }
  }
  // People with no record left (deleted) still count, as not recorded.
  const counts = new Map<string, number>();
  for (const id of candidateIds) {
    const source = newest.get(id)?.source ?? "Not recorded";
    counts.set(source, (counts.get(source) ?? 0) + 1);
  }
  return [...counts.entries()].map(([source, count]) => ({ source, count })).sort((a, b) => b.count - a.count || a.source.localeCompare(b.source));
}

const PERIOD_DAYS = 90;
const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);

async function recruitmentMetrics(
  client: SupabaseClient, orgId: string, now: Date,
  roles: RecruitmentDashboard["roles"], stages: Awaited<ReturnType<typeof loadStages>>["stages"],
): Promise<RecruitmentMetrics> {
  const since = new Date(now.getTime() - PERIOD_DAYS * DAY).toISOString();
  const [offers, rejected, reqs, events] = await Promise.all([
    client.from("recruitment_offers").select("id, position_id, status, released_at, response_at").eq("organization_id", orgId).gte("created_at", since).limit(2000),
    client.from("candidate_position_members").select("stage, remark").eq("organization_id", orgId).gte("stage_changed_at", since).is("deleted_at", null).limit(5000),
    client.from("recruitment_requisitions").select("submitted_at, decided_at, status").eq("organization_id", orgId).gte("decided_at", since).not("submitted_at", "is", null).limit(2000),
    client.from("recruitment_offer_events").select("offer_id, action, created_at").eq("organization_id", orgId).gte("created_at", since).in("action", ["proposed", "approved", "breakup_edited"]).order("created_at").limit(5000),
  ]);
  const offerRows = (offers.error ? [] : offers.data ?? []) as { id: string; position_id: string | null; status: OfferStatus; released_at: string | null; response_at: string | null }[];

  // Time to fill: the position's opening to the acceptance.
  const accepted = offerRows.filter((o) => ["accepted", "joined", "dropped"].includes(o.status) && o.response_at && o.position_id);
  const opened = accepted.length
    ? new Map((((await client.from("candidate_positions").select("id, created_at").in("id", [...new Set(accepted.map((o) => o.position_id as string))])).data ?? []) as { id: string; created_at: string }[]).map((p) => [p.id, p.created_at]))
    : new Map<string, string>();
  const fill = accepted.flatMap((o) => { const at = opened.get(o.position_id as string); return at ? [(new Date(o.response_at as string).getTime() - new Date(at).getTime()) / DAY] : []; });

  const released = offerRows.filter((o) => o.released_at);
  const yes = released.filter((o) => ["accepted", "joined", "dropped"].includes(o.status)).length;
  const no = released.filter((o) => o.status === "declined").length;

  const reasons = new Map<string, number>();
  for (const m of (rejected.error ? [] : rejected.data ?? []) as { stage: string; remark: string | null }[]) {
    if (findStage(stages, m.stage)?.kind !== "rejected") continue;
    const reason = (m.remark ?? "").trim() || "No reason given";
    reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
  }

  const reqHours = ((reqs.error ? [] : reqs.data ?? []) as { submitted_at: string; decided_at: string }[]).map((r) => (new Date(r.decided_at).getTime() - new Date(r.submitted_at).getTime()) / 3_600_000).filter((h) => h >= 0);
  const firstAt = new Map<string, number>();
  const lastApproved = new Map<string, number>();
  for (const e of (events.error ? [] : events.data ?? []) as { offer_id: string; action: string; created_at: string }[]) {
    const t = new Date(e.created_at).getTime();
    if (e.action === "proposed" || e.action === "breakup_edited") { firstAt.set(e.offer_id, t); lastApproved.delete(e.offer_id); } else lastApproved.set(e.offer_id, t);
  }
  const approvedOffers = new Set(offerRows.filter((o) => !["pending", "rejected", "withdrawn"].includes(o.status)).map((o) => o.id));
  const offerHours = [...lastApproved.entries()].filter(([id]) => approvedOffers.has(id) && firstAt.has(id)).map(([id, t]) => (t - (firstAt.get(id) as number)) / 3_600_000);

  const load = new Map<string, { recruiter: string; openRoles: number; inPipeline: number; ageing: number }>();
  for (const r of roles) {
    const key = r.recruiterName ?? "No recruiter yet";
    const row = load.get(key) ?? { recruiter: key, openRoles: 0, inPipeline: 0, ageing: 0 };
    row.openRoles += 1; row.inPipeline += r.inPipeline; row.ageing += r.ageing ? 1 : 0;
    load.set(key, row);
  }

  return {
    periodDays: PERIOD_DAYS,
    timeToFill: { days: avg(fill), offers: fill.length },
    offerAcceptance: { released: released.length, accepted: yes, declined: no, waiting: released.filter((o) => o.status === "released").length, ratePct: yes + no ? Math.round((yes / (yes + no)) * 100) : null },
    rejectionReasons: [...reasons.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count).slice(0, 10),
    approvalTurnaround: { requisitionHours: avg(reqHours), requisitions: reqHours.length, offerHours: avg(offerHours), offers: offerHours.length },
    recruiterLoad: [...load.values()].sort((a, b) => b.inPipeline - a.inPipeline),
  };
}
