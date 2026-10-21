import { after, NextResponse } from "next/server";

import {
  ASK_RATE_LIMIT,
  askHrAssistant,
  BOT_NAME,
  flushTraces,
  getSupabaseAdmin,
  MAX_QUESTION_LENGTH,
  type ChatTurn,
} from "@/backend/lib/hr-assistant";
import { isRateLimitError } from "@/backend/lib/hr-assistant/clients";

import { rateLimited, requireHrSession, requireHrUser } from "./_lib/admin-auth";

export const runtime = "nodejs";
export const maxDuration = 30;

// Earlier messages the browser may send for context: only the last few, each capped, and
// anything malformed dropped. They only help understand follow-ups; facts still come from
// the policy search.
const MAX_HISTORY_TURNS = 6;

function readHistory(value: unknown): ChatTurn[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(-MAX_HISTORY_TURNS)
    .filter(
      (turn): turn is ChatTurn =>
        !!turn &&
        (turn.role === "user" || turn.role === "assistant") &&
        typeof turn.content === "string" &&
        turn.content.trim() !== "",
    )
    .map((turn) => ({ role: turn.role, content: turn.content.slice(0, MAX_QUESTION_LENGTH) }));
}

/** What the signed-in user may do: drives whether the floating bot (and its admin link) shows. */
export async function GET() {
  const auth = await requireHrSession();
  if (auth.error) return auth.error;
  return NextResponse.json(auth.access, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const auth = await requireHrUser();
  if (auth.error) return auth.error;
  const { user } = auth;

  const limited = rateLimited("ask", user.id, ASK_RATE_LIMIT);
  if (limited) return limited;

  let question: unknown;
  let history: ChatTurn[];
  try {
    const body = await request.json();
    question = body?.question;
    history = readHistory(body?.history);
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof question !== "string" || !question.trim()) {
    return NextResponse.json({ error: "Question is required" }, { status: 400 });
  }
  if (question.length > MAX_QUESTION_LENGTH) {
    return NextResponse.json(
      { error: `Question must be at most ${MAX_QUESTION_LENGTH} characters` },
      { status: 400 },
    );
  }

  after(flushTraces);

  try {
    // Service role: the policy tables are server-only (no RLS read policies), so tenants
    // can't read them directly. Access was checked above; the log is keyed to the session user.
    const result = await askHrAssistant(question.trim(), { supabase: getSupabaseAdmin(), userId: user.id }, history);
    return NextResponse.json({
      answer: result.answer,
      blocked: result.blocked,
      sources: result.sources.map(({ source, content }) => ({ source, content })),
    });
  } catch (error) {
    console.error("[hr-assistant] request failed", error);
    const busy = isRateLimitError(error);
    return NextResponse.json(
      {
        error: busy
          ? `${BOT_NAME} is a bit busy right now. Please try again in a moment.`
          : `${BOT_NAME} is unavailable right now. Please try again.`,
      },
      { status: busy ? 429 : 503 },
    );
  }
}
