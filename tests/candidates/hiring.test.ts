/**
 * The hiring flow after booking (owner 2026-11-21; migration 20261121000003), against the real migrations in PGlite:
 * an interview's follow-up and reminders, blind scorecards, the offer's approvals (HR Head; the Director above the
 * band; never the proposer), the letter's blanks blocking release, the answer, joining (the position closes) and
 * dropping (it reopens), the chasers, and the dashboard. No message leaves: email is a recorder.
 */
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import type { PGlite } from "@electric-sql/pglite";
import type { SupabaseClient } from "@supabase/supabase-js";

import { resetHistoryCheck } from "../../backend/lib/candidates/actions";
import {
  createOffer, decideOffer, editLetter, fileInterview, istToInstant, letterGaps, listOffers, recordJoining, recordResponse, releaseOffer,
  rescheduleInterview, runInterviewJobs, runOfferJobs, setInterviewStatus, submitScorecard, type FlowDeps,
} from "../../backend/lib/candidates/hiring";
import { addMembers, createPosition, getPosition } from "../../backend/lib/candidates/positions";
import { recruitmentDashboard } from "../../backend/lib/candidates/recruitment-dashboard";
import { createRecord } from "../../backend/lib/candidates/records";
import { DEFAULT_OUTREACH } from "../../backend/lib/candidates/outreach-settings";
import { saveOutreachSettings, saveRecruitmentConfig } from "../../backend/lib/candidates/requisitions";

import { freshDb } from "./db-stub";
import { pgliteSupabase } from "./pglite-supabase";

const ORG = "00000000-0000-0000-0000-00000000000a";
const RECRUITER = "00000000-0000-0000-0000-000000000021";
const HR_HEAD = "00000000-0000-0000-0000-000000000022";
const DIRECTOR = "00000000-0000-0000-0000-000000000023";
const PANEL = "00000000-0000-0000-0000-000000000024";
const PANEL2 = "00000000-0000-0000-0000-000000000025";
const by = (id: string, name: string) => ({ id, name });
const ME = by(RECRUITER, "Roohi");
const NOW = new Date("2026-11-21T04:30:00Z"); // 10:00 IST

describe("the hiring flow after booking", () => {
  let db: PGlite;
  let client: SupabaseClient;
  let positionId: string;
  let farah: { id: string; candidateId: string };
  const sent: { to: string; subject: string; html: string }[] = [];
  const deps: FlowDeps = {
    async sendEmail(to, subject, html) { sent.push({ to, subject, html }); },
    async scorecardLink(_org, card) { return `https://app.test/score/${card.id}`; },
    appUrl: "https://app.test",
    now: () => NOW,
  };
  const q = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;

  before(async () => {
    db = await freshDb();
    await db.query("insert into public.organizations (id) values ($1)", [ORG]);
    for (const [id, name, email, role] of [[RECRUITER, "Roohi", "roohi@example.com", "hr"], [HR_HEAD, "Anita Verma", "anita@example.com", "hr_head"], [DIRECTOR, "Sunil Mehta", "sunil@example.com", "org_super_admin"], [PANEL, "Priya Shah", "priya@example.com", "manager"], [PANEL2, "Kunal Rao", "kunal@example.com", "manager"]] as const) {
      await db.query("insert into auth.users (id) values ($1)", [id]);
      await db.query("insert into public.users (id, full_name, email) values ($1, $2, $3)", [id, name, email]);
      await db.query("insert into public.organization_memberships (user_id, organization_id, role) values ($1, $2, $3)", [id, ORG, role]);
    }
    client = pgliteSupabase(db);
    await saveRecruitmentConfig(client, ORG, { hrHead: { userId: HR_HEAD }, director: { userId: DIRECTOR } });
    positionId = (await createPosition(client, ORG, ME, { title: "Accounts Executive", location: "Vadodara", openings: 1 })).id;
    const { record } = await createRecord(client, ORG, RECRUITER, { fullName: "Farah Naik", phone: "9876500002", email: "farah@example.com", role: "Accounts Executive" });
    farah = { id: record.id, candidateId: record.candidateId };
    await addMembers(client, ORG, ME, positionId, [farah.id]);
    // The position came from a hiring request with a budget band of 3 to 4 LPA.
    await db.query("insert into public.recruitment_requisitions (organization_id, role_title, status, budget_min_ctc, budget_max_ctc, position_id, requisition_no) values ($1, 'Accounts Executive', 'approved', 300000, 400000, $2, 'REQ-2026-0009')", [ORG, positionId]);
  });
  beforeEach(() => { sent.length = 0; resetHistoryCheck(); });
  after(async () => {
    await db.close();
  });

  const interviewId = "11111111-1111-4111-8111-111111111111";

  it("files an interview with a scorecard per interviewer, reminds 24 h and 2 h before, and asks to mark it after", async () => {
    const cards = await fileInterview(client, ORG, ME, {
      id: interviewId, candidateId: farah.candidateId, applicationId: farah.id, positionId, round: "L1", atLocal: "2026-11-22T11:00", mode: "in_person", venue: "Alkapuri office",
      interviewers: [{ id: PANEL, name: "Priya Shah" }, { id: PANEL2, name: "Kunal Rao" }], joinPath: null,
    });
    assert.equal(cards.size, 2);
    const at = istToInstant("2026-11-22T11:00").getTime();
    const run = (hoursBefore: number) => runInterviewJobs(client, ORG, { ...deps, now: () => new Date(at - hoursBefore * 3_600_000) });
    assert.equal((await run(30)).reminders, 0);
    assert.equal((await run(20)).reminders, 1);
    assert.ok(sent.some((s) => s.to === "farah@example.com" && /tomorrow/.test(s.subject)) && sent.some((s) => s.to === "priya@example.com"), "the candidate and the panel");
    assert.equal((await run(19)).reminders, 0, "once");
    assert.equal((await run(1.5)).reminders, 1, "the 2 h reminder");
    sent.length = 0;
    assert.equal((await run(-2)).nudges, 1);
    assert.ok(sent.some((s) => s.to === "roohi@example.com" && /Mark the interview/.test(s.subject)), "the person who booked it is asked to mark it");
  });

  it("moves an interview (everyone told, reminders again) and marks it done", async () => {
    await assert.rejects(rescheduleInterview(client, ORG, ME, interviewId, { at: "2020-01-01T10:00" }, deps), /past/);
    const moved = await rescheduleInterview(client, ORG, ME, interviewId, { at: "2026-11-23T15:00", reason: "Panel travelling" }, deps);
    assert.equal(moved.told, 3, "the candidate and two interviewers");
    const [row] = await q<{ at_local: string; reminded_24_at: string | null }>("select at_local, reminded_24_at from public.recruitment_interviews where id = $1", [interviewId]);
    assert.deepEqual(row, { at_local: "2026-11-23T15:00", reminded_24_at: null });
    assert.deepEqual(await setInterviewStatus(client, ORG, ME, interviewId, { status: "done" }, deps), { status: "done", told: 0 });
  });

  it("takes each scorecard once, needs a comment to reject, and shows the others only after submitting", async () => {
    const [mine, theirs] = await q<{ id: string }>("select id from public.recruitment_scorecards where interview_id = $1 order by panel_name desc", [interviewId]);
    const ratings = { "Technical skill": 4, Communication: 4, Attitude: 5, "Relevant experience": 3 };
    await assert.rejects(submitScorecard(client, mine.id, { ratings, overall: 2, recommendation: "reject" }), /Comments are required to reject/);
    await assert.rejects(submitScorecard(client, mine.id, { ratings: { Attitude: 5 }, overall: 4, recommendation: "proceed" }), /Rate Technical skill/);
    const first = await submitScorecard(client, mine.id, { ratings, overall: 4, recommendation: "proceed", comments: "Strong on Tally." });
    assert.equal(first.others.length, 0, "nobody else has submitted: nothing to see");
    await assert.rejects(submitScorecard(client, mine.id, { ratings, overall: 4, recommendation: "proceed" }), /already submitted/);
    const second = await submitScorecard(client, theirs.id, { ratings, overall: 3, recommendation: "hold", comments: "Check references." });
    assert.deepEqual(second.others.map((c) => [c.overall, c.recommendation]), [[4, "proceed"]], "after submitting, the other card is visible");
    // Chasers only for cards still empty: none left here.
    assert.equal((await runInterviewJobs(client, ORG, { ...deps, now: () => new Date(istToInstant("2026-11-23T15:00").getTime() + 30 * 3_600_000) })).chasers, 0);
  });

  it("routes an offer above the band to the HR Head then the Director; never the proposer; the letter's blanks block release", async () => {
    await assert.rejects(createOffer(client, ORG, ME, { applicationId: farah.id, positionId, proposedCtc: 0 }, deps), /CTC/);
    const offer = await createOffer(client, ORG, ME, { applicationId: farah.id, positionId, proposedCtc: 450_000, joiningDate: "2026-12-15", note: "Best of three." }, deps);
    assert.deepEqual([offer.status, offer.currentLevel, offer.needsDirector, offer.variancePct, offer.requisitionNo], ["pending", "hr_head", true, 12.5, "REQ-2026-0009"]);
    assert.ok(sent.some((s) => s.to === "anita@example.com" && /Offer to approve/.test(s.subject)));
    await assert.rejects(createOffer(client, ORG, ME, { applicationId: farah.id, positionId, proposedCtc: 400_000 }, deps), /already has an open offer/);
    await assert.rejects(decideOffer(client, ORG, by(DIRECTOR, "Sunil Mehta"), offer.id, { decision: "approve" }, deps), /Only the HR Head/);
    await assert.rejects(releaseOffer(client, ORG, ME, offer.id, deps), /cannot be released until every approval is in/);

    // Nobody recruits for the position yet, so the letter's {{recruiter_name}} stays blank.
    await db.query("update public.candidate_positions set recruiter_id = null where id = $1", [positionId]);
    const toDirector = await decideOffer(client, ORG, by(HR_HEAD, "Anita Verma"), offer.id, { decision: "approve" }, deps);
    assert.deepEqual([toDirector.status, toDirector.currentLevel], ["pending", "director"]);
    const approved = await decideOffer(client, ORG, by(DIRECTOR, "Sunil Mehta"), offer.id, { decision: "approve" }, deps);
    assert.equal(approved.status, "approved");
    assert.match(approved.letter ?? "", /Dear Farah Naik,[\s\S]*Accounts Executive[\s\S]*Vadodara[\s\S]*₹4.5 LPA[\s\S]*2026-12-15/);
    assert.deepEqual(approved.letterGaps, ["{{recruiter_name}}"], "the app does not know the recruiter's name here");
    await assert.rejects(releaseOffer(client, ORG, ME, offer.id, deps), /Fill the blanks/);
    const fixed = await editLetter(client, ORG, ME, offer.id, { letter: (approved.letter ?? "").replace("{{recruiter_name}}", "Roohi") });
    assert.deepEqual(letterGaps(fixed.letter), []);
    sent.length = 0;
    const released = await releaseOffer(client, ORG, ME, offer.id, deps);
    assert.equal(released.status, "released");
    assert.ok(sent.some((s) => s.to === "farah@example.com" && /Letter of intent/.test(s.subject)), "the letter goes to the candidate");
  });

  it("chases an unanswered offer, records the answer, and closes the position when the person joins", async () => {
    const [offer] = await listOffers(client, ORG, { userId: RECRUITER }, { candidateId: farah.candidateId });
    sent.length = 0;
    await runOfferJobs(client, ORG, { ...deps, now: () => new Date(Date.now() + 25 * 3_600_000) });
    assert.ok(sent.some((s) => s.to === "farah@example.com" && /Reminder: your offer/.test(s.subject)));
    await assert.rejects(recordResponse(client, ORG, ME, offer.id, { response: "declined" }), /reason/);
    const accepted = await recordResponse(client, ORG, ME, offer.id, { response: "accepted" });
    assert.deepEqual([accepted.status, accepted.joiningDate], ["accepted", "2026-12-15"]);
    const joined = await recordJoining(client, ORG, ME, offer.id, { outcome: "joined" }, deps);
    assert.equal(joined.status, "joined");
    assert.equal((await getPosition(client, ORG, positionId)).status, "closed", "its one opening is filled");
  });

  it("reopens the position and alerts the HR Head and Director when an accepted offer drops", async () => {
    await db.query("update public.candidate_positions set status = 'open', closed_at = null where id = $1", [positionId]);
    const { record } = await createRecord(client, ORG, RECRUITER, { fullName: "Imran Shaikh", phone: "9876500003", email: "imran@example.com", role: "Accounts Executive" });
    await addMembers(client, ORG, ME, positionId, [record.id]);
    // Owner 2026-11-24: the Director approves every offer by default; with that switched off, within the band it is the HR Head only.
    await saveOutreachSettings(client, ORG, { ...DEFAULT_OUTREACH, offer: { ...DEFAULT_OUTREACH.offer, directorAlways: false } });
    const offer = await createOffer(client, ORG, ME, { applicationId: record.id, positionId, proposedCtc: 350_000, joiningDate: "2026-12-20" }, deps);
    assert.equal(offer.needsDirector, false, "within the band: the HR Head only");
    await decideOffer(client, ORG, by(HR_HEAD, "Anita Verma"), offer.id, { decision: "approve" }, deps);
    await editLetter(client, ORG, ME, offer.id, { letter: "Dear Imran, welcome aboard as Accounts Executive. Roohi" });
    await releaseOffer(client, ORG, ME, offer.id, deps);
    await recordResponse(client, ORG, ME, offer.id, { response: "accepted" });
    await db.query("update public.candidate_positions set status = 'closed' where id = $1", [positionId]);
    sent.length = 0;
    await assert.rejects(recordJoining(client, ORG, ME, offer.id, { outcome: "dropped" }, deps), /reason/);
    const dropped = await recordJoining(client, ORG, ME, offer.id, { outcome: "dropped", reason: "Took a counter-offer" }, deps);
    assert.equal(dropped.status, "dropped");
    assert.equal((await getPosition(client, ORG, positionId)).status, "open");
    assert.ok(["anita@example.com", "sunil@example.com"].every((to) => sent.some((s) => s.to === to && /Dropped before joining/.test(s.subject))));
  });

  it("counts the dashboard from the records", async () => {
    const d = await recruitmentDashboard(client, ORG, NOW);
    const role = d.roles.find((r) => r.id === positionId);
    assert.ok(role, "the open role is listed");
    assert.equal(d.funnel.reduce((n, f) => n + f.count + f.rejected, 0), 2, "both people are counted once");
    assert.ok(Array.isArray(d.today.interviews) && Array.isArray(d.today.offersAwaiting));
    // Owner 2026-11-25 (workspace Pipeline and Insights tabs): the role's people by column, and where they came from.
    assert.equal(role.byColumn.length, d.funnel.length, "one count per board column");
    assert.equal(role.byColumn.reduce((n, c) => n + c, 0), role.inPipeline, "the columns add up to the people in the running");
    assert.equal(role.byColumn.reduce((n, c) => n + c, 0) + role.rejectedByColumn.reduce((n, c) => n + c, 0), 2, "and with the rejected, everyone");
    assert.equal(d.sources.reduce((n, s) => n + s.count, 0), 2, "each person's source is counted once");
  });
});
