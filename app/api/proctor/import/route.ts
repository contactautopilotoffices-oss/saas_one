import { NextRequest, NextResponse } from 'next/server';
import { resolveProctorAccess, isProctorAccessError } from '@/backend/lib/proctor/access';
import { councilChat } from '@/backend/lib/council/llm';

/**
 * POST /api/proctor/import — turn questions HR pasted (from Word, a PDF, an
 * email — any rough format) into sections and questions for the builder.
 *
 * Saves nothing: the result is added to the author's form, where they read it,
 * fix it and press Save. When the paste gives no answer, the model works one
 * out and the question is marked ai_picked, so the builder shows "AI-picked
 * answer — please check" until HR confirms it.
 *
 * ## Agent Spec — proctor question import
 * 1. Workflow or agent? workflow — fixed path (text → one call → structured draft); neither agent
 *    justification applies `[BAA p.115]`, so default to workflow `[BAA p.104]`. The deterministic
 *    alternative (a regex parser) can't cope with free-form pastes; no head-to-head run yet `[BAA pp.94–95, 99]`.
 * 2. Context: the pasted text and the test's existing section titles; nothing about candidates `[BAA p.112]`.
 * 3. Cost of a false positive: low — a misread question or wrong AI-picked answer costs an edit, and every
 *    AI-picked answer is flagged for a human before saving. Same tier as "Draft with AI"
 *    (PROCTOR_AUTHOR_MODEL / council synthesis) `[BAA p.112]`.
 * 4. Tools: none.
 * 5. Prompt: numbered rules, verbatim-text rule, JSON only, answer_given written per question `[BAA pp.105, 114]`.
 * 6. Memory: none — each paste is one-off `[BAA pp.100–103]`.
 * 7. Multi-agent: no — single call `[BAA p.116]`.
 * 8. Evaluation `[BAA pp.118–119]`: system = 502s returned to the author; quality = NONE yet (no rubric, no
 *    labelled pastes) `[BAA pp.96–98]`; tool interaction = N/A; efficiency = one call per paste.
 * 9. Trace: none beyond the response — nothing is stored until the author saves `[BAA pp.119–120]`.
 * 10. Knowingly violated: L5/L6 — no quality evaluation or rubric. Acceptable only because nothing is saved
 *     without a human reading it and AI-picked answers are flagged.
 *
 * Body: { org_id?, text, existing_sections?: string[] }
 * Returns: { sections: [{ title, description }], questions: [{ section, text, options, multi,
 *            answer_index, answer_indexes, ai_picked }] }  — section = a section title.
 */

const MAX_CHARS = 30_000;
const MAX_QUESTIONS = 80;

export async function POST(request: NextRequest) {
    const body = await request.json().catch(() => ({}));
    const access = await resolveProctorAccess(body.org_id);
    if (isProctorAccessError(access)) return access;
    if (!access.canAuthor) return NextResponse.json({ error: 'Forbidden: you cannot create tests' }, { status: 403 });

    const text = String(body.text || '').trim();
    if (text.length < 15) return NextResponse.json({ error: 'Paste at least one question with its options' }, { status: 400 });
    if (text.length > MAX_CHARS) return NextResponse.json({ error: `That is too long; paste up to ${MAX_CHARS.toLocaleString()} characters at a time` }, { status: 400 });

    const existing = (Array.isArray(body.existing_sections) ? body.existing_sections : [])
        .map((s: unknown) => String(s || '').trim()).filter(Boolean).slice(0, 20);

    const prompt = `Below is text an HR person pasted. It contains multiple-choice questions for an assessment, in any format.
Turn it into structured questions.

Rules, in order:
1. Find every question. Keep the question and option wording exactly as written; only remove numbering ("1.", "Q3)") and option letters ("a)", "(B)", "C.").
2. Do not invent questions or options. Skip lines that are not part of a question.
3. Sections: if the text has section headings, use them. If not, group the questions into 2–5 sections by topic, each with a short title (2–4 words).${existing.length ? ` Where a question fits one of these existing sections, use that exact title: ${existing.map((s: string) => `"${s}"`).join(', ')}.` : ''}
4. Give each section a one-sentence description the candidate will read.
5. Correct answers: if the text marks the answer (e.g. "Answer: B", "Ans - c", "*", "(correct)", "✓"), use it and set "answer_given": true.
   If the text does NOT give the answer, work out the correct option yourself and set "answer_given": false.
6. Multiple answers: set "multi": true only if the question asks to choose more than one ("select all that apply", "choose two") or the text marks more than one correct option. Otherwise "multi": false with exactly one correct option.
7. "answers" lists the 0-based indexes of the correct options in "options".

Return ONLY raw JSON, no markdown:
{"sections":[{"title":"<title>","description":"<one sentence>"}],"questions":[{"section":"<section title>","text":"<question>","options":["...","..."],"multi":false,"answers":[<index>],"answer_given":true}]}

The pasted text:
"""
${text}
"""`;

    let raw: string;
    try {
        raw = await councilChat(
            [
                { role: 'system', content: 'You convert pasted assessment questions into exact structured JSON. You reply with raw JSON only.' },
                { role: 'user', content: prompt },
            ],
            'synthesis',
            { model: process.env.PROCTOR_AUTHOR_MODEL || null },
        );
    } catch (err) {
        return NextResponse.json({ error: err instanceof Error ? err.message : 'The AI call failed' }, { status: 502 });
    }

    const clean = raw
        .replace(/<think>[\s\S]*?<\/think>/gi, '')
        .replace(/<think>[\s\S]*/gi, '')
        .replace(/```json/gi, '')
        .replace(/```/g, '')
        .trim();

    let parsed: { sections?: unknown; questions?: unknown } | null = null;
    try {
        parsed = JSON.parse(clean);
    } catch {
        const match = clean.match(/\{[\s\S]*\}/);
        if (match) { try { parsed = JSON.parse(match[0]); } catch { parsed = null; } }
    }
    if (!parsed || !Array.isArray(parsed.questions)) {
        return NextResponse.json({ error: 'The AI could not read those questions. Check the paste and try again.' }, { status: 502 });
    }

    const questions = [];
    for (const q of parsed.questions as Array<Record<string, unknown>>) {
        const qText = String(q?.text || '').trim();
        const options = (Array.isArray(q?.options) ? q.options : []).map((o) => String(o || '').trim()).filter(Boolean).slice(0, 8);
        if (!qText || options.length < 2) continue;
        const answers = [...new Set((Array.isArray(q?.answers) ? q.answers : [q?.answers])
            .map(Number)
            .filter((n) => Number.isInteger(n) && n >= 0 && n < options.length))].sort((a, b) => a - b);
        if (!answers.length) continue;
        const multi = q?.multi === true && answers.length >= 1;
        questions.push({
            section: String(q?.section || '').trim() || 'Questions',
            text: qText,
            options,
            multi,
            answer_index: answers[0],
            answer_indexes: multi ? answers : [],
            ai_picked: q?.answer_given !== true,
        });
        if (questions.length >= MAX_QUESTIONS) break;
    }
    if (!questions.length) {
        return NextResponse.json({ error: 'No usable questions were found. Each question needs at least two options.' }, { status: 502 });
    }

    const used = new Set(questions.map((q) => q.section.toLowerCase()));
    const sections = (Array.isArray(parsed.sections) ? parsed.sections : [])
        .map((s: Record<string, unknown>) => ({ title: String(s?.title || '').trim(), description: String(s?.description || '').trim() }))
        .filter((s: { title: string }) => s.title && used.has(s.title.toLowerCase()));

    return NextResponse.json({ sections, questions });
}
