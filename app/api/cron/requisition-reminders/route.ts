import { NextRequest, NextResponse } from "next/server";

import { getCandidatesAdmin } from "@/backend/lib/candidates/access";
import { runRequisitionReminders } from "@/backend/lib/candidates/requisition-notify";
import { defaultFlowDeps, organisationsWithFlow, runInterviewJobs, runOfferJobs } from "@/backend/lib/candidates/hiring";
import { organisationsWithWaiting } from "@/backend/lib/candidates/requisitions";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * GET /api/cron/requisition-reminders — hourly (vercel.json). Stage 2 of the Recruitment Module spec: a hiring
 * request waiting on an approver gets a reminder at 24 h and 48 h and is escalated at 72 h, once each per level, for
 * every organisation with a request waiting. Owner 2026-11-21: also the on-hold chasers (spec A24: day 15 and 20 to the
 * raiser, day 25 to the HR Head) and the HR Head's alert for a role with no recruiter after 48 h (A03).
 * Owner 2026-11-21: also the hiring flow's follow-ups (hiring.ts): interview reminders 24 h and 2 h before, the "mark it"
 * nudge, scorecard chasers, and the offer and joining chasers (A10-A18).
 * Auth: Bearer CRON_SECRET (refused when the secret is not set).
 */
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const admin = getCandidatesAdmin();
  const started = Date.now();
  const totals = { organisations: 0, reminders: 0, escalations: 0, holdChasers: 0, unassigned: 0, interviewReminders: 0, interviewNudges: 0, scorecardChasers: 0, offerNotices: 0 };
  for (const orgId of await organisationsWithWaiting(admin)) {
    if (Date.now() - started > 45_000) break;
    try {
      const { reminders, escalations, holdChasers, unassigned } = await runRequisitionReminders(admin, orgId);
      totals.organisations += 1;
      totals.reminders += reminders;
      totals.escalations += escalations;
      totals.holdChasers += holdChasers;
      totals.unassigned += unassigned;
    } catch (error) {
      console.error(`[candidates] requisition reminders failed for ${orgId}`, error);
    }
  }
  const flow = defaultFlowDeps();
  for (const orgId of await organisationsWithFlow(admin)) {
    if (Date.now() - started > 50_000) break;
    try {
      const i = await runInterviewJobs(admin, orgId, flow);
      totals.interviewReminders += i.reminders;
      totals.interviewNudges += i.nudges;
      totals.scorecardChasers += i.chasers;
      totals.offerNotices += await runOfferJobs(admin, orgId, flow);
    } catch (error) {
      console.error(`[candidates] hiring follow-ups failed for ${orgId}`, error);
    }
  }
  return NextResponse.json({ ok: true, ...totals, ms: Date.now() - started });
}
