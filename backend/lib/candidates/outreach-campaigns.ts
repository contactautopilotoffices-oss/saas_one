/**
 * Bulk and automatic outreach (owner 2026-11-24, from the 23 Nov HR meeting; migration 20261124000002):
 *   - "Bulk WhatsApp and email sending is needed, with separate templates for each channel": HR ticks candidates in
 *     Search, picks the channel(s) and the templates (Recruitment → Outreach), sees a preview, and sends.
 *   - "Once a requisition is approved, the database should be matched against the JD and matching candidates contacted
 *     automatically" (when HR switched it on): the approved request's position is searched (its skills and experience,
 *     and its location), and the matches get the job opening with their own application form link.
 *
 * A campaign is queued first (one row per candidate and channel, unique), then sent in small batches: by the page that
 * started it, and by the hourly job for anything left. Each send is claimed before the provider is called, so no
 * message goes twice, and a message whose placeholders cannot all be filled is skipped, never sent with a gap.
 * Blacklisted people get nothing. Automatic sends wait for 9 am to 7 pm IST on a working day.
 *
 * Nothing here reaches WhatsApp or Zoho in a test: the senders are injected (owner rule: no WhatsApp sends in tests).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { recordAction, type Actor } from "./actions";
import { markContacted } from "./audit";
import { personalLink, systemActor } from "./applications";
import { filterRecords } from "./filter-search";
import { EMPTY_FILTERS, type SearchFilters } from "./filters";
import { parseEmail, parsePhone } from "./normalize";
import { fillTemplate, whatsappParams, type OutreachSettings, type OutreachTemplate, type PlaceholderValues } from "./outreach-settings";
import { withinSendingHours } from "./outreach";
import { CandidateActionError, getRecordRows } from "./records";
import { loadRecruitmentConfig } from "./requisitions";
import type { Requisition } from "./types";

const CAMPAIGNS = "recruitment_outreach_campaigns";
const SENDS = "recruitment_outreach_sends";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const CAMPAIGN_MIGRATION_MESSAGE = "Bulk outreach needs a database update first: run 20261124000002_recruitment_outreach.sql in Supabase.";
/** At most this many people in one bulk send. */
export const MAX_RECIPIENTS = 500;
/** Sends per batch (a page click, or one pass of the hourly job per campaign). */
export const BATCH_SIZE = 15;

const missing = (error: { code?: string; message?: string } | null | undefined) =>
  Boolean(error) && (["42P01", "42703", "PGRST205", "PGRST204"].includes(error?.code ?? "") || /recruitment_outreach|recruitment_application|does not exist|schema cache/i.test(error?.message ?? ""));
function fail(what: string, error: { code?: string; message?: string }): never {
  if (missing(error)) throw new CandidateActionError(503, CAMPAIGN_MIGRATION_MESSAGE);
  console.error(`[candidates] outreach campaigns: ${what}`, error);
  throw new CandidateActionError(500, `Couldn't ${what}. Please try again.`);
}

// The senders -----------------------------------------------------------------------------------------------------------

export interface CampaignSenders {
  whatsapp: (o: { phone: string; campaignName: string; templateParams: string[]; userName?: string }) => Promise<{ success: boolean; error?: string; providerReference?: string }>;
  /** Sends one email from the connected mailbox; throws on failure (`rejected`: the provider refused it for sure). */
  email: (o: { connectionId: string; to: string; subject: string; body: string }) => Promise<{ messageId: string | null; threadId: string | null; from: string }>;
  now?: () => Date;
}

/** The real senders: AiSensy, and the recruitment mailbox's Zoho Mail grant. */
export function defaultCampaignSenders(client: SupabaseClient, orgId: string): CampaignSenders {
  return {
    async whatsapp(o) {
      const { AiSensyService } = await import("@/backend/services/AiSensyService");
      return AiSensyService.sendTemplate(o);
    },
    async email(o) {
      const [{ connection, grant }, { ZohoMailService }] = await Promise.all([import("./resume-mail"), import("@/backend/services/zohoMailService")]);
      const c = await connection(client, orgId, o.connectionId);
      if (!c.active || !c.can_send || !c.refresh_token_enc) throw new CandidateActionError(409, "The mailbox is not connected for sending.");
      const sent = await ZohoMailService.sendMessageWithGrant(grant(c, client), { from: c.address, to: o.to, subject: o.subject, body: o.body });
      return { ...sent, from: c.address };
    },
  };
}

/** The mailboxes connected for sending (the bulk dialog's choice; the first is used by automatic outreach). */
export async function sendingMailboxes(client: SupabaseClient, orgId: string): Promise<{ id: string; address: string }[]> {
  const { data, error } = await client.from("candidate_resume_mail_connections").select("id, address, active, can_send, refresh_token_enc").eq("organization_id", orgId).order("created_at");
  if (error) return [];
  return ((data ?? []) as { id: string; address: string; active: boolean; can_send?: boolean; refresh_token_enc: string | null }[])
    .filter((c) => c.active && c.can_send && c.refresh_token_enc).map((c) => ({ id: c.id, address: c.address }));
}

// Creating a campaign ---------------------------------------------------------------------------------------------------

const CreateInput = z.object({
  applicationIds: z.array(z.string().regex(UUID)).min(1, "Pick at least one candidate.").max(MAX_RECIPIENTS, `At most ${MAX_RECIPIENTS} people in one send.`),
  positionId: z.string().regex(UUID).nullish(),
  whatsappTemplateId: z.string().nullish(),
  emailTemplateId: z.string().nullish(),
  mailConnectionId: z.string().regex(UUID).nullish(),
});

export interface CampaignSummary {
  id: string; source: "manual" | "auto"; channels: ("whatsapp" | "email")[]; positionId: string | null; positionTitle: string | null; requisitionId: string | null;
  status: "queued" | "sending" | "done" | "cancelled"; total: number; createdByName: string | null; createdAt: string; finishedAt: string | null;
  counts: Record<"queued" | "sending" | "sent" | "failed" | "skipped" | "unknown", number>;
  whatsappTemplateName: string | null; emailTemplateName: string | null;
}

const templateOf = (s: OutreachSettings, id: string | null | undefined, channel: "whatsapp" | "email"): OutreachTemplate | null => {
  if (!id) return null;
  const t = s.templates.find((x) => x.id === id && x.channel === channel);
  if (!t) throw new CandidateActionError(400, `That ${channel === "whatsapp" ? "WhatsApp" : "email"} template no longer exists. Pick another one.`);
  return t;
};

/** Queues a bulk send to the people picked; returns it (nothing has gone out yet). */
export async function createCampaign(client: SupabaseClient, orgId: string, by: Actor, body: unknown, opts: { source?: "manual" | "auto"; requisitionId?: string | null } = {}): Promise<CampaignSummary> {
  const parsed = CreateInput.safeParse(body ?? {});
  if (!parsed.success) throw new CandidateActionError(400, parsed.error.issues[0]?.message ?? "Pick the candidates and the templates.");
  const input = parsed.data;
  const settings = (await loadRecruitmentConfig(client, orgId)).outreach;
  const wa = templateOf(settings, input.whatsappTemplateId, "whatsapp");
  const em = templateOf(settings, input.emailTemplateId, "email");
  if (!wa && !em) throw new CandidateActionError(400, "Pick a WhatsApp template, an email template, or both.");
  let mailConnectionId: string | null = null;
  if (em) {
    const boxes = await sendingMailboxes(client, orgId);
    const chosen = input.mailConnectionId ? boxes.find((b) => b.id === input.mailConnectionId) : boxes[0];
    if (!chosen) throw new CandidateActionError(409, "Connect Zoho Mail for sending first (the Connect Zoho Mail button at the top of Recruitment).");
    mailConnectionId = chosen.id;
  }
  if (input.positionId) {
    const { data, error } = await client.from("candidate_positions").select("id").eq("organization_id", orgId).eq("id", input.positionId).is("deleted_at", null).maybeSingle();
    if (error) fail("check the position", error);
    if (!data) throw new CandidateActionError(400, "That position no longer exists.");
  }

  // One row per person (a person with two records is messaged once), and per channel.
  const rows = await getRecordRows(client, orgId, [...new Set(input.applicationIds)]);
  const byCandidate = new Map<string, string>();
  for (const r of rows as unknown as { id: string; candidate_id: string }[]) if (!byCandidate.has(r.candidate_id)) byCandidate.set(r.candidate_id, r.id);
  if (!byCandidate.size) throw new CandidateActionError(400, "None of those candidates exist any more.");
  const channels = [...(wa ? ["whatsapp" as const] : []), ...(em ? ["email" as const] : [])];

  const { data: created, error } = await client.from(CAMPAIGNS).insert({
    organization_id: orgId, source: opts.source ?? "manual", channels, position_id: input.positionId ?? null, requisition_id: opts.requisitionId ?? null,
    whatsapp_template: wa, email_template: em, mail_connection_id: mailConnectionId, status: "queued", total: byCandidate.size,
    created_by: by.id ?? null, created_by_name: by.name,
  }).select("id").single();
  if (error) {
    if ((error as { code?: string }).code === "23505") throw new CandidateActionError(409, "This request already has its automatic outreach.");
    fail("start the send", error);
  }
  const campaignId = (created as { id: string }).id;
  const sends = [...byCandidate.entries()].flatMap(([candidateId, applicationId]) => channels.map((channel) => ({ organization_id: orgId, campaign_id: campaignId, candidate_id: candidateId, application_id: applicationId, channel, status: "queued" })));
  for (let i = 0; i < sends.length; i += 200) {
    const { error: sendError } = await client.from(SENDS).insert(sends.slice(i, i + 200));
    if (sendError) fail("queue the messages", sendError);
  }
  return getCampaign(client, orgId, campaignId);
}

// Sending ---------------------------------------------------------------------------------------------------------------

interface SendRow { id: string; candidate_id: string; application_id: string | null; channel: "whatsapp" | "email" }
interface CampaignRow {
  id: string; organization_id: string; source: "manual" | "auto"; channels: ("whatsapp" | "email")[]; position_id: string | null; requisition_id: string | null;
  whatsapp_template: OutreachTemplate | null; email_template: OutreachTemplate | null; mail_connection_id: string | null; status: CampaignSummary["status"];
  total: number; created_by: string | null; created_by_name: string | null; created_at: string; finished_at: string | null;
}
const CAMPAIGN_COLUMNS = "id, organization_id, source, channels, position_id, requisition_id, whatsapp_template, email_template, mail_connection_id, status, total, created_by, created_by_name, created_at, finished_at";

async function loadCampaign(client: SupabaseClient, orgId: string, id: unknown): Promise<CampaignRow> {
  if (typeof id !== "string" || !UUID.test(id)) throw new CandidateActionError(404, "That send no longer exists.");
  const { data, error } = await client.from(CAMPAIGNS).select(CAMPAIGN_COLUMNS).eq("organization_id", orgId).eq("id", id).maybeSingle();
  if (error) fail("load the send", error);
  if (!data) throw new CandidateActionError(404, "That send no longer exists.");
  return data as unknown as CampaignRow;
}

/** Records a claimed send's result (only while it is still "sending", so a result is never written twice). */
async function finish(client: SupabaseClient, id: string, values: Record<string, unknown>): Promise<void> {
  const { error } = await client.from(SENDS).update(values).eq("id", id).eq("status", "sending");
  if (error) console.error("[candidates] outreach send: the result was not recorded", error);
}

/**
 * Sends the next batch of a campaign. Each row is claimed (queued → sending) before anything goes out, so two batches
 * running at once never send the same message. Returns how many rows it finished and whether the campaign is done.
 */
export async function processCampaign(client: SupabaseClient, orgId: string, campaignId: string, senders: CampaignSenders, limit = BATCH_SIZE): Promise<{ processed: number; done: boolean; waiting?: "hours" }> {
  const c = await loadCampaign(client, orgId, campaignId);
  if (c.status === "done" || c.status === "cancelled") return { processed: 0, done: true };
  const now = senders.now?.() ?? new Date();
  // Owner rule: automatic messages go in working hours only (HR pressing Send decides for themselves).
  if (c.source === "auto" && !withinSendingHours(now)) return { processed: 0, done: false, waiting: "hours" };
  if (c.status === "queued") await client.from(CAMPAIGNS).update({ status: "sending" }).eq("id", c.id).eq("status", "queued");

  const settings = (await loadRecruitmentConfig(client, orgId)).outreach;
  const { data: queued, error } = await client.from(SENDS).select("id, candidate_id, application_id, channel").eq("campaign_id", c.id).eq("status", "queued").order("created_at").order("id").limit(limit);
  if (error) fail("load the messages to send", error);
  const rows = (queued ?? []) as SendRow[];

  const positionInfo = c.position_id
    ? ((await client.from("candidate_positions").select("title, location").eq("organization_id", orgId).eq("id", c.position_id).maybeSingle()).data as { title?: string; location?: string | null } | null)
    : null;
  let processed = 0;
  for (const row of rows) {
    // Claim it: only one batch sends a given row.
    const { data: claimed, error: claimError } = await client.from(SENDS).update({ status: "sending", attempted_at: now.toISOString() }).eq("id", row.id).eq("status", "queued").select("id");
    if (claimError) { console.error("[candidates] outreach send: claim failed", claimError); continue; }
    if (!(claimed ?? []).length) continue;
    processed += 1;
    await sendOne(client, orgId, c, settings, row, positionInfo, senders, now);
  }

  const { count } = await client.from(SENDS).select("id", { count: "exact", head: true }).eq("campaign_id", c.id).in("status", ["queued", "sending"]);
  const done = (count ?? 0) === 0;
  if (done) await client.from(CAMPAIGNS).update({ status: "done", finished_at: new Date().toISOString() }).eq("id", c.id).neq("status", "cancelled");
  return { processed, done };
}

async function sendOne(client: SupabaseClient, orgId: string, c: CampaignRow, settings: OutreachSettings, row: SendRow, position: { title?: string; location?: string | null } | null, senders: CampaignSenders, now: Date): Promise<void> {
  const skip = (reason: string) => finish(client, row.id, { status: "skipped", skip_reason: reason.slice(0, 300) });
  const { data: person, error } = await client.from("candidates").select("full_name, email, phone, location, blacklisted_at").eq("organization_id", orgId).eq("id", row.candidate_id).maybeSingle();
  if (error || !person) return skip("This person is no longer in the database.");
  const p = person as { full_name: string | null; email: string | null; phone: string | null; location: string | null; blacklisted_at: string | null };
  if (p.blacklisted_at) return skip("Blacklisted: no message goes to them.");

  const template = row.channel === "whatsapp" ? c.whatsapp_template : c.email_template;
  if (!template) return skip("No template for this channel.");
  const phoneKey = parsePhone(p.phone ?? "").key;
  const emailKey = parseEmail(p.email ?? "").key;
  if (row.channel === "whatsapp" && !phoneKey) return skip("No valid Indian mobile number on record.");
  if (row.channel === "email" && !emailKey) return skip("No valid email address on record.");

  // The link only when the template uses it (made once per person and position, reused by the other channel).
  const usesLink = (template.params ?? []).includes("application_link") || /\{\{\s*application_link\s*\}\}/.test(`${template.subject ?? ""} ${template.body}`);
  let linkId: string | null = null;
  let linkUrl: string | null = null;
  if (usesLink) {
    try {
      const link = await personalLink(client, orgId, { candidateId: row.candidate_id, applicationId: row.application_id, positionId: c.position_id, createdBy: c.created_by });
      linkId = link.id; linkUrl = link.url;
    } catch (e) {
      console.error("[candidates] outreach: application link failed", e);
      return finish(client, row.id, { status: "failed", error: "The application link could not be made." });
    }
  }
  const fullName = (p.full_name ?? "").trim();
  const values: PlaceholderValues = {
    first_name: fullName.split(/\s+/)[0] || null, full_name: fullName || null, role: position?.title ?? null, location: position?.location ?? null,
    company: settings.companyName, application_link: linkUrl, recruiter_name: c.created_by_name ?? `${settings.companyName} Recruitment`,
  };

  if (row.channel === "whatsapp") {
    const { params, gaps } = whatsappParams(template, values);
    if (gaps.length) return skip(`Missing ${gaps.join(", ")} for the template.`);
    let result: { success: boolean; error?: string; providerReference?: string };
    try {
      result = await senders.whatsapp({ phone: `91${phoneKey}`, campaignName: template.campaign ?? "", templateParams: params, userName: fullName || undefined });
    } catch (e) {
      result = { success: false, error: e instanceof Error ? e.message : "WhatsApp send failed" };
    }
    await finish(client, row.id, result.success
      ? { status: "sent", sent_at: new Date().toISOString(), recipient: `91${phoneKey}`, link_id: linkId, provider_ref: result.providerReference ?? null }
      : { status: "failed", recipient: `91${phoneKey}`, error: (result.error ?? "WhatsApp did not accept the message").slice(0, 500) });
    if (result.success) { await logSent(client, orgId, c, row, "whatsapp", template); await markContacted(client, orgId, row.candidate_id); }
    return;
  }

  const subject = fillTemplate(template.subject ?? "", values);
  const body = fillTemplate(template.body, values);
  const gaps = [...new Set([...subject.gaps, ...body.gaps])];
  if (gaps.length) return skip(`Missing ${gaps.join(", ")} for the template.`);
  if (!c.mail_connection_id) return skip("No mailbox chosen for sending.");
  try {
    const sent = await senders.email({ connectionId: c.mail_connection_id, to: emailKey as string, subject: subject.text.replace(/[\r\n]+/g, " ").slice(0, 250), body: body.text });
    await finish(client, row.id, { status: "sent", sent_at: new Date().toISOString(), recipient: emailKey, link_id: linkId, provider_ref: sent.messageId });
    await markContacted(client, orgId, row.candidate_id);
    // The Email tab shows it with the rest of the mailbox's mail.
    const { error: mailError } = await client.from("recruitment_mail_messages").insert({
      organization_id: orgId, connection_id: c.mail_connection_id, candidate_id: row.candidate_id, message_id: sent.messageId, thread_id: sent.threadId ?? sent.messageId,
      direction: "outgoing", status: "sent", sender: sent.from, recipient: emailKey, subject: subject.text.slice(0, 250), body: body.text, body_loaded: true,
      created_by: c.created_by, received_at: now.toISOString(), attempted_at: now.toISOString(),
    });
    if (mailError) console.error("[candidates] outreach email: not copied to the Email tab", mailError);
    await logSent(client, orgId, c, row, "email", template);
  } catch (e) {
    const rejected = Boolean((e as { rejected?: boolean })?.rejected) || e instanceof CandidateActionError;
    await finish(client, row.id, { status: rejected ? "failed" : "unknown", recipient: emailKey, error: (rejected ? "Zoho refused the email." : "Sending was not confirmed. Check Sent in Zoho before retrying.").slice(0, 500) });
  }
}

async function logSent(client: SupabaseClient, orgId: string, c: CampaignRow, row: SendRow, channel: "whatsapp" | "email", template: OutreachTemplate): Promise<void> {
  await recordAction(client, orgId, systemActor(c.created_by_name ?? (c.source === "auto" ? "Automatic outreach" : "Outreach"), c.created_by), {
    candidateId: row.candidate_id, applicationId: row.application_id, positionId: c.position_id, action: "outreach_sent",
    toValue: `${channel === "whatsapp" ? "WhatsApp" : "Email"}: ${template.name}`, meta: { kind: "campaign", campaignId: c.id, channel, template: template.id, source: c.source },
  });
}

/** Stops a campaign: what is still queued is not sent. */
export async function cancelCampaign(client: SupabaseClient, orgId: string, id: unknown): Promise<CampaignSummary> {
  const c = await loadCampaign(client, orgId, id);
  if (c.status === "done" || c.status === "cancelled") return getCampaign(client, orgId, c.id);
  await client.from(SENDS).update({ status: "skipped", skip_reason: "Stopped before sending." }).eq("campaign_id", c.id).eq("status", "queued");
  await client.from(CAMPAIGNS).update({ status: "cancelled", finished_at: new Date().toISOString() }).eq("id", c.id);
  return getCampaign(client, orgId, c.id);
}

// Reading ---------------------------------------------------------------------------------------------------------------

const EMPTY_COUNTS = (): CampaignSummary["counts"] => ({ queued: 0, sending: 0, sent: 0, failed: 0, skipped: 0, unknown: 0 });

async function summaries(client: SupabaseClient, orgId: string, rows: CampaignRow[]): Promise<CampaignSummary[]> {
  if (!rows.length) return [];
  const [{ data: sends }, { data: positions }] = await Promise.all([
    client.from(SENDS).select("campaign_id, status").in("campaign_id", rows.map((r) => r.id)),
    client.from("candidate_positions").select("id, title").eq("organization_id", orgId).in("id", [...new Set(rows.map((r) => r.position_id).filter((x): x is string => Boolean(x)))]),
  ]);
  const counts = new Map<string, CampaignSummary["counts"]>();
  for (const s of (sends ?? []) as { campaign_id: string; status: keyof CampaignSummary["counts"] }[]) {
    const c = counts.get(s.campaign_id) ?? EMPTY_COUNTS();
    c[s.status] += 1;
    counts.set(s.campaign_id, c);
  }
  const titles = new Map(((positions ?? []) as { id: string; title: string }[]).map((p) => [p.id, p.title]));
  const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : typeof v === "string" ? v : null);
  return rows.map((r) => ({
    id: r.id, source: r.source, channels: r.channels, positionId: r.position_id, positionTitle: r.position_id ? titles.get(r.position_id) ?? null : null, requisitionId: r.requisition_id,
    status: r.status, total: r.total, createdByName: r.created_by_name, createdAt: iso(r.created_at) ?? "", finishedAt: iso(r.finished_at),
    counts: counts.get(r.id) ?? EMPTY_COUNTS(), whatsappTemplateName: r.whatsapp_template?.name ?? null, emailTemplateName: r.email_template?.name ?? null,
  }));
}

export async function getCampaign(client: SupabaseClient, orgId: string, id: unknown): Promise<CampaignSummary> {
  return (await summaries(client, orgId, [await loadCampaign(client, orgId, id)]))[0];
}

export async function listCampaigns(client: SupabaseClient, orgId: string, limit = 50): Promise<CampaignSummary[]> {
  const { data, error } = await client.from(CAMPAIGNS).select(CAMPAIGN_COLUMNS).eq("organization_id", orgId).order("created_at", { ascending: false }).limit(limit);
  if (error) fail("load the sends", error);
  return summaries(client, orgId, (data ?? []) as unknown as CampaignRow[]);
}

export interface CampaignSendEntry { id: string; candidateId: string; name: string; channel: "whatsapp" | "email"; status: keyof CampaignSummary["counts"]; reason: string | null; at: string | null }
/** One campaign's messages, problems first. */
export async function campaignSends(client: SupabaseClient, orgId: string, id: unknown): Promise<CampaignSendEntry[]> {
  const c = await loadCampaign(client, orgId, id);
  const { data, error } = await client.from(SENDS).select("id, candidate_id, channel, status, skip_reason, error, sent_at, attempted_at").eq("campaign_id", c.id).limit(MAX_RECIPIENTS * 2);
  if (error) fail("load the messages", error);
  const rows = (data ?? []) as { id: string; candidate_id: string; channel: "whatsapp" | "email"; status: CampaignSendEntry["status"]; skip_reason: string | null; error: string | null; sent_at: string | null; attempted_at: string | null }[];
  const { data: people } = rows.length ? await client.from("candidates").select("id, full_name").eq("organization_id", orgId).in("id", [...new Set(rows.map((r) => r.candidate_id))]) : { data: [] };
  const names = new Map(((people ?? []) as { id: string; full_name: string | null }[]).map((p) => [p.id, p.full_name ?? "Candidate"]));
  const order: Record<string, number> = { failed: 0, unknown: 1, skipped: 2, sending: 3, queued: 4, sent: 5 };
  const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : typeof v === "string" ? v : null);
  return rows.map((r) => ({ id: r.id, candidateId: r.candidate_id, name: names.get(r.candidate_id) ?? "Candidate", channel: r.channel, status: r.status, reason: r.error ?? r.skip_reason, at: iso(r.sent_at ?? r.attempted_at) }))
    .sort((a, b) => order[a.status] - order[b.status] || a.name.localeCompare(b.name));
}

/** Previews one candidate's messages exactly as they would go (the bulk dialog shows the first person's). */
export async function previewCampaign(client: SupabaseClient, orgId: string, body: unknown): Promise<{ whatsapp: string | null; email: { subject: string; body: string } | null; gaps: string[]; recipients: number }> {
  const input = CreateInput.safeParse(body ?? {});
  if (!input.success) throw new CandidateActionError(400, input.error.issues[0]?.message ?? "Pick the candidates and the templates.");
  const settings = (await loadRecruitmentConfig(client, orgId)).outreach;
  const wa = templateOf(settings, input.data.whatsappTemplateId, "whatsapp");
  const em = templateOf(settings, input.data.emailTemplateId, "email");
  const rows = await getRecordRows(client, orgId, input.data.applicationIds.slice(0, 1));
  const first = (rows as unknown as { full_name?: string | null }[])[0];
  const position = input.data.positionId
    ? ((await client.from("candidate_positions").select("title, location").eq("organization_id", orgId).eq("id", input.data.positionId).maybeSingle()).data as { title?: string; location?: string | null } | null)
    : null;
  const name = (first?.full_name ?? "").trim();
  const values: PlaceholderValues = {
    first_name: name.split(/\s+/)[0] || null, full_name: name || null, role: position?.title ?? null, location: position?.location ?? null,
    company: settings.companyName, application_link: "https://…/apply/(their own link)", recruiter_name: null,
  };
  const waText = wa ? fillTemplate(wa.body, values) : null;
  const emSubject = em ? fillTemplate(em.subject ?? "", values) : null;
  const emBody = em ? fillTemplate(em.body, { ...values, recruiter_name: "(your name)" }) : null;
  const gaps = [...new Set([...(waText?.gaps ?? []), ...(emSubject?.gaps ?? []), ...(emBody?.gaps ?? [])])];
  return { whatsapp: waText?.text ?? null, email: em ? { subject: emSubject!.text, body: emBody!.text } : null, gaps, recipients: new Set(input.data.applicationIds).size };
}

// Automatic outreach when a hiring request is approved ---------------------------------------------------------------------

/**
 * The approved request's position, searched as HR's Search would: its skills (any of them) and minimum experience, and
 * (when set) its location, among people not blacklisted and not messaged about a job lately. Queues the job opening to
 * the first matches (up to the cap). Returns null when automatic outreach is off or nobody matches.
 */
export async function createAutoCampaign(client: SupabaseClient, orgId: string, requisition: Pick<Requisition, "id" | "positionId" | "location" | "roleTitle">, now = new Date()): Promise<CampaignSummary | null> {
  const settings = (await loadRecruitmentConfig(client, orgId)).outreach;
  const auto = settings.auto;
  if (!auto.enabled || !requisition.positionId) return null;
  const { data: pos, error } = await client.from("candidate_positions").select("id, title, location, filters").eq("organization_id", orgId).eq("id", requisition.positionId).maybeSingle();
  if (error || !pos) return null;
  const p = pos as { id: string; title: string; location: string | null; filters: Partial<SearchFilters> | null };
  const location = (p.location ?? requisition.location ?? "").trim();
  const filters: SearchFilters = {
    ...EMPTY_FILTERS, ...(p.filters ?? {}),
    ...(auto.matchLocation && location ? { locations: [location], relocate: true } : {}),
    includeBlank: false, showBlacklisted: false, sort: "updated",
  };
  // Leave out people messaged about a job lately.
  const since = new Date(now.getTime() - auto.skipContactedDays * 86_400_000).toISOString();
  const { data: recent } = auto.skipContactedDays > 0
    ? await client.from(SENDS).select("candidate_id").eq("organization_id", orgId).eq("status", "sent").gte("sent_at", since)
    : { data: [] };
  const skip = new Set(((recent ?? []) as { candidate_id: string }[]).map((r) => r.candidate_id));
  const picked: string[] = [];
  const seen = new Set<string>();
  for (let page = 1; picked.length < auto.maxPerRequest && page <= 10; page += 1) {
    const res = await filterRecords(client, orgId, filters, page, 100);
    for (const r of res.records) {
      if (picked.length >= auto.maxPerRequest) break;
      if (seen.has(r.candidateId) || skip.has(r.candidateId)) continue;
      seen.add(r.candidateId);
      picked.push(r.id);
    }
    if (res.records.length < 100) break;
  }
  if (!picked.length) return null;
  const mailboxes = auto.emailTemplateId ? await sendingMailboxes(client, orgId) : [];
  const useEmail = Boolean(auto.emailTemplateId && mailboxes.length);
  if (!auto.whatsappTemplateId && !useEmail) return null;
  try {
    return await createCampaign(client, orgId, systemActor("Automatic outreach"), {
      applicationIds: picked, positionId: p.id, whatsappTemplateId: auto.whatsappTemplateId, emailTemplateId: useEmail ? auto.emailTemplateId : null, mailConnectionId: useEmail ? mailboxes[0].id : null,
    }, { source: "auto", requisitionId: requisition.id });
  } catch (e) {
    if (e instanceof CandidateActionError && e.status === 409) return null;
    throw e;
  }
}

/** For the hourly job: every unfinished campaign of this organisation gets a batch, within the time given. */
export async function processOpenCampaigns(client: SupabaseClient, orgId: string, senders: CampaignSenders, deadline: number): Promise<number> {
  const { data, error } = await client.from(CAMPAIGNS).select("id").eq("organization_id", orgId).in("status", ["queued", "sending"]).order("created_at").limit(20);
  if (error) { if (!missing(error)) console.error("[candidates] open campaigns read failed", error); return 0; }
  let processed = 0;
  for (const { id } of (data ?? []) as { id: string }[]) {
    if (Date.now() > deadline) break;
    try {
      processed += (await processCampaign(client, orgId, id, senders, BATCH_SIZE * 2)).processed;
    } catch (e) {
      console.error(`[candidates] campaign ${id} failed`, e);
    }
  }
  return processed;
}

/** The organisations with a campaign still sending (for the hourly job). */
export async function organisationsWithOpenCampaigns(client: SupabaseClient): Promise<string[]> {
  const { data, error } = await client.from(CAMPAIGNS).select("organization_id").in("status", ["queued", "sending"]).limit(1000);
  if (error) return [];
  return [...new Set(((data ?? []) as { organization_id: string }[]).map((r) => r.organization_id))];
}
