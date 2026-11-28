import { NextRequest, NextResponse } from "next/server";

import { getCandidatesAdmin } from "@/backend/lib/candidates/access";
import { escapeReviewText as esc, reviewPage } from "@/backend/lib/candidates/review-page";
import { CandidateActionError } from "@/backend/lib/candidates/records";
import { defaultNotifyDeps, mobilityText, requisitionNotifier, type LinkSummary } from "@/backend/lib/candidates/requisition-notify";
import { decideRequisition } from "@/backend/lib/candidates/requisitions";
import { APPROVAL_LEVEL_LABELS, experienceText, type RequisitionLevel as ApprovalLevel } from "@/backend/lib/candidates/types";
import { actionPage } from "@/backend/lib/emailActions/page";
import { consumeEmailActionToken, peekEmailActionToken, recordTokenResult } from "@/backend/lib/emailActions/tokens";

/**
 * The approver's one-time link (owner 2026-11-17; Stage 2: "Managers and Directors approve from a phone, without a
 * desktop login"). GET renders the request and the four choices and never changes anything, so a mail scanner that
 * follows the link decides nothing; POST claims the token once and records the decision as that approver.
 */
export const dynamic = "force-dynamic";
const ENTITY = "recruitment_requisition";

const html = (body: string, status = 200) => new NextResponse(body, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
const lpa = (v: number | null) => (v === null ? "—" : `₹${(v / 100_000).toLocaleString("en-IN", { maximumFractionDigits: 1 })} LPA`);

function decisionPage(summary: LinkSummary, level: ApprovalLevel, error: string | null, chosen: string, reason: string, inPlan = summary.requestedInPlan === true): string {
  const rows: [string, string][] = [
    ["Request", summary.requisitionNo ?? "—"],
    ["Role", [summary.roleTitle, summary.department, summary.location].filter(Boolean).join(" · ")],
    ["Positions", `${summary.positions} · ${summary.requestType === "replacement" ? `replacement for ${summary.replacingName ?? "—"}` : "new"}`],
    ["Budget band (CTC)", `${lpa(summary.budgetMinCtc)} to ${lpa(summary.budgetMaxCtc)}`],
    ["Experience", experienceText(summary.minExperienceYears, summary.maxExperienceYears) || "—"],
    ...(summary.requestedInPlan == null ? [] : [["Requester’s plan status", summary.requestedInPlan ? "In plan" : "Out of plan"] as [string, string]]),
    ...(summary.jdFileName ? [["Job description PDF", `${summary.jdFileName} (in Hiring requests)`] as [string, string]] : []),
    ["Qualification", summary.qualification ?? "—"],
    ["Target joining", summary.targetJoiningDate ?? "—"],
    ["Raised by", summary.raisedByName ?? "—"],
    ...(summary.internalMobility !== undefined ? [["Internal mobility", mobilityText(summary.internalMobility)] as [string, string]] : []),
    ...(summary.roleIsNew ? [["New designation", "Raised under “Others”"] as [string, string]] : []),
  ];
  const choice = (value: string, label: string, hint: string) =>
    `<label class="opt"><input type="radio" name="decision" value="${value}" ${chosen === value ? "checked" : ""} required><span><b>${label}</b><small>${hint}</small></span></label>`;
  return reviewPage("Hiring request approval", `<section class="rf-card rf-hero"><p class="rf-kicker">Hiring request approval</p>
<h1>Hiring request ${esc(summary.requisitionNo)}</h1>
<p class="muted">Your decision as ${esc(APPROVAL_LEVEL_LABELS[level])}. Nothing is recorded until you press the button.</p>
${error ? `<p class="err" role="alert">${esc(error)}</p>` : ""}
</section><section class="rf-card"><h2>Request details</h2><table>${rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join("")}</table>
<p class="muted">Justification</p><div class="just">${esc(summary.justification ?? "—")}</div>
${summary.structureNote ? `<p class="muted">Place in the current structure</p><div class="just">${esc(summary.structureNote)}</div>` : ""}
</section><section class="rf-card"><form method="POST" action=""><fieldset><legend>Your decision</legend>
${choice("approve", "Approve", level === "hod" ? "It goes on to the HR Head." : level === "hr_head" ? "In plan: the role opens. Out of plan or above the CTC level: it goes to the Director." : "The role opens.")}
${choice("send_back", "Send back for change", "The manager changes the request and submits it again. Say what needs to change.")}
${choice("hold", "Put on hold", "It waits until an approver resumes it. Give the reason.")}
${choice("reject", "Reject", "Final. Give the reason.")}
${level === "hr_head" ? `<div class="plan"><input type="checkbox" name="in_plan" value="1" id="in_plan" ${inPlan ? "checked" : ""}><label for="in_plan"><b>This role is in the approved headcount plan</b><br><small class="muted">Check the plan status before approving. Out-of-plan requests go to the Director.</small></label></div>` : ""}
</fieldset><label class="muted" for="reason">Reason or note</label>
<textarea id="reason" name="reason" maxlength="2000" placeholder="Required for Reject, Send back and Hold">${esc(reason)}</textarea>
<button class="rf-primary" type="submit">Record my decision</button>
</form>
<p class="muted">This link works once. To change your mind afterwards, use the app under Hiring requests.</p>
</section>`);
}

type Peek = { entityType: string; action: string; payload: Record<string, unknown> };
const summaryOf = (peek: Peek) => ({ summary: peek.payload.summary as LinkSummary | undefined, level: peek.payload.level as ApprovalLevel | undefined });

export async function GET(_request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const peek = await peekEmailActionToken(token);
  const { summary, level } = peek && peek.entityType === ENTITY ? summaryOf(peek) : { summary: undefined, level: undefined };
  if (!summary || !level) {
    return html(actionPage({ kind: "error", title: "This link is not valid or has been used", message: "It may have expired, or the request was already decided. Open the app under Hiring requests to see it." }), 410);
  }
  return html(decisionPage(summary, level, null, "", ""));
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const peek = await peekEmailActionToken(token);
  const { summary, level } = peek && peek.entityType === ENTITY ? summaryOf(peek) : { summary: undefined, level: undefined };
  if (!summary || !level) {
    return html(actionPage({ kind: "error", title: "This link is not valid or has been used", message: "It may have expired, or the request was already decided. Open the app under Hiring requests to see it." }), 410);
  }
  // Read and check the answer before the link is burned: a missing reason costs a re-render, not the link.
  let decision = "";
  let reason = "";
  let inPlan = false;
  try {
    const form = await request.formData();
    decision = String(form.get("decision") ?? "").trim();
    reason = String(form.get("reason") ?? "").trim().slice(0, 2000);
    inPlan = form.get("in_plan") === "1";
  } catch { /* an empty form reads as no decision */ }
  if (!["approve", "reject", "send_back", "hold"].includes(decision)) return html(decisionPage(summary, level, "Choose one of the four.", decision, reason, inPlan), 400);
  if ((decision === "reject" || decision === "send_back" || decision === "hold") && !reason) {
    return html(decisionPage(summary, level, decision === "reject" ? "Give the reason for rejecting." : decision === "hold" ? "Give the reason for putting it on hold." : "Say what needs to change.", decision, reason, inPlan), 400);
  }

  const claim = await consumeEmailActionToken(token);
  if (!claim.ok) {
    return html(actionPage({ kind: "error", title: "This link has already been used", message: "The request may already be decided, by you or another approver. Open the app under Hiring requests to see the current status." }), 410);
  }
  const t = claim.token;
  const admin = getCandidatesAdmin();
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0].trim() || null;
  try {
    const { data: user } = await admin.from("users").select("full_name").eq("id", t.user_id).maybeSingle();
    const by = { id: t.user_id, name: ((user as { full_name?: string | null } | null)?.full_name ?? "").trim() || null };
    const requisition = await decideRequisition(admin, t.organization_id, by, t.entity_id, { decision, reason: reason || undefined, ...(level === "hr_head" ? { inPlan } : {}) }, { notify: requisitionNotifier(admin, t.organization_id, defaultNotifyDeps()), via: "link" });
    // The other links for this request were revoked by the notifier before it issued the next level's link (revoking
    // here, after the decision, would also kill the Director's fresh link).
    await recordTokenResult(t.id, "ok", ip);
    const what = { approved: "approved", rejected: "rejected", sent_back: "sent back for changes", on_hold: "put on hold", submitted: `passed to the ${requisition.currentLevel ? APPROVAL_LEVEL_LABELS[requisition.currentLevel] : "next approver"}` }[requisition.status as string] ?? requisition.status;
    return html(actionPage({ kind: "success", title: `Request ${summary.requisitionNo ?? ""} ${what}`, message: requisition.status === "approved" ? "The role is now open in Recruitment → Positions." : "The manager has been told. Thank you." }));
  } catch (error) {
    const message = error instanceof CandidateActionError ? error.message : "Something went wrong. Open the app under Hiring requests and decide there.";
    await recordTokenResult(t.id, message, ip);
    return html(actionPage({ kind: "error", title: "The decision was not recorded", message: `${message} This link is now used; decide from the app, or ask for a new link.` }), error instanceof CandidateActionError ? error.status : 500);
  }
}
