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
import { uploadAssignmentBrief } from "../../backend/lib/candidates/assignment-brief-storage";
import { scoreAssignment } from "../../backend/lib/candidates/assignment-score";
import { cancelAssignment, listAssignments, listDocuments, requestDocuments, reviewDocument, sendAssignment } from "../../backend/lib/candidates/assignments";
import {
  attachOfferPdf, fileInterview, setInterviewStatus, submitScorecard, breakupGroups, createOffer, decideOffer, editBreakup, editLetter, listHandovers, publicOffer, publicOfferPdf, releaseOffer, respondOnPage, staffOfferPdf, type FlowDeps,
} from "../../backend/lib/candidates/hiring";
import { DEFAULT_OUTREACH } from "../../backend/lib/candidates/outreach-settings";
import { addMembers, createPosition } from "../../backend/lib/candidates/positions";
import { createRecord } from "../../backend/lib/candidates/records";
import { saveOutreachSettings, saveDepartmentHeads, saveRecruitmentConfig } from "../../backend/lib/candidates/requisitions";

import { freshDb } from "./db-stub";
import { pgliteSupabase } from "./pglite-supabase";

const ORG = "00000000-0000-0000-0000-00000000000a";
const HR = "00000000-0000-0000-0000-000000000031";
const HR_HEAD = "00000000-0000-0000-0000-000000000032";
const DIRECTOR = "00000000-0000-0000-0000-000000000033";
const HOD = "00000000-0000-0000-0000-000000000035";
const MANAGER = "00000000-0000-0000-0000-000000000034";
const by = (id: string, name: string) => ({ id, name });
const ME = by(HR, "Shweta");

describe("assignment, documents and the letter of intent", () => {
  let db: PGlite;
  let client: SupabaseClient;
  let positionId: string;
  let person: { id: string; candidateId: string };
  const whatsapp: { phone: string; campaignName: string; templateParams: string[] }[] = [];
  const emails: { to: string; subject: string; html: string; attachments?: Parameters<FlowDeps["sendEmail"]>[3] }[] = [];
  const alerts: { positionId: string; title: string }[] = [];
  const uploads: string[] = [];
  const storage: ApplicationStorage = { async upload(path) { uploads.push(path); return { error: null }; } };
  const send = async (o: { phone: string; campaignName: string; templateParams: string[] }) => { whatsapp.push(o); return { success: true }; };
  const deps: FlowDeps = {
    async sendEmail(to, subject, html, attachments) { emails.push({ to, subject, html, attachments }); },
    async scorecardLink() { return null; },
    appUrl: "https://app.test",
    sendWhatsApp: send,
    async offerDecisionLink(_org, offerId, approverId, level) { return `https://app.test/act/${offerId}/${approverId}/${level}`; },
  };
  const tokenOf = (url: string, path: string) => url.split(path)[1];

  before(async () => {
    db = await freshDb();
    await db.query("insert into public.organizations (id) values ($1)", [ORG]);
    for (const [id, name, email, role] of [[HR, "Shweta", "shweta@example.com", "hr"], [HR_HEAD, "Anita", "anita@example.com", "hr_head"], [DIRECTOR, "Sunil", "sunil@example.com", "org_super_admin"], [MANAGER, "Rakesh", "rakesh@example.com", "manager"], [HOD, "Maya", "maya@example.com", "manager"]] as const) {
      await db.query("insert into auth.users (id) values ($1)", [id]);
      await db.query("insert into public.users (id, full_name, email) values ($1, $2, $3) on conflict do nothing", [id, name, email]);
      await db.query("insert into public.organization_memberships (user_id, organization_id, role) values ($1, $2, $3)", [id, ORG, role]);
    }
    client = pgliteSupabase(db);
    await saveRecruitmentConfig(client, ORG, { hrHead: { userId: HR_HEAD }, director: { userId: DIRECTOR } });
    positionId = (await createPosition(client, ORG, ME, { title: "Marketing Executive", department: "Marketing", location: "Mumbai", openings: 1 })).id;
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
    assert.equal((await publicForm(client, token, true))?.assignment?.downloadUrl, undefined);
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

  it("reuses the document link, accepts photos and replaces only the requested document", async () => {
    const [bucket] = (await db.query<{ allowed_mime_types: string[] }>("select allowed_mime_types from storage.buckets where id = 'candidate-resumes'")).rows;
    assert.ok(["application/pdf", "image/jpeg", "image/png", "image/webp"].every(type => bucket.allowed_mime_types.includes(type)));
    const target = { candidateId: person.candidateId, applicationId: person.id, positionId };
    const asked = await requestDocuments(client, ORG, ME, target, { send });
    assert.equal(asked.sent, true);
    assert.equal(whatsapp.at(-1)?.campaignName, "hr_candidate_documents_v1");
    const token = tokenOf(asked.url, "/apply/");
    const form = await publicForm(client, token);
    assert.equal(form?.kind, "documents");
    assert.equal(form?.form.fields.length, DEFAULT_OUTREACH.documents.items.length);
    const pdf = { name: "slip.pdf", type: "application/pdf", bytes: Buffer.from("%PDF-") };
    const jpg = { name: "pan.jpg", type: "", bytes: Buffer.from("ffd8ffe0", "hex") };
    const png = { name: "replacement.png", type: "image/png", bytes: Buffer.from("89504e470d0a1a0a", "hex") };
    const post = (files: NonNullable<Parameters<typeof submitApplication>[2]["files"]>, store = storage) =>
      submitApplication(client, token, { answers: {}, consent: true, resume: null, ip: null, userAgent: null, files }, store);
    await assert.rejects(post({ doc_1: { ...pdf, bytes: Buffer.from("PK") } }), /attach a PDF, JPG, PNG or WebP/);
    await post({ doc_1: pdf, doc_4: jpg });
    assert.match(uploads.at(-1) ?? "", /\.jpg$/);
    const docs = await listDocuments(client, ORG, person.candidateId);
    assert.deepEqual(docs.map(d => d.item).sort(), ["Last 3 months' salary slips", "PAN card"]);
    const pan = docs.find(doc => doc.item === "PAN card")!;
    await assert.rejects(reviewDocument(client, ORG, ME, pan.id, "rejected", ""), /Say why/);
    await reviewDocument(client, ORG, ME, pan.id, "verified", null, pan.uploadedAt);
    await assert.rejects(post({ doc_4: png }), /verified/);
    await reviewDocument(client, ORG, ME, pan.id, "rejected", "Please upload a clearer photo.", pan.uploadedAt);
    const resent = await requestDocuments(client, ORG, ME, target, { send });
    assert.equal(resent.url, asked.url);
    assert.deepEqual((await publicForm(client, token))?.documents?.doc_4, { fileName: "pan.jpg", status: "rejected", reviewNote: "Please upload a clearer photo." });
    await assert.rejects(post({ doc_4: png }, { async upload() { return { error: { message: "test storage failed" } }; } }), /could not be saved/);
    assert.equal((await publicForm(client, token))?.documents?.doc_4.fileName, "pan.jpg");

    const removed: string[] = [];
    await post({ doc_4: png }, { ...storage, async remove(path) { removed.push(path); } });
    assert.match(removed[0] ?? "", /\.jpg$/);
    const after = await listDocuments(client, ORG, person.candidateId);
    assert.equal(after.length, 2);
    assert.deepEqual(after.find(doc => doc.id === pan.id), { ...pan, fileName: "replacement.png", status: "uploaded", reviewedBy: null, reviewNote: null, uploadedAt: after.find(doc => doc.id === pan.id)?.uploadedAt });
    assert.deepEqual((await publicForm(client, token))?.documents?.doc_4, { fileName: "replacement.png", status: "uploaded", reviewNote: null });
    await assert.rejects(reviewDocument(client, ORG, ME, pan.id, "verified", null, pan.uploadedAt), /file changed/);
  });

  it("puts the hiring manager first, restarts approval when the breakup changes, and the candidate accepts once on the letter page", async () => {
    await saveDepartmentHeads(client, ORG, { heads: [{ department: "Marketing", userId: HOD }] });
    const interviewId = "33333333-3333-4333-8333-333333333333";
    const cards = await fileInterview(client, ORG, ME, { id: interviewId, candidateId: person.candidateId, applicationId: person.id, positionId, round: "Manager", atLocal: "2026-11-22T11:00", mode: "in_person", venue: null, joinPath: null, interviewers: [{ id: MANAGER, name: "Rakesh" }] });
    await setInterviewStatus(client, ORG, ME, interviewId, { status: "done" }, deps);
    await submitScorecard(client, cards.get(MANAGER)!, { ratings: { "Technical skill": 4, Communication: 4, Attitude: 4, "Relevant experience": 4 }, overall: 4, recommendation: "proceed" });
    emails.length = 0;
    const offer = await createOffer(client, ORG, ME, { applicationId: person.id, positionId, proposedCtc: 540_000, joiningDate: "2027-01-04" }, deps);
    assert.deepEqual([offer.currentLevel, offer.needsDirector], ["hiring_manager", true], "the manager first; the Director approves every offer by default");
    assert.ok(emails.some((e) => e.to === "rakesh@example.com" && e.html.includes(`https://app.test/act/${offer.id}/${MANAGER}/hiring_manager`)), "the manager approves from the email, without a login");
    await assert.rejects(decideOffer(client, ORG, by(HR_HEAD, "Anita"), offer.id, { decision: "approve" }, deps), /hiring manager who raised/);
    const decisions = await Promise.allSettled([1, 2].map(() =>
      decideOffer(client, ORG, by(MANAGER, "Rakesh"), offer.id, { decision: "approve" }, deps)));
    assert.deepEqual(decisions.flatMap(d => d.status === "fulfilled" ? [d.value.currentLevel] : []), ["hod"]);
    assert.equal(decisions.filter(d => d.status === "rejected").length, 1);
    await assert.rejects(decideOffer(client, ORG, by(DIRECTOR, "Sunil"), offer.id, { decision: "approve" }, deps), /department head/);

    // HR adds the breakup: approval starts again from the manager, and it is in the audit log.
    const breakup = { Basic: 22_500, HRA: 9_000, "Special allowance": 13_500, "Employee PF": 1_800, "Professional tax": 200 };
    const edited = await editBreakup(client, ORG, ME, offer.id, { breakup }, deps);
    await assert.rejects(decideOffer(client, ORG, by(MANAGER, "Rakesh"), offer.id, { decision: "approve", approvalRevision: offer.approvalRevision }, deps), /annexure or approval step changed/);
    assert.deepEqual([edited.status, edited.currentLevel, edited.breakup.Basic], ["pending", "hiring_manager", 22_500]);
    const [entry] = (await db.query<{ action: string; entity_id: string }>("select action, entity_id from public.recruitment_audit_log where entity_type = 'offer'")).rows;
    assert.deepEqual(entry, { action: "breakup_edit", entity_id: offer.id });
    await assert.rejects(db.query("delete from public.recruitment_audit_log"), /insert-only/);
    const g = breakupGroups(edited.breakup, DEFAULT_OUTREACH.offer);
    assert.deepEqual([g.gross, g.totalDeductions, g.net], [45_000, 2_000, 43_000]);

    for (const [id, name] of [[MANAGER, "Rakesh"], [HOD, "Maya"]] as const) await decideOffer(client, ORG, by(id, name), offer.id, { decision: "approve" }, deps);
    const rejected = await decideOffer(client, ORG, by(DIRECTOR, "Sunil"), offer.id, { decision: "reject", reason: "Adjust the CTC." }, deps);
    assert.equal(rejected.responseReason, "Adjust the CTC.");
    await assert.rejects(attachOfferPdf(client, ORG, ME, offer.id, "Offer.pdf", Buffer.from("%PDF-1.7")), /after approval/);
    const resubmitted = await editBreakup(client, ORG, ME, offer.id, { breakup, proposedCtc: 525_000, joiningDate: "2027-01-04", note: "Updated CTC", approvalRevision: rejected.approvalRevision }, deps, true);
    assert.deepEqual([resubmitted.id, resubmitted.status, resubmitted.currentLevel, resubmitted.proposedCtc, resubmitted.selectedNote], [offer.id, "pending", "hiring_manager", 525_000, "Updated CTC"]);
    assert.ok(resubmitted.events.some(e => e.action === "rejected" && e.reason === "Adjust the CTC."));
    assert.ok(resubmitted.events.some(e => e.action === "resubmitted"));
    assert.equal((await db.query("select id from public.recruitment_offers")).rows.length, 1);
    for (const [id, name] of [[MANAGER, "Rakesh"], [HOD, "Maya"], [DIRECTOR, "Sunil"]] as const) await decideOffer(client, ORG, by(id, name), offer.id, { decision: "approve" }, deps);
    await editLetter(client, ORG, ME, offer.id, { letter: "Dear Neha, we are glad to offer you the Marketing Executive role. Shweta" });
    await assert.rejects(attachOfferPdf(client, ORG, ME, offer.id, "bad.pdf", Buffer.from("not a PDF")), /Choose an offer letter PDF/);
    const pdf = Buffer.from("%PDF-1.7\nTest offer letter");
    assert.equal((await attachOfferPdf(client, ORG, ME, offer.id, "Neha offer letter.pdf", pdf)).letterFileName, "Neha offer letter.pdf");
    assert.deepEqual((await staffOfferPdf(client, ORG, offer.id))?.content, pdf);
    await assert.rejects(staffOfferPdf(client, "00000000-0000-0000-0000-000000000000", offer.id), /no longer there/);
    const unpublished = "P".repeat(32);
    await db.query("update public.recruitment_offers set public_token = $1 where id = $2", [unpublished, offer.id]);
    assert.equal(await publicOfferPdf(client, unpublished), null);
    emails.length = 0;
    const attempts = await Promise.allSettled([releaseOffer(client, ORG, ME, offer.id, deps), releaseOffer(client, ORG, ME, offer.id, deps)]);
    const released = attempts.find(r => r.status === "fulfilled")?.value;
    assert.ok(released);
    assert.equal(attempts.filter(r => r.status === "fulfilled").length, 1);
    assert.match(released.publicUrl ?? "", /\/offer\/[A-Za-z0-9_-]{32}$/);
    const letter = emails.find((e) => e.to === "neha@example.com");
    assert.ok(letter && /Letter of intent/.test(letter.subject) && letter.html.includes("Gross per month") && letter.html.includes("Accept or decline"), "the letter, the breakup and the page");
    assert.equal(emails.filter(e => e.to === "neha@example.com").length, 1);
    assert.deepEqual(letter?.attachments?.[0], { filename: "Neha offer letter.pdf", contentType: "application/pdf", content: pdf });
    assert.equal(whatsapp.at(-1)?.campaignName, "hr_candidate_loi_v1");

    const token = tokenOf(released.publicUrl!, "/offer/");
    const page = await publicOffer(client, token);
    assert.equal(page?.letterFileName, "Neha offer letter.pdf");
    assert.deepEqual((await publicOfferPdf(client, token))?.content, pdf);
    await assert.rejects(attachOfferPdf(client, ORG, ME, offer.id, "new.pdf", pdf), /before release/);
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

  it("keeps sent briefs independent of template edits and restricts downloads to an active assignment", async () => {
    const objects = new Set<string>();
    const bucket = {
      async upload(path: string) {
        if (objects.has(path)) return { error: { message: "The resource already exists" } };
        objects.add(path);
        return { error: null };
      },
      async createSignedUrl(path: string, seconds: number, options: { download: string }) {
        assert.equal(seconds, 60);
        return objects.has(path) ? { data: { signedUrl: "https://storage.test/" + path + "?download=" + options.download } }
          : { error: { message: "No such object" } };
      },
    };
    const scoped = Object.assign(Object.create(client) as SupabaseClient, { storage: { from: () => bucket } });
    const pdf = new File(["%PDF-1.7"], "Marketing brief.pdf");
    const word = new File([Buffer.from("504b0304", "hex"), "word/document.xml"], "New brief.docx");
    const legacy = new File([Buffer.from("d0cf11e0a1b11ae1", "hex"), Buffer.from("WordDocument", "utf16le")], "Legacy.doc");
    const original = await uploadAssignmentBrief(scoped, ORG, pdf);
    assert.deepEqual(await uploadAssignmentBrief(scoped, ORG, pdf), original);
    assert.equal(objects.size, 1);
    const replacement = await uploadAssignmentBrief(scoped, ORG, word);
    assert.equal((await uploadAssignmentBrief(scoped, ORG, legacy)).name, legacy.name);
    for (const invalid of [new File(["text"], "brief.pdf"), new File(["text"], "brief.txt"), new File([new Uint8Array(4194305)], "big.doc")]) {
      await assert.rejects(uploadAssignmentBrief(scoped, ORG, invalid), /Choose/);
    }
    const template = { id: "plan", name: "Marketing", department: "Marketing", title: "Plan", brief: "Prepare a plan", guidelines: "", driveLink: "https://drive.google.com/x", dueDays: 3, attachment: original };
    const settings = { ...DEFAULT_OUTREACH, assignment: { ...DEFAULT_OUTREACH.assignment, library: [template] } };
    const saved = await saveOutreachSettings(scoped, ORG, settings);
    const input = { applicationId: person.id, candidateId: person.candidateId, positionId, ...saved.assignment.library[0] };
    const delivery = { send, alert: async () => undefined };
    await assert.rejects(sendAssignment(scoped, ORG, ME, { ...input, attachment: { key: "../private.pdf", name: pdf.name } }, delivery), /valid assignment attachment/);
    const foreign = await uploadAssignmentBrief(scoped, HR, new File(["%PDF-foreign"], "Private.pdf"));
    await assert.rejects(sendAssignment(scoped, ORG, ME, { ...input, attachment: foreign }, delivery), /unavailable/);
    const sent = await sendAssignment(scoped, ORG, ME, input, delivery);
    const token = tokenOf(whatsapp.at(-1)!.templateParams[5], "/apply/");
    settings.assignment.library[0] = { ...template, attachment: replacement };
    await saveOutreachSettings(scoped, ORG, settings);
    const shown = (await publicForm(scoped, token))?.assignment;
    assert.equal(shown?.attachmentName, pdf.name);
    assert.equal(shown?.driveLink, template.driveLink);
    assert.equal(shown?.downloadUrl, undefined);
    assert.ok((await publicForm(scoped, token, true))?.assignment?.downloadUrl?.includes(original.key));
    await cancelAssignment(scoped, ORG, ME, sent.id);
    assert.equal(await publicForm(scoped, token, true), null);
  });
});
