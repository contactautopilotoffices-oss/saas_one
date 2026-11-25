/**
 * A position's stakeholders (owner 2026-11-24, from the 23 Nov HR meeting: "the hiring manager, HOD, director and
 * other stakeholders should be updated when an assignment is sent or an interview is scheduled"):
 *   - the hiring manager: whoever raised the hiring request the position was opened from;
 *   - the department head: the one set for the position's department (Tech dashboard → HR Configs);
 *   - the Director (the primary one set in HR Configs).
 * Told by email and in the app (the bell). Never throws: an alert is a courtesy, never a reason to fail the action.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { getCandidatesAdmin } from "./access";
import { headOfDepartment, loadRecruitmentConfig } from "./requisitions";

/** Who they are for this position (user ids, without the people in `except`). */
export async function positionStakeholders(client: SupabaseClient, orgId: string, positionId: string, except: (string | null | undefined)[] = []): Promise<string[]> {
  const [config, { data: pos }, { data: req }] = await Promise.all([
    loadRecruitmentConfig(client, orgId),
    client.from("candidate_positions").select("department").eq("organization_id", orgId).eq("id", positionId).maybeSingle(),
    client.from("recruitment_requisitions").select("raised_by").eq("organization_id", orgId).eq("position_id", positionId).limit(1),
  ]);
  const department = (pos as { department?: string | null } | null)?.department ?? null;
  const raiser = ((req ?? []) as { raised_by: string | null }[])[0]?.raised_by ?? null;
  const skip = new Set(except.filter(Boolean));
  return [...new Set([raiser, headOfDepartment(config, department), config.director.userId].filter((id): id is string => Boolean(id) && !skip.has(id as string)))];
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));

/** Tells them by email and in the app. */
export async function alertPositionStakeholders(orgId: string, positionId: string, alert: { title: string; message: string; exceptUserIds: string[] }): Promise<void> {
  const client = getCandidatesAdmin();
  const ids = await positionStakeholders(client, orgId, positionId, alert.exceptUserIds);
  if (!ids.length) return;
  const { data } = await client.from("users").select("id, email").in("id", ids);
  const [{ EmailService }, { NotificationService }] = await Promise.all([import("@/backend/services/EmailService"), import("@/backend/services/NotificationService")]);
  for (const u of (data ?? []) as { id: string; email: string | null }[]) {
    if (!u.email) continue;
    try {
      await EmailService.sendEmail({ to: u.email, subject: alert.title, html: `<div style="font-family:Arial,sans-serif;font-size:14px;color:#0f172a"><p>${esc(alert.message)}</p><p style="color:#64748b;font-size:12px">For your information. Open Recruitment in the app for the details.</p></div>` });
    } catch (e) {
      console.error("[candidates] stakeholder email failed", e);
    }
  }
  try {
    await NotificationService.sendToMany(ids, { organizationId: orgId, type: "recruitment_update", title: alert.title.slice(0, 120), message: alert.message.slice(0, 500), deepLink: "/hr-tickets" });
  } catch (e) {
    console.error("[candidates] stakeholder in-app alert failed", e);
  }
}
