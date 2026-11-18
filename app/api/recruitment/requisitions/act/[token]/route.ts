import { NextRequest, NextResponse } from "next/server";

import { getCandidatesAdmin } from "@/backend/lib/candidates/access";
import { CandidateActionError } from "@/backend/lib/candidates/records";
import { defaultNotifyDeps, requisitionNotifier, type LinkSummary } from "@/backend/lib/candidates/requisition-notify";
import { decideRequisition } from "@/backend/lib/candidates/requisitions";
import { APPROVAL_LEVEL_LABELS, type ApprovalLevel } from "@/backend/lib/candidates/types";
import { actionPage } from "@/backend/lib/emailActions/page";
import { consumeEmailActionToken, peekEmailActionToken, recordTokenResult, revokeTokensForEntity } from "@/backend/lib/emailActions/tokens";

/**
 * The approver's one-time link (owner 2026-11-17; Stage 2: "Managers and Directors approve from a phone, without a
 * desktop login"). GET renders the request and the four choices and never changes anything, so a mail scanner that
 * follows the link decides nothing; POST claims the token once and records the decision as that approver.
 */
export const dynamic = "force-dynamic";
const ENTITY = "recruitment_requisition";

const html = (body: string, status = 200) => new NextResponse(body, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
const lpa = (v: number | null) => (v === null ? "—" : `₹${(v / 100_000).toLocaleString("en-IN", { maximumFractionDigits: 1 })} LPA`);

function decisionPage(summary: LinkSummary, level: ApprovalLevel, error: string | null, chosen: string, reason: string): string {
  const rows: [string, string][] = [
    ["Request", summary.requisitionNo ?? "—"],
    ["Role", [summary.roleTitle, summary.department, summary.location].filter(Boolean).join(" · ")],
    ["Positions", `${summary.positions} · ${summary.requestType === "replacement" ? `replacement for ${summary.replacingName ?? "—"}` : "new"}`],
    ["Budget band (CTC)", `${lpa(summary.budgetMinCtc)} to ${lpa(summary.budgetMaxCtc)}`],
    ["Experience", summary.minExperienceYears !== null ? `${summary.minExperienceYears}+ years` : "—"],
    ["Qualification", summary.qualification ?? "—"],
    ["Target joining", summary.targetJoiningDate ?? "—"],
    ["Raised by", summary.raisedByName ?? "—"],
  ];
  const choice = (value: string, label: string, hint: string) =>
    `<label class="opt"><input type="radio" name="decision" value="${value}" ${chosen === value ? "checked" : ""} required><span><b>${label}</b><small>${hint}</small></span></label>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Hiring request ${esc(summary.requisitionNo)}</title>
<style>
body{margin:0;background:#f1f5f9;font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#0f172a}
main{max-width:560px;margin:0 auto;padding:20px 16px 48px}
.card{background:#fff;border-radius:16px;padding:20px;box-shadow:0 1px 3px rgba(15,23,42,.08)}
h1{font-size:20px;margin:0 0 4px}p{margin:8px 0}
table{border-collapse:collapse;width:100%;font-size:14px;margin:12px 0}td{padding:6px 0;vertical-align:top}td:first-child{color:#64748b;width:38%}
.just{white-space:pre-wrap;background:#f8fafc;border-radius:10px;padding:10px;font-size:14px}
.opt{display:flex;gap:10px;align-items:flex-start;padding:10px 12px;border:1px solid #e2e8f0;border-radius:12px;margin:8px 0;cursor:pointer}.opt input{margin-top:5px}.opt small{display:block;color:#64748b}
.plan{display:flex;gap:10px;align-items:flex-start;background:#fffbeb;border:1px solid #fde68a;border-radius:12px;padding:12px;margin:12px 0}.plan input{margin-top:5px}
textarea{width:100%;box-sizing:border-box;border:1px solid #cbd5e1;border-radius:10px;padding:10px;font:inherit;min-height:80px}
.btn{display:block;width:100%;margin-top:14px;background:#1e293b;color:#fff;border:0;border-radius:12px;padding:14px;font:inherit;font-weight:700;cursor:pointer}
.err{background:#fef2f2;border:1px solid #fecaca;color:#991b1b;border-radius:10px;padding:10px;font-size:14px}
.muted{color:#64748b;font-size:13px}
</style></head><body><main><div class="card">
<h1>Hiring request ${esc(summary.requisitionNo)}</h1>
<p class="muted">Your decision as ${esc(APPROVAL_LEVEL_LABELS[level])}. Nothing is recorded until you press the button.</p>
${error ? `<p class="err">${esc(error)}</p>` : ""}
<table>${rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join("")}</table>
<p class="muted">Justification</p><div class="just">${esc(summary.justification ?? "—")}</div>
<form method="POST" action="">
${choice("approve", "Approve", level === "hr_head" ? "In plan: the role opens. Out of plan or above the CTC level: it goes to the Director." : "The role opens.")}
${choice("send_back", "Send back for change", "The manager changes the request and submits it again. Say what needs to change.")}
${choice("hold", "Put on hold", "It waits until an approver resumes it.")}
${choice("reject", "Reject", "Final. Give the reason.")}
${level === "hr_head" ? `<div class="plan"><input type="checkbox" name="in_plan" value="1" id="in_plan"><label for="in_plan"><b>This role is in the approved headcount plan</b><br><small class="muted">Tick it before approving. Unticked, the request goes to the Director.</small></label></div>` : ""}
<label class="muted" for="reason">Reason or note</label>
<textarea id="reason" name="reason" maxlength="2000" placeholder="Required for Reject and Send back">${esc(reason)}</textarea>
<button class="btn" type="submit">Record my decision</button>
</form>
<p class="muted">This link works once. To change your mind afterwards, use the app under Hiring requests.</p>
</div></main></body></html>`;
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
  if (!["approve", "reject", "send_back", "hold"].includes(decision)) return html(decisionPage(summary, level, "Choose one of the four.", decision, reason), 400);
  if ((decision === "reject" || decision === "send_back") && !reason) return html(decisionPage(summary, level, decision === "reject" ? "Give the reason for rejecting." : "Say what needs to change.", decision, reason), 400);

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
    await revokeTokensForEntity(ENTITY, t.entity_id, t.id);
    await recordTokenResult(t.id, "ok", ip);
    const what = { approved: requisition.currentLevel === "director" ? "passed to the Director" : "approved", rejected: "rejected", sent_back: "sent back for changes", on_hold: "put on hold", submitted: "passed to the Director" }[requisition.status as string] ?? requisition.status;
    return html(actionPage({ kind: "success", title: `Request ${summary.requisitionNo ?? ""} ${what}`, message: requisition.status === "approved" ? "The role is now open in Recruitment → Positions." : "The manager has been told. Thank you." }));
  } catch (error) {
    const message = error instanceof CandidateActionError ? error.message : "Something went wrong. Open the app under Hiring requests and decide there.";
    await recordTokenResult(t.id, message, ip);
    return html(actionPage({ kind: "error", title: "The decision was not recorded", message: `${message} This link is now used; decide from the app, or ask for a new link.` }), error instanceof CandidateActionError ? error.status : 500);
  }
}
