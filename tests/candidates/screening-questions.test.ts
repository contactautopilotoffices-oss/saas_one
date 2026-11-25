/**
 * Owner 2026-11-25: a position's own screening questions, drafted by the AI from the JD (a fake model here), edited and
 * saved by HR; the standard questions always asked first; HR's limit on the total; the candidate's page and the Calls
 * tab use the position's list. Against the real migrations in PGlite; no model or WhatsApp is called.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import type { PGlite } from "@electric-sql/pglite";
import type { SupabaseClient } from "@supabase/supabase-js";

import { publicForm, screeningLink, submitApplication } from "../../backend/lib/candidates/applications";
import type { JsonCaller } from "../../backend/lib/candidates/models";
import { DEFAULT_OUTREACH } from "../../backend/lib/candidates/outreach-settings";
import { addMembers, createPosition } from "../../backend/lib/candidates/positions";
import { createRecord } from "../../backend/lib/candidates/records";
import { saveOutreachSettings } from "../../backend/lib/candidates/requisitions";
import { screeningViews } from "../../backend/lib/candidates/screening";
import { positionScreening, savePositionQuestions, suggestScreeningQuestions } from "../../backend/lib/candidates/screening-questions";

import { freshDb } from "./db-stub";
import { pgliteSupabase } from "./pglite-supabase";

const ORG = "00000000-0000-0000-0000-00000000000a";
const USER = "00000000-0000-0000-0000-000000000001";
const ME = { id: USER, name: "Shweta" };

const reply = (questions: { label: string; type: string; options?: string[]; required?: boolean; help?: string }[]): JsonCaller =>
  async () => ({ text: JSON.stringify({ questions: questions.map((q) => ({ options: [], required: true, help: "", ...q })) }), model: "anthropic:claude-sonnet-5-5" });

describe("screening questions drafted from the JD", () => {
  let db: PGlite;
  let client: SupabaseClient;
  let positionId: string;
  let noJd: string;

  before(async () => {
    db = await freshDb();
    await db.query("insert into public.organizations (id) values ($1)", [ORG]);
    await db.query("insert into auth.users (id) values ($1)", [USER]);
    client = pgliteSupabase(db);
    positionId = (await createPosition(client, ORG, ME, { title: "Accounts Executive", location: "Vadodara" })).id;
    await db.query("update public.candidate_positions set jd_text = 'Day-to-day accounting in Tally Prime, GST returns (GSTR-1, 3B), TDS, bank reconciliation.' where id = $1", [positionId]);
    noJd = (await createPosition(client, ORG, ME, { title: "Office Boy" })).id;
  });
  after(async () => { await db.close(); });

  const standardCount = DEFAULT_OUTREACH.screening.fields.filter((f) => f.target).length;

  it("drafts the number HR asks for from the JD, and drops what it must not ask or already asks", async () => {
    await assert.rejects(suggestScreeningQuestions(client, ORG, noJd, { count: 5 }, reply([])), /job description/);
    let prompt = "";
    const caller: JsonCaller = async (req) => {
      prompt = req.user;
      return reply([
        { label: "How many years have you worked on Tally Prime?", type: "number" },
        { label: "Have you filed GSTR-1 and GSTR-3B yourself?", type: "select", options: ["Yes", "No"] },
        { label: "What is your marital status?", type: "text" },
        { label: "What is your expected salary?", type: "number" },
        { label: "Which banks have you reconciled?", type: "select", options: ["Only one"] },
      ])(req);
    };
    const drafted = await suggestScreeningQuestions(client, ORG, positionId, { count: 12 }, caller);
    assert.match(prompt, /Tally Prime/, "the JD goes in");
    assert.match(prompt, /Write 12 new questions/, "as many as HR asked for");
    assert.match(prompt, /Current city/, "the standard questions are listed as already asked");
    assert.deepEqual(drafted.map((q) => q.label), ["How many years have you worked on Tally Prime?", "Have you filed GSTR-1 and GSTR-3B yourself?", "Which banks have you reconciled?"],
      "personal and standard topics are dropped");
    assert.equal(drafted[1].type, "select");
    assert.equal(drafted[2].type, "text", "a choice with one option becomes a short answer");
    assert.ok(drafted.every((q) => q.target === null && /^q_/.test(q.id)));

    // "Suggest more" never repeats what is on the list.
    const more = await suggestScreeningQuestions(client, ORG, positionId, { count: 3, existing: drafted }, reply([
      { label: "How many years have you worked on Tally Prime?", type: "number" },
      { label: "Have you handled TDS returns?", type: "select", options: ["Yes", "No"] },
    ]));
    assert.deepEqual(more.map((q) => q.label), ["Have you handled TDS returns?"]);
  });

  it("saves HR's list within the limit; the candidate's page and the Calls tab ask the standard questions, then these", async () => {
    const own = [
      { id: "q_tally", label: "How many years have you worked on Tally Prime?", type: "number" as const, required: true, target: null },
      { id: "q_gst", label: "Have you filed GST returns yourself?", type: "select" as const, options: ["Yes", "No"], required: true, target: null },
    ];
    await assert.rejects(savePositionQuestions(client, ORG, positionId, [{ ...own[0], id: "total_exp" }]), /Two questions use the id/);
    await assert.rejects(savePositionQuestions(client, ORG, positionId, [{ ...own[1], options: ["Yes"] }]), /two options/);
    const tooMany = Array.from({ length: 25 }, (_, i) => ({ id: `q_${i}`, label: `Question ${i}`, type: "text" as const, required: false, target: null }));
    await assert.rejects(savePositionQuestions(client, ORG, positionId, tooMany), /the most is 25/);
    await savePositionQuestions(client, ORG, positionId, own);
    const view = await positionScreening(client, ORG, positionId);
    assert.deepEqual([view.standard.length, view.own.length, view.max, view.hasJd], [standardCount, 2, 25, true]);

    // HR lowers the limit: there is no room left for more suggestions.
    await saveOutreachSettings(client, ORG, { ...DEFAULT_OUTREACH, screening: { ...DEFAULT_OUTREACH.screening, maxQuestions: standardCount + 2 } });
    await assert.rejects(suggestScreeningQuestions(client, ORG, positionId, { count: 3, existing: own }, reply([])), /at the most allowed/);

    const { record } = await createRecord(client, ORG, USER, { fullName: "Farah Naik", phone: "9876500777" });
    await addMembers(client, ORG, ME, positionId, [record.id]);
    const link = await screeningLink(client, ORG, { candidateId: record.candidateId, applicationId: record.id, positionId, createdBy: USER });
    await db.query("insert into public.recruitment_screenings (organization_id, candidate_id, application_id, position_id, link_id, status, sent_at) values ($1, $2, $3, $4, $5, 'sent', now())", [ORG, record.candidateId, record.id, positionId, link.id]);
    const form = await publicForm(client, link.token);
    const labels = form?.form.fields.map((f) => f.label) ?? [];
    assert.equal(labels.length, standardCount + 2);
    assert.deepEqual(labels.slice(-2), ["How many years have you worked on Tally Prime?", "Have you filed GST returns yourself?"]);
    assert.ok(!labels.includes("Why are you looking for a change?"), "the standard list's own extra question gives way to the position's");

    await assert.rejects(submitApplication(client, link.token, { answers: { total_exp: "3", city: "Vadodara", notice: "30", expected_salary: "30000", q_tally: "3" }, consent: true, resume: null, ip: null, userAgent: null }), /GST returns/);
    await submitApplication(client, link.token, { answers: { total_exp: "3", city: "Vadodara", notice: "30", expected_salary: "30000", q_tally: "3", q_gst: "Yes" }, consent: true, resume: null, ip: null, userAgent: null });
    const { views } = await screeningViews(client, ORG, record.candidateId);
    assert.deepEqual(views[0].questions?.slice(-1).map((q) => q.id), ["q_gst"]);
    assert.equal(views[0].screening?.answers?.q_gst, "Yes");

    // An empty list: back to the standard questions.
    await savePositionQuestions(client, ORG, positionId, []);
    assert.deepEqual((await positionScreening(client, ORG, positionId)).own, []);
  });
});
