/**
 * Manpower requisitions (owner 2026-11-17; migration 20261117000003), Stages 1 and 2 of the Recruitment Module spec:
 * the form and its number, the last requisition for the same role, the approval gate (HR Head then Director; in plan
 * / out of plan / above the CTC level), the four actions, "nobody approves their own request", the position opened
 * on approval, the alerts and the 24 h / 48 h / 72 h clock. Against the real migrations in PGlite; no message is ever
 * sent (recorded senders only).
 */
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import type { PGlite } from "@electric-sql/pglite";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getPosition, updatePosition } from "../../backend/lib/candidates/positions";
import { requisitionNotifier, runRequisitionReminders, type NotifyDeps } from "../../backend/lib/candidates/requisition-notify";
const runJob = runRequisitionReminders;
import {
  aboveCtcLevel, canDecide, createRequisition, decideRequisition, firstLevelFor, getRequisition, listRequisitions, loadRecruitmentConfig,
  approverPools, canRaiseRequisitions, mayConfigureApprovals, mayConfigureRaisers, requisitionAccess, roleChoices, saveRaisers, saveRecruitmentConfig, submitRequisition, updateRequisition, withdrawRequisition, workingDaysBetween, type RequisitionEvent,
  canEndorse, confirmStillNeeded, endorseRequisition, hasEndorsed, saveDepartmentHeads, saveRejectionReasons, unassignedRoles,
} from "../../backend/lib/candidates/requisitions";

import { DEFAULT_REJECTION_REASONS } from "../../backend/lib/candidates/stage-list";

import { freshDb, REQUISITIONS_MIGRATION } from "./db-stub";
import { pgliteSupabase } from "./pglite-supabase";

const ORG = "00000000-0000-0000-0000-00000000000a";
const MANAGER = "00000000-0000-0000-0000-000000000011";
const HR_HEAD = "00000000-0000-0000-0000-000000000012";
const DIRECTOR = "00000000-0000-0000-0000-000000000013";
const HR_BACKUP = "00000000-0000-0000-0000-000000000014";
const by = (id: string, name: string) => ({ id, name });
const FORM = { roleTitle: "Senior Technical Executive", department: "Facilities", location: "Bengaluru", positions: 2, budgetMinCtc: 400_000, budgetMaxCtc: 600_000, requiredSkills: ["MEP", "BMS"], minExperienceYears: 5, qualification: "B.E. Electrical", targetJoiningDate: "2026-12-15", justification: "Two sites opening in January.", reportingManager: "Priya" };

describe("manpower requisitions", () => {
  let db: PGlite;
  let client: SupabaseClient;
  const events: RequisitionEvent[] = [];
  const sent: { channel: "email" | "whatsapp"; to: string; subject: string }[] = [];
  const deps: NotifyDeps = {
    async sendEmail(to, subject) { sent.push({ channel: "email", to, subject }); },
    async sendWhatsApp(phone, campaign) { sent.push({ channel: "whatsapp", to: phone, subject: campaign }); },
    async decisionLink(_orgId, r, approverId) { return `https://app.test/act/${r.id}/${approverId}`; },
    async matrixRecipients() { return { emails: ["hr-inbox@example.com"], users: [] }; },
    appUrl: "https://app.test",
  };
  const notify = (event: RequisitionEvent) => { events.push(event); return requisitionNotifier(client, ORG, deps)(event); };
  const q = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;

  before(async () => {
    db = await freshDb();
    await db.query("insert into public.organizations (id) values ($1)", [ORG]);
    for (const [id, name, email, phone, role] of [[MANAGER, "Ravi Kumar", "ravi@example.com", "9876543210", "manager"], [HR_HEAD, "Anita Verma", "anita@example.com", "9876543211", "hr_head"], [DIRECTOR, "Sunil Mehta", "sunil@example.com", null, "director"], [HR_BACKUP, "Deepa Rao", "deepa@example.com", null, "hr"]] as const) {
      await db.query("insert into auth.users (id) values ($1)", [id]);
      await db.query("insert into public.users (id, full_name, email, phone) values ($1, $2, $3, $4)", [id, name, email, phone]);
      await db.query("insert into public.organization_memberships (user_id, organization_id, role) values ($1, $2, $3)", [id, ORG, role]);
    }
    client = pgliteSupabase(db);
  });
  beforeEach(() => { events.length = 0; sent.length = 0; });
  after(async () => {
    await db.close();
  });

  it("is safe to re-run, numbers requests per organisation and year, and keeps its audit trail insert-only", async () => {
    await db.exec(REQUISITIONS_MIGRATION);
    const [{ n1 }] = await q<{ n1: string }>("select public.recruitment_next_requisition_no($1) as n1", [ORG]);
    const [{ n2 }] = await q<{ n2: string }>("select public.recruitment_next_requisition_no($1) as n2", [ORG]);
    assert.match(n1, /^REQ-\d{4}-0001$/);
    assert.match(n2, /^REQ-\d{4}-0002$/);
    await q("delete from public.recruitment_requisition_counters where organization_id = $1", [ORG]);
  });

  it("refuses to submit until the approvers are set in Settings, then saves them", async () => {
    const draft = await createRequisition(client, ORG, by(MANAGER, "Ravi Kumar"), FORM);
    assert.deepEqual([draft.status, draft.requisitionNo, draft.raisedByName], ["draft", null, "Ravi Kumar"]);
    await assert.rejects(submitRequisition(client, ORG, by(MANAGER, "Ravi Kumar"), draft.id), /approvers are not set/);
    assert.deepEqual((await loadRecruitmentConfig(client, ORG)).hrHead, { userId: null, backupUserId: null });

    await assert.rejects(saveRecruitmentConfig(client, ORG, { hrHead: { userId: HR_HEAD, backupUserId: HR_HEAD } }), /different person/);
    const saved = await saveRecruitmentConfig(client, ORG, { hrHead: { userId: HR_HEAD, backupUserId: HR_BACKUP }, director: { userId: DIRECTOR }, directorCtcLevel: 1_000_000, targetDays: 30 });
    assert.deepEqual(saved, { hrHead: { userId: HR_HEAD, backupUserId: HR_BACKUP }, director: { userId: DIRECTOR, backupUserId: null }, directorCtcLevel: 1_000_000, targetDays: 30, raisers: { roles: [], userIds: [] }, departmentHeads: [], rejectionReasons: [...DEFAULT_REJECTION_REASONS], offerLetter: "" });
    const access = await requisitionAccess(client, HR_HEAD, ORG);
    assert.deepEqual([access.seesAll, access.approverLevels, access.configured], [true, ["hr_head"], true]);
    assert.deepEqual((await requisitionAccess(client, MANAGER, ORG)).approverLevels, []);
    assert.equal((await requisitionAccess(client, MANAGER, ORG)).seesAll, false);
    await withdrawRequisition(client, ORG, by(MANAGER, "Ravi Kumar"), draft.id, "test draft");
  });

  // Owner 2026-11-20: the approvers are set in the Tech dashboard's HR Configs tab, by the Tech team and admins.
  it("lets only the Tech team and admins change the approvers, and records each change", async () => {
    const ADMIN = "00000000-0000-0000-0000-000000000015";
    const TECH = "00000000-0000-0000-0000-000000000016";
    for (const [id, name, role] of [[ADMIN, "Org Admin", "org_super_admin"], [TECH, "Tech Person", "tech"]] as const) {
      await db.query("insert into auth.users (id) values ($1)", [id]);
      await db.query("insert into public.users (id, full_name, email) values ($1, $2, null)", [id, name]);
      await db.query("insert into public.organization_memberships (user_id, organization_id, role) values ($1, $2, $3)", [id, ORG, role]);
    }
    assert.equal(await mayConfigureApprovals(client, TECH, ORG), true, "the Tech team sets them (HR Configs)");
    assert.equal(await mayConfigureApprovals(client, ADMIN, ORG), true);
    assert.equal(await mayConfigureApprovals(client, HR_HEAD, ORG), false, "HR sees them, read-only");
    assert.equal(await mayConfigureApprovals(client, MANAGER, ORG), false);

    // The dropdowns: the HR team (by department or HR role) for the HR Head, the org super admins for the Director.
    const pools = approverPools(
      [{ id: HR_BACKUP, name: "Deepa Rao", department: "Human Resources" }, { id: MANAGER, name: "Ravi Kumar", department: "Operations" }, { id: "x-1", name: "Lohitaksha R", department: "Tech" }],
      [{ userId: HR_HEAD, role: "hr_head" }, { userId: ADMIN, role: "org_super_admin" }, { userId: MANAGER, role: "manager" }],
      new Map([[HR_HEAD, "Anita Verma"], [ADMIN, "Org Admin"]]),
    );
    assert.deepEqual(pools.hr.map((p) => p.name), ["Anita Verma", "Deepa Rao"]);
    assert.deepEqual(pools.directors.map((p) => p.name), ["Org Admin"]);
    const strict = { hr: pools.hr, directors: pools.directors };
    await assert.rejects(saveRecruitmentConfig(client, ORG, { director: { userId: MANAGER } }, by(ADMIN, "Org Admin"), strict), /Director must be an org super admin/);
    await assert.rejects(saveRecruitmentConfig(client, ORG, { hrHead: { userId: MANAGER } }, by(ADMIN, "Org Admin"), strict), /HR Head must be someone in the HR team/);

    await saveRecruitmentConfig(client, ORG, { directorCtcLevel: 1_500_000, targetDays: 21 }, by(ADMIN, "Org Admin"));
    const [change] = await q<{ summary: string; changed_by_name: string }>("select summary, changed_by_name from public.recruitment_stage_changes where organization_id = $1 order by created_at desc limit 1", [ORG]);
    assert.deepEqual(change, { summary: "Hiring approvals: Director above: 15 LPA (was 10 LPA) · target days: 21 (was 30)", changed_by_name: "Org Admin" });
    // Back as the tests below expect.
    await saveRecruitmentConfig(client, ORG, { directorCtcLevel: 1_000_000, targetDays: 30 });
  });

  // Owner 2026-11-20: who may raise a request (their sidebar item) is set by the Tech team and admins.
  it("lets only the roles and people the Tech team picked raise requests", async () => {
    assert.equal(await canRaiseRequisitions(client, MANAGER, ORG), false, "nobody until set");
    assert.equal((await requisitionAccess(client, MANAGER, ORG)).canRaise, false);
    const TECH = "00000000-0000-0000-0000-000000000016";
    assert.equal(await mayConfigureRaisers(client, TECH, ORG), true);
    assert.equal(await mayConfigureRaisers(client, HR_HEAD, ORG), false, "HR does not decide who raises");
    assert.ok((await roleChoices(client, ORG)).includes("manager"));

    await assert.rejects(saveRaisers(client, ORG, { roles: ["Manager!"], userIds: [] }), /Unknown role/);
    const saved = await saveRaisers(client, ORG, { roles: ["manager", "manager"], userIds: [DIRECTOR] }, by(TECH, "Tech Person"));
    assert.deepEqual(saved, { roles: ["manager"], userIds: [DIRECTOR] });
    assert.equal(await canRaiseRequisitions(client, MANAGER, ORG), true, "by role");
    assert.equal(await canRaiseRequisitions(client, DIRECTOR, ORG), true, "by name");
    assert.equal(await canRaiseRequisitions(client, HR_BACKUP, ORG), false, "HR no longer raises");
    assert.equal((await requisitionAccess(client, MANAGER, ORG)).canRaise, true);
    const [change] = await q<{ summary: string }>("select summary from public.recruitment_stage_changes where organization_id = $1 order by created_at desc limit 1", [ORG]);
    assert.equal(change.summary, "Who can raise hiring requests: roles manager; people Sunil Mehta");

    // An approvals save keeps who may raise.
    await saveRecruitmentConfig(client, ORG, { targetDays: 30 });
    assert.deepEqual((await loadRecruitmentConfig(client, ORG)).raisers, { roles: ["manager"], userIds: [DIRECTOR] });
  });

  it("keeps HR's rejection reasons, each once, and other settings saves keep them (owner 2026-11-21)", async () => {
    await assert.rejects(saveRejectionReasons(client, ORG, { reasons: [] }), /at least one/);
    await assert.rejects(saveRejectionReasons(client, ORG, { reasons: ["x".repeat(61)] }), /1 to 60/);
    assert.deepEqual(await saveRejectionReasons(client, ORG, { reasons: [" Salary  mismatch ", "salary mismatch", "Other"] }, by(HR_HEAD, "Anita Verma")), ["Salary mismatch", "Other"]);
    await saveRecruitmentConfig(client, ORG, { targetDays: 30 });
    assert.deepEqual((await loadRecruitmentConfig(client, ORG)).rejectionReasons, ["Salary mismatch", "Other"]);
    await saveRejectionReasons(client, ORG, { reasons: [...DEFAULT_REJECTION_REASONS] });
  });

  it("Stage 1: the form is checked, the request gets its ID on submission, and the last request for the same role is shown", async () => {
    await assert.rejects(createRequisition(client, ORG, by(MANAGER, "Ravi Kumar"), { ...FORM, budgetMinCtc: 700_000 }), /minimum is above/);
    await assert.rejects(createRequisition(client, ORG, by(MANAGER, "Ravi Kumar"), { ...FORM, requestType: "replacement" }), /who is being replaced/);
    await assert.rejects(createRequisition(client, ORG, by(MANAGER, "Ravi Kumar"), { ...FORM, justification: "", submit: true }), /justification/);

    const first = await createRequisition(client, ORG, by(MANAGER, "Ravi Kumar"), { ...FORM, submit: true }, { notify });
    assert.match(first.requisitionNo ?? "", /^REQ-\d{4}-0001$/);
    assert.deepEqual([first.status, first.currentLevel, first.currentApproverId, first.currentApproverName], ["submitted", "hr_head", HR_HEAD, "Anita Verma"]);
    assert.deepEqual(events.map((e) => e.kind), ["awaiting"]);
    // The HR Head is emailed (with the one-time link) and messaged; the matrix's extra inbox is emailed too.
    assert.deepEqual(sent.map((s) => [s.channel, s.to]), [["email", "anita@example.com"], ["email", "hr-inbox@example.com"]].concat(process.env.AISENSY_REQUISITION_AWAITING_CAMPAIGN ? [["whatsapp", "919876543211"]] : []));
    assert.equal((await q<{ n: number }>("select count(*)::int as n from public.recruitment_requisition_notices where requisition_id = $1 and kind = 'awaiting' and ok", [first.id]))[0].n, sent.length);

    const { approvals } = await getRequisition(client, ORG, first.id);
    assert.deepEqual(approvals.map((a) => [a.action, a.level, a.byName]), [["submitted", "hr_head", "Ravi Kumar"]]);
    await assert.rejects(updateRequisition(client, ORG, by(MANAGER, "Ravi Kumar"), first.id, { positions: 3 }), /with the approvers/);

    const second = await createRequisition(client, ORG, by(MANAGER, "Ravi Kumar"), { ...FORM, positions: 1 });
    assert.deepEqual((await getRequisition(client, ORG, second.id)).requisition.previous, { id: first.id, requisitionNo: first.requisitionNo, status: "submitted", createdAt: first.createdAt });
    await withdrawRequisition(client, ORG, by(MANAGER, "Ravi Kumar"), second.id, null);
  });

  it("Stage 2, in plan: the HR Head approves, the role becomes a position, and the Director is notified", async () => {
    const r = (await listRequisitions(client, ORG, { userId: HR_HEAD, seesAll: true })).find((x) => x.status === "submitted")!;
    assert.ok(r, "the first request waits at the HR Head");
    const access = await requisitionAccess(client, HR_HEAD, ORG);
    assert.equal(canDecide(r, HR_HEAD, access), true);
    assert.equal(canDecide(r, DIRECTOR, await requisitionAccess(client, DIRECTOR, ORG)), false, "it waits at the HR Head, not the Director");

    await assert.rejects(decideRequisition(client, ORG, by(MANAGER, "Ravi Kumar"), r.id, { decision: "approve", inPlan: true }), /cannot be approved by the person who raised/);
    await assert.rejects(decideRequisition(client, ORG, by(DIRECTOR, "Sunil Mehta"), r.id, { decision: "approve", inPlan: true }), /Only the HR Head/);
    await assert.rejects(decideRequisition(client, ORG, by(HR_HEAD, "Anita Verma"), r.id, { decision: "approve" }), /Tick whether the role is in the approved plan/);
    await assert.rejects(decideRequisition(client, ORG, by(HR_HEAD, "Anita Verma"), r.id, { decision: "reject" }), /reason for rejecting/);

    const approved = await decideRequisition(client, ORG, by(HR_HEAD, "Anita Verma"), r.id, { decision: "approve", inPlan: true }, { notify });
    assert.deepEqual([approved.status, approved.inPlan, approved.needsDirector, approved.currentLevel], ["approved", true, false, null]);
    assert.ok(approved.positionId, "the role becomes active: a position is opened");
    const position = await getPosition(client, ORG, approved.positionId!);
    assert.deepEqual([position.title, position.department, position.location, position.openings, position.education, position.hiringManager, position.targetDays], ["Senior Technical Executive", "Facilities", "Bengaluru", 2, "B.E. Electrical", "Ravi Kumar", 30]);
    assert.deepEqual(position.filters.keywords?.map((k) => k.text), ["MEP", "BMS"]);
    assert.match(position.summary ?? "", /REQ-\d{4}-0001 raised by Ravi Kumar.*₹4 LPA to ₹6 LPA/);
    // Spec A03: the role is open, so HR is told to assign a recruiter (owner 2026-11-21).
    assert.deepEqual(events.map((e) => e.kind), ["decided", "role_opened", "director_informed"]);
    assert.ok(sent.some((s) => s.to === "ravi@example.com" && /approved/.test(s.subject)), "the manager is told");
    assert.ok(sent.some((s) => s.to === "sunil@example.com" && /For your information/.test(s.subject)), "the Director is notified");
    const { approvals } = await getRequisition(client, ORG, r.id);
    assert.deepEqual(approvals.map((a) => [a.action, a.inPlan]), [["position_opened", null], ["approved", true], ["submitted", null]]);
    await assert.rejects(q("update public.recruitment_requisition_approvals set action = 'rejected' where requisition_id = $1", [r.id]), /insert-only/);
  });

  it("Stage 2, out of plan or above the CTC level: the HR Head reviews, the Director approves", async () => {
    const outOfPlan = await createRequisition(client, ORG, by(MANAGER, "Ravi Kumar"), { ...FORM, roleTitle: "Facility Manager", submit: true }, { notify });
    const toDirector = await decideRequisition(client, ORG, by(HR_HEAD, "Anita Verma"), outOfPlan.id, { decision: "approve", inPlan: false }, { notify });
    assert.deepEqual([toDirector.status, toDirector.inPlan, toDirector.needsDirector, toDirector.currentLevel, toDirector.currentApproverId], ["submitted", false, true, "director", DIRECTOR]);
    assert.deepEqual(events.map((e) => e.kind), ["awaiting", "awaiting"]);
    assert.ok(sent.some((s) => s.to === "sunil@example.com" && /awaits your approval/.test(s.subject)));
    await assert.rejects(decideRequisition(client, ORG, by(HR_HEAD, "Anita Verma"), outOfPlan.id, { decision: "approve", inPlan: false }), /Only the Director/);
    const approved = await decideRequisition(client, ORG, by(DIRECTOR, "Sunil Mehta"), outOfPlan.id, { decision: "approve" }, { notify });
    assert.deepEqual([approved.status, approved.positionId !== null], ["approved", true]);
    assert.equal(events.filter((e) => e.kind === "director_informed").length, 0, "the Director decided it, so is not 'notified'");

    // In plan, but above the CTC level set in Settings (10 LPA): the Director approves regardless.
    const config = await loadRecruitmentConfig(client, ORG);
    assert.equal(aboveCtcLevel(config, 1_200_000), true);
    assert.equal(aboveCtcLevel(config, 1_000_000), false);
    const costly = await createRequisition(client, ORG, by(MANAGER, "Ravi Kumar"), { ...FORM, roleTitle: "Head of Operations", budgetMinCtc: 1_000_000, budgetMaxCtc: 1_500_000, submit: true });
    const passed = await decideRequisition(client, ORG, by(HR_HEAD, "Anita Verma"), costly.id, { decision: "approve", inPlan: true });
    assert.deepEqual([passed.currentLevel, passed.needsDirector, passed.inPlan], ["director", true, true]);
    assert.equal((await getRequisition(client, ORG, costly.id)).approvals[0].reason, "Above the CTC level: the Director approves");
    await decideRequisition(client, ORG, by(DIRECTOR, "Sunil Mehta"), costly.id, { decision: "reject", reason: "Not this quarter." });
    assert.deepEqual((await getRequisition(client, ORG, costly.id)).requisition.status, "rejected");
  });

  it("send back for change, put on hold, resume, withdraw", async () => {
    const r = await createRequisition(client, ORG, by(MANAGER, "Ravi Kumar"), { ...FORM, roleTitle: "Security Supervisor", submit: true });
    const sentBack = await decideRequisition(client, ORG, by(HR_BACKUP, "Deepa Rao"), r.id, { decision: "send_back", reason: "Add the reporting manager." }, { notify });
    assert.deepEqual([sentBack.status, sentBack.currentLevel], ["sent_back", null]);
    assert.ok(sent.some((s) => s.to === "ravi@example.com" && /sent back/.test(s.subject)));
    await assert.rejects(decideRequisition(client, ORG, by(HR_HEAD, "Anita Verma"), r.id, { decision: "approve", inPlan: true }), /nothing to decide/);
    // The manager changes it and resubmits: the same number, a fresh clock at the HR Head.
    const resubmitted = await updateRequisition(client, ORG, by(MANAGER, "Ravi Kumar"), r.id, { reportingManager: "Priya Nair", submit: true });
    assert.deepEqual([resubmitted.status, resubmitted.requisitionNo, resubmitted.currentLevel, resubmitted.reportingManager], ["submitted", r.requisitionNo, "hr_head", "Priya Nair"]);

    const held = await decideRequisition(client, ORG, by(HR_HEAD, "Anita Verma"), r.id, { decision: "hold", reason: "Budget review next week." });
    assert.deepEqual([held.status, held.holdReason, held.currentLevel], ["on_hold", "Budget review next week.", "hr_head"]);
    await assert.rejects(decideRequisition(client, ORG, by(HR_HEAD, "Anita Verma"), r.id, { decision: "approve", inPlan: true }), /Resume it first/);
    const resumed = await decideRequisition(client, ORG, by(HR_HEAD, "Anita Verma"), r.id, { decision: "resume" });
    assert.deepEqual([resumed.status, resumed.holdSince], ["submitted", null]);

    const withdrawn = await withdrawRequisition(client, ORG, by(MANAGER, "Ravi Kumar"), r.id, "Role no longer needed.");
    assert.deepEqual([withdrawn.status, withdrawn.decisionReason], ["withdrawn", "Role no longer needed."]);
    await assert.rejects(withdrawRequisition(client, ORG, by(HR_HEAD, "Anita Verma"), r.id, null), /Only the person who raised/);
    assert.deepEqual((await getRequisition(client, ORG, r.id)).approvals.map((a) => a.action), ["withdrawn", "resumed", "on_hold", "submitted", "sent_back", "submitted"]);
  });

  it("nobody approves their own request: the HR Head's request goes to their backup, or to the Director", async () => {
    const config = await loadRecruitmentConfig(client, ORG);
    assert.deepEqual(firstLevelFor(config, MANAGER), { level: "hr_head", approverId: HR_HEAD });
    assert.deepEqual(firstLevelFor(config, HR_HEAD), { level: "hr_head", approverId: HR_BACKUP });
    assert.deepEqual(firstLevelFor({ ...config, hrHead: { userId: HR_HEAD, backupUserId: null } }, HR_HEAD), { level: "director", approverId: DIRECTOR });
    assert.throws(() => firstLevelFor({ ...config, hrHead: { userId: HR_HEAD, backupUserId: null }, director: { userId: null, backupUserId: null } }, HR_HEAD), /only approver set/);

    const own = await createRequisition(client, ORG, by(HR_HEAD, "Anita Verma"), { ...FORM, roleTitle: "HR Executive", submit: true });
    assert.equal(own.currentApproverId, HR_BACKUP);
    await assert.rejects(decideRequisition(client, ORG, by(HR_HEAD, "Anita Verma"), own.id, { decision: "approve", inPlan: true }), /cannot be approved by the person who raised/);
    // The manager sees only their own requests and those waiting on them; the HR Head sees all.
    assert.equal((await listRequisitions(client, ORG, { userId: MANAGER, seesAll: false })).some((x) => x.id === own.id), false);
    assert.equal((await listRequisitions(client, ORG, { userId: HR_BACKUP, seesAll: false })).some((x) => x.id === own.id), true);
    await withdrawRequisition(client, ORG, by(HR_HEAD, "Anita Verma"), own.id, null);
  });

  it("reminds the approver at 24 h and 48 h and escalates at 72 h, once each per level", async () => {
    const r = await createRequisition(client, ORG, by(MANAGER, "Ravi Kumar"), { ...FORM, roleTitle: "Pantry Executive", submit: true }, { notify });
    const t0 = new Date(r.levelEnteredAt!).getTime();
    const at = (hours: number) => new Date(t0 + hours * 3_600_000);
    // Only this test's counters (the job also chases holds and unassigned roles, tested below).
    const runRequisitionReminders = async (...a: Parameters<typeof runJob>) => { const x = await runJob(...a); return { reminders: x.reminders, escalations: x.escalations }; };
    assert.deepEqual(await runRequisitionReminders(client, ORG, deps, at(10)), { reminders: 0, escalations: 0 });
    assert.deepEqual(await runRequisitionReminders(client, ORG, deps, at(25)), { reminders: 1, escalations: 0 });
    assert.ok(sent.some((s) => s.to === "anita@example.com" && /^Reminder:/.test(s.subject)));
    assert.deepEqual(await runRequisitionReminders(client, ORG, deps, at(30)), { reminders: 0, escalations: 0 }, "the 24 h reminder goes once");
    assert.deepEqual(await runRequisitionReminders(client, ORG, deps, at(50)), { reminders: 1, escalations: 0 });
    sent.length = 0;
    assert.deepEqual(await runRequisitionReminders(client, ORG, deps, at(73)), { reminders: 0, escalations: 1 });
    assert.ok(sent.some((s) => s.to === "sunil@example.com" && /^Escalation/.test(s.subject)), "at the HR Head's level, the Director is the escalation");
    assert.deepEqual(await runRequisitionReminders(client, ORG, deps, at(100)), { reminders: 0, escalations: 0 });
    const kinds = (await q<{ kind: string }>("select kind from public.recruitment_requisition_notices where requisition_id = $1 and level = 'hr_head' and channel = 'email' and recipient = 'anita@example.com' order by created_at", [r.id])).map((n) => n.kind);
    assert.deepEqual(kinds, ["awaiting", "reminder_24", "reminder_48"]);

    // Passed to the Director: the clock starts again at that level.
    await decideRequisition(client, ORG, by(HR_HEAD, "Anita Verma"), r.id, { decision: "approve", inPlan: false }, { now: () => at(100) });
    assert.deepEqual(await runRequisitionReminders(client, ORG, deps, at(110)), { reminders: 0, escalations: 0 });
    assert.deepEqual(await runRequisitionReminders(client, ORG, deps, at(125)), { reminders: 1, escalations: 0 });
    await withdrawRequisition(client, ORG, by(MANAGER, "Ravi Kumar"), r.id, null);
  });

  // Owner 2026-11-21 ("go ahead with all"): the spec's department head, A03 (assign a recruiter) and A24 (on hold).
  it("department heads see and endorse their departments' requests; endorsing approves nothing", async () => {
    const HEAD = "00000000-0000-0000-0000-000000000017";
    const TECH = "00000000-0000-0000-0000-000000000016";
    await db.query("insert into auth.users (id) values ($1) on conflict do nothing", [HEAD]);
    await db.query("insert into public.users (id, full_name, email) values ($1, 'Meena Iyer', 'meena@example.com') on conflict do nothing", [HEAD]);
    await db.query("insert into public.organization_memberships (user_id, organization_id, role) values ($1, $2, 'supervisor')", [HEAD, ORG]);

    await assert.rejects(saveDepartmentHeads(client, ORG, { heads: [{ department: "Facilities", userId: HEAD }, { department: " facilities", userId: MANAGER }] }), /listed twice/);
    await assert.rejects(saveDepartmentHeads(client, ORG, { heads: [{ department: "Facilities", userId: HEAD }] }, undefined, new Set([MANAGER])), /Task Manager/);
    assert.deepEqual(await saveDepartmentHeads(client, ORG, { heads: [{ department: " Facilities ", userId: HEAD }] }, by(TECH, "Tech Person")), [{ department: "Facilities", userId: HEAD }]);
    const [change] = await q<{ summary: string }>("select summary from public.recruitment_stage_changes where organization_id = $1 order by created_at desc limit 1", [ORG]);
    assert.equal(change.summary, "Department heads: Facilities — Meena Iyer");
    await saveRecruitmentConfig(client, ORG, { targetDays: 30 });
    assert.deepEqual((await loadRecruitmentConfig(client, ORG)).departmentHeads, [{ department: "Facilities", userId: HEAD }], "an approvals save keeps them");
    const access = await requisitionAccess(client, HEAD, ORG);
    assert.deepEqual([access.headOf, access.member, access.canRaise], [["facilities"], true, false]);

    const draft = await createRequisition(client, ORG, by(MANAGER, "Ravi Kumar"), { ...FORM, roleTitle: "Electrician" });
    const other = await createRequisition(client, ORG, by(MANAGER, "Ravi Kumar"), { ...FORM, roleTitle: "Accountant", department: "Finance", submit: true });
    events.length = 0; sent.length = 0;
    const r = await createRequisition(client, ORG, by(MANAGER, "Ravi Kumar"), { ...FORM, roleTitle: "Plumber", department: "FACILITIES", submit: true }, { notify });
    assert.deepEqual(events.map((e) => e.kind), ["awaiting", "department_head"]);
    assert.ok(sent.some((s) => s.to === "meena@example.com" && /for your department/.test(s.subject)), "the head is told");

    const seen = await listRequisitions(client, ORG, { userId: HEAD, seesAll: false, headOf: access.headOf });
    assert.deepEqual([seen.some((x) => x.id === r.id), seen.some((x) => x.id === draft.id), seen.some((x) => x.id === other.id)], [true, false, false], "their department's submitted requests only");
    assert.equal(canEndorse(r, HEAD, access, false), true);
    assert.equal(canEndorse(r, HEAD, access, true), false);
    await assert.rejects(endorseRequisition(client, ORG, by(HR_HEAD, "Anita Verma"), r.id, null), /Only the head/);
    const endorsed = await endorseRequisition(client, ORG, by(HEAD, "Meena Iyer"), r.id, "Needed for the new tower.");
    assert.deepEqual([endorsed.status, endorsed.currentLevel, endorsed.endorsedBy], ["submitted", "hr_head", ["Meena Iyer"]], "endorsing approves nothing");
    assert.equal(await hasEndorsed(client, ORG, r.id, HEAD), true);
    await assert.rejects(endorseRequisition(client, ORG, by(HEAD, "Meena Iyer"), r.id, null), /already endorsed/);
    const { approvals } = await getRequisition(client, ORG, r.id);
    assert.deepEqual([approvals[0].action, approvals[0].byName, approvals[0].reason], ["endorsed", "Meena Iyer", "Needed for the new tower."]);
    for (const x of [draft, other, r]) await withdrawRequisition(client, ORG, by(MANAGER, "Ravi Kumar"), x.id, null);
  });

  it("an approved request opens a role with no recruiter: HR is told, and the HR Head after 48 h without one", async () => {
    const r = await createRequisition(client, ORG, by(MANAGER, "Ravi Kumar"), { ...FORM, roleTitle: "Fire Safety Officer", department: "Safety", submit: true });
    events.length = 0; sent.length = 0;
    const approved = await decideRequisition(client, ORG, by(HR_HEAD, "Anita Verma"), r.id, { decision: "approve", inPlan: true }, { notify });
    const position = await getPosition(client, ORG, approved.positionId!);
    assert.deepEqual([position.recruiterId, position.recruiterName], [null, null], "the approver is not the recruiter");
    assert.ok(events.some((e) => e.kind === "role_opened"));
    assert.ok(sent.some((s) => s.to === "deepa@example.com" && /assign a recruiter/.test(s.subject)), "the HR team is told");

    const t0 = new Date(approved.decidedAt!).getTime();
    const notices = async () => (await q<{ n: number }>("select count(*)::int as n from public.recruitment_requisition_notices where requisition_id = $1 and kind = 'unassigned_48'", [r.id]))[0].n;
    await runRequisitionReminders(client, ORG, deps, new Date(t0 + 24 * 3_600_000));
    assert.equal(await notices(), 0);
    sent.length = 0;
    await runRequisitionReminders(client, ORG, deps, new Date(t0 + 49 * 3_600_000));
    assert.ok((await notices()) > 0);
    assert.ok(sent.some((s) => s.to === "anita@example.com" && /No recruiter yet: Fire Safety Officer/.test(s.subject)), "the HR Head");
    const once = await notices();
    await runRequisitionReminders(client, ORG, deps, new Date(t0 + 60 * 3_600_000));
    assert.equal(await notices(), once, "once");

    assert.equal((await listRequisitions(client, ORG, { userId: HR_HEAD, seesAll: true })).find((x) => x.id === r.id)?.pipelineCount, 0, "the tracker's candidates in pipeline");
    assert.equal((await updatePosition(client, ORG, position.id, { recruiterId: HR_BACKUP })).recruiterId, HR_BACKUP);
    assert.equal((await unassignedRoles(client, ORG, new Date(t0 + 60 * 3_600_000))).some((x) => x.id === r.id), false, "assigned: no more alerts");
  });

  it("on hold over 15 days: the raiser is asked on day 15 and 20, the HR Head on day 25; 'still needed' tells the approver", async () => {
    const r = await createRequisition(client, ORG, by(MANAGER, "Ravi Kumar"), { ...FORM, roleTitle: "Housekeeping Supervisor", department: "Housekeeping", submit: true });
    await assert.rejects(confirmStillNeeded(client, ORG, by(MANAGER, "Ravi Kumar"), r.id, null), /not on hold/);
    const held = await decideRequisition(client, ORG, by(HR_HEAD, "Anita Verma"), r.id, { decision: "hold", reason: "Budget review." });
    const t0 = new Date(held.holdSince!).getTime();
    const holds = async (days: number) => (await runRequisitionReminders(client, ORG, deps, new Date(t0 + days * 86_400_000 + 3_600_000))).holdChasers;
    sent.length = 0;
    assert.equal(await holds(10), 0);
    assert.equal(await holds(16), 1);
    assert.ok(sent.some((s) => s.to === "ravi@example.com" && /still needed\?/.test(s.subject)), "the raiser is asked");
    assert.equal(await holds(17), 0, "once");

    await assert.rejects(confirmStillNeeded(client, ORG, by(HR_HEAD, "Anita Verma"), r.id, null), /Only the person who raised/);
    events.length = 0; sent.length = 0;
    await confirmStillNeeded(client, ORG, by(MANAGER, "Ravi Kumar"), r.id, "Still needed for January.", { notify });
    assert.deepEqual(events.map((e) => e.kind), ["still_needed"]);
    assert.ok(sent.some((s) => s.to === "anita@example.com" && /^Still needed/.test(s.subject)), "the approver is told");
    assert.equal(await holds(21), 0, "confirmed: not asked again");
    sent.length = 0;
    assert.equal(await holds(26), 1);
    assert.ok(sent.some((s) => s.to === "anita@example.com" && /On hold 25 days/.test(s.subject)), "the HR Head at day 25");
    assert.equal(await holds(27), 0);
    assert.equal((await getRequisition(client, ORG, r.id)).approvals[0].action, "still_needed");
    await withdrawRequisition(client, ORG, by(MANAGER, "Ravi Kumar"), r.id, null);
  });

  // Bug fix 2026-11-24: two approvers clicking at once could both approve (two approval rows, two positions).
  it("lets only one of two approvers deciding at the same moment win, and opens one position", async () => {
    const r = await createRequisition(client, ORG, by(MANAGER, "Ravi Kumar"), { ...FORM, roleTitle: "Race Test Role", submit: true });
    const results = await Promise.allSettled([
      decideRequisition(client, ORG, by(HR_HEAD, "Anita Verma"), r.id, { decision: "approve", inPlan: true }),
      decideRequisition(client, ORG, by(HR_BACKUP, "Deepa Rao"), r.id, { decision: "approve", inPlan: true }),
    ]);
    assert.equal(results.filter((x) => x.status === "fulfilled").length, 1, "exactly one approval goes through");
    const lost = results.find((x) => x.status === "rejected") as PromiseRejectedResult;
    assert.equal(lost.reason.status, 409);
    const [{ n }] = await q<{ n: number }>("select count(*)::int as n from public.recruitment_requisition_approvals where requisition_id = $1 and action = 'approved'", [r.id]);
    assert.equal(n, 1, "one approval in the history");
    const [{ p }] = await q<{ p: number }>("select count(*)::int as p from public.recruitment_requisition_approvals where requisition_id = $1 and action = 'position_opened'", [r.id]);
    assert.equal(p, 1, "one position opened");
    assert.equal((await getRequisition(client, ORG, r.id)).requisition.status, "approved");
  });

  it("submits a double-clicked request once", async () => {
    const draft = await createRequisition(client, ORG, by(MANAGER, "Ravi Kumar"), { ...FORM, roleTitle: "Double Submit Role" });
    const results = await Promise.allSettled([
      submitRequisition(client, ORG, by(MANAGER, "Ravi Kumar"), draft.id),
      submitRequisition(client, ORG, by(MANAGER, "Ravi Kumar"), draft.id),
    ]);
    assert.equal(results.filter((x) => x.status === "fulfilled").length, 1);
    const after = (await getRequisition(client, ORG, draft.id)).requisition;
    assert.equal(after.status, "submitted");
    assert.match(after.requisitionNo ?? "", /^REQ-\d{4}-\d{4}$/);
    const [{ n }] = await q<{ n: number }>("select count(*)::int as n from public.recruitment_requisition_approvals where requisition_id = $1 and action = 'submitted'", [draft.id]);
    assert.equal(n, 1);
    await withdrawRequisition(client, ORG, by(MANAGER, "Ravi Kumar"), draft.id, null);
  });

  // Bug fix 2026-11-24: old one-time links stay usable after the request moves on, and the HR Head's link decision
  // revoked the Director's fresh link. Links are now revoked before new ones are issued, and kept on a resume.
  it("revokes earlier decision links whenever the request moves on, but not on a resume", async () => {
    const revoked: string[] = [];
    const linkDeps: NotifyDeps = { ...deps, async revokeLinks(id) { revoked.push(id); } };
    const linkNotify = (event: RequisitionEvent) => requisitionNotifier(client, ORG, linkDeps)(event);
    const r = await createRequisition(client, ORG, by(MANAGER, "Ravi Kumar"), { ...FORM, roleTitle: "Link Test Role", submit: true }, { notify: linkNotify });
    assert.deepEqual(revoked, [r.id], "submitted: links from before are revoked, then the HR Head's goes out");
    await decideRequisition(client, ORG, by(HR_HEAD, "Anita Verma"), r.id, { decision: "hold", reason: "Budget review." }, { notify: linkNotify });
    assert.equal(revoked.length, 2, "on hold");
    await decideRequisition(client, ORG, by(HR_HEAD, "Anita Verma"), r.id, { decision: "resume" }, { notify: linkNotify });
    assert.equal(revoked.length, 2, "a resume keeps the links");
    sent.length = 0;
    await decideRequisition(client, ORG, by(HR_HEAD, "Anita Verma"), r.id, { decision: "approve", inPlan: false }, { notify: linkNotify });
    assert.equal(revoked.length, 3, "on to the Director: the HR Head's links go before the Director's is issued");
    assert.ok(sent.some((s) => s.to === "sunil@example.com"), "the Director is asked, with the link issued after the revoke");
    await decideRequisition(client, ORG, by(DIRECTOR, "Sunil Mehta"), r.id, { decision: "send_back", reason: "Lower the band." }, { notify: linkNotify });
    assert.equal(revoked.length, 4, "sent back: no old link can decide the edited request");
  });

  it("counts the SLA in working days, Monday to Saturday", () => {
    // Thursday 2026-11-19 09:00 to Tuesday 2026-11-24 09:00: Fri, Sat, (Sun skipped), Mon, Tue = 4 working days.
    assert.equal(workingDaysBetween(new Date("2026-11-19T09:00:00Z"), new Date("2026-11-24T09:00:00Z")), 4);
    assert.equal(workingDaysBetween(new Date("2026-11-19T09:00:00Z"), new Date("2026-11-19T18:00:00Z")), 0);
  });
});
