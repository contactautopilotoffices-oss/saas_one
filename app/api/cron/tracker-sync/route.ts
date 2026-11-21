import { NextRequest, NextResponse } from "next/server";

import { getCandidatesAdmin } from "@/backend/lib/candidates/access";
import { indexPending } from "@/backend/lib/candidates/indexing";
import { dueTrackers, syncTracker } from "@/backend/lib/candidates/trackers";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * GET /api/cron/tracker-sync — hourly (vercel.json). Owner 2026-11-21 (HRMS meeting item 5): pulls every connected
 * tracker that is due (hourly ones each hour, daily ones once a day; "manual" ones never). One at a time within the
 * minute; the rest are picked up next hour. Auth: Bearer CRON_SECRET (refused when the secret is not set).
 */
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const admin = getCandidatesAdmin();
  const started = Date.now();
  const totals = { synced: 0, failed: 0, rowsChanged: 0 };
  const orgs = new Set<string>();
  for (const { orgId, id } of await dueTrackers(admin)) {
    // A sync may take most of a minute: none starts after 15 s.
    if (Date.now() - started > 15_000) break;
    try {
      const summary = await syncTracker(admin, orgId, id, { trigger: "schedule" });
      totals.synced += 1;
      totals.rowsChanged += summary.rowsChanged;
      if (summary.rowsChanged) orgs.add(orgId);
    } catch (error) {
      totals.failed += 1;
      console.error(`[candidates] tracker sync failed for ${id}`, error);
    }
  }
  for (const orgId of orgs) await indexPending(admin, orgId).catch(() => undefined);
  return NextResponse.json({ ok: true, ...totals, ms: Date.now() - started });
}
