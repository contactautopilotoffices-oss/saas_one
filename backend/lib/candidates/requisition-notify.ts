/**
 * Requisition alerts, reminders and escalation (owner 2026-11-17; Stage 2 of the Recruitment Module spec: "task plus
 * email and WhatsApp alert to the approver; reminder at 24 h and 48 h; escalation at 72 h").
 *
 * Who is told:
 *   - the approver the request waits on is always told (that is the point of the approval), by email, and on WhatsApp
 *     when the template is set up (AISENSY_REQUISITION_* below);
 *   - the Tech dashboard's Omnichannel matrix (module "recruitment") adds anyone else, by role or by name, per event,
 *     through the same resolvers every other module uses;
 *   - the manager who raised it is told of every decision; the Director is told when the HR Head approved in plan;
 *   - owner 2026-11-21: the department's head when a request for it goes in (they may endorse it); the HR team when an
 *     approved request opens a role (spec A03: assign a recruiter), and the HR Head when nobody is assigned after 48 h;
 *     a recruiter when they are assigned; the raiser of a request on hold at 15 and 20 days, the HR Head at 25 (spec
 *     A24), and the approver when the raiser confirms it is still needed. These go by email.
 * Every message sent is written to recruitment_requisition_notices, so a reminder goes once per level, and the
 * approver's email carries a one-time link (email_action_tokens, 7 days) that decides from a phone without a login.
 *
 * Nothing here is called from a test with the real senders: `NotifyDeps` are injected (owner rule: no WhatsApp sends in
 * tests).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { APPROVAL_LEVEL_LABELS, HOD_DECISION_HOURS, REQUISITION_STATUS_LABELS, type Requisition, type RequisitionLevel } from "./types";
import { activeRoles, headOfDepartment, heldRequisitions, HR_ROLES, loadRecruitmentConfig, passFromDepartmentHead, unassignedRoles, waitingRequisitions, type RequisitionEvent } from "./requisitions";

const NOTICES = "recruitment_requisition_notices";
const TOKEN_ENTITY = "recruitment_requisition";
/** The in-app notification's type (the bell; also the Omnichannel matrix key that may switch its push off). */
const IN_APP_TYPE = "requisition_update";
/** Stage 2's clock: reminders at 24 h and 48 h, escalation at 72 h, at each level. */
export const REMINDER_HOURS = [24, 48] as const;
export const ESCALATION_HOURS = 72;
/** Spec A24: on hold over 15 days, ask the raiser on day 15 and day 20; day 25 to the HR Head. */
export const HOLD_CHASE_DAYS = [15, 20] as const;
export const HOLD_ESCALATION_DAYS = 25;
/** Spec A03: an opened role with no recruiter after 2 days goes to the HR Head. */
export const UNASSIGNED_HOURS = 48;

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
  /** Owner 2026-11-24: "for your information" to the department head, HR Head and Director (requisition_update_v1). */
  update: process.env.AISENSY_REQUISITION_UPDATE_CAMPAIGN ?? "",
};

export interface Person { id: string; name: string | null; email: string | null; phone: string | null }
export interface NotifyDeps {
  sendEmail: (to: string, subject: string, html: string) => Promise<void>;
  sendWhatsApp: (phone: string, campaign: string, params: string[], userName?: string) => Promise<void>;
  /** The one-time decision link for this approver, or null when links are not available. */
  decisionLink: (orgId: string, requisition: Requisition, approverId: string, level: RequisitionLevel) => Promise<string | null>;
  /** Stops every unused decision link for this request (before new ones are issued). Optional: tests leave it out. */
  revokeLinks?: (requisitionId: string) => Promise<void>;
  /**
   * Owner 2026-11-24: an approved request opened a role: match the database and queue the job opening to the matches
   * (when HR switched automatic outreach on). Optional: tests leave it out.
   */
  autoOutreach?: (orgId: string, requisition: Requisition) => Promise<void>;
  /** Owner 2026-11-24: the in-app notification (the bell, and a push where the person allowed it). Optional: tests record it. */
  notifyInApp?: (orgId: string, userIds: string[], note: { title: string; message: string; deepLink: string }) => Promise<void>;
  /** Extra recipients from the Omnichannel matrix for an event key. */
  matrixRecipients: (orgId: string, eventKey: string, contextual: { approverId?: string | null; requesterId?: string | null }) => Promise<{ emails: string[]; users: Person[] }>;
  appUrl: string;
  now?: () => Date;
}

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || "").replace(/\/$/, "");

/** What the one-time decision page shows (kept on the token, so the page needs no id to render). */
export interface LinkSummary {
  requisitionNo: string | null; roleTitle: string; department: string | null; location: string | null; positions: number; requestType: string; replacingName: string | null;
  budgetMinCtc: number | null; budgetMaxCtc: number | null; minExperienceYears: number | null; qualification: string | null; targetJoiningDate: string | null; justification: string | null;
  raisedByName: string | null;
  /** Owner 2026-11-24 (absent on links issued before). */
  structureNote?: string | null; internalMobility?: boolean | null; roleIsNew?: boolean;
}
export const linkSummary = (r: Requisition): LinkSummary => ({
  requisitionNo: r.requisitionNo, roleTitle: r.roleTitle, department: r.department, location: r.location, positions: r.positions, requestType: r.requestType, replacingName: r.replacingName,
  budgetMinCtc: r.budgetMinCtc, budgetMaxCtc: r.budgetMaxCtc, minExperienceYears: r.minExperienceYears, qualification: r.qualification, targetJoiningDate: r.targetJoiningDate,
  justification: r.justification ? r.justification.slice(0, 1500) : null, raisedByName: r.raisedByName,
  structureNote: r.structureNote ? r.structureNote.slice(0, 1000) : null, internalMobility: r.internalMobility, roleIsNew: r.roleIsNew,
});
/** "Yes", "No" or "—" for the internal mobility answer. */
export const mobilityText = (v: boolean | null | undefined) => (v === true ? "Yes: someone in the company may fill it" : v === false ? "No" : "—");

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
    async revokeLinks(requisitionId) {
      const { revokeTokensForEntity } = await import("@/backend/lib/emailActions/tokens");
      await revokeTokensForEntity(TOKEN_ENTITY, requisitionId);
    },
    async autoOutreach(orgId, requisition) {
      const [{ getCandidatesAdmin }, campaigns] = await Promise.all([import("./access"), import("./outreach-campaigns")]);
      const admin = getCandidatesAdmin();
      const campaign = await campaigns.createAutoCampaign(admin, orgId, requisition);
      if (!campaign) return;
      // The first batch goes after the approver's page has its answer; the hourly job sends the rest.
      const run = () => campaigns.processCampaign(admin, orgId, campaign.id, campaigns.defaultCampaignSenders(admin, orgId)).then(() => undefined, (e) => console.error("[candidates] auto outreach first batch failed", e));
      try {
        const { after } = await import("next/server");
        after(run);
      } catch {
        await run();
      }
    },
    async notifyInApp(orgId, userIds, note) {
      if (!userIds.length) return;
      const { NotificationService } = await import("@/backend/services/NotificationService");
      await NotificationService.sendToMany(userIds, { organizationId: orgId, type: IN_APP_TYPE, title: note.title, message: note.message, deepLink: note.deepLink });
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
    ["Place in the structure", r.structureNote ?? "—"],
    ["Internal mobility", mobilityText(r.internalMobility)],
    ...(r.roleIsNew ? [["New designation", "Raised under “Others”: not in the department's list yet"] as [string, string]] : []),
  ];
  return `<table style="border-collapse:collapse;font-size:14px">${rows.map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#64748b;vertical-align:top">${esc(k)}</td><td style="padding:4px 0">${esc(v)}</td></tr>`).join("")}</table>`;
}

async function note(client: SupabaseClient, orgId: string, requisitionId: string, kind: string, level: RequisitionLevel | null, channel: "email" | "whatsapp", recipient: string, ok: boolean, error: string | null): Promise<void> {
  await client.from(NOTICES).insert({ organization_id: orgId, requisition_id: requisitionId, kind, level, channel, recipient, ok, error: error?.slice(0, 500) ?? null, created_at: new Date().toISOString() });
}

/** Sends one message each way it can, writing a notice per attempt. Never throws. */
async function deliver(client: SupabaseClient, orgId: string, deps: NotifyDeps, r: Requisition, kind: string, level: RequisitionLevel | null, to: { emails: string[]; whatsapp: { person: Person; campaign: string; params: string[] }[] }, subject: string, html: string): Promise<void> {
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
async function notifyAwaiting(client: SupabaseClient, orgId: string, deps: NotifyDeps, r: Requisition, approverId: string, level: RequisitionLevel, kind: "awaiting" | "reminder_24" | "reminder_48"): Promise<void> {
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
async function notifyEscalated(client: SupabaseClient, orgId: string, deps: NotifyDeps, r: Requisition, level: RequisitionLevel): Promise<void> {
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

const button = (href: string, label: string) => `<p style="margin-top:16px"><a href="${esc(href)}" style="display:inline-block;background:#1e293b;color:#fff;padding:11px 22px;border-radius:10px;text-decoration:none;font-weight:bold">${esc(label)}</a></p>`;
const hiringRequestsUrl = (deps: NotifyDeps, orgId: string) => `${deps.appUrl}/${orgId}/hiring-requests`;

/** Owner 2026-11-21: the department's head hears of a request for it, and may endorse it. */
async function notifyDepartmentHead(client: SupabaseClient, orgId: string, deps: NotifyDeps, r: Requisition, headId: string): Promise<void> {
  const head = (await people(client, [headId])).get(headId);
  const subject = `Hiring request ${r.requisitionNo ?? ""} for your department · ${r.roleTitle}`;
  const html = `<p>Hello ${esc(firstName(head?.name ?? null))},</p>
    <p>${esc(r.raisedByName ?? "A manager")} raised a hiring request for ${esc(r.department ?? "your department")}. It is with the ${esc(r.currentLevel ? APPROVAL_LEVEL_LABELS[r.currentLevel] : "approvers")} now.</p>
    ${summaryHtml(r)}
    <p>As the department head you can endorse it from Hiring requests. Endorsing tells the approvers you support it; it does not approve it.</p>
    ${deps.appUrl ? button(hiringRequestsUrl(deps, orgId), "Open Hiring requests") : ""}`;
  await deliver(client, orgId, deps, r, "department_head", null, { emails: [head?.email ?? ""].filter(Boolean), whatsapp: [] }, subject, html);
}

/** The HR team: the HR Head and backup, and everyone with an HR role in the organisation. */
async function hrTeam(client: SupabaseClient, orgId: string): Promise<string[]> {
  const [config, { roles }] = await Promise.all([loadRecruitmentConfig(client, orgId), activeRoles(client, orgId).catch(() => ({ roles: [] as { userId: string; role: string }[] }))]);
  return [...new Set([config.hrHead.userId, config.hrHead.backupUserId, ...roles.filter((x) => HR_ROLES.includes(x.role.toLowerCase())).map((x) => x.userId)].filter((id): id is string => Boolean(id)))];
}

/** Spec A03: an approved request opened a role; the HR team assigns a recruiter. */
async function notifyRoleOpened(client: SupabaseClient, orgId: string, deps: NotifyDeps, r: Requisition): Promise<void> {
  const who = await people(client, await hrTeam(client, orgId));
  const subject = `New role open: ${r.roleTitle} (${r.requisitionNo ?? "hiring request"}) · assign a recruiter`;
  const html = `<p>Hello,</p>
    <p>Hiring request <strong>${esc(r.requisitionNo)}</strong> was approved, so <strong>${esc(r.roleTitle)}</strong> is now an open position. Nobody is recruiting for it yet.</p>
    ${summaryHtml(r)}
    <p>Open Recruitment → Positions and pick the recruiter. If nobody is assigned within 2 days, the HR Head is told.</p>`;
  await deliver(client, orgId, deps, r, "role_opened", null, { emails: [...who.values()].map((p) => p.email ?? "").filter(Boolean), whatsapp: [] }, subject, html);
}

/** Spec A24: the raiser confirmed a request on hold is still needed; the approver it waits on is told. */
async function notifyStillNeeded(client: SupabaseClient, orgId: string, deps: NotifyDeps, r: Requisition, approverId: string | null, noteText: string | null): Promise<void> {
  if (!approverId) return;
  const approver = (await people(client, [approverId])).get(approverId);
  const subject = `Still needed: hiring request ${r.requisitionNo ?? ""} on hold · ${r.roleTitle}`;
  const html = `<p>Hello ${esc(firstName(approver?.name ?? null))},</p>
    <p>${esc(r.raisedByName ?? "The manager")} confirms the role <strong>${esc(r.roleTitle)}</strong> is still needed. The request has been on hold${r.holdSince ? ` since ${esc(r.holdSince.slice(0, 10))}` : ""}.</p>
    ${noteText ? `<p style="border-left:3px solid #cbd5e1;padding-left:10px;color:#334155">${esc(noteText)}</p>` : ""}
    <p>Open Hiring requests to resume it, or to decide.</p>`;
  await deliver(client, orgId, deps, r, "still_needed", r.currentLevel, { emails: [approver?.email ?? ""].filter(Boolean), whatsapp: [] }, subject, html);
}

/** Owner 2026-11-21: a recruiter is told when they are assigned to a position (Recruitment → Positions). */
export async function notifyRecruiterAssigned(client: SupabaseClient, position: { id: string; title: string }, recruiterId: string, byName: string | null, deps: Pick<NotifyDeps, "sendEmail"> = defaultNotifyDeps()): Promise<void> {
  const recruiter = (await people(client, [recruiterId])).get(recruiterId);
  if (!recruiter?.email) return;
  try {
    await deps.sendEmail(recruiter.email, `You are the recruiter for ${position.title}`, `<p>Hello ${esc(firstName(recruiter.name))},</p>
      <p>${esc(byName ?? "HR")} made you the recruiter for <strong>${esc(position.title)}</strong>. You will find it under Recruitment → Positions.</p>`);
  } catch (error) {
    console.error("[candidates] recruiter alert failed", error);
  }
}

async function revokeLinks(deps: NotifyDeps, requisitionId: string): Promise<void> {
  try {
    await deps.revokeLinks?.(requisitionId);
  } catch (error) {
    console.error("[candidates] revoking old decision links failed", error);
  }
}

// Everyone involved hears of it (owner 2026-11-24, 23 Nov meeting: "hiring manager, HOD, HR and directors, by mail,
// WhatsApp and in the system") ------------------------------------------------------------------------------------------

const DECISION_WORDS: Record<string, string> = { approved: "approved", rejected: "rejected", sent_back: "sent back for changes", on_hold: "put on hold", resumed: "taken off hold" };

/** The department head, the HR Head and the Director of a request (the primaries), without the people in `except`. */
async function stakeholders(client: SupabaseClient, orgId: string, r: Requisition, except: (string | null | undefined)[]): Promise<string[]> {
  const config = await loadRecruitmentConfig(client, orgId);
  const skip = new Set(except.filter(Boolean));
  return [...new Set([headOfDepartment(config, r.department), config.hrHead.userId, config.director.userId].filter((id): id is string => Boolean(id) && !skip.has(id as string)))];
}

/** The in-app notification. Never throws. */
async function inApp(deps: NotifyDeps, orgId: string, userIds: (string | null | undefined)[], title: string, message: string): Promise<void> {
  const ids = [...new Set(userIds.filter((id): id is string => Boolean(id)))];
  if (!ids.length || !deps.notifyInApp) return;
  try {
    await deps.notifyInApp(orgId, ids, { title, message: message.slice(0, 500), deepLink: `/${orgId}/hiring-requests` });
  } catch (error) {
    console.error("[candidates] requisition in-app notice failed", error);
  }
}

/** A request was submitted: the HR Head and the Director (and the department head when not deciding it) hear of it. */
async function notifyRaised(client: SupabaseClient, orgId: string, deps: NotifyDeps, r: Requisition, approverId: string): Promise<void> {
  const config = await loadRecruitmentConfig(client, orgId);
  // The approver has the "awaiting" message; the head who is not deciding has the department_head one.
  const ids = await stakeholders(client, orgId, r, [approverId, r.raisedBy, headOfDepartment(config, r.department)]);
  const who = await people(client, [...ids, approverId]);
  const waitingOn = who.get(approverId)?.name ?? (r.currentLevel ? APPROVAL_LEVEL_LABELS[r.currentLevel] : "the approvers");
  const subject = `New hiring request ${r.requisitionNo ?? ""} · ${r.roleTitle}${r.department ? ` · ${r.department}` : ""}`;
  const html = `<p>Hello,</p>
    <p>${esc(r.raisedByName ?? "A manager")} raised a hiring request. It is with ${esc(waitingOn)}${r.currentLevel ? ` (${esc(APPROVAL_LEVEL_LABELS[r.currentLevel])})` : ""} now. No action is needed from you yet.</p>
    ${summaryHtml(r)}
    ${deps.appUrl ? button(hiringRequestsUrl(deps, orgId), "Open Hiring requests") : ""}`;
  const targets = ids.map((id) => who.get(id)).filter((p): p is Person => Boolean(p));
  const params = [r.requisitionNo ?? "", r.roleTitle, r.department ?? "-", `raised by ${r.raisedByName ?? "a manager"}, now with ${waitingOn}`];
  await deliver(client, orgId, deps, r, "raised", null, {
    emails: targets.map((p) => p.email ?? "").filter(Boolean),
    whatsapp: targets.map((person) => ({ person, campaign: CAMPAIGNS.update, params })),
  }, subject, html);
  await inApp(deps, orgId, ids, `New hiring request: ${r.roleTitle}`, `${r.requisitionNo ?? ""} raised by ${r.raisedByName ?? "a manager"}${r.department ? ` for ${r.department}` : ""}. With ${waitingOn} now.`);
}

/** A decision: besides the manager (notifyDecided), the department head, HR Head and Director hear of it, not the one who decided. */
async function notifyDecidedOthers(client: SupabaseClient, orgId: string, deps: NotifyDeps, r: Requisition, decision: string, reason: string | null, byName: string | null, byId: string | null): Promise<void> {
  const what = DECISION_WORDS[decision] ?? decision;
  // Resuming is a small step: in-app only.
  const ids = await stakeholders(client, orgId, r, [byId, r.raisedBy]);
  const line = `${r.requisitionNo ?? ""} for ${r.roleTitle} was ${what}${byName ? ` by ${byName}` : ""}.${reason ? ` ${reason}` : ""}`;
  await inApp(deps, orgId, [r.raisedBy, ...ids], `Hiring request ${what}: ${r.roleTitle}`, line);
  if (decision === "resumed") return;
  const who = await people(client, ids);
  const targets = ids.map((id) => who.get(id)).filter((p): p is Person => Boolean(p));
  const subject = `For your information: hiring request ${r.requisitionNo ?? ""} ${what} · ${r.roleTitle}`;
  const html = `<p>Hello,</p>
    <p>Hiring request <strong>${esc(r.requisitionNo)}</strong> for <strong>${esc(r.roleTitle)}</strong>, raised by ${esc(r.raisedByName ?? "a manager")}, was <strong>${esc(what)}</strong>${byName ? ` by ${esc(byName)}` : ""}.</p>
    ${reason ? `<p style="border-left:3px solid #cbd5e1;padding-left:10px;color:#334155">${esc(reason)}</p>` : ""}
    ${r.status === "submitted" && r.currentLevel ? `<p>It is now with the ${esc(APPROVAL_LEVEL_LABELS[r.currentLevel])}.</p>` : ""}
    ${deps.appUrl ? button(hiringRequestsUrl(deps, orgId), "Open Hiring requests") : ""}`;
  const params = [r.requisitionNo ?? "", r.roleTitle, r.department ?? "-", `${what}${byName ? ` by ${byName}` : ""}`];
  await deliver(client, orgId, deps, r, "decided_fyi", null, {
    emails: targets.map((p) => p.email ?? "").filter(Boolean),
    whatsapp: targets.map((person) => ({ person, campaign: CAMPAIGNS.update, params })),
  }, subject, html);
}

/** The routes' notifier: one event from requisitions.ts -> the messages for it. */
export function requisitionNotifier(client: SupabaseClient, orgId: string, deps: NotifyDeps = defaultNotifyDeps()): (event: RequisitionEvent) => Promise<void> {
  return async (event) => {
    // The request moved on (a new level, or a decision): earlier one-time links must stop working before new ones go out,
    // so an old link cannot decide a resubmitted request with its old details, and the link just issued is not revoked.
    // A resume keeps the links (the request returns to the same level and approver).
    if (event.kind === "awaiting" || (event.kind === "decided" && event.decision !== "resumed")) await revokeLinks(deps, event.requisition.id);
    if (event.kind === "awaiting") {
      await notifyAwaiting(client, orgId, deps, event.requisition, event.approverId, event.level, "awaiting");
      await inApp(deps, orgId, [event.approverId], `Your decision: hiring request ${event.requisition.roleTitle}`, `${event.requisition.requisitionNo ?? ""} raised by ${event.requisition.raisedByName ?? "a manager"} waits on you as ${APPROVAL_LEVEL_LABELS[event.level]}.`);
    } else if (event.kind === "raised") await notifyRaised(client, orgId, deps, event.requisition, event.approverId);
    else if (event.kind === "decided") {
      await notifyDecided(client, orgId, deps, event.requisition, event.decision, event.reason, event.byName);
      await notifyDecidedOthers(client, orgId, deps, event.requisition, event.decision, event.reason, event.byName, event.byId ?? null);
    }
    else if (event.kind === "director_informed") await notifyDirectorInformed(client, orgId, deps, event.requisition, event.directorId);
    else if (event.kind === "department_head") await notifyDepartmentHead(client, orgId, deps, event.requisition, event.headId);
    else if (event.kind === "role_opened") {
      await notifyRoleOpened(client, orgId, deps, event.requisition);
      if (deps.autoOutreach) {
        try {
          await deps.autoOutreach(orgId, event.requisition);
        } catch (error) {
          console.error("[candidates] automatic outreach failed", error);
        }
      }
    }
    else if (event.kind === "still_needed") await notifyStillNeeded(client, orgId, deps, event.requisition, event.approverId, event.note);
  };
}

/** Which of these notices this request already had at this level. */
async function sentKinds(client: SupabaseClient, orgId: string, requisitionId: string, level: RequisitionLevel): Promise<Set<string>> {
  const { data } = await client.from(NOTICES).select("kind").eq("organization_id", orgId).eq("requisition_id", requisitionId).eq("level", level).eq("ok", true);
  return new Set(((data ?? []) as { kind: string }[]).map((n) => n.kind));
}

/** The notices of these kinds this request had since `since` (any level). */
async function sentSince(client: SupabaseClient, orgId: string, requisitionId: string, kinds: string[], since: string | null): Promise<Set<string>> {
  let q = client.from(NOTICES).select("kind, created_at").eq("organization_id", orgId).eq("requisition_id", requisitionId).in("kind", kinds).eq("ok", true);
  if (since) q = q.gte("created_at", since);
  const { data } = await q;
  return new Set(((data ?? []) as { kind: string }[]).map((n) => n.kind));
}

/** Spec A24: day 15 and day 20 to the raiser ("still needed, or withdraw?"), day 25 to the HR Head. */
async function chaseHold(client: SupabaseClient, orgId: string, deps: NotifyDeps, r: Requisition, kind: "hold_15" | "hold_20" | "hold_25", confirmedAt: string | null): Promise<void> {
  const config = await loadRecruitmentConfig(client, orgId);
  const days = kind === "hold_25" ? HOLD_ESCALATION_DAYS : kind === "hold_20" ? 20 : 15;
  const ids = kind === "hold_25" ? [config.hrHead.userId, config.hrHead.backupUserId] : [r.raisedBy];
  const who = await people(client, [...ids, r.currentApproverId]);
  const to = ids.filter((id): id is string => Boolean(id)).map((id) => who.get(id)).filter((p): p is Person => Boolean(p));
  const holder = r.currentApproverId ? who.get(r.currentApproverId)?.name ?? null : null;
  const subject = kind === "hold_25"
    ? `On hold ${days} days: hiring request ${r.requisitionNo ?? ""} · ${r.roleTitle}`
    : `Is this role still needed? Hiring request ${r.requisitionNo ?? ""} has been on hold ${days} days`;
  const html = kind === "hold_25"
    ? `<p>Hiring request <strong>${esc(r.requisitionNo)}</strong> for <strong>${esc(r.roleTitle)}</strong> has been on hold for ${days} days${holder ? `, waiting on ${esc(holder)}` : ""}.${r.holdReason ? ` Reason: ${esc(r.holdReason)}.` : ""}</p>
      <p>${confirmedAt ? `${esc(r.raisedByName ?? "The manager")} confirmed on ${esc(confirmedAt.slice(0, 10))} that it is still needed.` : `${esc(r.raisedByName ?? "The manager")} has not confirmed it is still needed.`} Please resume it or decide.</p>${summaryHtml(r)}`
    : `<p>Hello ${esc(firstName(to[0]?.name ?? null))},</p>
      <p>Your hiring request <strong>${esc(r.requisitionNo)}</strong> for <strong>${esc(r.roleTitle)}</strong> has been on hold for ${days} days${r.holdReason ? ` (${esc(r.holdReason)})` : ""}.</p>
      <p>Open it under Hiring requests and either press <strong>Still needed</strong>, so the approver knows, or <strong>Withdraw</strong> it if the role is no longer needed.</p>
      ${deps.appUrl ? button(hiringRequestsUrl(deps, orgId), "Open Hiring requests") : ""}`;
  await deliver(client, orgId, deps, r, kind, null, { emails: to.map((p) => p.email ?? "").filter(Boolean), whatsapp: [] }, subject, html);
}

/** Spec A03's escalation: a role opened from a request still has no recruiter after 48 h; the HR Head is told, once. */
async function notifyUnassigned(client: SupabaseClient, orgId: string, deps: NotifyDeps, r: Requisition): Promise<void> {
  const config = await loadRecruitmentConfig(client, orgId);
  const who = await people(client, [config.hrHead.userId, config.hrHead.backupUserId]);
  const subject = `No recruiter yet: ${r.roleTitle} (${r.requisitionNo ?? "hiring request"})`;
  const html = `<p>The role <strong>${esc(r.roleTitle)}</strong>, opened when hiring request <strong>${esc(r.requisitionNo)}</strong> was approved${r.decidedAt ? ` on ${esc(r.decidedAt.slice(0, 10))}` : ""}, still has no recruiter.</p>
    <p>Open Recruitment → Positions and pick one.</p>${summaryHtml(r)}`;
  await deliver(client, orgId, deps, r, "unassigned_48", null, { emails: [...who.values()].map((p) => p.email ?? "").filter(Boolean), whatsapp: [] }, subject, html);
}

/**
 * The reminders job (hourly): for every request waiting at a level, a reminder at 24 h and 48 h to its approver and
 * an escalation at 72 h, each once per level; for every request on hold, the spec's A24 chasers (day 15 and 20 to the
 * raiser, day 25 to the HR Head, once each per hold); for every role opened without a recruiter after 48 h, the HR Head
 * (A03, once). Returns what it sent, for the cron's log.
 */
export async function runRequisitionReminders(client: SupabaseClient, orgId: string, deps: NotifyDeps = defaultNotifyDeps(), now = deps.now?.() ?? new Date()): Promise<{ reminders: number; escalations: number; holdChasers: number; unassigned: number }> {
  let reminders = 0;
  let escalations = 0;
  let holdChasers = 0;
  let unassigned = 0;
  for (const { requisition: r, hoursAtLevel } of await waitingRequisitions(client, orgId, now)) {
    const level = r.currentLevel;
    if (!level || !r.currentApproverId) continue;
    // Owner 2026-11-24: the department head gets the 24 h reminder; at 48 h the request passes to the HR Head on its own
    // (who is then asked, and reminded and escalated on their own clock).
    if (level === "hod" && hoursAtLevel >= HOD_DECISION_HOURS) {
      if (await passFromDepartmentHead(client, orgId, r.id, { notify: requisitionNotifier(client, orgId, deps), now: () => now })) escalations += 1;
      continue;
    }
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
  for (const { requisition: r, daysOnHold, confirmedAt } of await heldRequisitions(client, orgId, now)) {
    const had = await sentSince(client, orgId, r.id, ["hold_15", "hold_20", "hold_25"], r.holdSince);
    if (daysOnHold >= HOLD_ESCALATION_DAYS) {
      if (!had.has("hold_25")) { await chaseHold(client, orgId, deps, r, "hold_25", confirmedAt); holdChasers += 1; }
      continue;
    }
    // A raiser who already confirmed it is still needed is not asked again in this hold.
    if (confirmedAt) continue;
    const due = HOLD_CHASE_DAYS.filter((d) => daysOnHold >= d).map((d) => `hold_${d}` as "hold_15" | "hold_20").filter((k) => !had.has(k));
    const latest = due[due.length - 1];
    if (latest) { await chaseHold(client, orgId, deps, r, latest, null); holdChasers += 1; }
  }
  for (const r of await unassignedRoles(client, orgId, now, UNASSIGNED_HOURS)) {
    if ((await sentSince(client, orgId, r.id, ["unassigned_48"], null)).has("unassigned_48")) continue;
    await notifyUnassigned(client, orgId, deps, r);
    unassigned += 1;
  }
  return { reminders, escalations, holdChasers, unassigned };
}
