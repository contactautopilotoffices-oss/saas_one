/**
 * Voice Note Intake — Phase 5: measures the voice pipeline on the owner's 20 recorded samples.
 *
 *   npx tsx task-manager/voice/eval/run_voice_eval.ts [--out <folder>] [--only 1,6,16] [--no-grade] [--no-brain] [--reuse <earlier results folder>]
 *
 * MANUAL tool, NOT part of the normal test run. It calls Groq Whisper (GROQ_VOICE_API_KEY), the tidy-up AI and the brain's
 * understanding step (the existing COUNCIL_* provider), and a grader on Groq (GROQ_VOICE_API_KEY). Keys are read from
 * .env / .env.local and never printed. It sends no WhatsApp message and touches no database (the brain runs on its
 * fake eval world). Results (including transcripts) are written to the --out folder.
 *
 * What is measured (doctrine L5 axes, docs/VOICE_NOTE_INTAKE_PLAN.md §8):
 *   1. Whisper large-v3 vs large-v3-turbo, each ALONE (no fallback): key-detail recall, WER, space-free CER, latency.
 *   2. The tidy-up (production models + fallback) on each transcript: the same metrics, Devanagari left, tokens.
 *   3. Rubric (doctrine L6): a grader from a different family (gpt-oss-120b) scores 0–3, reasoning first, raw vs tidy.
 *   4. The brain's understanding (doctrine L2 substitute): intent from the typed truth vs raw Whisper vs tidy text.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../../..');
for (const f of ['.env', '.env.local']) {
    const p = path.join(ROOT, f);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
        const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
        if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
}

const arg = (name: string) => { const i = process.argv.indexOf(`--${name}`); return i > -1 ? process.argv[i + 1] : undefined; };
const flag = (name: string) => process.argv.includes(`--${name}`);
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const WHISPER_MODELS = ['whisper-large-v3', 'whisper-large-v3-turbo'] as const;
const GRADER_MODEL = 'openai/gpt-oss-120b';
const WHISPER_GAP_MS = 3_200;   // Groq: 20 requests / minute for Whisper

const GRADER_SYSTEM = `You grade how well a machine-made text of a WhatsApp voice note matches what the speaker actually said.
The speaker is an office employee in India speaking English, Hindi or Hinglish. The text will be used to manage their tasks.

Ignore: punctuation, capital letters, script (Hindi may be in Devanagari or Roman letters — judge meaning, not script),
spelling variants of Hinglish words ("kar do" = "kardo", "saath" = "sath"), and filler sounds ("umm", "uh", "arre") being
present or absent.

Score on this scale:
3 = same meaning, and every name, number, amount, time, day and task word is correct.
2 = same meaning; a small slip that would not change what happens (a common word misspelled, a word added or dropped
    that carries no meaning).
1 = a detail that matters is wrong or missing (a name, number, amount, time, day, or which task), or the meaning is
    partly changed.
0 = a different meaning, invented content, or unusable.

Reply with ONLY one JSON object, with the reasoning written BEFORE the score:
{"reasoning": "<one or two sentences>", "score": 0 | 1 | 2 | 3}`;

interface Grade { score: number | null; reasoning: string; error?: string; tokens?: number }

async function grade(truth: string, candidate: string): Promise<Grade> {
    const key = process.env.GROQ_VOICE_API_KEY;
    if (!key) return { score: null, reasoning: '', error: 'no GROQ_VOICE_API_KEY' };
    for (let attempt = 0; attempt < 4; attempt++) {
        try {
            const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: GRADER_MODEL, temperature: 0, max_tokens: 800, reasoning_effort: 'low', response_format: { type: 'json_object' },
                    messages: [{ role: 'system', content: GRADER_SYSTEM },
                        { role: 'user', content: `What the speaker said:\n"${truth}"\n\nThe machine-made text:\n"${candidate}"` }],
                }),
                signal: AbortSignal.timeout(60_000),
            });
            if (res.status === 429) { await sleep(Number(res.headers.get('retry-after') || 0) * 1000 || 8_000 * (attempt + 1)); continue; }
            if (!res.ok) return { score: null, reasoning: '', error: `HTTP ${res.status}` };
            const j = await res.json() as { choices?: Array<{ message?: { content?: string } }>; usage?: { total_tokens?: number } };
            const out = JSON.parse(j.choices?.[0]?.message?.content ?? '{}') as { reasoning?: unknown; score?: unknown };
            const score = typeof out.score === 'number' && [0, 1, 2, 3].includes(out.score) ? out.score : null;
            return { score, reasoning: String(out.reasoning ?? ''), tokens: j.usage?.total_tokens, ...(score === null ? { error: 'bad grader reply' } : {}) };
        } catch (err) {
            if (attempt === 3) return { score: null, reasoning: '', error: err instanceof Error ? err.message : String(err) };
            await sleep(4_000);
        }
    }
    return { score: null, reasoning: '', error: 'rate-limited' };
}

async function main() {
    if (!process.env.GROQ_VOICE_API_KEY) { console.error('GROQ_VOICE_API_KEY is not set in .env / .env.local'); process.exit(1); }
    const outDir = arg('out') ?? path.join(ROOT, 'task-manager', 'voice', 'eval', 'results', new Date().toISOString().replace(/[:.]/g, '-'));
    fs.mkdirSync(outDir, { recursive: true });

    const M = await import('./metrics');
    const { loadVoiceEvalCases } = await import('./cases');
    const { transcribeVoiceNote } = await import('../VoiceTranscriber');
    const { cleanTranscript } = await import('../VoiceCleanup');
    const { engyBrainLlm } = await import('../../brain/llm');
    const { runBrain } = await import('../../brain/index');
    const { world } = await import('../../brain/eval/worlds');
    const llm = engyBrainLlm();

    const only = arg('only')?.split(',').map(Number);
    // --reuse <earlier results folder>: take Whisper's text from that run (no audio is sent again) and re-run only the
    // tidy-up, its grade, and the brain. For measuring a tidy-up change on exactly the same transcripts.
    const reuseDir = arg('reuse');
    type Prior = { ok: boolean; raw?: string; whisperLanguage?: string | null; durationSec?: number | null; whisperMs?: number; gradeRaw?: unknown };
    const prior = new Map<number, Record<string, Prior>>(
        reuseDir ? (JSON.parse(fs.readFileSync(path.join(reuseDir, 'results.json'), 'utf8')) as Array<Record<string, Prior> & { id: number }>).map(r => [r.id, r]) : []);
    const cases = loadVoiceEvalCases(ROOT).filter(c => !only || only.includes(c.id));
    const warn = console.warn; console.warn = () => undefined;   // the modules warn per model failure; failures are recorded below

    type Row = Record<string, unknown> & { id: number };
    const rows: Row[] = [];
    for (const c of cases) {
        const audio = fs.readFileSync(c.file);
        const reference = M.stripFillers(c.truth, c.fillers);
        const row: Row = { id: c.id, language: c.language, truth: c.truth, reference, mustKeep: c.mustKeep, brainExpected: c.brainIntent, bytes: audio.length };
        for (const model of WHISPER_MODELS) {
            const key = model === 'whisper-large-v3' ? 'v3' : 'turbo';
            const before = prior.get(c.id)?.[key];
            const t0 = Date.now();
            const heard = reuseDir
                ? (before?.ok && before.raw
                    ? { ok: true as const, text: before.raw, language: before.whisperLanguage ?? null, durationSec: before.durationSec ?? null, model, failures: [] }
                    : { ok: false as const, reason: 'failed' as const, detail: 'not in the reused run', failures: [] })
                : await transcribeVoiceNote({ audio, mimeType: 'audio/ogg; codecs=opus' }, { models: [model] });
            const whisperMs = reuseDir ? before?.whisperMs ?? 0 : Date.now() - t0;
            if (!heard.ok) { row[key] = { ok: false, reason: heard.reason, detail: heard.detail, whisperMs }; if (!reuseDir) await sleep(WHISPER_GAP_MS); continue; }
            const t1 = Date.now();
            const tidy = await cleanTranscript(heard.text, { llm });
            const cleanupMs = Date.now() - t1;
            const measure = (text: string) => ({
                devanagari: M.hasDevanagari(text), recall: M.keyRecall(text, c.mustKeep),
                wer: Number(M.wer(reference, text).toFixed(3)), cer: Number(M.cerNoSpaces(reference, text).toFixed(3)),
            });
            row[key] = {
                ok: true, raw: heard.text, whisperLanguage: heard.language, durationSec: heard.durationSec, whisperMs,
                tidy: tidy.text, cleaned: tidy.cleaned, unclear: tidy.unclear, tidyLanguage: tidy.language, cleanupModel: tidy.model,
                cleanupFailures: tidy.failures, cleanupMs, tokensIn: tidy.tokensIn, tokensOut: tidy.tokensOut,
                rawMetrics: measure(heard.text), tidyMetrics: measure(tidy.text),
            };
            console.log(`${String(c.id).padStart(2)} ${key.padEnd(5)} ${heard.ok ? 'ok' : 'FAIL'}  recall raw ${M.keyRecall(heard.text, c.mustKeep).kept}/${c.mustKeep.length} → tidy ${M.keyRecall(tidy.text, c.mustKeep).kept}/${c.mustKeep.length}  ${whisperMs} ms + ${cleanupMs} ms`);
            if (!reuseDir) await sleep(WHISPER_GAP_MS);
        }
        rows.push(row);
    }

    // ── 3. rubric on the production path (large-v3): raw vs tidy ──
    if (!flag('no-grade')) {
        console.log('\nGrading (raw vs tidy, large-v3)…');
        for (const row of rows) {
            const v3 = row.v3 as { ok: boolean; raw?: string; tidy?: string } | undefined;
            if (!v3?.ok) continue;
            // The raw text is the same in a reused run, so its grade is carried over rather than paid for again.
            const priorRaw = prior.get(row.id)?.v3?.gradeRaw;
            (row.v3 as Record<string, unknown>).gradeRaw = priorRaw ?? await grade(String(row.truth), v3.raw!);
            (row.v3 as Record<string, unknown>).gradeTidy = await grade(String(row.truth), v3.tidy!);
            const g = row.v3 as { gradeRaw: Grade; gradeTidy: Grade };
            console.log(`${String(row.id).padStart(2)} raw ${g.gradeRaw.score ?? 'x'}  tidy ${g.gradeTidy.score ?? 'x'}`);
        }
    }

    // ── 4. the brain's understanding: typed truth vs raw vs tidy (large-v3) ──
    if (!flag('no-brain')) {
        console.log('\nBrain understanding (truth / raw / tidy)…');
        const intentOf = async (text: string) => {
            try {
                const r = await runBrain(text, world('default'), { llm, skipReply: true });
                return { intent: r.interpretation?.intent ?? null, outcome: r.decision?.outcome ?? null, status: r.status };
            } catch (err) { return { intent: null, outcome: null, status: 'error', error: err instanceof Error ? err.message : String(err) }; }
        };
        for (const row of rows) {
            const v3 = row.v3 as { ok: boolean; raw?: string; tidy?: string } | undefined;
            row.brain = {
                truth: await intentOf(String(row.truth)),
                raw: v3?.ok ? await intentOf(v3.raw!) : null,
                tidy: v3?.ok ? await intentOf(v3.tidy!) : null,
            };
            const b = row.brain as Record<string, { intent: string | null } | null>;
            console.log(`${String(row.id).padStart(2)} expected ${row.brainExpected ?? '(none)'}  truth ${b.truth?.intent}  raw ${b.raw?.intent}  tidy ${b.tidy?.intent}`);
        }
    }
    console.warn = warn;

    fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify(rows, null, 2));
    console.log(`\nWrote ${path.join(outDir, 'results.json')}`);
}

main().catch(err => { console.error(err instanceof Error ? err.message : err); process.exit(1); });
