/**
 * Schedule interview (owner 2026-11-19; migration 20261119000002): the video meeting made for an online interview,
 * the recording made for an in-person one ("Record interview"), the history entry, the optional stage move, the invites only where HR ticked (WhatsApp recorded in
 * candidate_outreach, emails), never to a blacklisted person, and the notes read back. The meeting, WhatsApp and email
 * are fakes: no test here can message anyone.
 */
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import type { PGlite } from "@electric-sql/pglite";
import type { SupabaseClient } from "@supabase/supabase-js";

import { listActions, resetHistoryCheck, setBlacklist } from "../../backend/lib/candidates/actions";
import { istLabel, listInterviews, scheduleInterview, startInterviewRecording, type InterviewDeps } from "../../backend/lib/candidates/interviews";
import { addMembers, createPosition, listMembers } from "../../backend/lib/candidates/positions";
import { createRecord } from "../../backend/lib/candidates/records";

import { freshDb } from "./db-stub";
import { pgliteSupabase } from "./pglite-supabase";

const ORG = "00000000-0000-0000-0000-00000000000a";
const USER = "00000000-0000-0000-0000-000000000001";
const PRIYA = "00000000-0000-0000-0000-000000000002";
const NOMAIL = "00000000-0000-0000-0000-000000000003";
const MEETING = "00000000-0000-0000-0000-0000000000aa";
const RECORDING = "00000000-0000-0000-0000-0000000000bb";
const ME = { id: USER, name: "Roohi" };
/** Thursday 2026-11-19, 11:00 IST. */
const NOW = () => new Date("2026-11-19T05:30:00Z");

function fakes() {
  const log = { meetings: [] as unknown[], whatsapp: [] as { phone: string; campaignName: string; templateParams: string[] }[], emails: [] as { to: string; subject: string; html: string }[] };
  const deps: InterviewDeps = {
    async createMeeting(userId, input) {
      log.meetings.push({ userId, ...input });
      return input.kind === "online" ? { id: MEETING, joinPath: "/guest/secret-link" } : { id: RECORDING, joinPath: null };
    },
    async people() { return [{ id: PRIYA, name: "Priya Shah", department: "Finance" }, { id: NOMAIL, name: "Kunal Rao", department: "Finance" }]; },
    async sendWhatsApp(o) { log.whatsapp.push(o); return { success: true, providerReference: "wa-1" }; },
    async sendEmail(to, subject, html) { log.emails.push({ to, subject, html }); },
    appUrl: "https://app.example.com",
    now: NOW,
  };
  return { deps, log };
}

describe("schedule interview", () => {
  let db: PGlite;
  let client: SupabaseClient;
  let positionId: string;
  let farah: { id: string; candidateId: string };

  before(async () => {
    db = await freshDb();
    await db.query("insert into public.organizations (id) values ($1)", [ORG]);
    for (const id of [USER, PRIYA, NOMAIL]) await db.query("insert into auth.users (id) values ($1)", [id]);
    await db.query("insert into public.users (id, full_name, email) values ($1, 'Priya Shah', 'priya@example.com'), ($2, 'Kunal Rao', null)", [PRIYA, NOMAIL]);
    // The Meeting Assistant's table, as far as the interviews list reads it.
    await db.exec("create table public.meeting_notes (id uuid primary key, status text, summary jsonb)");
    client = pgliteSupabase(db);
    positionId = (await createPosition(client, ORG, ME, { title: "Assistant Manager – Accounts", location: "Vadodara" })).id;
    const { record } = await createRecord(client, ORG, USER, { fullName: "Farah Naik", phone: "9876500002", email: "farah@example.com", role: "Accountant" });
    farah = { id: record.id, candidateId: record.candidateId };
    await addMembers(client, ORG, ME, positionId, [farah.id]);
  });
  beforeEach(() => resetHistoryCheck());
  after(async () => {
    await db.close();
  });

  it("says the time the way people read it", () => {
    assert.equal(istLabel("2026-11-21T11:00"), "Sat, 21 Nov 2026 at 11:00 am (IST)");
  });

  it("makes the video call, files the interview, moves the person and sends only the invites ticked", async () => {
    const { deps, log } = fakes();
    const { interview, sent } = await scheduleInterview(client, ORG, ME, {
      applicationId: farah.id, positionId, round: "L1", at: "2026-11-21T11:00", mode: "online",
      interviewerIds: [PRIYA, NOMAIL, "00000000-0000-0000-0000-0000000000ff"], note: "Check Tally and GST returns", moveTo: "l1_pending",
      notify: { whatsapp: true, email: true, interviewers: true },
    }, deps);

    // The meeting: the interviewers picked (unknown ids dropped), the candidate's name for the notes, the time in UTC.
    assert.deepEqual(log.meetings, [{ userId: USER, title: "Interview: Farah Naik · L1 · Assistant Manager – Accounts", attendeeIds: [PRIYA, NOMAIL], extraNames: ["Farah Naik"], kind: "online", scheduledFor: "2026-11-21T05:30:00.000Z" }]);
    assert.deepEqual([interview.round, interview.at, interview.mode, interview.meetingId, interview.joinUrl, interview.interviewers, interview.note],
      ["L1", "2026-11-21T11:00", "online", MEETING, "https://app.example.com/guest/secret-link", "Priya Shah, Kunal Rao", "Check Tally and GST returns"]);
    assert.equal((await listMembers(client, ORG, positionId))[0].stage, "l1_pending");

    // WhatsApp: the template's five one-line parameters, recorded with the interview.
    assert.deepEqual(log.whatsapp, [{
      phone: "919876500002", campaignName: "candidate_interview_invite_v1", userName: "Farah Naik",
      templateParams: ["Farah", "L1", "Assistant Manager – Accounts", "Sat, 21 Nov 2026 at 11:00 am (IST)", "Join the video call here: https://app.example.com/guest/secret-link"],
    }]);
    const [row] = (await db.query<{ kind: string; status: string; interview_id: string | null }>("select kind, status, interview_id from public.candidate_outreach")).rows;
    assert.deepEqual([row.kind, row.status, typeof row.interview_id], ["interview_invite", "sent", "string"]);

    // Email: the candidate, and the interviewer who has an address; the one without is reported, not skipped silently.
    assert.deepEqual(log.emails.map((e) => e.to), ["farah@example.com", "priya@example.com"]);
    assert.match(log.emails[0].html, /guest\/secret-link/);
    assert.deepEqual(sent.map((s) => [s.to, s.channel, s.name, s.ok]), [
      ["candidate", "whatsapp", "Farah Naik", true], ["candidate", "email", "Farah Naik", true],
      ["interviewer", "email", "Priya Shah", true], ["interviewer", "email", "Kunal Rao", false],
    ]);

    const history = await listActions(client, ORG, farah.candidateId);
    assert.ok(history.some((a) => a.action === "outreach_sent" && a.toValue === "Interview invite: L1"));
    assert.ok(history.some((a) => a.action === "stage_change" && a.toValue === "L1 Pending"));
    const entry = history.find((a) => a.action === "remark" && a.meta.kind === "interview")!;
    assert.deepEqual([entry.toValue, entry.meta.meetingId, entry.meta.mode, entry.positionId], ["Interview scheduled", MEETING, "online", positionId]);
  });

  it("sends nothing it was not asked to, and an in-person interview has no call", async () => {
    const { deps, log } = fakes();
    const { interview, sent } = await scheduleInterview(client, ORG, ME, {
      applicationId: farah.id, positionId, round: "L2", at: "2026-11-24T15:30", mode: "in_person", venue: "3rd floor, Alkapuri, Vadodara",
      notify: { whatsapp: false, email: false, interviewers: false },
    }, deps);
    assert.deepEqual([log.meetings.length, log.whatsapp.length, log.emails.length, sent.length], [0, 0, 0, 0]);
    assert.deepEqual([interview.meetingId, interview.joinUrl, interview.venue], [null, null, "3rd floor, Alkapuri, Vadodara"]);
  });

  it("refuses a bad form, a past time, someone not in the position, and makes nothing when the call cannot be made", async () => {
    const { deps } = fakes();
    const base = { applicationId: farah.id, positionId, round: "L1", at: "2026-11-21T11:00", mode: "online" };
    await assert.rejects(scheduleInterview(client, ORG, ME, { ...base, at: "tomorrow" }, deps), /date and time/);
    await assert.rejects(scheduleInterview(client, ORG, ME, { ...base, at: "2026-11-18T11:00" }, deps), /in the past/);
    await assert.rejects(scheduleInterview(client, ORG, ME, { ...base, round: " " }, deps), /which round/);
    await assert.rejects(scheduleInterview(client, ORG, ME, { ...base, mode: "phone" }, deps), /./);
    // Owner 2026-11-19: no hybrid.
    await assert.rejects(scheduleInterview(client, ORG, ME, { ...base, mode: "hybrid" }, deps), /./);
    const other = (await createPosition(client, ORG, ME, { title: "Other role" })).id;
    await assert.rejects(scheduleInterview(client, ORG, ME, { ...base, positionId: other }, deps), /no longer in that position/);

    const before = (await listActions(client, ORG, farah.candidateId)).length;
    const broken: InterviewDeps = { ...deps, async createMeeting() { throw new Error("Online meetings are not set up yet."); } };
    await assert.rejects(scheduleInterview(client, ORG, ME, base, broken), /not set up/);
    assert.equal((await listActions(client, ORG, farah.candidateId)).length, before);
  });

  it("never messages a blacklisted person", async () => {
    const { record } = await createRecord(client, ORG, USER, { fullName: "Ganesh P", phone: "9876500003", email: "g@example.com", role: "Accountant" });
    await addMembers(client, ORG, ME, positionId, [record.id]);
    await setBlacklist(client, ORG, ME, record.candidateId, { reason: "asked_not_to_contact" });
    const { deps, log } = fakes();
    const { sent } = await scheduleInterview(client, ORG, ME, {
      applicationId: record.id, positionId, round: "L1", at: "2026-11-21T12:00", mode: "online", notify: { whatsapp: true, email: true, interviewers: false },
    }, deps);
    assert.deepEqual([log.whatsapp.length, log.emails.length], [0, 0]);
    assert.ok(sent.every((s) => !s.ok && /blacklisted/.test(s.note ?? "")));
  });

  it("records an in-person interview from Recruitment, once, and hands back a recording still going", async () => {
    const { deps, log } = fakes();
    const [inPerson, online] = await listInterviews(client, ORG, farah.candidateId, "");
    assert.deepEqual([inPerson.mode, inPerson.meetingId, online.mode], ["in_person", null, "online"]);
    await assert.rejects(startInterviewRecording(client, ORG, ME, { candidateId: farah.candidateId, interviewId: online.id }, deps), /use Join call/);

    const started = await startInterviewRecording(client, ORG, ME, { candidateId: farah.candidateId, interviewId: inPerson.id }, deps);
    assert.deepEqual(started, { meetingId: RECORDING, title: "Interview: Farah Naik · L2 · Assistant Manager – Accounts" });
    assert.deepEqual(log.meetings, [{ userId: USER, title: started.title, attendeeIds: [], extraNames: ["Farah Naik"], kind: "room" }]);
    assert.equal((await listInterviews(client, ORG, farah.candidateId, ""))[0].meetingId, RECORDING);

    // Still recording: the same one comes back. Done: no second recording.
    await db.query("insert into public.meeting_notes (id, status, summary) values ($1, 'recording', null)", [RECORDING]);
    assert.equal((await startInterviewRecording(client, ORG, ME, { candidateId: farah.candidateId, interviewId: inPerson.id }, deps)).meetingId, RECORDING);
    assert.equal(log.meetings.length, 1);
    await db.query("update public.meeting_notes set status = 'ready', summary = $2 where id = $1", [RECORDING, JSON.stringify({ summary: "Calm, clear on GST.", decisions: [], openQuestions: [] })]);
    await assert.rejects(startInterviewRecording(client, ORG, ME, { candidateId: farah.candidateId, interviewId: inPerson.id }, deps), /already recorded/);
  });

  it("shows each interview with its meeting's notes once written", async () => {
    await db.query("insert into public.meeting_notes (id, status, summary) values ($1, 'ready', $2)", [MEETING, JSON.stringify({ summary: "Strong on GST.", decisions: ["Move to L2"], openQuestions: ["Notice period?"], notes: [] })]);
    const list = await listInterviews(client, ORG, farah.candidateId, "https://app.example.com");
    assert.deepEqual(list.map((i) => [i.round, i.meeting?.status ?? null]), [["L2", "ready"], ["L1", "ready"]]);
    assert.equal(list[0].meeting?.summary?.summary, "Calm, clear on GST.");
    assert.deepEqual(list[1].meeting?.summary, { summary: "Strong on GST.", decisions: ["Move to L2"], openQuestions: ["Notice period?"] });
    assert.equal(list[1].positionTitle, "Assistant Manager – Accounts");
  });
});

describe("schedule interview before migration 20261119000002", () => {
  it("still schedules, but does not send the WhatsApp invite it could not record", async () => {
    const db = await freshDb({ interviews: false });
    try {
      await db.query("insert into public.organizations (id) values ($1)", [ORG]);
      await db.query("insert into auth.users (id) values ($1)", [USER]);
      const client = pgliteSupabase(db);
      const positionId = (await createPosition(client, ORG, ME, { title: "Accountant" })).id;
      const { record } = await createRecord(client, ORG, USER, { fullName: "Hina S", phone: "9876500004", role: "Accountant" });
      await addMembers(client, ORG, ME, positionId, [record.id]);
      const { deps, log } = fakes();
      const { sent } = await scheduleInterview(client, ORG, ME, {
        applicationId: record.id, positionId, round: "L1", at: "2026-11-21T11:00", mode: "online", notify: { whatsapp: true, email: false, interviewers: false },
      }, deps);
      assert.equal(log.whatsapp.length, 0);
      assert.match(sent[0].note ?? "", /20261119000002/);
    } finally {
      await db.close();
    }
  });
});
