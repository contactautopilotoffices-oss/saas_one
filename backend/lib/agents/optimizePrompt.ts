/**
 * PROMPT OPTIMIZER — operator sentence → structured agent brief.
 * -----------------------------------------------------------------------------
 * An operator types how they'd explain the job to a colleague:
 *
 *     "Every morning, look at electricity bills that have been waiting for
 *      approval for more than three days and tell the property admin which
 *      ones are stuck."
 *
 * That is a perfectly good description and a poor agent prompt. It leaves the
 * order of operations implicit, names no terminal state, and uses words ("bills",
 * "stuck") that do not map to any table on their own.
 *
 * ── WHAT "OPTIMIZED" MEANS HERE ─────────────────────────────────────────────
 * Not "longer" and not "more polite". This rewrites toward four specific
 * properties the handbook is explicit about [BAA pp.105, 114]:
 *
 *   1. NUMBERED, ORDERED STEPS. The book's own lead-gen prompt is a numbered
 *      list. Order is stated because the model has none of the common sense that
 *      would supply it.
 *   2. AN EXPLICIT NO-SKIP CLAUSE. "Follow these steps in order, and do not skip
 *      any steps" — spelled out precisely because a human would find it obvious.
 *   3. A TERMINAL STATE WRITTEN TO DATA. The book ends its emailing prompt with
 *      "update the contact to have a lead status of Connected so we know that you
 *      have sent the email" — so the run is auditable from the records, not the
 *      logs.
 *   4. REAL VOCABULARY. "electricity bills" becomes the module and tables this
 *      org actually has, so the composer downstream can bind them.
 *
 * ── GROUNDING, AND WHY THE MODEL IS NOT TRUSTED ─────────────────────────────
 * The model is given the module list and the table catalog and told to use only
 * those names. It is not believed: every table it cites is re-checked against the
 * catalog afterwards, and anything invented is stripped out of `grounded_in` and
 * reported in `rejected`. Same closed-set posture as composeAgent().
 *
 * INTENT IS PRESERVED. The optimizer may sharpen wording and make order explicit.
 * It may NOT widen scope, add steps the operator did not ask for, or invent
 * thresholds. A prompt that quietly grew an extra responsibility is worse than
 * the vague one it replaced, because nobody reviews what they did not write.
 */

import { councilChat, isMockLlm } from '@/backend/lib/council/llm';
import { extractJsonObject } from '@/backend/lib/agents/compose';

export interface OptimizeModule {
    key: string;
    label: string;
    description: string;
}

export interface OptimizeTable {
    name: string;
    domain: string;
    purpose: string;
}

export interface OptimizePromptInput {
    description: string;
    modules: ReadonlyArray<OptimizeModule>;
    tables: ReadonlyArray<OptimizeTable>;
    /** Cap on how much catalog goes into the prompt. */
    maxTables?: number;
}

export interface OptimizePromptResult {
    /** The rewritten brief. This is what replaces the textarea. */
    optimized: string;
    /** Short, human-readable notes on what was changed and why. */
    changes: string[];
    /** Real table names the rewrite binds to. Verified against the catalog. */
    grounded_in: string[];
    /** Module slug it belongs to, or null when genuinely unclear. */
    module: string | null;
    /** Table names the model invented. Always stripped, always reported. */
    rejected: string[];
    /** Questions the rewrite could not resolve without the operator. */
    open_questions: string[];
    mocked: boolean;
}

const MAX_TABLES_IN_PROMPT = 140;

function buildSystemPrompt(modules: ReadonlyArray<OptimizeModule>, tables: ReadonlyArray<OptimizeTable>): string {
    const moduleList = modules.map((m) => `  ${m.key} — ${m.label}: ${m.description}`).join('\n');
    const tableList = tables.map((t) => `  ${t.name} [${t.domain}] — ${t.purpose}`).join('\n');

    return `You rewrite an operator's plain-English description of a facility-management agent into a structured agent brief.

This is a facility management system (FMS). These are the ONLY modules that exist:
${moduleList}

These are the ONLY tables that exist. Never name a table outside this list:
${tableList}

Rewrite the operator's description so it has ALL of the following:
1. A one-line statement of the agent's job.
2. Numbered steps in the order they must happen.
3. The literal sentence "Follow these steps in order, and do not skip any steps."
4. A terminal state: what must be TRUE IN THE DATA when the run is done, so the work is auditable from records rather than logs.
5. FMS vocabulary — refer to the real modules and tables above by name where the operator used loose words.

HARD RULES:
- Preserve the operator's intent exactly. Do NOT add responsibilities, steps or scope they did not ask for.
- Do NOT invent thresholds, dates, values, site names or amounts. If one is missing, put it in open_questions instead of guessing.
- Do NOT name any table that is not in the list above.
- Keep it under 220 words. A brief, not an essay.

Return ONLY a JSON object:
{
  "optimized": "the rewritten brief",
  "changes": ["short note on each substantive change"],
  "grounded_in": ["table_name", ...],
  "module": "one module key or null",
  "open_questions": ["anything you refused to guess"]
}`;
}

/** Deterministic stub for COUNCIL_MOCK_LLM=1 — shaped correctly, honestly labelled. */
function mockResult(input: OptimizePromptInput): OptimizePromptResult {
    return {
        optimized:
            `${input.description.trim()}\n\n` +
            'Follow these steps in order, and do not skip any steps.\n\n' +
            '(Mock mode — COUNCIL_MOCK_LLM=1. No model was called, so this is your ' +
            'original text with the required clause appended, not a real rewrite.)',
        changes: ['Mock mode: no model ran, so nothing was actually rewritten.'],
        grounded_in: [],
        module: null,
        rejected: [],
        open_questions: [],
        mocked: true,
    };
}

export async function optimizePrompt(input: OptimizePromptInput): Promise<OptimizePromptResult> {
    const description = (input.description ?? '').trim();
    if (!description) throw new Error('Nothing to optimize.');
    if (isMockLlm()) return mockResult(input);

    const tables = input.tables.slice(0, input.maxTables ?? MAX_TABLES_IN_PROMPT);
    const raw = await councilChat(
        [
            { role: 'system', content: buildSystemPrompt(input.modules, tables) },
            { role: 'user', content: description },
        ],
        'opinion' as never,
    );

    const parsed = extractJsonObject(raw) as Record<string, unknown> | null;
    if (!parsed || typeof parsed !== 'object') {
        throw new Error('The model did not return a usable JSON envelope.');
    }

    const optimized = typeof parsed.optimized === 'string' ? parsed.optimized.trim() : '';
    if (!optimized) throw new Error('The model returned no rewritten brief.');

    const asStrings = (v: unknown): string[] =>
        Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0) : [];

    // Closed-set enforcement. The model is not believed about table names.
    const known = new Set(input.tables.map((t) => t.name.toLowerCase()));
    const claimed = asStrings(parsed.grounded_in);
    const grounded_in = claimed.filter((t) => known.has(t.toLowerCase()));
    const rejected = claimed.filter((t) => !known.has(t.toLowerCase()));

    const moduleKeys = new Set(input.modules.map((m) => m.key));
    const moduleRaw = typeof parsed.module === 'string' ? parsed.module.trim() : '';
    const module = moduleKeys.has(moduleRaw) ? moduleRaw : null;

    const open_questions = asStrings(parsed.open_questions);
    if (rejected.length) {
        open_questions.push(
            `Dropped ${rejected.length} table name${rejected.length > 1 ? 's' : ''} this org does not have: ${rejected.join(', ')}.`,
        );
    }

    return {
        optimized,
        changes: asStrings(parsed.changes),
        grounded_in,
        module,
        rejected,
        open_questions,
        mocked: false,
    };
}
