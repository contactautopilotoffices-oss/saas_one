import { NextRequest, NextResponse } from "next/server";

import { getCandidatesAdmin } from "@/backend/lib/candidates/access";
import { getScorecard, SCORECARD_ENTITY, submitScorecard, type ScorecardPayload } from "@/backend/lib/candidates/hiring";
import { CandidateActionError } from "@/backend/lib/candidates/records";
import { RECOMMENDATION_LABELS, SCORECARD_SKILLS, type Scorecard } from "@/backend/lib/candidates/types";
import { actionPage } from "@/backend/lib/emailActions/page";
import { consumeEmailActionToken, peekEmailActionToken, recordTokenResult, revokeTokensForEntity } from "@/backend/lib/emailActions/tokens";

/**
 * An interviewer's scorecard from their one-time link (owner 2026-11-21; spec screen 10: "resume and JD on screen,
 * competency ratings, recommendation, comments; mandatory comment on reject; no sight of others' ratings until
 * submitted"). GET shows the form and never changes anything; POST claims the link once and saves the card, then shows
 * the other interviewers' submitted cards, which this interviewer may now see.
 */
export const dynamic = "force-dynamic";

const html = (body: string, status = 200) => new NextResponse(body, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
const STYLE = `body{margin:0;background:#f1f5f9;font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#0f172a}main{max-width:560px;margin:0 auto;padding:20px 16px 48px}
.card{background:#fff;border-radius:16px;padding:20px;box-shadow:0 1px 3px rgba(15,23,42,.08);margin-bottom:14px}h1{font-size:20px;margin:0 0 4px}.muted{color:#64748b;font-size:13px}
.skill{margin:14px 0}.stars{display:flex;gap:6px}.stars label{flex:1;text-align:center;border:1px solid #cbd5e1;border-radius:10px;padding:8px 0;cursor:pointer}.stars input{display:none}.stars input:checked+span{font-weight:800;color:#0f766e}
.opt{display:inline-flex;gap:6px;align-items:center;border:1px solid #e2e8f0;border-radius:10px;padding:8px 12px;margin:4px 6px 4px 0}
textarea{width:100%;box-sizing:border-box;border:1px solid #cbd5e1;border-radius:10px;padding:10px;font:inherit;min-height:90px}
.btn{display:block;width:100%;margin-top:14px;background:#0f766e;color:#fff;border:0;border-radius:12px;padding:14px;font:inherit;font-weight:700;cursor:pointer}
.err{background:#fef2f2;border:1px solid #fecaca;color:#991b1b;border-radius:10px;padding:10px;font-size:14px}table{border-collapse:collapse;width:100%;font-size:14px}td{padding:4px 0}td:first-child{color:#64748b}`;
const page = (title: string, body: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${STYLE}</style></head><body><main>${body}</main></body></html>`;

function form(p: ScorecardPayload, error: string | null, values: Record<string, string>): string {
  const scale = (name: string) => `<div class="stars">${[1, 2, 3, 4, 5].map((n) => `<label><input type="radio" name="${esc(name)}" value="${n}" ${values[name] === String(n) ? "checked" : ""} required><span>${n}</span></label>`).join("")}</div>`;
  return page(`Scorecard: ${p.candidate}`, `<div class="card"><h1>Scorecard: ${esc(p.candidate)}</h1>
<p class="muted">${esc([p.round, p.role, p.when].filter(Boolean).join(" · "))}${p.panelName ? ` · for ${esc(p.panelName)}` : ""}</p>
${error ? `<p class="err">${esc(error)}</p>` : ""}
<form method="POST" action="">
${SCORECARD_SKILLS.map((k, i) => `<div class="skill"><b>${esc(k)}</b> <span class="muted">1 = poor, 5 = excellent</span>${scale(`s${i}`)}</div>`).join("")}
<div class="skill"><b>Overall</b>${scale("overall")}</div>
<p><b>Recommendation</b><br>${(["proceed", "hold", "reject"] as const).map((r) => `<label class="opt"><input type="radio" name="recommendation" value="${r}" ${values.recommendation === r ? "checked" : ""} required>${RECOMMENDATION_LABELS[r]}</label>`).join("")}</p>
<label class="muted" for="comments">Comments (required to reject)</label>
<textarea id="comments" name="comments" maxlength="3000">${esc(values.comments ?? "")}</textarea>
<button class="btn" type="submit">Submit my scorecard</button>
</form><p class="muted">Your link only, and it works once. You see the other interviewers' ratings after you submit yours.</p></div>`);
}

function others(list: Scorecard[]): string {
  if (!list.length) return `<div class="card"><p class="muted">No other interviewer has submitted yet.</p></div>`;
  return list.map((c) => `<div class="card"><b>${esc(c.panelName ?? "Interviewer")}</b> · overall ${c.overall ?? "—"}/5 · ${esc(c.recommendation ? RECOMMENDATION_LABELS[c.recommendation] : "—")}
<table>${Object.entries(c.ratings).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}/5</td></tr>`).join("")}</table>${c.comments ? `<p class="muted">“${esc(c.comments)}”</p>` : ""}</div>`).join("");
}

const gone = () => html(actionPage({ kind: "error", title: "This link is not valid or has been used", message: "It may have expired, or the scorecard was already submitted. Ask HR for a new link if you still need to fill it." }), 410);

export async function GET(_request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const peek = await peekEmailActionToken(token);
  if (!peek || peek.entityType !== SCORECARD_ENTITY) return gone();
  return html(form(peek.payload as unknown as ScorecardPayload, null, {}));
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const peek = await peekEmailActionToken(token);
  if (!peek || peek.entityType !== SCORECARD_ENTITY) return gone();
  const p = peek.payload as unknown as ScorecardPayload;
  const values: Record<string, string> = {};
  try {
    const f = await request.formData();
    for (const [k, v] of f.entries()) values[k] = String(v).slice(0, 3000);
  } catch { /* empty form */ }
  const ratings = Object.fromEntries(SCORECARD_SKILLS.map((k, i) => [k, Number(values[`s${i}`])]).filter(([, v]) => Number.isInteger(v) && (v as number) >= 1));
  const body = { ratings, overall: Number(values.overall), recommendation: values.recommendation, comments: values.comments?.trim() || undefined };
  // Check before the link is used up: a missing rating or comment costs a re-render, not the link.
  if (Object.keys(ratings).length < SCORECARD_SKILLS.length || !(Number(values.overall) >= 1)) return html(form(p, "Rate every skill and the overall.", values), 400);
  if (!["proceed", "hold", "reject"].includes(values.recommendation ?? "")) return html(form(p, "Pick proceed, hold or reject.", values), 400);
  if (values.recommendation === "reject" && !values.comments?.trim()) return html(form(p, "Comments are required to reject.", values), 400);

  const admin = getCandidatesAdmin();
  const card = await getScorecard(admin, p.scorecardId).catch(() => null);
  if (!card || card.submittedAt) return gone();
  const claim = await consumeEmailActionToken(token);
  if (!claim.ok) return gone();
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0].trim() || null;
  try {
    const { others: rest } = await submitScorecard(admin, p.scorecardId, body);
    await revokeTokensForEntity(SCORECARD_ENTITY, p.scorecardId, claim.token.id);
    await recordTokenResult(claim.token.id, "ok", ip);
    return html(page("Scorecard submitted", `<div class="card"><h1>Thank you. Your scorecard is in.</h1><p class="muted">The other interviewers' ratings for ${esc(p.candidate)}:</p></div>${others(rest)}`));
  } catch (error) {
    const message = error instanceof CandidateActionError ? error.message : "Something went wrong.";
    await recordTokenResult(claim.token.id, message, ip);
    return html(actionPage({ kind: "error", title: "The scorecard was not saved", message: `${message} Ask HR for a new link.` }), 500);
  }
}
