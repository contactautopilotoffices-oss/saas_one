/**
 * Requisition alerts, reminders and escalation (owner 2026-11-17; Stage 2 of the Recruitment Module spec: "task plus
 * email and WhatsApp alert to the approver; reminder at 24 h and 48 h; escalation at 72 h").
 *
 * Who is told:
 *   - the approver the request waits on is always told (that is the point of the approval), by email, and on WhatsApp
 *     when the template is set up (AISENSY_REQUISITION_* below);
 *   - the Tech dashboard's Omnichannel matrix (module "recruitment") adds anyone else, by role or by name, per event,
 *     through the same resolvers every other module uses;
 *   - the manager who raised it is told of every decision; the Director is told when the HR Head approved in plan.
 * Every message sent is written to recruitment_requisition_notices, so a reminder goes once per level, and the
 * approver's email carries a one-time link (email_action_tokens, 7 days) that decides from a phone without a login.
 *
 * Nothing here is called from a test with the real senders: `NotifyDeps` are injected (owner rule: no WhatsApp sends in
 * tests).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { APPROVAL_LEVEL_LABELS, REQUISITION_STATUS_LABELS, type ApprovalLevel, type Requisition } from "./types";
import { loadRecruitmentConfig, waitingRequisitions, type RequisitionEvent } from "./requisitions";

const NOTICES = "recruitment_requisition_notices";
const TOKEN_ENTITY = "recruitment_requisition";
/** Stage 2's clock: reminders at 24 h and 48 h, escalation at 72 h, at each level. */
export const REMINDER_HOURS = [24, 48] as const;
export const ESCALATION_HOURS = 72;

/** The Omnichannel matrix's event keys for the "recruitment" module (OmnichannelNotificationSettings.tsx lists the same). */
export const REQUISITION_EVENT_KEYS = {
  awaiting: "requisition_awaiting_approval",
  decided: "requisition_decided",
  director_informed: "requisition_director_informed",
  reminder: "requisition_reminder",
  escalation: "requisition_escalated",
} as const;

/** AiSensy campaign names; the templates are in docs/whatsapp_templates_hr.md §1c. Unset = no WhatsApp for that event. */
const CAMPAIGNS = {
  awaiting: process.env.AISENSY_REQUISITION_AWAITING_CAMPAIGN ?? "",
  decided: process.env.AISENSY_REQUISITION_DECIDED_CAMPAIGN ?? "",
  reminder: process.env.AISENSY_REQUISITION_REMINDER_CAMPAIGN ?? "",
  escalation: process.env.AISENSY_REQUISITION_ESCALATED_CAMPAIGN ?? "",
};

export interface Person { id: string; name: string | null; email: string | null; phone: string | null }
export interface NotifyDeps {
  sendEmail: (to: string, subject: string, html: string) => Promise<void>;
  sendWhatsApp: (phone: string, campaign: string, params: string[], userName?: string) => Promise<void>;
  /** The one-time decision link for this approver, or null when links are not available. */
  decisionLink: (orgId: string, requisition: Requisition, approverId: string, level: ApprovalLevel) => Promise<string | null>;
  /** Extra recipients from the Omnichannel matrix for an event key. */
  matrixRecipients: (orgId: string, eventKey: string, contextual: { approverId?: string | null; requesterId?: string | null }) => Promise<{ emails: string[]; users: Person[] }>;
  appUrl: string;
  now?: () => Date;
}

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || "").replace(/\/$/, "");

/** What the one-time decision page shows (kept on the token, so the page needs no id to render). */
export interface LinkSummary { requisitionNo: string | null; roleTitle: string; department: string | null; location: string | null; positions: number; requestType: string; replacingName: string | null; budgetMinCtc: number | null; budgetMaxCtc: number | null; minExperienceYears: number | null; qualification: string | null; targetJoiningDate: string | null; justification: string | null; raisedByName: string | null }
export const linkSummary = (r: Requisition): LinkSummary => ({
  requisitionNo: r.requisitionNo, roleTitle: r.roleTitle, department: r.department, location: r.location, positions: r.positions, requestType: r.requestType, replacingName: r.replacingName,
  budgetMinCtc: r.budgetMinCtc, budgetMaxCtc: r.budgetMaxCtc, minExperienceYears: r.minExperienceYears, qualification: r.qualification, targetJoiningDate: r.targetJoiningDate,
  justification: r.justification ? r.justification.slice(0, 1500) : null, raisedByName: r.raisedByName,
});

/** The real senders (the routes and the cron). */
export function defaultNotifyDeps(): NotifyDeps {
  return {
    async sendEmail(to, subject, html) {
      const { EmailService } = await import("@/backend/services/EmailService");
      await EmailService.sendEmail({ to, subject, html });
    },
    async sendWhatsApp(phone, campaign, params, userName) {
      const { AiSensyService } = await import("@/backend/services/AiSensyService");
      const result = await AiSensyService.sendTemplate({ phone, campaignName: campaign, templateParams: params, userName });
      if (!result.success) throw new Error(result.error ?? "WhatsApp send failed");
    },
    async decisionLink(orgId, requisition, approverId, level) {
      if (!APP_URL) return null;
      const { issueEmailActionToken } = await import("@/backend/lib/emailActions/tokens");
      const raw = await issueEmailActionToken({
        organizationId: orgId, userId: approverId, entityType: TOKEN_ENTITY, entityId: requisition.id, action: "decide",
        // The decision page (act/[token]) reads the request from here, so a peek at the token shows it without an id.
        payload: { level, summary: linkSummary(requisition) },
      });
      return raw ? `${APP_URL}/api/recruitment/requisitions/act/${raw}` : null;
    },
    async matrixRecipients(orgId, eventKey, contextual) {
      const [{ EmailRecipientResolver }, { WhatsAppRecipientResolver }] = await Promise.all([
        import("@/backend/services/EmailRecipientResolver"),
        import("@/backend/services/WhatsAppRecipientResolver"),
      ]);
      const [email, wa] = await Promise.all([
        EmailRecipientResolver.resolveRecipients({ organizationId: orgId, featureKey: eventKey, contextualRecipients: {} }).catch(() => ({ enabled: false, emails: [] as string[] })),
        WhatsAppRecipientResolver.resolveRecipients({ organizationId: orgId, featureKey: eventKey, contextualUsers: { approverId: contextual.approverId ?? null, requesterId: contextual.requesterId ?? null } }).catch(() => ({ enabled: false, users: [] as { id: string; phone: string; name: string | null }[] })),
      ]);
      return {
        emails: email.enabled ? email.emails : [],
        users: wa.enabled ? wa.users.map((u) => ({ id: u.id, name: u.name ?? null, email: null, phone: u.phone })) : [],
      };
    },
    appUrl: APP_URL,
  };
}

async function people(client: SupabaseClient, ids: (string | null | undefined)[]): Promise<Map<string, Person>> {
  const wanted = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  const out = new Map<string, Person>();
  if (!wanted.length) return out;
  const { data } = await client.from("users").select("id, full_name, email, phone").in("id", wanted);
  for (const u of (data ?? []) as { id: string; full_name: string | null; email: string | null; phone: string | null }[]) {
    out.set(u.id, { id: u.id, name: u.full_name, email: u.email, phone: u.phone });
  }
  return out;
}

const digits = (phone: string | null) => {
  const d = (phone ?? "").replace(/\D/g, "");
  if (d.length === 10) return `91${d}`;
  if (d.length === 12 && d.startsWith("91")) return d;
  return null;
};
const esc = (s: string | null | undefined) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
const lpa = (v: number | null) => (v === null ? "—" : `₹${(v / 100_000).toLocaleString("en-IN", { maximumFractionDigits: 1 })} LPA`);
const firstName = (name: string | null) => (name ?? "").trim().split(/\s+/)[0] || "there";

function summaryHtml(r: Requisition): string {
  const rows: [string, string][] = [
    ["Request", r.requisitionNo ?? "—"],
    ["Role", `${r.roleTitle}${r.department ? ` · ${r.department}` : ""}${r.location ? ` · ${r.location}` : ""}`],
    ["Positions", `${r.positions} · ${r.requestType === "replacement" ? `replacement for ${r.replacingName ?? "—"}` : "new"}`],
    ["Budget band (CTC)", `${lpa(r.budgetMinCtc)} to ${lpa(r.budgetMaxCtc)}`],
    ["Experience", r.minExperienceYears !== null ? `${r.minExperienceYears}+ years` : "—"],
    ["Qualification", r.qualification ?? "—"],
    ["Target joining", r.targetJoiningDate ?? "—"],
    ["Raised by", r.raisedByName ?? "—"],
    ["Justification", r.justification ?? "—"],
  ];
  return `<table style="border-collapse:collapse;font-size:14px">${rows.map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#64748b;vertical-align:top">${esc(k)}</td><td style="padding:4px 0">${esc(v)}</td></tr>`).join("")}</table>`;
}

async function note(client: SupabaseClient, orgId: string, requisitionId: string, kind: string, level: ApprovalLevel | null, channel: "email" | "whatsapp", recipient: string, ok: boolean, error: string | null): Promise<void> {
  await client.from(NOTICES).insert({ organization_id: orgId, requisition_id: requisitionId, kind, level, channel, recipient, ok, error: error?.slice(0, 500) ?? null, created_at: new Date().toISOString() });
}

/** Sends one message each way it can, writing a notice per attempt. Never throws. */
async function deliver(client: SupabaseClient, orgId: string, deps: NotifyDeps, r: Requisition, kind: string, level: ApprovalLevel | null, to: { emails: string[]; whatsapp: { person: Person; campaign: string; params: string[] }[] }, subject: string, html: string): Promise<void> {
  for (const email of [...new Set(to.emails.map((e) => e.trim().toLowerCase()).filter(Boolean))]) {
    try {
      await deps.sendEmail(email, subject, html);
      await note(client, orgId, r.id, kind, level, "email", email, true, null);
    } catch (error) {
      await note(client, orgId, r.id, kind, level, "email", email, false, error instanceof Error ? error.message : String(error));
    }
  }
  const seen = new Set<string>();
  for (const w of to.whatsapp) {
    const phone = digits(w.person.phone);
    if (!phone || !w.campaign || seen.has(phone)) continue;
    seen.add(phone);
    try {
      await deps.sendWhatsApp(phone, w.campaign, w.params, w.person.name ?? undefined);
      await note(client, orgId, r.id, kind, level, "whatsapp", phone, true, null);
    } catch (error) {
      await note(client, orgId, r.id, kind, level, "whatsapp", phone, false, error instanceof Error ? error.message : String(error));
    }
  }
}

/** The approver is told a request waits on them (on submission, and when it moves to the Director). */
async function notifyAwaiting(client: SupabaseClient, orgId: string, deps: NotifyDeps, r: Requisition, approverId: string, level: ApprovalLevel, kind: "awaiting" | "reminder_24" | "reminder_48"): Promise<void> {
  const [who, extra] = await Promise.all([people(client, [approverId, r.raisedBy]), deps.matrixRecipients(orgId, kind === "awaiting" ? REQUISITION_EVENT_KEYS.awaiting : REQUISITION_EVENT_KEYS.reminder, { approverId, requesterId: r.raisedBy })]);
  const approver = who.get(approverId);
  const link = await deps.decisionLink(orgId, r, approverId, level);
  const reminder = kind !== "awaiting";
  const subject = `${reminder ? "Reminder: " : ""}Hiring request ${r.requisitionNo ?? ""} awaits your approval · ${r.roleTitle}`;
  const html = `
    <p>Hello ${esc(firstName(approver?.name ?? null))},</p>
    <p>${reminder ? `This hiring request has waited ${kind === "reminder_24" ? "a day" : "two days"} for your decision as ${APPROVAL_LEVEL_LABELS[level]}.` : `A hiring request needs your decision as ${APPROVAL_LEVEL_LABELS[level]}.`}</p>
    ${summaryHtml(r)}
    ${link ? `<p style="margin-top:16px"><a href="${esc(link)}" style="display:inline-block;background:#1e293b;color:#fff;padding:11px 22px;border-radius:10px;text-decoration:none;font-weight:bold">Review and decide</a></p><p style="color:#64748b;font-size:12px">The link works once, for 7 days, without signing in. You can also decide from the app under Hiring requests.</p>` : `<p>Open the app and go to Hiring requests to decide.</p>`}`;
  const params = [firstName(approver?.name ?? null), r.requisitionNo ?? "", r.roleTitle, r.raisedByName ?? "", link ?? `${deps.appUrl}/dashboard?tab=grievance&hr=hiring`];
  const campaign = reminder ? CAMPAIGNS.reminder : CAMPAIGNS.awaiting;
  await deliver(client, orgId, deps, r, kind, level, {
    emails: [approver?.email ?? "", ...extra.emails].filter(Boolean),
    whatsapp: [...(approver ? [{ person: approver, campaign, params }] : []), ...extra.users.filter((u) => u.id !== approverId).map((person) => ({ person, campaign, params }))],
  }, subject, html);
}

/** The manager is told of every decision; the matrix may add others. */
async function notifyDecided(client: SupabaseClient, orgId: string, deps: NotifyDeps, r: Requisition, decision: string, reason: string | null, byName: string | null): Promise<void> {
  const [who, extra] = await Promise.all([people(client, [r.raisedBy]), deps.matrixRecipients(orgId, REQUISITION_EVENT_KEYS.decided, { requesterId: r.raisedBy })]);
  const manager = r.raisedBy ? who.get(r.raisedBy) : undefined;
  const what = ({ approved: "approved", rejected: "rejected", sent_back: "sent back for changes", on_hold: "put on hold", resumed: "taken off hold" } as Record<string, string>)[decision] ?? decision;
  const subject = `Hiring request ${r.requisitionNo ?? ""} ${what} · ${r.roleTitle}`;
  const html = `
    <p>Hello ${esc(firstName(manager?.name ?? null))},</p>
    <p>Your hiring request <strong>${esc(r.requisitionNo)}</strong> for <strong>${esc(r.roleTitle)}</strong> was <strong>${esc(what)}</strong>${byName ? ` by ${esc(byName)}` : ""}.</p>
    ${reason ? `<p style="border-left:3px solid #cbd5e1;padding-left:10px;color:#334155">${esc(reason)}</p>` : ""}
    ${decision === "approved" ? `<p>The role is now open: HR will find it under Positions${r.positionId ? "" : " shortly"}.</p>` : decision === "sent_back" ? `<p>Open the request under Hiring requests, make the changes, and submit it again.</p>` : ""}
    <p style="color:#64748b;font-size:12px">Status: ${esc(REQUISITION_STATUS_LABELS[r.status])}</p>`;
  const params = [firstName(manager?.name ?? null), r.requisitionNo ?? "", r.roleTitle, what, reason ?? "-"];
  await deliver(client, orgId, deps, r, "decided", null, {
    emails: [manager?.email ?? "", ...extra.emails].filter(Boolean),
    whatsapp: [...(manager ? [{ person: manager, campaign: CAMPAIGNS.decided, params }] : []), ...extra.users.filter((u) => u.id !== r.raisedBy).map((person) => ({ person, campaign: CAMPAIGNS.decided, params }))],
  }, subject, html);
}

/** Stage 2: in plan, the HR Head approves and the Director is notified. */
async function notifyDirectorInformed(client: SupabaseClient, orgId: string, deps: NotifyDeps, r: Requisition, directorId: string): Promise<void> {
  const [who, extra] = await Promise.all([people(client, [directorId]), deps.matrixRecipients(orgId, REQUISITION_EVENT_KEYS.director_informed, { approverId: directorId })]);
  const director = who.get(directorId);
  const subject = `For your information: hiring request ${r.requisitionNo ?? ""} approved in plan · ${r.roleTitle}`;
  const html = `<p>Hello ${esc(firstName(director?.name ?? null))},</p><p>The HR Head approved this in-plan hiring request. No action is needed from you.</p>${summaryHtml(r)}`;
  const params = [firstName(director?.name ?? null), r.requisitionNo ?? "", r.roleTitle, "approved in plan by the HR Head", "-"];
  await deliver(client, orgId, deps, r, "director_informed", null, {
    emails: [director?.email ?? "", ...extra.emails].filter(Boolean),
    whatsapp: [...(director ? [{ person: director, campaign: CAMPAIGNS.decided, params }] : []), ...extra.users.filter((u) => u.id !== directorId).map((person) => ({ person, campaign: CAMPAIGNS.decided, params }))],
  }, subject, html);
}

/** 72 h without a decision: the Director (at the HR Head's level) or the matrix's escalation recipients are told. */
async function notifyEscalated(client: SupabaseClient, orgId: string, deps: NotifyDeps, r: Requisition, level: ApprovalLevel): Promise<void> {
  const config = await loadRecruitmentConfig(client, orgId);
  // At the HR Head's level the Director is the escalation; at the Director's level, the Director's backup (and whoever the matrix names).
  const escalateTo = level === "hr_head" ? [config.director.userId, config.director.backupUserId] : [config.director.backupUserId, config.hrHead.userId];
  const [who, extra] = await Promise.all([people(client, [...escalateTo, r.currentApproverId]), deps.matrixRecipients(orgId, REQUISITION_EVENT_KEYS.escalation, { approverId: r.currentApproverId })]);
  const targets = escalateTo.filter((id): id is string => Boolean(id) && id !== r.currentApproverId).map((id) => who.get(id)).filter((p): p is Person => Boolean(p));
  const waitingOn = r.currentApproverId ? who.get(r.currentApproverId) : undefined;
  const subject = `Escalation: hiring request ${r.requisitionNo ?? ""} has waited 3 days · ${r.roleTitle}`;
  const html = `<p>This hiring request has waited over 72 hours for ${esc(waitingOn?.name ?? APPROVAL_LEVEL_LABELS[level])}'s decision as ${APPROVAL_LEVEL_LABELS[level]}.</p>${summaryHtml(r)}<p>Open the app under Hiring requests to see it.</p>`;
  const params = [r.requisitionNo ?? "", r.roleTitle, waitingOn?.name ?? APPROVAL_LEVEL_LABELS[level], r.raisedByName ?? ""];
  await deliver(client, orgId, deps, r, "escalation_72", level, {
    emails: [...targets.map((p) => p.email ?? ""), ...extra.emails].filter(Boolean),
    whatsapp: [...targets, ...extra.users.filter((u) => !targets.some((t) => t.id === u.id))].map((person) => ({ person, campaign: CAMPAIGNS.escalation, params })),
  }, subject, html);
}

/** The routes' notifier: one event from requisitions.ts -> the messages for it. */
export function requisitionNotifier(client: SupabaseClient, orgId: string, deps: NotifyDeps = defaultNotifyDeps()): (event: RequisitionEvent) => Promise<void> {
  return async (event) => {
    if (event.kind === "awaiting") await notifyAwaiting(client, orgId, deps, event.requisition, event.approverId, event.level, "awaiting");
    else if (event.kind === "decided") await notifyDecided(client, orgId, deps, event.requisition, event.decision, event.reason, event.byName);
    else if (event.kind === "director_informed") await notifyDirectorInformed(client, orgId, deps, event.requisition, event.directorId);
  };
}

/** Which of these notices this request already had at this level. */
async function sentKinds(client: SupabaseClient, orgId: string, requisitionId: string, level: ApprovalLevel): Promise<Set<string>> {
  const { data } = await client.from(NOTICES).select("kind").eq("organization_id", orgId).eq("requisition_id", requisitionId).eq("level", level).eq("ok", true);
  return new Set(((data ?? []) as { kind: string }[]).map((n) => n.kind));
}

/**
 * The reminders job (hourly): for every request waiting at a level, a reminder at 24 h and 48 h to its approver and
 * an escalation at 72 h, each once per level. Returns what it sent, for the cron's log.
 */
export async function runRequisitionReminders(client: SupabaseClient, orgId: string, deps: NotifyDeps = defaultNotifyDeps(), now = deps.now?.() ?? new Date()): Promise<{ reminders: number; escalations: number }> {
  let reminders = 0;
  let escalations = 0;
  for (const { requisition: r, hoursAtLevel } of await waitingRequisitions(client, orgId, now)) {
    const level = r.currentLevel;
    if (!level || !r.currentApproverId) continue;
    const had = await sentKinds(client, orgId, r.id, level);
    if (hoursAtLevel >= ESCALATION_HOURS) {
      if (!had.has("escalation_72")) { await notifyEscalated(client, orgId, deps, r, level); escalations += 1; }
      continue;
    }
    const due = REMINDER_HOURS.filter((h) => hoursAtLevel >= h).map((h) => `reminder_${h}` as "reminder_24" | "reminder_48").filter((k) => !had.has(k));
    // Only the latest due reminder: a request found at 50 h gets the 48 h one, not two.
    const latest = due[due.length - 1];
    if (latest) { await notifyAwaiting(client, orgId, deps, r, r.currentApproverId, level, latest); reminders += 1; }
  }
  return { reminders, escalations };
}
