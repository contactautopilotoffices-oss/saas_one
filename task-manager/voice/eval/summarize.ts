/**
 * Voice Note Intake — Phase 5: turns a results.json from run_voice_eval.ts into report.md (no network, no keys).
 *   npx tsx task-manager/voice/eval/summarize.ts <results folder>
 */
import fs from 'node:fs';
import path from 'node:path';
import { mean, median } from './metrics';

interface Metrics { devanagari: boolean; recall: { kept: number; total: number; missing: string[] }; wer: number; cer: number }
interface Grade { score: number | null; reasoning: string; error?: string }
interface Tier {
    ok: boolean; reason?: string; raw?: string; tidy?: string; cleaned?: boolean; unclear?: boolean; whisperMs: number; cleanupMs?: number;
    whisperLanguage?: string | null; rawMetrics?: Metrics; tidyMetrics?: Metrics; tokensIn?: number; tokensOut?: number; cleanupModel?: string | null;
    gradeRaw?: Grade; gradeTidy?: Grade;
}
interface Row {
    id: number; language: string; truth: string; brainExpected: string | null; v3?: Tier; turbo?: Tier;
    brain?: Record<'truth' | 'raw' | 'tidy', { intent: string | null } | null>;
}

const dir = process.argv[2];
if (!dir) { console.error('usage: summarize.ts <results folder>'); process.exit(1); }
const rows = JSON.parse(fs.readFileSync(path.join(dir, 'results.json'), 'utf8')) as Row[];
const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)}%` : '—');
const f2 = (n: number) => n.toFixed(2);
const LANGS = ['English', 'Hinglish', 'Hindi', 'All'];
const pick = (lang: string) => rows.filter(r => lang === 'All' || r.language === lang);

const lines: string[] = [];
const out = (s = '') => lines.push(s);
out('# Voice Note Intake — evaluation report');
out();
out(`Samples: ${rows.length} (owner-recorded, tests/voice_samples). Generated from \`results.json\` by \`summarize.ts\`.`);
out();

for (const tier of ['v3', 'turbo'] as const) {
    out(`## Whisper ${tier === 'v3' ? 'large-v3' : 'large-v3-turbo'}`);
    out();
    out('| Language | n | failed | Devanagari raw | Key details raw | Key details tidy | WER raw | WER tidy | CER raw | CER tidy | Whisper ms (median) | Tidy ms (median) |');
    out('|---|---|---|---|---|---|---|---|---|---|---|---|');
    for (const lang of LANGS) {
        const rs = pick(lang);
        const ok = rs.map(r => r[tier]).filter((t): t is Tier => !!t?.ok);
        const kept = (k: 'rawMetrics' | 'tidyMetrics') => ok.reduce((s, t) => s + t[k]!.recall.kept, 0);
        const total = ok.reduce((s, t) => s + t.rawMetrics!.recall.total, 0);
        const roman = ok.filter(t => !t.rawMetrics!.devanagari);
        out(`| ${lang} | ${rs.length} | ${rs.length - ok.length} | ${ok.length - roman.length} | ${kept('rawMetrics')}/${total} (${pct(kept('rawMetrics'), total)}) | ${kept('tidyMetrics')}/${total} (${pct(kept('tidyMetrics'), total)}) | ${roman.length ? f2(mean(roman.map(t => t.rawMetrics!.wer))) : '—'}${roman.length < ok.length ? '*' : ''} | ${f2(mean(ok.map(t => t.tidyMetrics!.wer)))} | ${roman.length ? f2(mean(roman.map(t => t.rawMetrics!.cer))) : '—'}${roman.length < ok.length ? '*' : ''} | ${f2(mean(ok.map(t => t.tidyMetrics!.cer)))} | ${Math.round(median(ok.map(t => t.whisperMs)))} | ${Math.round(median(ok.map(t => t.cleanupMs ?? 0)))} |`);
    }
    out();
    out('\\* raw WER/CER only over transcripts in Roman letters (a Devanagari transcript cannot be compared letter by letter with a Roman truth).');
    out();
}

const graded = rows.filter(r => r.v3?.gradeRaw || r.v3?.gradeTidy);
if (graded.length) {
    out('## Rubric (large-v3; grader openai/gpt-oss-120b; 0–3, reasoning before score)');
    out();
    out('| Language | n | Raw mean | Tidy mean | Tidy = 3 | Tidy ≤ 1 |');
    out('|---|---|---|---|---|---|');
    for (const lang of LANGS) {
        const rs = graded.filter(r => lang === 'All' || r.language === lang);
        const raw = rs.map(r => r.v3!.gradeRaw?.score).filter((s): s is number => typeof s === 'number');
        const tidy = rs.map(r => r.v3!.gradeTidy?.score).filter((s): s is number => typeof s === 'number');
        out(`| ${lang} | ${rs.length} | ${raw.length ? f2(mean(raw)) : '—'} | ${tidy.length ? f2(mean(tidy)) : '—'} | ${tidy.filter(s => s === 3).length} | ${tidy.filter(s => s <= 1).length} |`);
    }
    out();
}

const braind = rows.filter(r => r.brain);
if (braind.length) {
    const scored = braind.filter(r => r.brainExpected);
    const hit = (k: 'truth' | 'raw' | 'tidy') => scored.filter(r => r.brain![k]?.intent === r.brainExpected).length;
    out('## Brain understanding (intent), large-v3');
    out();
    out(`Scored on the ${scored.length} samples whose request the brain supports (${braind.length - scored.length} have no brain intent today: reported below, not scored).`);
    out();
    out('| Input | Right intent |');
    out('|---|---|');
    out(`| Typed truth (ceiling) | ${hit('truth')}/${scored.length} (${pct(hit('truth'), scored.length)}) |`);
    out(`| Raw Whisper | ${hit('raw')}/${scored.length} (${pct(hit('raw'), scored.length)}) |`);
    out(`| Tidy text | ${hit('tidy')}/${scored.length} (${pct(hit('tidy'), scored.length)}) |`);
    out();
}

out('## Per sample (large-v3)');
out();
out('| # | Lang | Truth | Raw Whisper | Tidy | Key details raw→tidy | Missing after tidy | Grade raw→tidy | Brain exp / truth / raw / tidy |');
out('|---|---|---|---|---|---|---|---|---|');
const esc = (s: unknown) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
for (const r of rows) {
    const t = r.v3;
    if (!t?.ok) { out(`| ${r.id} | ${r.language} | ${esc(r.truth)} | FAILED: ${esc(t?.reason)} | | | | | |`); continue; }
    out(`| ${r.id} | ${r.language} | ${esc(r.truth)} | ${esc(t.raw)} | ${esc(t.tidy)}${t.cleaned ? '' : ' *(not tidied)*'} | ${t.rawMetrics!.recall.kept}→${t.tidyMetrics!.recall.kept}/${t.tidyMetrics!.recall.total} | ${esc(t.tidyMetrics!.recall.missing.join(', '))} | ${t.gradeRaw?.score ?? '—'}→${t.gradeTidy?.score ?? '—'} | ${r.brainExpected ?? '(none)'} / ${r.brain?.truth?.intent ?? '—'} / ${r.brain?.raw?.intent ?? '—'} / ${r.brain?.tidy?.intent ?? '—'} |`);
}
out();
out('## Grader reasoning (tidy text, large-v3)');
out();
for (const r of rows) if (r.v3?.gradeTidy) out(`- **${r.id}** (${r.v3.gradeTidy.score ?? 'x'}): ${esc(r.v3.gradeTidy.reasoning || r.v3.gradeTidy.error)}`);
out();
out('## Tokens');
out();
for (const tier of ['v3', 'turbo'] as const) {
    const ok = rows.map(r => r[tier]).filter((t): t is Tier => !!t?.ok);
    out(`- Tidy-up after ${tier === 'v3' ? 'large-v3' : 'turbo'}: ${ok.reduce((s, t) => s + (t.tokensIn ?? 0), 0)} in / ${ok.reduce((s, t) => s + (t.tokensOut ?? 0), 0)} out over ${ok.length} notes; not tidied: ${ok.filter(t => !t.cleaned).length}; models: ${[...new Set(ok.map(t => t.cleanupModel ?? 'none'))].join(', ')}.`);
}

fs.writeFileSync(path.join(dir, 'report.md'), lines.join('\n') + '\n');
console.log(`Wrote ${path.join(dir, 'report.md')}`);
