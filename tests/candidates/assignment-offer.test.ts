/**
 * Owner 2026-11-24 ("complete all the remaining phases"; 23 Nov HR meeting), against the real migrations in PGlite:
 *   - the assignment: sent with the candidate's own link (WhatsApp is a fake), stakeholders told, submitted once with a
 *     link and a file, scored by the AI against the JD (a fake model), the score shown to HR only;
 *   - documents after selection: asked for, uploaded through the link, verified or rejected;
 *   - the offer: the hiring manager approves the annexure first; a breakup change starts the approval again (audited);
 *     the letter-of-intent page where the candidate accepts once; the acceptance handed to onboarding.
 * No message leaves: email, WhatsApp and storage are recorders (owner rule: no WhatsApp sends in tests).
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import type { PGlite } from "@electric-sql/pglite";
import type { SupabaseClient } from "@supabase/supabase-js";

import { publicForm, submitApplication, type ApplicationStorage } from "../../backend/lib/candidates/applications";
import { scoreAssignment } from "../../backend/lib/candidates/assignment-score";
import { cancelAssignment, listAssignments, listDocuments, requestDocuments, reviewDocument, sendAssignment } from "../../backend/lib/candidates/assignments";
import {
  breakupGroups, createOffer, decideOffer, editBreakup, editLetter, listHandovers, publicOffer, releaseOffer, respondOnPage, type FlowDeps,
} from "../../backend/lib/candidates/hiring";
import { DEFAULT_OUTREACH } from "../../backend/lib/candidates/outreach-settings";
import { addMembers, createPosition } from "../../backend/lib/candidates/positions";
import { createRecord } from "../../backend/lib/candidates/records";
import { saveRecruitmentConfig } from "../../backend/lib/candidates/requisitions";

import { freshDb } from "./db-stub";
import { pgliteSupabase } from "./pglite-supabase";

const ORG = "00000000-0000-0000-0000-00000000000a";
const HR = "00000000-0000-0000-0000-000000000031";
const HR_HEAD = "00000000-0000-0000-0000-000000000032";
const DIRECTOR = "00000000-0000-0000-0000-000000000033";
const MANAGER = "00000000-0000-0000-0000-000000000034";
const by = (id: string, name: string) => ({ id, name });
const ME = by(HR, "Shweta");

describe("assignment, documents and the letter of intent", () => {
  let db: PGlite;
  let client: SupabaseClient;
  let positionId: string;
  let person: { id: string; candidateId: string };
  const whatsapp: { phone: string; campaignName: string; templateParams: string[] }[] = [];
  const emails: { to: string; subject: string; html: string }[] = [];
  const alerts: { positionId: string; title: string }[] = [];
  const uploads: string[] = [];
  const storage: ApplicationStorage = { async upload(path) { uploads.push(path); return { error: null }; } };
  const send = async (o: { phone: string; campaignName: string; templateParams: string[] }) => { whatsapp.push(o); return { success: true }; };
  const deps: FlowDeps = {
    async sendEmail(to, subject, html) { emails.push({ to, subject, html }); },
    async scorecardLink() { return null; },
    appUrl: "https://app.test",
    sendWhatsApp: send,
    async offerDecisionLink(_org, offerId, approverId, level) { return `https://app.test/act/${offerId}/${approverId}/${level}`; },
  };
  const tokenOf = (url: string, path: string) => url.split(path)[1];

  before(async () => {
    db = await freshDb();
    await db.query("insert into public.organizations (id) values ($1)", [ORG]);
    for (const [id, name, email, role] of [[HR, "Shweta", "shweta@example.com", "hr"], [HR_HEAD, "Anita", "anita@example.com", "hr_head"], [DIRECTOR, "Sunil", "sunil@example.com", "org_super_admin"], [MANAGER, "Rakesh", "rakesh@example.com", "manager"]] as const) {
      await db.query("insert into auth.users (id) values ($1)", [id]);
      await db.query("insert into public.users (id, full_name, email) values ($1, $2, $3) on conflict do nothing", [id, name, email]);
      await db.query("insert into public.organization_memberships (user_id, organization_id, role) values ($1, $2, $3)", [id, ORG, role]);
    }
    client = pgliteSupabase(db);
    await saveRecruitmentConfig(client, ORG, { hrHead: { userId: HR_HEAD }, director: { userId: DIRECTOR } });
    positionId = (await createPosition(client, ORG, ME, { title: "Marketing Executive", location: "Mumbai", openings: 1 })).id;
    await db.query("update public.candidate_positions set jd_text = 'Plan and run social media campaigns; write copy; report on results.' where id = $1", [positionId]);
    // The position came from Rakesh's hiring request (band 4 to 6 LPA): he is the hiring manager.
    await db.query("insert into public.recruitment_requisitions (organization_id, role_title, status, budget_min_ctc, budget_max_ctc, position_id, requisition_no, raised_by) values ($1, 'Marketing Executive', 'approved', 400000, 600000, $2, 'REQ-2026-0042', $3)", [ORG, positionId, MANAGER]);
    const { record } = await createRecord(client, ORG, HR, { fullName: "Neha Kulkarni", phone: "9876512399", email: "neha@example.com" });
    person = { id: record.id, candidateId: record.candidateId };
    await addMembers(client, ORG, ME, positionId, [record.id]);
  });
  after(async () => { await db.close(); });

  let assignmentId = "";
  it("sends an assignment with the candidate's own link, and tells the stakeholders", async () => {
    await assert.rejects(sendAssignment(client, ORG, ME, { applicationId: person.id, candidateId: person.candidateId, positionId, title: "", brief: "x" }, { send, alert: async () => undefined }), /title and a brief/);
    await assert.rejects(sendAssignment(client, ORG, ME, { applicationId: person.id, candidateId: person.candidateId, positionId, title: "Plan", brief: "x", dueAt: "2020-01-01T10:00:00Z" }, { send, alert: async () => undefined }), /future/);
    const due = new Date(Date.now() + 3 * 86_400_000).toISOString();
    const r = await sendAssignment(client, ORG, ME, { applicationId: person.id, candidateId: person.candidateId, positionId, title: "Diwali campaign plan", brief: "Plan a 2-week Instagram campaign.", driveLink: "https://drive.google.com/x", dueAt: due },
      { send, alert: async (_org, pos, a) => { alerts.push({ positionId: pos, title: a.title }); } });
    assignmentId = r.id;
    assert.equal(r.sent, true);
    assert.equal(whatsapp.at(-1)?.campaignName, "hr_candidate_assignment_v1");
    assert.deepEqual(whatsapp.at(-1)?.templateParams.slice(0, 4), ["Neha", "Marketing Executive", "Autopilot Offices", "Diwali campaign plan"]);
    assert.match(whatsapp.at(-1)?.templateParams[5] ?? "", /\/apply\/[A-Za-z0-9_-]{32}$/);
    assert.deepEqual(alerts, [{ positionId, title: "Assignment sent: Neha Kulkarni (Marketing Executive)" }]);
    await assert.rejects(sendAssignment(client, ORG, ME, { applicationId: person.id, candidateId: person.candidateId, positionId, title: "Again", brief: "x" }, { send, alert: async () => undefined }), /already waiting/);
    const [log] = (await db.query<{ kind: string; status: string }>("select kind, status from public.recruitment_message_log where candidate_id = $1", [person.candidateId])).rows;
    assert.deepEqual(log, { kind: "assignment", status: "sent" }, "the one message log");
    const [c] = (await db.query<{ last_contacted_at: string | null }>("select last_contacted_at from public.candidates where id = $1", [person.candidateId])).rows;
    assert.ok(c.last_contacted_at, "last contacted is kept");
  });

  it("takes the work once through the link, then scores it against the JD for HR only", async () => {
    const token = tokenOf(whatsapp.at(-1)!.templateParams[5], "/apply/");
    const form = await publicForm(client, token);
    assert.equal(form?.kind, "assignment");
    assert.equal(form?.assignment?.title, "Diwali campaign plan");
    assert.equal(form?.assignment?.driveLink, "https://drive.google.com/x");
    const base = { consent: true, resume: null, ip: null, userAgent: null };
    await assert.rejects(submitApplication(client, token, { ...base, answers: {} }, storage), /link to your work, a file, or both/);
    await assert.rejects(submitApplication(client, token, { ...base, answers: { submission_link: "drive.google.com/y" } }, storage), /https/);
    const file = { name: "plan.pdf", type: "application/pdf", bytes: new Uint8Array([37, 80, 68, 70]) };
    const done = await submitApplication(client, token, { ...base, answers: { submission_link: "https://drive.google.com/y", notes: "Plan attached." }, files: { work_file: file } }, storage);
    assert.equal(done.assignmentId, assignmentId);
    assert.ok(uploads.some((u) => u.startsWith(`assignments/${ORG}/${assignmentId}.pdf`)));
    await assert.rejects(submitApplication(client, token, { ...base, answers: { notes: "again" } }, storage), /already submitted/);

    const result = await scoreAssignment(client, ORG, assignmentId, {
      download: async () => new Uint8Array([1]), read: async () => "Week 1: reels. Week 2: influencer posts. KPIs: reach, saves.",
      caller: async (req) => {
        assert.match(req.user, /Plan and run social media campaigns/, "the JD goes in");
        assert.match(req.user, /influencer posts/, "the work goes in");
        return { text: JSON.stringify({ score: 78, summary: "A clear plan.", strengths: ["Clear weekly plan"], gaps: ["No budget"] }), model: "anthropic:claude-sonnet-5-5" };
      },
    });
    assert.deepEqual(result, { status: "scored", score: 78 });
    const [hr] = await listAssignments(client, ORG, person.candidateId, { withAi: true });
    assert.deepEqual([hr.status, hr.ai?.score, hr.ai?.gaps], ["submitted", 78, ["No budget"]]);
    const [manager] = await listAssignments(client, ORG, person.candidateId, { withAi: false });
    assert.equal(manager.ai, null, "the hiring manager never sees the AI's view");
    await assert.rejects(cancelAssignment(client, ORG, ME, assignmentId), /still waiting/);
  });

  it("asks for documents and takes them through the link; HR verifies or rejects each", async () => {
    const asked = await requestDocuments(client, ORG, ME, { candidateId: person.candidateId, applicationId: person.id, positionId }, { send });
    assert.equal(asked.sent, true);
    assert.equal(whatsapp.at(-1)?.campaignName, "hr_candidate_documents_v1");
    const token = tokenOf(asked.url, "/apply/");
    const form = await publicForm(client, token);
    assert.equal(form?.kind, "documents");
    assert.equal(form?.form.fields.length, DEFAULT_OUTREACH.documents.items.length);
    const pdf = { name: "slip.pdf", type: "application/pdf", bytes: new Uint8Array([1, 2]) };
    await assert.rejects(submitApplication(client, token, { answers: {}, consent: true, resume: null, ip: null, userAgent: null, files: { doc_1: { ...pdf, type: "application/zip" } } }, storage), /PDF or an image/);
    await submitApplication(client, token, { answers: {}, consent: true, resume: null, ip: null, userAgent: null, files: { doc_1: pdf, doc_4: { ...pdf, name: "pan.jpg", type: "image/jpeg" } } }, storage);
    const docs = await listDocuments(client, ORG, person.candidateId);
    assert.deepEqual(docs.map((d) => d.item).sort(), ["Last 3 months' salary slips", "PAN card"]);
    await assert.rejects(reviewDocument(client, ORG, ME, docs[0].id, "rejected", ""), /Say why/);
    await reviewDocument(client, ORG, ME, docs[0].id, "verified", null);
    assert.equal((await listDocuments(client, ORG, person.candidateId)).find((d) => d.id === docs[0].id)?.status, "verified");
    // A second request switches the first link off.
    await requestDocuments(client, ORG, ME, { candidateId: person.candidateId, applicationId: person.id, positionId }, { send });
    assert.equal(await publicForm(client, token), null);
  });

  it("puts the hiring manager first, restarts approval when the breakup changes, and the candidate accepts once on the letter page", async () => {
    emails.length = 0;
    const offer = await createOffer(client, ORG, ME, { applicationId: person.id, positionId, proposedCtc: 540_000, joiningDate: "2027-01-04" }, deps);
    assert.deepEqual([offer.currentLevel, offer.needsDirector], ["hiring_manager", true], "the manager first; the Director approves every offer by default");
    assert.ok(emails.some((e) => e.to === "rakesh@example.com" && e.html.includes(`https://app.test/act/${offer.id}/${MANAGER}/hiring_manager`)), "the manager approves from the email, without a login");
    await assert.rejects(decideOffer(client, ORG, by(HR_HEAD, "Anita"), offer.id, { decision: "approve" }, deps), /hiring manager who raised/);
    const toHr = await decideOffer(client, ORG, by(MANAGER, "Rakesh"), offer.id, { decision: "approve" }, deps);
    assert.equal(toHr.currentLevel, "hr_head");

    // HR adds the breakup: approval starts again from the manager, and it is in the audit log.
    const breakup = { Basic: 22_500, HRA: 9_000, "Special allowance": 13_500, "Employee PF": 1_800, "Professional tax": 200 };
    const edited = await editBreakup(client, ORG, ME, offer.id, { breakup }, deps);
    assert.deepEqual([edited.status, edited.currentLevel, edited.breakup.Basic], ["pending", "hiring_manager", 22_500]);
    const [entry] = (await db.query<{ action: string; entity_id: string }>("select action, entity_id from public.recruitment_audit_log where entity_type = 'offer'")).rows;
    assert.deepEqual(entry, { action: "breakup_edit", entity_id: offer.id });
    await assert.rejects(db.query("delete from public.recruitment_audit_log"), /insert-only/);
    const g = breakupGroups(edited.breakup, DEFAULT_OUTREACH.offer);
    assert.deepEqual([g.gross, g.totalDeductions, g.net], [45_000, 2_000, 43_000]);

    for (const [id, name] of [[MANAGER, "Rakesh"], [HR_HEAD, "Anita"], [DIRECTOR, "Sunil"]] as const) await decideOffer(client, ORG, by(id, name), offer.id, { decision: "approve" }, deps);
    await editLetter(client, ORG, ME, offer.id, { letter: "Dear Neha, we are glad to offer you the Marketing Executive role. Shweta" });
    emails.length = 0;
    const released = await releaseOffer(client, ORG, ME, offer.id, deps);
    assert.match(released.publicUrl ?? "", /\/offer\/[A-Za-z0-9_-]{32}$/);
    const letter = emails.find((e) => e.to === "neha@example.com");
    assert.ok(letter && /Letter of intent/.test(letter.subject) && letter.html.includes("Gross per month") && letter.html.includes("Accept or decline"), "the letter, the breakup and the page");
    assert.equal(whatsapp.at(-1)?.campaignName, "hr_candidate_loi_v1");

    const token = tokenOf(released.publicUrl!, "/offer/");
    const page = await publicOffer(client, token);
    assert.deepEqual([page?.status, page?.firstName, page?.breakup.net], ["open", "Neha", 43_000]);
    await assert.rejects(respondOnPage(client, token, { response: "declined" }, deps), /why/);
    assert.deepEqual(await respondOnPage(client, token, { response: "accepted" }, deps), { status: "accepted" });
    await assert.rejects(respondOnPage(client, token, { response: "declined", reason: "changed my mind" }, deps), /already answered/);
    assert.equal((await publicOffer(client, token))?.status, "accepted");

    const [handover] = await listHandovers(client, ORG);
    assert.deepEqual([handover.candidateName, handover.joiningDate, handover.status], ["Neha Kulkarni", "2027-01-04", "pending"]);
    assert.equal(((handover.snapshot as { documents: unknown[] }).documents).length, 2, "the documents go with it");
    assert.ok(emails.some((e) => e.to === "anita@example.com" && /ready for onboarding/.test(e.subject)), "the HR team is told");
  });
});
