import { NextRequest, NextResponse } from "next/server";

import { getCandidatesAdmin } from "@/backend/lib/candidates/access";
import { breakupGroups, decideOffer, defaultFlowDeps, lpa, OFFER_ENTITY, OFFER_LEVEL_LABELS, type OfferLevel, type OfferLinkSummary } from "@/backend/lib/candidates/hiring";
import { escapeReviewText as esc, reviewPage } from "@/backend/lib/candidates/review-page";
import { CandidateActionError } from "@/backend/lib/candidates/records";
import { actionPage } from "@/backend/lib/emailActions/page";
import { consumeEmailActionToken, peekEmailActionToken, recordTokenResult } from "@/backend/lib/emailActions/tokens";

/**
 * An offer approver's one-time link (owner 2026-11-24, 23 Nov meeting: "annexure approval by the hiring manager and the
 * directors before the candidate sees it"). The hiring manager has no Recruitment login, so the link is how they
 * approve. GET shows the offer and its breakup and changes nothing (a mail scanner that follows it decides nothing);
 * POST claims the token once and records the decision as that approver.
 */
export const dynamic = "force-dynamic";

const html = (body: string, status = 200) => new NextResponse(body, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
const inr = (v: number) => `₹${Math.round(v).toLocaleString("en-IN")}`;
const used = () => html(actionPage({ kind: "error", title: "This link is not valid or has been used", message: "It may have expired, or the offer was already decided. Ask HR for the current status." }), 410);

type Peek = { entityType: string; payload: Record<string, unknown> };

function decisionPage(summary: OfferLinkSummary, level: OfferLevel, error: string | null, chosen: string, reason: string): string {
  const g = summary.groups ?? breakupGroups(summary.breakup ?? {}, { earnings: [], deductions: [], benefits: [] });
  const rows: [string, string][] = [
    ["Candidate", summary.candidateName], ["Role", summary.role ?? "—"], ["Offer CTC", lpa(summary.ctc)],
    ["Budget band", `${lpa(summary.bandMin)} to ${lpa(summary.bandMax)}`], ["Joining", summary.joiningDate ?? "—"], ["Proposed by", summary.proposedBy ?? "—"],
  ];
  const group = (title: string, list: [string, number][], total: [string, number] | null) => list.length
    ? `<tr><td colspan="2" class="g">${esc(title)}</td></tr>${list.map(([k, v]) => `<tr><td>${esc(k)}</td><td class="n">${inr(v)}</td></tr>`).join("")}${total ? `<tr><td><b>${esc(total[0])}</b></td><td class="n"><b>${inr(total[1])}</b></td></tr>` : ""}`
    : "";
  const breakup = `${group("Earnings (per month)", g.earnings, ["Gross per month", g.gross])}${group("Deductions (per month)", g.deductions, ["Net per month", g.net])}${group("Benefits (per year)", g.benefits, null)}${group("Other", g.other, null)}`;
  const choice = (value: string, label: string, hint: string) =>
    `<label class="opt"><input type="radio" name="decision" value="${value}" ${chosen === value ? "checked" : ""} required><span><b>${label}</b><small>${hint}</small></span></label>`;
  return reviewPage("Offer approval", `<section class="rf-card rf-hero"><p class="rf-kicker">Offer approval</p>
<h1>Offer for ${esc(summary.candidateName)}</h1>
<p class="muted">Your decision as ${esc(OFFER_LEVEL_LABELS[level])}. The candidate sees nothing until every approval is in. Nothing is recorded until you press the button.</p>
${error ? `<p class="err" role="alert">${esc(error)}</p>` : ""}
</section><section class="rf-card"><h2>Offer details</h2><table>${rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join("")}</table>
${breakup ? `<p class="muted">Salary breakup (annexure)</p><table>${breakup}</table>` : `<p class="muted">No breakup given yet.</p>`}
${summary.note ? `<p class="muted">Note from HR</p><div class="just">${esc(summary.note)}</div>` : ""}
</section><section class="rf-card"><form method="POST" action=""><fieldset><legend>Your decision</legend>
${choice("approve", "Approve", level === "director" ? "The letter goes to HR to release." : "It goes on to the next approver.")}
${choice("revise", "Send back for a change", "HR changes the offer or the breakup. Say what to change.")}
${choice("reject", "Reject", "Final. Give the reason.")}
</fieldset><label class="muted" for="reason">Reason or note</label>
<textarea id="reason" name="reason" maxlength="2000" placeholder="Required to send back or reject">${esc(reason)}</textarea>
<button class="rf-primary" type="submit">Record my decision</button>
</form>
<p class="muted">This link works once.</p>
</section>`);
}

const read = (peek: Peek | null) => {
  if (!peek || peek.entityType !== OFFER_ENTITY) return null;
  const summary = peek.payload.summary as OfferLinkSummary | undefined;
  const level = peek.payload.level as OfferLevel | undefined;
  return summary && level && level in OFFER_LEVEL_LABELS ? { summary, level } : null;
};

export async function GET(_request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const got = read((await peekEmailActionToken(token)) as Peek | null);
  if (!got) return used();
  return html(decisionPage(got.summary, got.level, null, "", ""));
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const got = read((await peekEmailActionToken(token)) as Peek | null);
  if (!got) return used();
  let decision = "";
  let reason = "";
  try {
    const form = await request.formData();
    decision = String(form.get("decision") ?? "").trim();
    reason = String(form.get("reason") ?? "").trim().slice(0, 2000);
  } catch { /* an empty form reads as no decision */ }
  if (!["approve", "reject", "revise"].includes(decision)) return html(decisionPage(got.summary, got.level, "Choose one of the three.", decision, reason), 400);
  if (decision !== "approve" && !reason) return html(decisionPage(got.summary, got.level, decision === "reject" ? "Give the reason for rejecting." : "Say what to change.", decision, reason), 400);

  const claim = await consumeEmailActionToken(token);
  if (!claim.ok) return html(actionPage({ kind: "error", title: "This link has already been used", message: "The offer may already be decided. Ask HR for the current status." }), 410);
  const t = claim.token;
  const admin = getCandidatesAdmin();
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0].trim() || null;
  try {
    const { data: user } = await admin.from("users").select("full_name").eq("id", t.user_id).maybeSingle();
    const by = { id: t.user_id, name: ((user as { full_name?: string | null } | null)?.full_name ?? "").trim() || null };
    const offer = await decideOffer(admin, t.organization_id, by as { id: string; name: string | null }, t.entity_id, { decision, reason: reason || undefined, expectedLevel: got.level, approvalRevision: got.summary.approvalRevision ?? 1 }, defaultFlowDeps());
    await recordTokenResult(t.id, "ok", ip);
    const message = offer.status === "approved" ? "Every approval is in. HR will release the letter to the candidate."
      : offer.status === "pending" ? `It goes on to the ${offer.currentLevel ? OFFER_LEVEL_LABELS[offer.currentLevel] : "next approver"}.`
      : "HR has been told. Thank you.";
    return html(actionPage({ kind: "success", title: `Offer for ${got.summary.candidateName}: ${decision === "approve" ? "approved" : decision === "reject" ? "rejected" : "sent back"}`, message }));
  } catch (error) {
    const message = error instanceof CandidateActionError ? error.message : "Something went wrong.";
    await recordTokenResult(t.id, message, ip);
    return html(actionPage({ kind: "error", title: "The decision was not recorded", message: `${message} This link is now used; ask HR for a new one.` }), error instanceof CandidateActionError ? error.status : 500);
  }
}
