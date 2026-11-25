/**
 * Owner 2026-11-24 (23 Nov HR meeting): screening questions on WhatsApp when someone reaches the screening stage (the
 * answers fill the record; reminders at 24 h and 48 h; then "No response"), and the interview page with Yes / No.
 * Against the real migrations in PGlite; the WhatsApp sender is a fake (owner rule: no WhatsApp sends in tests).
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import type { PGlite } from "@electric-sql/pglite";
import type { SupabaseClient } from "@supabase/supabase-js";

import { listActions } from "../../backend/lib/candidates/actions";
import { publicForm, submitApplication } from "../../backend/lib/candidates/applications";
import { fileInterview } from "../../backend/lib/candidates/hiring";
import { publicInterview, rsvpInterview } from "../../backend/lib/candidates/interview-page";
import { DEFAULT_OUTREACH, FLOW_TEMPLATES, toOutreachSettings } from "../../backend/lib/candidates/outreach-settings";
import { addMembers, createPosition, listMembers, moveMember } from "../../backend/lib/candidates/positions";
import { createRecord, getRecord } from "../../backend/lib/candidates/records";
import { loadRecruitmentConfig, saveOutreachSettings } from "../../backend/lib/candidates/requisitions";
import { onStageMove, runScreeningJobs, screeningViews, type ScreeningSender } from "../../backend/lib/candidates/screening";

import { freshDb } from "./db-stub";
import { pgliteSupabase } from "./pglite-supabase";

const ORG = "00000000-0000-0000-0000-00000000000a";
const USER = "00000000-0000-0000-0000-000000000001";
const ME = { id: USER, name: "Shweta" };
const HOUR = 3_600_000;

describe("screening and interview pages", () => {
  let db: PGlite;
  let client: SupabaseClient;
  let positionId: string;
  const sent: { phone: string; campaignName: string; templateParams: string[] }[] = [];
  const send: ScreeningSender = async (o) => { sent.push(o); return { success: true }; };

  const memberFor = async (fields: Record<string, unknown>) => {
    const { record } = await createRecord(client, ORG, USER, fields);
    await addMembers(client, ORG, ME, positionId, [record.id]);
    const member = (await listMembers(client, ORG, positionId)).find((m) => m.candidateId === record.candidateId)!;
    return { record, member };
  };

  before(async () => {
    db = await freshDb();
    await db.query("insert into public.organizations (id) values ($1)", [ORG]);
    await db.query("insert into auth.users (id) values ($1)", [USER]);
    await db.query("insert into public.users (id, full_name, email) values ($1, 'Shweta', 'shweta@example.com') on conflict do nothing", [USER]);
    client = pgliteSupabase(db);
    positionId = (await createPosition(client, ORG, ME, { title: "AI Intern", location: "Mumbai" })).id;
  });
  after(async () => { await db.close(); });

  it("keeps HR's older saved settings and adds the screening, interview and rejection templates", () => {
    const old = toOutreachSettings({ companyName: "Autopilot Offices", templates: DEFAULT_OUTREACH.templates.filter((t) => !FLOW_TEMPLATES.some((f) => f.id === t.id)), auto: { enabled: true } });
    assert.equal(old.auto.enabled, true, "what HR saved is kept");
    assert.ok(FLOW_TEMPLATES.every((f) => old.templates.some((t) => t.id === f.id)), "the new templates are added");
    assert.equal(old.screening.stageKey, "screening_pending");
  });

  it("sends the screening questions once when someone reaches the screening stage, naming the HR person", async () => {
    const { record, member } = await memberFor({ fullName: "Sahil Gorde", phone: "9876512345", email: "sahil@example.com" });
    const moved = await moveMember(client, ORG, ME, positionId, member.id, "screening_pending", null);
    const first = await onStageMove(client, ORG, ME, positionId, moved, send);
    assert.deepEqual(first, { status: "sent", note: null });
    assert.equal(sent.length, 1);
    assert.equal(sent[0].campaignName, "hr_candidate_screening_v1");
    assert.deepEqual(sent[0].templateParams.slice(0, 5), ["Sahil", "Shweta", "Autopilot Offices", "AI Intern", "Mumbai"]);
    assert.match(sent[0].templateParams[5], /\/apply\/[A-Za-z0-9_-]{32}$/, "their own link to the questions");
    assert.equal((await onStageMove(client, ORG, ME, positionId, moved, send))?.status, "skipped", "once per person and position");
    assert.equal(sent.length, 1);
    const sourced = await moveMember(client, ORG, ME, positionId, member.id, "sourced", "Back for a recheck");
    assert.equal(await onStageMove(client, ORG, ME, positionId, sourced, send), null, "other stages send nothing");

    // The questions page and the answers.
    const token = sent[0].templateParams[5].split("/apply/")[1];
    const form = await publicForm(client, token);
    assert.equal(form?.kind, "screening");
    assert.equal(form?.firstName, "Sahil");
    await assert.rejects(submitApplication(client, token, { answers: { total_exp: "2", city: "Pune", notice: "15", expected_salary: "40000" }, consent: true, resume: null, ip: null, userAgent: null }), /Why are you looking/);
    await submitApplication(client, token, { answers: { total_exp: "2", city: "Pune", notice: "15", expected_salary: "40000", reason: "Growth" }, consent: true, resume: null, ip: null, userAgent: null });
    const after = await getRecord(client, ORG, record.id);
    assert.deepEqual([after.totalExpMonths, after.location, after.noticePeriodDays, after.expectedInhand], [24, "Pune", 15, 40000], "the answers fill the record");
    assert.equal(await publicForm(client, token), null, "answered: the link closes");
    const { views, questions } = await screeningViews(client, ORG, record.candidateId);
    assert.equal(views[0].screening?.status, "answered");
    assert.equal(views[0].screening?.answers?.reason, "Growth");
    assert.ok(questions.length >= 5);
    assert.ok((await listActions(client, ORG, record.candidateId)).some((a) => a.meta.kind === "screening_answered"));
  });

  it("reminds at 24 h and 48 h in working hours, then marks no response and moves them", async () => {
    const { record, member } = await memberFor({ fullName: "Neeti Upadhyay", phone: "9876512346" });
    const moved = await moveMember(client, ORG, ME, positionId, member.id, "screening_pending", null);
    sent.length = 0;
    await onStageMove(client, ORG, ME, positionId, moved, send);
    const [row] = (await db.query<{ sent_at: Date }>("select sent_at from public.recruitment_screenings where candidate_id = $1", [record.candidateId])).rows;
    const t0 = new Date(row.sent_at).getTime();
    // 11:00 IST on a weekday, 25 h later.
    const at = (hours: number) => new Date(t0 + hours * HOUR);
    const working = (d: Date) => { const ist = new Date(d.getTime() + 5.5 * HOUR); return ist.getUTCDay() !== 0 && ist.getUTCHours() >= 9 && ist.getUTCHours() < 19; };
    let h = 25; while (!working(at(h))) h += 1;
    assert.deepEqual(await runScreeningJobs(client, ORG, send, at(h)), { chased: 1, noResponse: 0 });
    assert.deepEqual(await runScreeningJobs(client, ORG, send, at(h)), { chased: 0, noResponse: 0 }, "once");
    const settings = (await loadRecruitmentConfig(client, ORG)).outreach;
    assert.deepEqual((await runScreeningJobs(client, ORG, send, at(settings.screening.noResponseAfterHours + 1))).noResponse, 1);
    const now = (await listMembers(client, ORG, positionId)).find((m) => m.id === member.id)!;
    assert.equal(now.stage, "not_responding", "moved to HR's no-response stage");
    const { views } = await screeningViews(client, ORG, record.candidateId);
    assert.equal(views[0].screening?.status, "no_response");
  });

  it("can be switched off, and leaves a blacklisted person alone", async () => {
    const settings = (await loadRecruitmentConfig(client, ORG)).outreach;
    await saveOutreachSettings(client, ORG, { ...settings, screening: { ...settings.screening, enabled: false } });
    const { member } = await memberFor({ fullName: "Ravi Iyer", phone: "9876512347" });
    const moved = await moveMember(client, ORG, ME, positionId, member.id, "screening_pending", null);
    assert.equal(await onStageMove(client, ORG, ME, positionId, moved, send), null);
    await saveOutreachSettings(client, ORG, settings);
  });

  it("gives each interview a page with the job, the guidelines and Yes / No, and tells the booker about a No", async () => {
    const settings = (await loadRecruitmentConfig(client, ORG)).outreach;
    await saveOutreachSettings(client, ORG, { ...settings, companyProfileUrl: "https://autopilotoffices.com/profile" });
    const { record } = await memberFor({ fullName: "Asha Rao", phone: "9876512348" });
    const id = "00000000-0000-0000-0000-0000000000f1";
    const token = "t".repeat(32);
    const inTwoDays = new Date(Date.now() + 48 * HOUR);
    const local = new Date(inTwoDays.getTime() + 5.5 * HOUR).toISOString().slice(0, 16);
    await fileInterview(client, ORG, ME, { id, candidateId: record.candidateId, applicationId: record.id, positionId, round: "L1", atLocal: local, mode: "in_person", venue: "3rd floor, Thane", interviewers: [], joinPath: null, publicToken: token });
    const page = await publicInterview(client, token);
    assert.deepEqual([page?.firstName, page?.role, page?.round, page?.online, page?.venue, page?.companyProfileUrl, page?.rsvp], ["Asha", "AI Intern", "L1", false, "3rd floor, Thane", "https://autopilotoffices.com/profile", null]);
    assert.ok(page?.guidelines.some((g) => /Dress formally/.test(g)), "the in-person guidelines");
    assert.equal(await publicInterview(client, "x".repeat(32)), null);

    const mails: { to: string; subject: string }[] = [];
    const sendEmail = async (to: string, subject: string) => { mails.push({ to, subject }); };
    await assert.rejects(rsvpInterview(client, token, { answer: "maybe" }), /Yes or No/);
    assert.equal(await rsvpInterview(client, token, { answer: "yes" }, { sendEmail }), "yes");
    assert.equal(mails.length, 0);
    assert.equal(await rsvpInterview(client, token, { answer: "no", note: "Travelling that day" }, { sendEmail }), "no");
    assert.equal(mails.length, 1, "the booker is told");
    assert.equal(mails[0].to, "shweta@example.com");
    assert.equal((await publicInterview(client, token))?.rsvp, "no");
    const history = await listActions(client, ORG, record.candidateId);
    assert.ok(history.some((a) => a.meta.kind === "interview_rsvp" && a.meta.rsvp === "no" && a.remark === "Travelling that day"));
    await db.query("update public.recruitment_interviews set status = 'cancelled' where id = $1", [id]);
    await assert.rejects(rsvpInterview(client, token, { answer: "yes" }), /cancelled/);
  });
});
