/**
 * Owner 2026-11-24 (23 Nov HR meeting): the configurable job application form, bulk WhatsApp / email outreach, and the
 * automatic outreach when a hiring request is approved. Against the real migrations in PGlite; no message is ever sent
 * (the senders are fakes: owner rule, no WhatsApp sends in tests).
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import type { PGlite } from "@electric-sql/pglite";
import type { SupabaseClient } from "@supabase/supabase-js";

import { listActions, setBlacklist } from "../../backend/lib/candidates/actions";
import { APPLICATION_SOURCE, personalLink, openLink, publicForm, submitApplication, listApplications, FormError, recordFieldsFrom } from "../../backend/lib/candidates/applications";
import {
  cancelCampaign, campaignSends, createAutoCampaign, createCampaign, getCampaign, previewCampaign, processCampaign, type CampaignSenders,
} from "../../backend/lib/candidates/outreach-campaigns";
import {
  DEFAULT_APPLICATION_FORM, DEFAULT_OUTREACH, fillTemplate, toOutreachSettings, validateOutreachSettings, whatsappParams, type OutreachSettings,
} from "../../backend/lib/candidates/outreach-settings";
import { createPosition, listMembers } from "../../backend/lib/candidates/positions";
import { createRecord, getRecord } from "../../backend/lib/candidates/records";
import { loadRecruitmentConfig, saveOutreachSettings, saveRecruitmentConfig } from "../../backend/lib/candidates/requisitions";

import { freshDb } from "./db-stub";
import { pgliteSupabase } from "./pglite-supabase";

const ORG = "00000000-0000-0000-0000-00000000000a";
const USER = "00000000-0000-0000-0000-000000000001";
const ME = { id: USER, name: "Roohi" };
/** Tuesday 2026-11-24, 11:00 IST. */
const WORKING = () => new Date("2026-11-24T05:30:00Z");
/** Tuesday 2026-11-24, 02:00 IST. */
const NIGHT = () => new Date("2026-11-23T20:30:00Z");

describe("job application form and outreach", () => {
  let db: PGlite;
  let client: SupabaseClient;
  let positionId: string;
  const whatsapp: { phone: string; campaignName: string; templateParams: string[] }[] = [];
  const senders: CampaignSenders = {
    async whatsapp(o) { whatsapp.push(o); return { success: true, providerReference: `wa-${whatsapp.length}` }; },
    async email() { throw new Error("no email in these tests"); },
    now: WORKING,
  };
  const add = async (fields: Record<string, unknown>) => (await createRecord(client, ORG, USER, fields)).record;

  before(async () => {
    db = await freshDb();
    await db.query("insert into public.organizations (id) values ($1)", [ORG]);
    await db.query("insert into auth.users (id) values ($1)", [USER]);
    await db.query("insert into public.users (id, full_name, email) values ($1, 'Roohi', 'roohi@example.com') on conflict do nothing", [USER]);
    client = pgliteSupabase(db);
    positionId = (await createPosition(client, ORG, ME, { title: "Senior Graphic Designer", location: "Mumbai" })).id;
  });
  after(async () => { await db.close(); });

  it("validates HR's settings and fills the placeholders, never sending a gap", () => {
    assert.deepEqual(validateOutreachSettings(DEFAULT_OUTREACH), DEFAULT_OUTREACH);
    const without = { ...DEFAULT_OUTREACH, applicationForm: { ...DEFAULT_APPLICATION_FORM, fields: DEFAULT_APPLICATION_FORM.fields.filter((f) => f.target !== "email") } };
    assert.throws(() => validateOutreachSettings(without), /Keep a question for "Email"/);
    const optionalPhone = { ...DEFAULT_OUTREACH, applicationForm: { ...DEFAULT_APPLICATION_FORM, fields: DEFAULT_APPLICATION_FORM.fields.map((f) => (f.target === "phone" ? { ...f, required: false } : f)) } };
    assert.throws(() => validateOutreachSettings(optionalPhone), /must stay required/);
    const badPlaceholder = { ...DEFAULT_OUTREACH, templates: [{ ...DEFAULT_OUTREACH.templates[1], body: "Hi {{salary}}" }] };
    assert.throws(() => validateOutreachSettings(badPlaceholder), /\{\{salary\}\}/);
    assert.throws(() => validateOutreachSettings({ ...DEFAULT_OUTREACH, templates: [{ ...DEFAULT_OUTREACH.templates[0], campaign: "" }] }), /campaign name/);
    assert.deepEqual(toOutreachSettings({ templates: "rubbish" }), DEFAULT_OUTREACH, "anything invalid falls back to the defaults");

    assert.deepEqual(fillTemplate("Hi {{first_name}}, the {{role}} role", { first_name: "Asha", role: null }), { text: "Hi Asha, the {{role}} role", gaps: ["role"] });
    const wa = DEFAULT_OUTREACH.templates[0];
    assert.deepEqual(whatsappParams(wa, { first_name: "Asha", role: "Designer", location: "Mumbai\nWest", application_link: "https://x/apply/t" }), { params: ["Asha", "Designer", "Mumbai West", "https://x/apply/t"], gaps: [] });
    assert.deepEqual(whatsappParams(wa, { first_name: "Asha" }).gaps, ["role", "location", "application_link"]);
  });

  it("saves the settings for HR, and keeps them when the approvals are saved", async () => {
    const next: OutreachSettings = { ...DEFAULT_OUTREACH, companyName: "Autopilot Offices", auto: { ...DEFAULT_OUTREACH.auto, maxPerRequest: 2 } };
    await assert.rejects(saveOutreachSettings(client, ORG, { ...next, templates: [] , auto: { ...next.auto, enabled: true, whatsappTemplateId: null, emailTemplateId: null } }), /pick a WhatsApp or an email template/);
    await saveOutreachSettings(client, ORG, next, ME);
    await saveRecruitmentConfig(client, ORG, { targetDays: 25 });
    assert.equal((await loadRecruitmentConfig(client, ORG)).outreach.auto.maxPerRequest, 2, "an approvals save keeps the outreach settings");
  });

  it("gives each candidate one link per position, and an open link per position for postings", async () => {
    const r = await add({ fullName: "Asha Rao", phone: "9876511111", email: "asha@example.com" });
    const a = await personalLink(client, ORG, { candidateId: r.candidateId, applicationId: r.id, positionId, createdBy: USER });
    const b = await personalLink(client, ORG, { candidateId: r.candidateId, applicationId: r.id, positionId, createdBy: USER });
    assert.equal(a.token, b.token, "the same link is reused");
    assert.match(a.url, /\/apply\/[A-Za-z0-9_-]{32}$/);
    const open1 = await openLink(client, ORG, positionId, USER);
    assert.equal((await openLink(client, ORG, positionId, USER)).token, open1.token);
    assert.notEqual(open1.token, a.token);
    const form = await publicForm(client, a.token);
    assert.deepEqual([form?.role, form?.location, form?.firstName], ["Senior Graphic Designer", "Mumbai", "Asha"], "a personal link greets by first name only");
    assert.equal((await publicForm(client, open1.token))?.firstName, null);
    assert.equal(await publicForm(client, "x".repeat(32)), null, "an unknown link opens nothing");
  });

  it("turns a submitted form into a record in the position's pipeline, keeping the answers and the resume", async () => {
    const link = await openLink(client, ORG, positionId, USER);
    const stored: string[] = [];
    const storage = { async upload(path: string) { stored.push(path); return { error: null }; } };
    const answers = {
      full_name: "Vikram Shah", email: "VIKRAM@example.com", phone: "+91 98765 22222", city: "Mumbai", total_exp: "6.5", expected_salary: "85000",
      notice: "30", skills: "Figma, Illustrator, figma", reason: "Growth",
    };
    const pdf = { name: "vikram.pdf", type: "application/pdf", bytes: new Uint8Array([37, 80, 68, 70]) };
    await assert.rejects(submitApplication(client, link.token, { answers, consent: false, resume: pdf, ip: "1.1.1.1", userAgent: "t" }, storage), (e) => e instanceof FormError && /consent/.test(e.message));
    await assert.rejects(submitApplication(client, link.token, { answers: { ...answers, email: "nope" }, consent: true, resume: pdf, ip: null, userAgent: null }, storage), (e) => e instanceof FormError && e.fieldId === "email");
    await assert.rejects(submitApplication(client, link.token, { answers, consent: true, resume: null, ip: null, userAgent: null }, storage), (e) => e instanceof FormError && e.fieldId === "resume", "the resume is required");
    await assert.rejects(submitApplication(client, link.token, { answers, consent: true, resume: { ...pdf, type: "image/png" }, ip: null, userAgent: null }, storage), /PDF or Word/);

    const done = await submitApplication(client, link.token, { answers, consent: true, resume: pdf, ip: "1.1.1.1", userAgent: "t" }, storage);
    assert.match(done.thanks, /Thank you/);
    assert.equal(stored.length, 1);
    assert.match(stored[0], new RegExp(`^applications/${ORG}/[0-9a-f-]{36}\\.pdf$`));
    const { applications } = await listApplications(client, ORG, { positionId });
    const app = applications[0];
    assert.deepEqual([app.name, app.email, app.hasResume, app.via, app.positionTitle], ["Vikram Shah", "vikram@example.com", true, "open", "Senior Graphic Designer"]);
    const record = await getRecord(client, ORG, app.applicationId!);
    assert.deepEqual([record.fullName, record.candidateSource, record.role, record.totalExpMonths, record.expectedInhand, record.noticePeriodDays, record.location],
      ["Vikram Shah", APPLICATION_SOURCE, "Senior Graphic Designer", 78, 85000, 30, "Mumbai"]);
    assert.ok((await listMembers(client, ORG, positionId)).some((m) => m.candidateId === record.candidateId), "added to the position's pipeline");
    assert.ok((await listActions(client, ORG, record.candidateId)).some((a) => a.action === "remark" && a.meta.kind === "application_form"), "written in the history");

    // The same person applying again is matched (by email), not duplicated.
    await submitApplication(client, link.token, { answers: { ...answers, phone: "9876522222", notice: "15" }, consent: true, resume: pdf, ip: null, userAgent: null }, storage);
    const again = (await listApplications(client, ORG, { positionId })).applications[0];
    assert.equal((await getRecord(client, ORG, again.applicationId!)).candidateId, record.candidateId);
    assert.deepEqual(recordFieldsFrom(DEFAULT_APPLICATION_FORM, { skills: "A, b, a", preferred_locations: "Pune; Thane" }), { skills: ["A", "b", "a"], preferredLocations: ["Pune", "Thane"] });
  });

  it("queues a bulk send, sends each message once, and skips the blacklisted and those without a number", async () => {
    const ok = await add({ fullName: "Neha Kulkarni", phone: "9876533333", email: "neha@example.com" });
    const noPhone = await add({ fullName: "Ravi Iyer", email: "ravi@example.com" });
    const blocked = await add({ fullName: "Karan Mehta", phone: "9876544444" });
    await setBlacklist(client, ORG, ME, blocked.candidateId, { reason: "asked_not_to_contact" });

    await assert.rejects(createCampaign(client, ORG, ME, { applicationIds: [ok.id] }), /Pick a WhatsApp template/);
    await assert.rejects(createCampaign(client, ORG, ME, { applicationIds: [ok.id], emailTemplateId: "email_job_opening" }), /Connect Zoho Mail/);
    const preview = await previewCampaign(client, ORG, { applicationIds: [ok.id], whatsappTemplateId: "wa_job_opening" });
    assert.deepEqual(preview.gaps, ["role", "location"], "no position: the role and location are missing");

    const c = await createCampaign(client, ORG, ME, { applicationIds: [ok.id, noPhone.id, blocked.id, ok.id], positionId, whatsappTemplateId: "wa_job_opening" });
    assert.deepEqual([c.status, c.total, c.counts.queued], ["queued", 3, 3], "one row per person");
    whatsapp.length = 0;
    // Two batches at the same moment: each message is claimed once.
    const [x, y] = await Promise.all([processCampaign(client, ORG, c.id, senders), processCampaign(client, ORG, c.id, senders)]);
    assert.equal(x.processed + y.processed, 3);
    assert.equal(whatsapp.length, 1, "only Neha is messaged, once");
    const [first] = whatsapp;
    assert.equal(first.phone, "919876533333");
    assert.equal(first.campaignName, "candidate_job_opening_v1");
    assert.deepEqual(first.templateParams.slice(0, 3), ["Neha", "Senior Graphic Designer", "Mumbai"]);
    assert.match(first.templateParams[3], /\/apply\/[A-Za-z0-9_-]{32}$/, "her own application link");
    const after1 = await getCampaign(client, ORG, c.id);
    assert.deepEqual([after1.status, after1.counts.sent, after1.counts.skipped], ["done", 1, 2]);
    const sends = await campaignSends(client, ORG, c.id);
    assert.ok(sends.some((s) => s.name === "Karan Mehta" && /Blacklisted/.test(s.reason ?? "")));
    assert.ok(sends.some((s) => s.name === "Ravi Iyer" && /mobile number/.test(s.reason ?? "")));
    assert.ok((await listActions(client, ORG, ok.candidateId)).some((a) => a.action === "outreach_sent" && a.meta.kind === "campaign"));
    assert.equal((await processCampaign(client, ORG, c.id, senders)).processed, 0, "nothing goes twice");
    assert.equal(whatsapp.length, 1);
    // The link sent is the one her form opens.
    const token = first.templateParams[3].split("/apply/")[1];
    assert.equal((await publicForm(client, token))?.firstName, "Neha");
  });

  it("stops a send, and runs automatic outreach for an approved request within working hours", async () => {
    const a1 = await add({ fullName: "Meera Joshi", phone: "9876555555", location: "Mumbai" });
    const big = await createCampaign(client, ORG, ME, { applicationIds: [a1.id], positionId, whatsappTemplateId: "wa_job_opening" });
    const stopped = await cancelCampaign(client, ORG, big.id);
    assert.deepEqual([stopped.status, stopped.counts.skipped], ["cancelled", 1]);

    // Off: nothing happens.
    const req = { id: "00000000-0000-0000-0000-0000000000c1", positionId, location: "Mumbai", roleTitle: "Senior Graphic Designer" };
    assert.equal(await createAutoCampaign(client, ORG, req, WORKING()), null);
    const settings = (await loadRecruitmentConfig(client, ORG)).outreach;
    await saveOutreachSettings(client, ORG, { ...settings, auto: { ...settings.auto, enabled: true, emailTemplateId: null, skipContactedDays: 30, maxPerRequest: 2 } });
    await db.query("insert into public.recruitment_requisitions (id, organization_id, role_title, status) values ($1, $2, 'Senior Graphic Designer', 'approved')", [req.id, ORG]);
    const auto = await createAutoCampaign(client, ORG, req, WORKING());
    assert.ok(auto, "matches found");
    assert.equal(auto!.source, "auto");
    assert.ok(auto!.total <= 2, "capped per request");
    const picked = (await campaignSends(client, ORG, auto!.id)).map((s) => s.name);
    assert.ok(!picked.includes("Neha Kulkarni"), "messaged about a job lately: left out");
    assert.ok(!picked.includes("Karan Mehta"), "blacklisted: left out");
    assert.equal(await createAutoCampaign(client, ORG, req, WORKING()), null, "one automatic send per request");
    whatsapp.length = 0;
    assert.deepEqual(await processCampaign(client, ORG, auto!.id, { ...senders, now: NIGHT }), { processed: 0, done: false, waiting: "hours" }, "not at night");
    assert.equal(whatsapp.length, 0);
    await processCampaign(client, ORG, auto!.id, senders);
    assert.equal((await getCampaign(client, ORG, auto!.id)).status, "done");
  });
});
