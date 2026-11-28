/**
 * Outreach on WhatsApp (owner 2026-11-16; migration 20261116000003): the preview and its checks, one send per person
 * and position, the history entry, and a failed send recorded without being hidden. The sender is a fake: no test
 * here may message a real number.
 */
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import type { PGlite } from "@electric-sql/pglite";
import type { SupabaseClient } from "@supabase/supabase-js";

import { listActions, resetHistoryCheck, setBlacklist } from "../../backend/lib/candidates/actions";
import { campaignFor, listOutreach, previewOutreach, sendOutreach, withinSendingHours, type OutreachSendOptions } from "../../backend/lib/candidates/outreach";
import { addMembers, createPosition, listMembers, moveMember } from "../../backend/lib/candidates/positions";
import { createRecord } from "../../backend/lib/candidates/records";

import { freshDb, OUTREACH_MIGRATION } from "./db-stub";
import { pgliteSupabase } from "./pglite-supabase";

const ORG = "00000000-0000-0000-0000-00000000000a";
const USER = "00000000-0000-0000-0000-000000000001";
const ME = { id: USER, name: "Roohi" };
/** Tuesday 2026-11-17, 11:00 IST. */
const WORKING_HOURS = () => new Date("2026-11-17T05:30:00Z");

describe("outreach on WhatsApp", () => {
  let db: PGlite;
  let client: SupabaseClient;
  let suresh: { id: string; candidateId: string };
  let noPhone: { id: string; candidateId: string };
  let positionId: string;
  const sent: OutreachSendOptions[] = [];
  const okSender = async (o: OutreachSendOptions) => { sent.push(o); return { success: true, providerReference: `msg-${sent.length}` }; };

  before(async () => {
    db = await freshDb();
    await db.query("insert into public.organizations (id) values ($1)", [ORG]);
    await db.query("insert into auth.users (id) values ($1)", [USER]);
    client = pgliteSupabase(db);
    const add = async (fields: Record<string, unknown>) => { const { record } = await createRecord(client, ORG, USER, fields); return { id: record.id, candidateId: record.candidateId }; };
    suresh = await add({ fullName: "Suresh V", phone: "+91 98765 42210", role: "MEP Supervisor" });
    noPhone = await add({ fullName: "Lakshmi K", role: "Electrical Engineer" });
    positionId = (await createPosition(client, ORG, ME, { title: "Sr Technical Executive", location: "Bengaluru" })).id;
  });
  beforeEach(() => resetHistoryCheck());
  after(async () => {
    await db.close();
  });

  it("is safe to re-run and allows the new history action", async () => {
    await db.exec(OUTREACH_MIGRATION);
    const [{ ok }] = (await db.query<{ ok: boolean }>("select exists (select 1 from pg_constraint where conname = 'candidate_actions_action_check' and pg_get_constraintdef(oid) like '%outreach_sent%') as ok")).rows;
    assert.equal(ok, true);
  });

  it("knows the sending hours and the campaign names", () => {
    assert.equal(withinSendingHours(WORKING_HOURS()), true);
    assert.equal(withinSendingHours(new Date("2026-11-17T14:30:00Z")), false); // 8 pm IST
    assert.equal(withinSendingHours(new Date("2026-11-15T05:30:00Z")), false); // Sunday
    assert.equal(campaignFor("shortlisted", {}), "candidate_shortlisted_v1");
    assert.equal(campaignFor("not_shortlisted", { AISENSY_CANDIDATE_NOT_SHORTLISTED_CAMPAIGN: " rejected_v2 " }), "rejected_v2");
    assert.equal(campaignFor("stage_update", {}), "candidate_stage_update_v1");
  });

  it("previews the message with the name and the role filled in, and says what blocks a send", async () => {
    const p = await previewOutreach(client, ORG, { applicationId: suresh.id, positionId, kind: "shortlisted" }, WORKING_HOURS());
    assert.equal(p.canSend, true);
    assert.equal(p.blockedBy, null);
    assert.equal(p.phoneMasked, "98•••• 2210");
    assert.equal(p.roleTitle, "Sr Technical Executive");
    assert.match(p.message, /^Hello Suresh,\n\nThank you for speaking with us about the Sr Technical Executive role/);
    assert.match(p.footer, /do not reply/);
    assert.deepEqual(p.checks, { notBlacklisted: true, phoneValid: true, notSentBefore: true, roleNamed: true, withinHours: true });

    // No position: the record's role is named. No phone: blocked.
    const byRole = await previewOutreach(client, ORG, { applicationId: suresh.id, kind: "not_shortlisted" }, WORKING_HOURS());
    assert.equal(byRole.roleTitle, "MEP Supervisor");
    assert.match(byRole.message, /will not be moving forward/);
    const blocked = await previewOutreach(client, ORG, { applicationId: noPhone.id, positionId, kind: "shortlisted" }, WORKING_HOURS());
    assert.equal(blocked.canSend, false);
    assert.match(blocked.blockedBy ?? "", /No valid Indian mobile/);
    await assert.rejects(previewOutreach(client, ORG, { applicationId: suresh.id, kind: "maybe" }), /kind/);
    await assert.rejects(previewOutreach(client, ORG, { applicationId: suresh.id, positionId: "00000000-0000-0000-0000-0000000000ff", kind: "shortlisted" }), /position no longer exists/);
  });

  it("sends once per person and position, with the template's two parameters, and writes the history", async () => {
    const saved = await sendOutreach(client, ORG, ME, { applicationId: suresh.id, positionId, kind: "shortlisted" }, { send: okSender, now: WORKING_HOURS });
    assert.deepEqual([saved.status, saved.kind, saved.phoneMasked, saved.positionTitle, saved.byName], ["sent", "shortlisted", "98•••• 2210", "Sr Technical Executive", "Roohi"]);
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0], { phone: "919876542210", campaignName: "candidate_shortlisted_v1", templateParams: ["Suresh", "Sr Technical Executive"], userName: "Suresh V" });

    const [logged] = await listActions(client, ORG, suresh.candidateId);
    assert.deepEqual([logged.action, logged.toValue, logged.positionId], ["outreach_sent", "Shortlisted", positionId]);
    assert.deepEqual([logged.meta.kind, logged.meta.campaign, logged.meta.position, logged.meta.phone], ["shortlisted", "candidate_shortlisted_v1", "Sr Technical Executive", "98•••• 2210"]);

    // Told already: the preview says so and a second send is refused before the sender is called.
    const again = await previewOutreach(client, ORG, { applicationId: suresh.id, positionId, kind: "shortlisted" }, WORKING_HOURS());
    assert.equal(again.canSend, false);
    assert.match(again.blockedBy ?? "", /Already told by Roohi/);
    await assert.rejects(sendOutreach(client, ORG, ME, { applicationId: suresh.id, positionId, kind: "shortlisted" }, { send: okSender, now: WORKING_HOURS }), /Already told/);
    assert.equal(sent.length, 1);
    // The unique index refuses it too, should two people race past the preview.
    await assert.rejects(
      db.query("insert into public.candidate_outreach (organization_id, candidate_id, position_id, kind, phone, campaign, status) values ($1, $2, $3, 'shortlisted', '919876542210', 'c', 'sent')", [ORG, suresh.candidateId, positionId]),
      /candidate_outreach_once/,
    );

    // A different kind, or the same kind without a position, is its own message.
    await sendOutreach(client, ORG, ME, { applicationId: suresh.id, positionId, kind: "not_shortlisted" }, { send: okSender, now: WORKING_HOURS });
    await sendOutreach(client, ORG, ME, { applicationId: suresh.id, kind: "shortlisted" }, { send: okSender, now: WORKING_HOURS });
    assert.equal(sent.length, 3);
    assert.deepEqual(sent[2].templateParams, ["Suresh", "MEP Supervisor"]);
    assert.deepEqual((await listOutreach(client, ORG, suresh.candidateId)).map((o) => [o.kind, o.positionId !== null, o.status]), [["shortlisted", false, "sent"], ["not_shortlisted", true, "sent"], ["shortlisted", true, "sent"]]);
  });

  it("records a refused send as failed, without a history entry, and allows a retry", async () => {
    const fresh = await createRecord(client, ORG, USER, { fullName: "Tejas M", phone: "9876500001", role: "Facility Engineer" });
    const failing = async () => ({ success: false, error: "Campaign is inactive" });
    await assert.rejects(sendOutreach(client, ORG, ME, { applicationId: fresh.record.id, positionId, kind: "shortlisted" }, { send: failing, now: WORKING_HOURS }), /WhatsApp did not accept the message: Campaign is inactive/);
    const attempts = await listOutreach(client, ORG, fresh.record.candidateId);
    assert.deepEqual([attempts.length, attempts[0].status, attempts[0].error], [1, "failed", "Campaign is inactive"]);
    assert.equal((await listActions(client, ORG, fresh.record.candidateId)).length, 0);
    // A failed attempt does not count as "told": the next try can go.
    const retry = await previewOutreach(client, ORG, { applicationId: fresh.record.id, positionId, kind: "shortlisted" }, WORKING_HOURS());
    assert.equal(retry.canSend, true);
  });

  // Bug fix 2026-11-24: two clicks at once both passed the preview and both messages went; only the record was refused.
  it("sends one message when two people press Send at the same moment", async () => {
    const fresh = await createRecord(client, ORG, USER, { fullName: "Kiran P", phone: "9876500093", role: "Facility Engineer" });
    const before = sent.length;
    const results = await Promise.allSettled([
      sendOutreach(client, ORG, ME, { applicationId: fresh.record.id, positionId, kind: "shortlisted" }, { send: okSender, now: WORKING_HOURS }),
      sendOutreach(client, ORG, ME, { applicationId: fresh.record.id, positionId, kind: "shortlisted" }, { send: okSender, now: WORKING_HOURS }),
    ]);
    assert.equal(results.filter((x) => x.status === "fulfilled").length, 1);
    assert.match(String((results.find((x) => x.status === "rejected") as PromiseRejectedResult).reason), /Already told/);
    assert.equal(sent.length - before, 1, "WhatsApp is called once");
    const rows = await listOutreach(client, ORG, fresh.record.candidateId);
    assert.deepEqual(rows.map((o) => o.status), ["sent"]);
    assert.ok(rows[0].id);
  });

  it("never messages a blacklisted person", async () => {
    await setBlacklist(client, ORG, ME, suresh.candidateId, { reason: "asked_not_to_contact" });
    const p = await previewOutreach(client, ORG, { applicationId: suresh.id, kind: "not_shortlisted" }, WORKING_HOURS());
    assert.equal(p.checks.notBlacklisted, false);
    assert.match(p.blockedBy ?? "", /blacklisted/);
    const before = sent.length;
    await assert.rejects(sendOutreach(client, ORG, ME, { applicationId: suresh.id, kind: "not_shortlisted" }, { send: okSender, now: WORKING_HOURS }), /blacklisted/);
    assert.equal(sent.length, before);
  });
  // Owner 2026-11-19: the editable stage update (fixed opening and closing, HR's text in the middle).
  it("sends the stage update with HR's text, once per person, position and stage", async () => {
    const { record } = await createRecord(client, ORG, USER, { fullName: "Farah N", phone: "9876500002", role: "Accountant" });
    await addMembers(client, ORG, ME, positionId, [record.id]);
    const member = (await listMembers(client, ORG, positionId)).find((m) => m.candidateId === record.candidateId)!;
    await assert.rejects(previewOutreach(client, ORG, { applicationId: record.id, kind: "stage_update" }), /Choose the position/);
    await moveMember(client, ORG, ME, positionId, member.id, "l1_pending", null);

    const p = await previewOutreach(client, ORG, { applicationId: record.id, positionId, kind: "stage_update" }, WORKING_HOURS());
    assert.equal(p.canSend, true);
    assert.deepEqual([p.stageUpdate?.stageKey, p.stageUpdate?.stageName, p.campaign], ["l1_pending", "L1 Pending", "candidate_stage_update_v1"]);
    assert.match(p.stageUpdate?.defaultText ?? "", /shortlisted for the first interview round/);
    assert.match(p.message, /^Hello Farah,\n\nThis is an update on your application for the Sr Technical Executive role at Autopilot Offices\.\n\nYou have been shortlisted/);

    const before = sent.length;
    await assert.rejects(sendOutreach(client, ORG, ME, { applicationId: record.id, positionId, kind: "stage_update", message: "   " }, { send: okSender, now: WORKING_HOURS }), /Write the update/);
    await assert.rejects(sendOutreach(client, ORG, ME, { applicationId: record.id, positionId, kind: "stage_update", message: "x".repeat(401) }, { send: okSender, now: WORKING_HOURS }), /under 400/);
    assert.equal(sent.length, before);
    const saved = await sendOutreach(client, ORG, ME, { applicationId: record.id, positionId, kind: "stage_update", message: "Your L1 interview is on Friday at 11 am.\nPlease bring your ID proof." }, { send: okSender, now: WORKING_HOURS });
    assert.deepEqual(sent[sent.length - 1].templateParams, ["Farah", "Sr Technical Executive", "Your L1 interview is on Friday at 11 am. Please bring your ID proof."]);
    assert.equal(sent[sent.length - 1].campaignName, "candidate_stage_update_v1");
    assert.deepEqual([saved.kind, saved.stageKey, saved.message], ["stage_update", "l1_pending", "Your L1 interview is on Friday at 11 am. Please bring your ID proof."]);
    const [logged] = await listActions(client, ORG, record.candidateId);
    assert.deepEqual([logged.action, logged.toValue, logged.meta.stage, logged.meta.message], ["outreach_sent", "Update: L1 Pending", "l1_pending", "Your L1 interview is on Friday at 11 am. Please bring your ID proof."]);

    // The same stage again: refused. The next stage: its own message.
    const again = await previewOutreach(client, ORG, { applicationId: record.id, positionId, kind: "stage_update" }, WORKING_HOURS());
    assert.match(again.blockedBy ?? "", /Already told about L1 Pending by Roohi/);
    await moveMember(client, ORG, ME, positionId, member.id, "l2_pending", null);
    await assert.rejects(sendOutreach(client, ORG, ME, { applicationId: record.id, positionId, kind: "stage_update", message: "Earlier decision.", expectedStage: "l1_pending" }, { send: okSender, now: WORKING_HOURS }), /stage changed/);
    const next = await previewOutreach(client, ORG, { applicationId: record.id, positionId, kind: "stage_update" }, WORKING_HOURS());
    assert.equal(next.canSend, true);
    await sendOutreach(client, ORG, ME, { applicationId: record.id, positionId, kind: "stage_update", message: "Please complete the assignment by Monday." }, { send: okSender, now: WORKING_HOURS });
    assert.deepEqual((await listOutreach(client, ORG, record.candidateId)).map((o) => o.stageKey), ["l2_pending", "l1_pending"]);

    // Someone not in the position.
    await assert.rejects(previewOutreach(client, ORG, { applicationId: noPhone.id, positionId, kind: "stage_update" }), /no longer in that position/);
  });
});
