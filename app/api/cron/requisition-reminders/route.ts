import { NextRequest, NextResponse } from "next/server";

import { getCandidatesAdmin } from "@/backend/lib/candidates/access";
import { runRequisitionReminders } from "@/backend/lib/candidates/requisition-notify";
import { organisationsWithWaiting } from "@/backend/lib/candidates/requisitions";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * GET /api/cron/requisition-reminders — hourly (vercel.json). Stage 2 of the Recruitment Module spec: a hiring
 * request waiting on an approver gets a reminder at 24 h and 48 h and is escalated at 72 h, once each per level, for
 * every organisation with a request waiting. Auth: Bearer CRON_SECRET (refused when the secret is not set).
 */
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const admin = getCandidatesAdmin();
  const started = Date.now();
  const totals = { organisations: 0, reminders: 0, escalations: 0 };
  for (const orgId of await organisationsWithWaiting(admin)) {
    if (Date.now() - started > 45_000) break;
    try {
      const { reminders, escalations } = await runRequisitionReminders(admin, orgId);
      totals.organisations += 1;
      totals.reminders += reminders;
      totals.escalations += escalations;
    } catch (error) {
      console.error(`[candidates] requisition reminders failed for ${orgId}`, error);
    }
  }
  return NextResponse.json({ ok: true, ...totals, ms: Date.now() - started });
}
