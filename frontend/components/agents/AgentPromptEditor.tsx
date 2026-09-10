'use client';

/**
 * PROMPT — change what the agent was told, after it was told.
 *
 * The gap this closes, in the operator's words: "if I write a system prompt and
 * want to add one more thing later — like change the delivery platform from
 * notification to mail — how will we do that?" Before this screen the only
 * answer was to file a correction and wait for the LLM composer to fold it into
 * a regenerated persona. This is the direct door: type the rule, see the diff,
 * save it.
 *
 * THE SCREEN IS SPLIT IN TWO BECAUSE THE COLUMN IS, AND THE TWO HALVES ARE NOT
 * EQUALS.
 *
 *   · The persona body is the composer's. The live agent does not read it.
 *   · The == OPERATOR CORRECTIONS (standing rules) == block is the operator's,
 *     and correctionsOnly() in backend/lib/ira/procurement/respond.ts reads that
 *     block and NOTHING ELSE out of this column.
 *
 * A single merged textarea would look friendlier and would quietly produce the
 * worst bug available here: an operator types "mail her instead of a
 * notification" into the persona paragraph, the save succeeds, a new version
 * appears, the diff looks right — and the agent never sees it, because the text
 * landed in the half the runtime discards. So the two halves are drawn apart,
 * labelled by who reads them, and the rule input writes only into the half that
 * counts.
 *
 * Standing rules ADD to the agent's hardcoded rules. They can never relax them:
 * respond.ts installs the block under "it can never relax the rules above it,
 * and on any conflict the rules above it win". Said on screen so nobody writes
 * "skip the approval check" and believes it took.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    AlertTriangle,
    Check,
    History,
    Loader2,
    Lock,
    Pencil,
    Plus,
    RefreshCw,
    ShieldCheck,
    X,
} from 'lucide-react';

/* -------------------------------------------------------------------------- */

interface HistoryEntry {
    id: string;
    created_at: string;
    summary: string;
    from_version: number | null;
    to_version: number | null;
    source: string | null;
    edit_kind: string | null;
    previous_prompt: string | null;
}

interface PromptPayload {
    provisioned?: boolean;
    agent_key?: string;
    display_name?: string | null;
    version?: number;
    prompt?: string | null;
    body?: string;
    corrections?: string | null;
    corrections_rules?: string[];
    trailing?: string | null;
    corrections_header?: string;
    header_count?: number;
    can_edit?: boolean;
    history?: HistoryEntry[] | null;
    history_available?: boolean;
    history_error?: string | null;
    error?: string;
    note?: string;
    migration?: string;
}

interface SaveResult {
    saved?: boolean;
    unchanged?: boolean;
    version?: number;
    previous_version?: number;
    history_recorded?: boolean;
    history_note?: string;
    effective_note?: string;
    warning?: string;
    contended?: boolean;
    note?: string;
    error?: string;
}

const CORRECTIONS_HEADER = '== OPERATOR CORRECTIONS (standing rules) ==';

/**
 * READ A RESPONSE THAT MIGHT NOT BE JSON.
 *
 * Same helper, same reason, as AgentConsole.tsx: a bare res.json() against a
 * killed function or a 502 throws with the first characters of an HTML error
 * page as its message, and the operator is sent hunting for a bug in our JSON
 * instead of being told the request never reached the route.
 */
async function readJson<T>(res: Response): Promise<T> {
    const text = await res.text();
    try {
        return JSON.parse(text) as T;
    } catch {
        const head = text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
        throw new Error(
            res.status === 504 || /timeout/i.test(head)
                ? `The server took too long and was cut off (HTTP ${res.status}). Try again.`
                : `The server replied with ${res.status} and not JSON${head ? `: ${head}` : '.'}`,
        );
    }
}

/* -------------------------------------------------------------------------- */
/* Diff — "show what changed before saving"                                    */
/* -------------------------------------------------------------------------- */

type DiffLine = { kind: 'same' | 'add' | 'del'; text: string };

/**
 * Line-level LCS. Prompts are hundreds of lines at most, so the quadratic table
 * is free, and a naive index-by-index compare would render a one-line insert as
 * "every line below it changed" — which is exactly the diff nobody reads, and an
 * unread diff is the same as no diff.
 */
function diffLines(before: string, after: string): DiffLine[] {
    const a = before.split('\n');
    const b = after.split('\n');
    const n = a.length;
    const m = b.length;

    const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--) {
        for (let j = m - 1; j >= 0; j--) {
            lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
        }
    }

    const out: DiffLine[] = [];
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
        if (a[i] === b[j]) {
            out.push({ kind: 'same', text: a[i] });
            i++;
            j++;
        } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
            out.push({ kind: 'del', text: a[i] });
            i++;
        } else {
            out.push({ kind: 'add', text: b[j] });
            j++;
        }
    }
    while (i < n) out.push({ kind: 'del', text: a[i++] });
    while (j < m) out.push({ kind: 'add', text: b[j++] });
    return out;
}

/** Collapse long runs of unchanged lines so the changes are what you see. */
function condense(lines: DiffLine[], context = 2): Array<DiffLine | { kind: 'gap'; text: string }> {
    const keep = new Set<number>();
    lines.forEach((l, idx) => {
        if (l.kind === 'same') return;
        for (let k = idx - context; k <= idx + context; k++) if (k >= 0 && k < lines.length) keep.add(k);
    });

    const out: Array<DiffLine | { kind: 'gap'; text: string }> = [];
    let skipped = 0;
    lines.forEach((l, idx) => {
        if (keep.has(idx)) {
            if (skipped > 0) {
                out.push({ kind: 'gap', text: `… ${skipped} unchanged line${skipped === 1 ? '' : 's'}` });
                skipped = 0;
            }
            out.push(l);
        } else {
            skipped++;
        }
    });
    if (skipped > 0) out.push({ kind: 'gap', text: `… ${skipped} unchanged line${skipped === 1 ? '' : 's'}` });
    return out;
}

/** Rebuild the whole prompt exactly the way the route's joinPrompt() does. */
function joinPrompt(body: string, corrections: string, trailing: string): string {
    const out: string[] = [body.trimEnd()];
    const block = corrections.trim();
    if (block) out.push('', CORRECTIONS_HEADER, block);
    if (trailing.trim()) out.push('', trailing.trim());
    return out.join('\n').trim();
}

const rulesOf = (block: string) =>
    block
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.startsWith('- '));

/* -------------------------------------------------------------------------- */

export default function AgentPromptEditor({
    orgId,
    agentKey,
    onSaved,
}: {
    orgId: string;
    agentKey: string;
    onSaved?: () => void;
}) {
    const [data, setData] = useState<PromptPayload | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);

    const [newRule, setNewRule] = useState('');
    const [editing, setEditing] = useState(false);
    const [bodyDraft, setBodyDraft] = useState('');
    const [correctionsDraft, setCorrectionsDraft] = useState('');

    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<SaveResult | null>(null);
    const [showHistory, setShowHistory] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        setLoadError(null);
        try {
            const res = await fetch(
                `/api/agents/prompt?orgId=${encodeURIComponent(orgId)}&agentKey=${encodeURIComponent(agentKey)}`,
                { cache: 'no-store' },
            );
            const json = await readJson<PromptPayload>(res);
            if (json.error) {
                setLoadError(json.error);
                setData(null);
                return;
            }
            setData(json);
            setBodyDraft(json.body ?? '');
            setCorrectionsDraft(json.corrections ?? '');
        } catch (e) {
            setLoadError((e as Error).message);
        } finally {
            setLoading(false);
        }
    }, [orgId, agentKey]);

    useEffect(() => {
        void load();
    }, [load]);

    const liveRules = data?.corrections_rules ?? [];
    const canEdit = data?.can_edit ?? false;

    /** What the full prompt would become if the open edit were saved. */
    const nextPrompt = useMemo(
        () => joinPrompt(bodyDraft, correctionsDraft, data?.trailing ?? ''),
        [bodyDraft, correctionsDraft, data?.trailing],
    );

    const dirty = editing && nextPrompt !== (data?.prompt ?? '').trim();

    const diff = useMemo(
        () => (dirty ? condense(diffLines((data?.prompt ?? '').trim(), nextPrompt)) : []),
        [dirty, data?.prompt, nextPrompt],
    );

    /** The one-line append, previewed as the rule the agent will actually read. */
    const previewRule = useMemo(() => {
        const t = newRule.replace(/^[-*•]\s*/, '').replace(/\s+/g, ' ').trim();
        return t ? `- ${t}` : '';
    }, [newRule]);

    const duplicate = previewRule.length > 0 && liveRules.includes(previewRule);

    /* ---- writes -------------------------------------------------------- */

    const addRule = async () => {
        if (!previewRule || duplicate) return;
        setBusy(true);
        setError(null);
        setResult(null);
        try {
            const res = await fetch(`/api/agents/prompt?orgId=${encodeURIComponent(orgId)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ agent_key: agentKey, append: newRule }),
            });
            const json = await readJson<SaveResult>(res);
            if (json.error) {
                setError(json.error);
                return;
            }
            setResult(json);
            setNewRule('');
            await load();
            onSaved?.();
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setBusy(false);
        }
    };

    const savePrompt = async () => {
        setBusy(true);
        setError(null);
        setResult(null);
        try {
            const res = await fetch(`/api/agents/prompt?orgId=${encodeURIComponent(orgId)}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    agent_key: agentKey,
                    system_prompt: nextPrompt,
                    // Sent so a save that would overwrite someone else's newer
                    // rule is refused with a 409 instead of silently winning.
                    expected_version: data?.version ?? 0,
                }),
            });
            const json = await readJson<SaveResult>(res);
            if (json.error) {
                setError(json.error);
                return;
            }
            setResult(json);
            setEditing(false);
            await load();
            onSaved?.();
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setBusy(false);
        }
    };

    /* ---- chrome -------------------------------------------------------- */

    const field =
        'w-full rounded-lg border border-border bg-card px-3 py-2 text-[12.5px] focus:border-primary/40 focus:outline-none';
    const heading =
        'flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-text-tertiary';

    if (loading) {
        return (
            <div className="flex items-center gap-2 rounded-[14px] border border-border bg-card p-4 text-[12px] text-text-tertiary">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Reading the running prompt…
            </div>
        );
    }

    if (loadError) {
        return (
            <div className="rounded-[14px] border border-rose-200 bg-rose-50 p-4">
                <p className="text-[12px] text-rose-700">{loadError}</p>
                <button
                    type="button"
                    onClick={() => void load()}
                    className="mt-2 inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-rose-700 underline"
                >
                    <RefreshCw className="h-3 w-3" /> Try again
                </button>
            </div>
        );
    }

    if (data?.provisioned === false) {
        return (
            <div className="rounded-[14px] border border-border bg-card p-4">
                <p className="text-[12px] text-text-secondary">
                    {data.note ?? `Not provisioned yet — run migration ${data.migration ?? ''}.`}
                </p>
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-4">
            {/* ---- what reads what ------------------------------------------ */}
            <section className="rounded-[14px] border border-border bg-card p-4">
                <div className="flex items-start justify-between gap-3">
                    <div>
                        <h4 className={heading}>
                            <ShieldCheck className="h-3.5 w-3.5" /> System prompt
                        </h4>
                        <p className="mt-1 text-[11.5px] leading-relaxed text-text-secondary">
                            Two halves, two owners. The <b>persona body</b> is what the composer wrote. The{' '}
                            <b>standing rules</b> are yours — and they are the only part of this prompt the
                            running agent reads.
                        </p>
                    </div>
                    <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[10.5px] font-semibold text-text-tertiary">
                        v{data?.version ?? 0}
                    </span>
                </div>

                {!canEdit && (
                    <p className="mt-3 flex items-start gap-1.5 text-[11px] text-text-tertiary">
                        <Lock className="mt-0.5 h-3 w-3 shrink-0" />
                        Read-only: changing what an agent was told needs an organization admin role.
                    </p>
                )}

                {(data?.header_count ?? 0) > 1 && (
                    <div className="mt-3 flex items-start gap-2 rounded-[10px] border border-amber-200 bg-amber-50 px-3 py-2">
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
                        <p className="text-[11.5px] leading-relaxed text-amber-800">
                            This prompt has {data?.header_count} standing-rule blocks. The agent reads the
                            first one and stops at the next <span className="font-mono">== </span> heading, so
                            every rule in the others is dead text. Merge them into one block.
                        </p>
                    </div>
                )}
            </section>

            {/* ---- the operator's half, first: it is the half that acts ------ */}
            <section className="rounded-[14px] border border-border bg-card p-4">
                <h4 className={heading}>
                    <ShieldCheck className="h-3.5 w-3.5" /> Standing rules
                    <span className="font-normal normal-case tracking-normal text-text-tertiary">
                        — read by the agent on every run
                    </span>
                </h4>

                <p className="mt-1.5 text-[11.5px] leading-relaxed text-text-secondary">
                    Rules here are <b>added</b> to the agent&rsquo;s built-in rules. They can never relax
                    them: on any conflict the built-in rules win. A rule that says &ldquo;skip the approval
                    check&rdquo; will be read and will not be obeyed. Use them to add a preference —{' '}
                    <i>&ldquo;send this by mail, not a notification&rdquo;</i> — not to remove a guardrail.
                </p>

                {liveRules.length === 0 ? (
                    <p className="mt-3 rounded-[10px] border border-dashed border-border px-3 py-2.5 text-[11.5px] text-text-tertiary">
                        No standing rules yet. The agent is running on its built-in rules alone.
                    </p>
                ) : (
                    <ul className="mt-3 space-y-1.5">
                        {liveRules.map((r) => (
                            <li
                                key={r}
                                className="rounded-[10px] border border-border bg-background px-3 py-2 text-[12px] leading-relaxed text-text-primary"
                            >
                                {r.replace(/^-\s*/, '')}
                            </li>
                        ))}
                    </ul>
                )}

                {/* ---- add one ---------------------------------------------- */}
                {canEdit && (
                    <div className="mt-3">
                        <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">
                            Add a standing rule
                        </label>
                        <div className="flex gap-2">
                            <input
                                className={field}
                                value={newRule}
                                placeholder="Send the daily scan by mail instead of a notification."
                                onChange={(e) => setNewRule(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' && !busy) void addRule();
                                }}
                            />
                            <button
                                type="button"
                                onClick={() => void addRule()}
                                disabled={busy || !previewRule || duplicate}
                                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-foreground px-3 py-2 text-[12px] font-semibold text-background disabled:opacity-40"
                            >
                                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                                Add rule
                            </button>
                        </div>

                        {/* What changes, before it changes. */}
                        {previewRule && (
                            <div className="mt-2 rounded-[10px] border border-emerald-200 bg-emerald-50 px-3 py-2">
                                <p className="text-[10.5px] font-semibold uppercase tracking-wide text-emerald-700">
                                    {duplicate ? 'Already standing' : 'Will be added to the block, exactly as'}
                                </p>
                                <p className="mt-1 font-mono text-[11.5px] leading-relaxed text-emerald-900">
                                    {previewRule}
                                </p>
                                {duplicate && (
                                    <p className="mt-1 text-[11px] text-emerald-800">
                                        This rule is already in the block — nothing would change.
                                    </p>
                                )}
                            </div>
                        )}
                    </div>
                )}
            </section>

            {/* ---- the composer's half -------------------------------------- */}
            <section className="rounded-[14px] border border-border bg-card p-4">
                <div className="flex items-start justify-between gap-3">
                    <div>
                        <h4 className={heading}>
                            <Pencil className="h-3.5 w-3.5" /> Persona body
                            <span className="font-normal normal-case tracking-normal text-text-tertiary">
                                — the composer&rsquo;s text
                            </span>
                        </h4>
                        <p className="mt-1 text-[11.5px] leading-relaxed text-text-secondary">
                            The runtime does <b>not</b> read this half — it keeps its own hardcoded voice and
                            takes only the standing rules from here. Editing it changes the composed record,
                            not what the agent does next run. Put behaviour changes in the block above.
                        </p>
                    </div>
                    {canEdit && (
                        <button
                            type="button"
                            onClick={() => {
                                setEditing((v) => !v);
                                setBodyDraft(data?.body ?? '');
                                setCorrectionsDraft(data?.corrections ?? '');
                                setError(null);
                            }}
                            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-[11.5px] font-semibold text-text-secondary"
                        >
                            {editing ? <X className="h-3.5 w-3.5" /> : <Pencil className="h-3.5 w-3.5" />}
                            {editing ? 'Cancel' : 'Edit full prompt'}
                        </button>
                    )}
                </div>

                {editing ? (
                    <div className="mt-3 space-y-3">
                        <div>
                            <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">
                                Persona body
                            </label>
                            <textarea
                                rows={14}
                                className={`${field} font-mono text-[11.5px] leading-relaxed`}
                                value={bodyDraft}
                                onChange={(e) => setBodyDraft(e.target.value)}
                            />
                        </div>
                        <div>
                            <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">
                                Standing rules block —{' '}
                                <span className="font-normal normal-case tracking-normal">
                                    one <span className="font-mono">- </span>rule per line
                                </span>
                            </label>
                            <textarea
                                rows={6}
                                className={`${field} font-mono text-[11.5px] leading-relaxed`}
                                value={correctionsDraft}
                                placeholder="- Send the daily scan by mail instead of a notification."
                                onChange={(e) => setCorrectionsDraft(e.target.value)}
                            />
                            <p className="mt-1 text-[10.5px] text-text-tertiary">
                                The <span className="font-mono">{CORRECTIONS_HEADER}</span> heading is written
                                for you — do not type it here, or the agent will read the block twice over and
                                the second one not at all.
                            </p>
                            {rulesOf(correctionsDraft).length !== correctionsDraft.trim().split('\n').filter(Boolean).length && (
                                <p className="mt-1 flex items-start gap-1.5 text-[11px] text-amber-700">
                                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                                    Some lines do not start with <span className="font-mono">- </span>. They
                                    still reach the agent, but the composer&rsquo;s next fold merges rules line
                                    by line and will not recognise them as existing rules.
                                </p>
                            )}
                        </div>
                    </div>
                ) : (
                    <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap rounded-[10px] border border-border bg-background px-3 py-2.5 font-mono text-[11.5px] leading-relaxed text-text-secondary">
                        {data?.body?.trim() || 'No persona body — this agent has never been composed.'}
                    </pre>
                )}
            </section>

            {/* ---- diff + save ---------------------------------------------- */}
            {editing && (
                <section className="rounded-[14px] border border-border bg-card p-4">
                    <h4 className={heading}>What changes</h4>
                    {!dirty ? (
                        <p className="mt-2 text-[11.5px] text-text-tertiary">
                            Nothing yet — the draft is identical to v{data?.version ?? 0}.
                        </p>
                    ) : (
                        <div className="mt-2 max-h-72 overflow-auto rounded-[10px] border border-border bg-background">
                            {diff.map((l, i) => (
                                <div
                                    key={`${i}-${l.text.slice(0, 24)}`}
                                    className={
                                        'whitespace-pre-wrap px-3 py-0.5 font-mono text-[11px] leading-relaxed '
                                        + (l.kind === 'add'
                                            ? 'bg-emerald-50 text-emerald-900'
                                            : l.kind === 'del'
                                              ? 'bg-rose-50 text-rose-900 line-through decoration-rose-300'
                                              : l.kind === 'gap'
                                                ? 'text-text-tertiary italic'
                                                : 'text-text-secondary')
                                    }
                                >
                                    {l.kind === 'add' ? '+ ' : l.kind === 'del' ? '− ' : l.kind === 'gap' ? '' : '  '}
                                    {l.text || ' '}
                                </div>
                            ))}
                        </div>
                    )}

                    <div className="mt-3 flex items-center gap-3">
                        <button
                            type="button"
                            onClick={() => void savePrompt()}
                            disabled={busy || !dirty}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-foreground px-4 py-2 text-[12px] font-semibold text-background disabled:opacity-40"
                        >
                            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                            Save as v{(data?.version ?? 0) + 1}
                        </button>
                        <span className="text-[11px] text-text-tertiary">
                            The outgoing text is archived first, so this version can be read back.
                        </span>
                    </div>
                </section>
            )}

            {/* ---- outcome --------------------------------------------------- */}
            {error && (
                <div className="flex items-start gap-2 rounded-[10px] border border-rose-200 bg-rose-50 px-3 py-2">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-600" />
                    <p className="text-[11.5px] leading-relaxed text-rose-800">{error}</p>
                </div>
            )}

            {result && !error && (
                <div className="rounded-[10px] border border-emerald-200 bg-emerald-50 px-3 py-2">
                    <p className="text-[11.5px] font-semibold text-emerald-900">
                        {result.unchanged
                            ? (result.note ?? 'Nothing changed.')
                            : `Saved as v${result.version} (was v${result.previous_version}).`}
                    </p>
                    {result.effective_note && !result.unchanged && (
                        <p className="mt-0.5 text-[11px] text-emerald-800">{result.effective_note}</p>
                    )}
                    {result.warning && <p className="mt-1 text-[11px] text-amber-800">{result.warning}</p>}
                    {result.history_note && <p className="mt-1 text-[11px] text-amber-800">{result.history_note}</p>}
                </div>
            )}

            {/* ---- history ---------------------------------------------------- */}
            <section className="rounded-[14px] border border-border bg-card p-4">
                <button
                    type="button"
                    onClick={() => setShowHistory((v) => !v)}
                    className={`${heading} w-full justify-start`}
                >
                    <History className="h-3.5 w-3.5" /> Version history
                    <span className="font-normal normal-case tracking-normal text-text-tertiary">
                        {data?.history_available === false
                            ? '— unavailable'
                            : `— ${data?.history?.length ?? 0} recorded`}
                    </span>
                </button>

                {data?.history_error && (
                    <p className="mt-2 text-[11px] text-amber-700">{data.history_error}</p>
                )}

                {showHistory && (data?.history?.length ?? 0) > 0 && (
                    <ul className="mt-3 space-y-2">
                        {data?.history?.map((h) => (
                            <li key={h.id} className="rounded-[10px] border border-border bg-background px-3 py-2">
                                <div className="flex items-baseline justify-between gap-3">
                                    <span className="text-[12px] font-semibold text-text-primary">
                                        v{h.from_version ?? '?'} → v{h.to_version ?? '?'}
                                    </span>
                                    <span className="text-[10.5px] text-text-tertiary">
                                        {new Date(h.created_at).toLocaleString()}
                                    </span>
                                </div>
                                <p className="mt-0.5 text-[11.5px] leading-relaxed text-text-secondary">{h.summary}</p>
                                {h.previous_prompt && (
                                    <details className="mt-1">
                                        <summary className="cursor-pointer text-[11px] font-semibold text-text-tertiary">
                                            The text this version replaced
                                        </summary>
                                        <pre className="mt-1 max-h-56 overflow-auto whitespace-pre-wrap rounded-[8px] border border-border px-2 py-1.5 font-mono text-[10.5px] leading-relaxed text-text-secondary">
                                            {h.previous_prompt}
                                        </pre>
                                    </details>
                                )}
                            </li>
                        ))}
                    </ul>
                )}

                {showHistory && (data?.history?.length ?? 0) === 0 && !data?.history_error && (
                    <p className="mt-2 text-[11.5px] text-text-tertiary">
                        Nothing recorded yet — this prompt has not been changed since the archive existed.
                    </p>
                )}
            </section>
        </div>
    );
}
