/**
 * Candidate outreach on WhatsApp (owner 2026-11-16, mockup board 7; migration 20261116000003).
 *
 * When a person moves a candidate to Shortlisted or Rejected on a position's pipeline, the app offers to tell the
 * candidate on WhatsApp with a Meta-approved AiSensy template; the same panel opens from the candidate's "Send
 * update". A PERSON clicks Send every time: nothing goes out on the stage change alone. The wording is the template's
 * (only the first name and the role are filled in), so nothing typed by hand can reach a candidate.
 *
 * Before a send, the checks the panel shows: not blacklisted, a valid Indian mobile on record, not already told for
 * this position, a role to name; and, as a warning only, inside 9 am to 7 pm IST on a working day. Every attempt is a
 * row in candidate_outreach (sent or failed); a successful send is also an `outreach_sent` entry in the history.
 *
 * Owner 2026-11-19, editable messages: the "stage update" (kind stage_update) is one Meta-approved template with a
 * fixed opening and closing; the middle is HR's text, prefilled from the stage's default in Recruitment ->
 * Configurations and edited before each send. It is always for the stage the person is in now, in one position, and
 * goes once per person, position and stage. The text is one line (WhatsApp refuses line breaks in a parameter).
 *
 * Sending goes through backend/services/AiSensyService (the app's one WhatsApp sender). It is loaded on first use
 * and the tests pass a fake, so no test can message a real number.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { loadBlacklist, recordAction, type Actor } from "./actions";
import { parsePhone } from "./normalize";
import { CandidateActionError, getRecord } from "./records";
import { oneLine, stageName, STAGE_MESSAGE_MAX } from "./stage-list";
import { loadStages, STAGES_MIGRATION_MESSAGE } from "./stages";
import { OUTREACH_KIND_LABELS, OUTREACH_KINDS, type OutreachKind, type OutreachPreview, type OutreachRecord } from "./types";

const TABLE = "candidate_outreach";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const OUTREACH_MIGRATION_MESSAGE = "This needs a database update first: run 20261116000003_candidate_outreach.sql in Supabase.";

/**
 * The templates, as submitted to Meta through AiSensy (docs/whatsapp_templates_hr.md, section 1b). The campaign
 * name is the template name unless the environment variable says otherwise. The body here is what the preview shows;
 * WhatsApp renders the approved template, which must say the same.
 */
export const OUTREACH_TEMPLATES: Record<Exclude<OutreachKind, "stage_update" | "interview_invite">, { env: string; campaign: string; body: (firstName: string, role: string) => string }> = {
  shortlisted: {
    env: "AISENSY_CANDIDATE_SHORTLISTED_CAMPAIGN",
    campaign: "candidate_shortlisted_v1",
    body: (name, role) =>
      `Hello ${name},\n\nThank you for speaking with us about the ${role} role at Autopilot Offices. We're happy to let you know that you have been shortlisted for the next round.\n\nOur recruiter will call you shortly with the next steps.`,
  },
  not_shortlisted: {
    env: "AISENSY_CANDIDATE_NOT_SHORTLISTED_CAMPAIGN",
    campaign: "candidate_not_shortlisted_v1",
    body: (name, role) =>
      `Hello ${name},\n\nThank you for your time and interest in the ${role} role at Autopilot Offices. After careful review, we will not be moving forward with your application for this position.\n\nWe will keep your profile with us and reach out when a suitable role opens up. We wish you the very best.`,
  },
};
export const OUTREACH_FOOTER = "Automated update · Please do not reply to this message";

/**
 * Owner 2026-11-19: the editable stage update, to submit to Meta through AiSensy (docs/whatsapp_templates_hr.md, 1b,
 * Template 12). {{1}} first name, {{2}} role, {{3}} HR's text. The opening and closing here must say what the approved
 * template says.
 */
export const STAGE_UPDATE_TEMPLATE = {
  env: "AISENSY_CANDIDATE_STAGE_UPDATE_CAMPAIGN",
  campaign: "candidate_stage_update_v1",
  opening: (name: string, role: string) => `Hello ${name},\n\nThis is an update on your application for the ${role} role at Autopilot Offices.`,
  closing: "Thank you,\nAutopilot Offices Recruitment Team",
};

/**
 * Owner 2026-11-19: the interview invite (interviews.ts; docs/whatsapp_templates_hr.md, 1b, Template 13). {{1}} first
 * name, {{2}} round, {{3}} role, {{4}} when, {{5}} how to join or where to come.
 */
export const INTERVIEW_INVITE_TEMPLATE = {
  env: "AISENSY_CANDIDATE_INTERVIEW_INVITE_CAMPAIGN",
  campaign: "candidate_interview_invite_v1",
  body: (name: string, round: string, role: string, when: string, where: string) =>
    `Hello ${name},

Your ${round} interview for the ${role} role at Autopilot Offices is on ${when}.

${where}

If this time does not suit you, please tell the recruiter who called you.`,
};

export function campaignFor(kind: OutreachKind, env: Record<string, string | undefined> = process.env): string {
  const t = kind === "stage_update" ? STAGE_UPDATE_TEMPLATE : kind === "interview_invite" ? INTERVIEW_INVITE_TEMPLATE : OUTREACH_TEMPLATES[kind];
  return (env[t.env] ?? "").trim() || t.campaign;
}

/** 9 am to 7 pm IST, Monday to Saturday. */
export function withinSendingHours(now = new Date()): boolean {
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  const hour = ist.getUTCHours();
  const day = ist.getUTCDay();
  return day !== 0 && hour >= 9 && hour < 19;
}

/** "98•••• 4471": the number as the panel shows it. */
export function maskPhone(digits: string): string {
  return digits.length > 6 ? `${digits.slice(0, 2)}•••• ${digits.slice(-4)}` : digits;
}

const firstName = (fullName: string) => fullName.trim().split(/\s+/)[0] || "there";

/** What the sender is handed; the shape of AiSensyService.sendTemplate. */
export interface OutreachSendOptions {
  phone: string;
  campaignName: string;
  templateParams: string[];
  userName?: string;
}
export type OutreachSender = (options: OutreachSendOptions) => Promise<{ success: boolean; error?: string; providerReference?: string }>;

async function defaultSender(options: OutreachSendOptions) {
  const { AiSensyService } = await import("@/backend/services/AiSensyService");
  return AiSensyService.sendTemplate(options);
}

function migrationMissing(error: { code?: string; message?: string } | null | undefined): boolean {
  const code = error?.code ?? "";
  return ["42P01", "42703", "PGRST204", "PGRST205"].includes(code) || /candidate_outreach.*does not exist|schema cache/i.test(error?.message ?? "");
}

function fail(context: string, error: unknown): never {
  if (migrationMissing(error as { code?: string } | null)) {
    console.error(`[candidates] ${context}: migration 20261116000003 not applied`, error);
    throw new CandidateActionError(503, OUTREACH_MIGRATION_MESSAGE);
  }
  console.error(`[candidates] ${context}`, error);
  throw new CandidateActionError(500, `Couldn't ${context}. Please try again.`);
}

const Input = z.object({
  applicationId: z.string().regex(UUID),
  positionId: z.string().regex(UUID).nullish(),
  kind: z.enum(OUTREACH_KINDS),
  /** A stage update: HR's text for the middle of the message. */
  message: z.string().max(2000).nullish(),
});
export type OutreachInput = z.infer<typeof Input>;

export function parseOutreachInput(input: unknown): OutreachInput {
  const parsed = Input.safeParse(input ?? {});
  if (!parsed.success) throw new CandidateActionError(400, "Send the record (applicationId), the kind (stage_update, shortlisted or not_shortlisted) and, if any, the position.");
  return parsed.data;
}

interface OutreachRow {
  id: string;
  candidate_id: string;
  application_id: string | null;
  position_id: string | null;
  kind: OutreachKind;
  phone: string;
  campaign: string;
  role_title: string | null;
  status: "sent" | "failed";
  error: string | null;
  created_by_name: string | null;
  created_at: string | Date;
  stage_key?: string | null;
  message?: string | null;
}
const COLUMNS = "id, candidate_id, application_id, position_id, kind, phone, campaign, role_title, status, error, created_by_name, created_at";
/** Owner 2026-11-19 (migration 20261119000001): the stage an update was for and the text sent. */
const UPDATE_COLUMNS = ", stage_key, message";
const updateColumnsMissing = (error: { code?: string; message?: string } | null | undefined) =>
  Boolean(error) && ["42703", "PGRST204"].includes(error?.code ?? "") && /stage_key|message/.test(error?.message ?? "");

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : typeof v === "string" ? v : "");

async function positionTitles(client: SupabaseClient, orgId: string, ids: (string | null)[]): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  const titles = new Map<string, string>();
  if (!wanted.length) return titles;
  const { data } = await client.from("candidate_positions").select("id, title").eq("organization_id", orgId).in("id", wanted);
  for (const row of (data ?? []) as { id: string; title: string }[]) titles.set(row.id, row.title);
  return titles;
}

function toRecord(row: OutreachRow, titles: Map<string, string>): OutreachRecord {
  return {
    id: row.id,
    candidateId: row.candidate_id,
    applicationId: row.application_id ?? null,
    positionId: row.position_id ?? null,
    positionTitle: row.position_id ? titles.get(row.position_id) ?? null : null,
    kind: row.kind,
    phoneMasked: maskPhone(row.phone.replace(/^91(?=\d{10}$)/, "")),
    campaign: row.campaign,
    roleTitle: row.role_title ?? null,
    status: row.status,
    error: row.error ?? null,
    byName: row.created_by_name ?? null,
    at: iso(row.created_at),
    stageKey: row.stage_key ?? null,
    message: row.message ?? null,
  };
}

/** Every attempt on this person, newest first. */
export async function listOutreach(client: SupabaseClient, orgId: string, candidateId: string): Promise<OutreachRecord[]> {
  const run = (columns: string) => client.from(TABLE).select(columns).eq("organization_id", orgId).eq("candidate_id", candidateId).order("created_at", { ascending: false }).limit(50);
  let { data, error } = await run(COLUMNS + UPDATE_COLUMNS);
  if (error && updateColumnsMissing(error)) ({ data, error } = await run(COLUMNS));
  if (error) fail("load the messages sent", error);
  const rows = (data ?? []) as unknown as OutreachRow[];
  const titles = await positionTitles(client, orgId, rows.map((r) => r.position_id));
  return rows.map((row) => toRecord(row, titles));
}

/** What the panel shows, and whether Send is allowed. Never sends. */
export async function previewOutreach(client: SupabaseClient, orgId: string, input: unknown, now = new Date()): Promise<OutreachPreview & { phone: string | null; fullName: string; text: string }> {
  const { applicationId, positionId, kind, message } = parseOutreachInput(input);
  const record = await getRecord(client, orgId, applicationId);
  if (kind === "stage_update" && !positionId) throw new CandidateActionError(400, "Choose the position the update is for.");

  let positionTitle: string | null = null;
  if (positionId) {
    const { data, error } = await client.from("candidate_positions").select("id, title").eq("organization_id", orgId).eq("id", positionId).is("deleted_at", null).maybeSingle();
    if (error) fail("check the position", error);
    if (!data) throw new CandidateActionError(400, "That position no longer exists.");
    positionTitle = (data as { title: string }).title;
  }
  const roleTitle = positionTitle ?? record.role ?? null;

  // Owner 2026-11-19: a stage update is for the stage the person is in now, in this position.
  let stage: { key: string; name: string; defaultText: string } | null = null;
  if (kind === "stage_update") {
    const list = await loadStages(client, orgId);
    if (list.source === "legacy") throw new CandidateActionError(503, STAGES_MIGRATION_MESSAGE);
    const { data, error } = await client.from("candidate_position_members").select("stage").eq("organization_id", orgId).eq("position_id", positionId!).eq("candidate_id", record.candidateId).is("deleted_at", null).maybeSingle();
    if (error) fail("check the stage", error);
    if (!data) throw new CandidateActionError(400, "This person is no longer in that position.");
    const key = (data as { stage: string }).stage;
    stage = { key, name: stageName(list.stages, key), defaultText: list.stages.find((x) => x.key === key)?.message ?? "" };
  }
  const text = stage ? (message === undefined || message === null ? stage.defaultText : oneLine(message)) : "";

  const blacklist = await loadBlacklist(client, orgId, record.candidateId);
  const phoneKey = record.phone ? parsePhone(record.phone).key : null;

  // Told already for this position and kind: the unique index says the same, this just tells the person first.
  let earlierQuery = client
    .from(TABLE)
    .select(stage ? "created_at, created_by_name, position_id, stage_key" : "created_at, created_by_name, position_id")
    .eq("organization_id", orgId)
    .eq("candidate_id", record.candidateId)
    .eq("kind", kind)
    .eq("status", "sent");
  if (stage) earlierQuery = earlierQuery.eq("stage_key", stage.key);
  const { data: earlier, error: earlierErr } = await earlierQuery.order("created_at", { ascending: false }).limit(20);
  if (earlierErr) fail("check earlier messages", earlierErr);
  const sent = ((earlier ?? []) as unknown as { created_at: string | Date; created_by_name: string | null; position_id: string | null }[]).find((r) => (r.position_id ?? null) === (positionId ?? null)) ?? null;

  const checks = {
    notBlacklisted: !blacklist,
    phoneValid: Boolean(phoneKey),
    notSentBefore: !sent,
    roleNamed: Boolean(roleTitle),
    withinHours: withinSendingHours(now),
  };
  const blockedBy = !checks.notBlacklisted ? "This person is blacklisted. No message goes to them."
    : !checks.phoneValid ? "No valid Indian mobile number on record."
    : !checks.notSentBefore ? `Already told${stage ? ` about ${stage.name}` : ""}${sent?.created_by_name ? ` by ${sent.created_by_name}` : ""} on ${iso(sent?.created_at).slice(0, 10)}.`
    : !checks.roleNamed ? "No role to name in the message: add the person to a position, or set the record's role."
    : null;

  return {
    kind,
    candidateId: record.candidateId,
    applicationId: record.id,
    positionId: positionId ?? null,
    positionTitle,
    roleTitle,
    phoneMasked: phoneKey ? maskPhone(phoneKey) : null,
    campaign: campaignFor(kind),
    message: kind === "stage_update"
      ? `${STAGE_UPDATE_TEMPLATE.opening(firstName(record.fullName), roleTitle ?? "[role]")}\n\n${text || "[your update]"}\n\n${STAGE_UPDATE_TEMPLATE.closing}`
      : OUTREACH_TEMPLATES[kind].body(firstName(record.fullName), roleTitle ?? "[role]"),
    footer: OUTREACH_FOOTER,
    stageUpdate: stage ? {
      stageKey: stage.key, stageName: stage.name, defaultText: stage.defaultText,
      opening: STAGE_UPDATE_TEMPLATE.opening(firstName(record.fullName), roleTitle ?? "[role]"), closing: STAGE_UPDATE_TEMPLATE.closing,
    } : null,
    checks,
    canSend: blockedBy === null,
    blockedBy,
    sentBefore: sent ? { at: iso(sent.created_at), byName: sent.created_by_name } : null,
    phone: phoneKey,
    fullName: record.fullName,
    text,
  };
}

/**
 * Sends the message, after the checks above pass. Records the attempt either way; a successful send is also in the
 * history. Throws 409 when a check fails, 502 when WhatsApp refused the message.
 */
export async function sendOutreach(client: SupabaseClient, orgId: string, by: Actor, input: unknown, deps: { send?: OutreachSender; now?: () => Date } = {}): Promise<OutreachRecord> {
  const preview = await previewOutreach(client, orgId, input, deps.now?.() ?? new Date());
  if (!preview.canSend || !preview.phone) throw new CandidateActionError(409, preview.blockedBy ?? "This message cannot be sent.");
  const update = preview.stageUpdate ?? null;
  if (update) {
    const typed = oneLine(parseOutreachInput(input).message);
    if (!typed) throw new CandidateActionError(400, "Write the update for the candidate before sending.");
    if (typed.length > STAGE_MESSAGE_MAX) throw new CandidateActionError(400, `Keep the update under ${STAGE_MESSAGE_MAX} characters.`);
  }

  const send = deps.send ?? defaultSender;
  const destination = `91${preview.phone}`;
  const result = await send({
    phone: destination,
    campaignName: preview.campaign,
    templateParams: update ? [firstName(preview.fullName), preview.roleTitle ?? "", preview.text] : [firstName(preview.fullName), preview.roleTitle ?? ""],
    userName: preview.fullName,
  });

  const row = {
    organization_id: orgId,
    candidate_id: preview.candidateId,
    application_id: preview.applicationId,
    position_id: preview.positionId,
    kind: preview.kind,
    channel: "whatsapp",
    phone: destination,
    campaign: preview.campaign,
    role_title: preview.roleTitle,
    status: result.success ? "sent" : "failed",
    error: result.success ? null : (result.error ?? "WhatsApp did not accept the message").slice(0, 500),
    provider_message_id: result.providerReference ?? null,
    created_by: by.id,
    created_by_name: by.name,
    ...(update ? { stage_key: update.stageKey, message: preview.text } : {}),
  };
  const { data, error } = await client.from(TABLE).insert(row).select(update ? COLUMNS + UPDATE_COLUMNS : COLUMNS).single();
  if (error) {
    if ((error as { code?: string }).code === "23505") throw new CandidateActionError(409, "Already told: someone sent this message a moment ago.");
    // The message went (or failed) but the row did not: say so plainly rather than hide a send.
    fail(result.success ? "record the message that was sent" : "record the failed message", error);
  }
  const saved = toRecord(data as unknown as OutreachRow, new Map(preview.positionId && preview.positionTitle ? [[preview.positionId, preview.positionTitle]] : []));
  if (!result.success) throw new CandidateActionError(502, `WhatsApp did not accept the message: ${(result.error ?? "unknown error").slice(0, 200)}`);

  await recordAction(client, orgId, by, {
    candidateId: preview.candidateId,
    applicationId: preview.applicationId,
    positionId: preview.positionId,
    action: "outreach_sent",
    toValue: update ? `Update: ${update.stageName}` : OUTREACH_KIND_LABELS[preview.kind],
    meta: {
      kind: preview.kind, channel: "whatsapp", campaign: preview.campaign, position: preview.positionTitle, phone: maskPhone(preview.phone), outreachId: saved.id,
      ...(update ? { stage: update.stageKey, message: preview.text } : {}),
    },
  });
  return saved;
}
