import { NextRequest, NextResponse } from 'next/server';
import { resolveProctorAccess, isProctorAccessError } from '@/backend/lib/proctor/access';
import { councilChat } from '@/backend/lib/council/llm';

/**
 * POST /api/proctor/generate — draft a test from a description.
 *
 * Writes a draft into the author's form; it saves nothing. The author reads
 * every question, edits what they want and presses Save, so a wrong or unfair
 * question costs an edit, not a bad hire. That is why a cheap model is fine
 * here `[BAA p.112]`, and why this is a single call, not an agent `[BAA p.104]`.
 *
 * Body: { org_id?, brief, role?, sections?: [{ key, title, count }], duration_minutes? }
 */

const MAX_QUESTIONS = 40;

interface DraftQuestion {
    section: string;
    text: string;
    options: string[];
    answer_index: number;
}

export async function POST(request: NextRequest) {
    const body = await request.json().catch(() => ({}));
    const access = await resolveProctorAccess(body.org_id);
    if (isProctorAccessError(access)) return access;
    if (!access.canAuthor) return NextResponse.json({ error: 'Forbidden: you cannot create tests' }, { status: 403 });

    const brief = String(body.brief || '').trim();
    if (brief.length < 8) return NextResponse.json({ error: 'Describe the test you want in a line or two' }, { status: 400 });

    const role = String(body.role || '').trim();
    const requested = (Array.isArray(body.sections) ? body.sections : [])
        .map((s: { key?: unknown; title?: unknown; count?: unknown }) => ({
            key: String(s?.key || '').trim(),
            title: String(s?.title || '').trim(),
            count: Math.max(1, Math.min(15, Number(s?.count) || 5)),
        }))
        .filter((s: { key: string }) => s.key);

    const plan = requested.length
        ? requested
        : [
              { key: 'cognitive', title: 'Cognitive ability', count: 5 },
              { key: 'aptitude', title: 'Aptitude', count: 5 },
              { key: 'culture', title: 'Workplace culture', count: 5 },
              { key: 'situational', title: 'Situational judgement', count: 5 },
          ];
    const total = plan.reduce((n: number, s: { count: number }) => n + s.count, 0);
    if (total > MAX_QUESTIONS) {
        return NextResponse.json({ error: `That is ${total} questions; keep it to ${MAX_QUESTIONS} or fewer` }, { status: 400 });
    }

    const prompt = `Write a multiple-choice assessment${role ? ` for the role of ${role}` : ''}.

What the test is for, in the author's words:
"""${brief.slice(0, 2000)}"""

Sections and how many questions each needs:
${plan.map((s: { key: string; title: string; count: number }) => `- ${s.key} (${s.title || s.key}): ${s.count} questions`).join('\n')}

Rules:
- Exactly 4 options per question, exactly one best answer.
- Spread the correct answer across positions; do not put it in the same place every time.
- Do not make the right answer the longest option. Wrong options must be plausible to someone who does not know the answer.
- Plain English, short sentences. Indian workplace context; rupee amounts where money appears.
- Arithmetic questions must be solvable in the head, and the arithmetic must be correct.
- No trick questions, nothing about protected characteristics (age, caste, religion, gender, marital status).
- Each section also gets a one-sentence description the candidate will read.

Return ONLY raw JSON, no markdown:
{"title":"<test title>","instructions":"<2-3 sentences the candidate reads before starting>","sections":[{"key":"<section key>","title":"<section title>","description":"<one sentence>"}],"questions":[{"section":"<section key>","text":"<question>","options":["a","b","c","d"],"answer_index":<0-3>}]}`;

    let raw: string;
    try {
        raw = await councilChat(
            [
                { role: 'system', content: 'You write fair, job-relevant assessments. You reply with raw JSON only.' },
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

    let parsed: { title?: unknown; instructions?: unknown; sections?: unknown; questions?: unknown } | null = null;
    try {
        parsed = JSON.parse(clean);
    } catch {
        const match = clean.match(/\{[\s\S]*\}/);
        if (match) { try { parsed = JSON.parse(match[0]); } catch { parsed = null; } }
    }
    if (!parsed || !Array.isArray(parsed.questions)) {
        return NextResponse.json({ error: 'The AI returned something unreadable. Try again, or write the questions yourself.' }, { status: 502 });
    }

    const allowedKeys = plan.map((s: { key: string }) => s.key);
    const questions: DraftQuestion[] = [];
    for (const q of parsed.questions as Array<Record<string, unknown>>) {
        const text = String(q?.text || '').trim();
        const options = (Array.isArray(q?.options) ? q.options : []).map((o) => String(o || '').trim()).filter(Boolean);
        const answer = Number(q?.answer_index);
        const section = allowedKeys.includes(String(q?.section)) ? String(q.section) : allowedKeys[0];
        if (!text || options.length < 2) continue;
        if (!Number.isInteger(answer) || answer < 0 || answer >= options.length) continue;
        questions.push({ section, text, options, answer_index: answer });
        if (questions.length >= MAX_QUESTIONS) break;
    }
    if (!questions.length) {
        return NextResponse.json({ error: 'The AI returned no usable questions. Try describing the test differently.' }, { status: 502 });
    }

    const sections = (Array.isArray(parsed.sections) ? parsed.sections : [])
        .map((s: Record<string, unknown>) => ({
            key: String(s?.key || '').trim(),
            title: String(s?.title || '').trim(),
            description: String(s?.description || '').trim(),
        }))
        .filter((s: { key: string }) => allowedKeys.includes(s.key));

    return NextResponse.json({
        title: String(parsed.title || '').trim(),
        instructions: String(parsed.instructions || '').trim(),
        sections,
        questions,
        // Shown to the author: what came back vs what was asked for.
        asked_for: total,
    });
}
