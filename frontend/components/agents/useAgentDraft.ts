'use client';

/**
 * useAgentDraft — save progress and resume, for the agent composer.
 *
 * THE PROBLEM THIS SOLVES
 * The composer is a one-shot form. You describe an agent, wait ~30s for a model
 * round-trip, read its open questions, go away and think about them — and if the
 * tab closes, the session refreshes or you navigate to another module, all of it
 * is gone. There is no list of work in progress and no way back to it.
 *
 * This hook owns that state and keeps it on the server, autosaved.
 *
 * TWO RULES IT WILL NOT BREAK
 *
 *  1. NEVER LOSE TYPED WORK. A failed save does NOT clear `current` and does NOT
 *     advance `lastSavedAt`; it sets `error` and leaves the local copy exactly as
 *     the operator left it, so the next keystroke retries. Silent loss is the
 *     failure this whole feature exists to prevent, and a save path that
 *     optimistically forgets is that failure wearing a different hat.
 *
 *  2. AUTOSAVE IS DEBOUNCED AND VALUE-COMPARED. See the AUTOSAVE section — this
 *     is where the bug documented in AgentDelivery.tsx:52-62 gets reintroduced if
 *     anyone depends on object identity instead of the serialised value.
 *
 * The console owns the UI; this hook owns nothing but the draft and the network.
 * It is deliberately import-free of AgentConsole so either can change alone.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/** Roughly a pause in typing, not a keystroke. */
const AUTOSAVE_MS = 2_000;

/* ========================================================================== */
/* Shapes                                                                     */
/* ========================================================================== */

export type AgentDraftStatus = 'describing' | 'proposed' | 'applied' | 'abandoned';

/** The composition in progress, as the composer holds it. */
export interface AgentDraft {
    /** Minted on the first save. Stable for the life of one composing session. */
    id: string | null;
    /** null = a brand-new agent. Set = editing an existing one. */
    agent_key: string | null;
    /** Usually the proposed display_name once there is a proposal. */
    title: string | null;
    description: string;
    /** Keyed by open-question TEXT — never by position. See the migration. */
    answers: Record<string, string>;
    /** The last /api/agents/compose proposal, verbatim. Never recomputed. */
    proposal: unknown;
    /** The last /api/agents/plan output, verbatim. */
    plan: unknown;
    status: AgentDraftStatus;
}

/** One row in the "work in progress" list. */
export interface AgentDraftListRow {
    id: string;
    agent_key: string | null;
    title: string;
    snippet: string;
    status: AgentDraftStatus;
    is_new_agent: boolean;
    answered_count: number;
    created_at: string;
    updated_at: string;
}

export interface UseAgentDraft {
    /** Resumable drafts, newest first. NULL = the list could not be read. */
    drafts: AgentDraftListRow[] | null;
    /** The composition currently in hand, or null when nothing is being composed. */
    current: AgentDraft | null;
    /**
     * Merge a patch into the current draft and schedule a debounced save.
     * Call it on every change; it decides whether anything actually needs
     * writing. Pass `{ flush: true }` to write immediately (e.g. right before
     * the operator navigates away).
     */
    save: (patch: Partial<AgentDraft>, opts?: { flush?: boolean }) => void;
    /** Load one draft in full and make it `current`. Resolves to it, or null. */
    resume: (id: string) => Promise<AgentDraft | null>;
    /** Delete a draft. Omit the id to discard whatever is currently in hand. */
    discard: (id?: string) => Promise<boolean>;
    saving: boolean;
    /** When the server last confirmed a write. NULL = nothing saved this session. */
    lastSavedAt: Date | null;
    /** Surfaced, never swallowed. A set error means the local copy is unsaved. */
    error: string | null;
    /**
     * FALSE = the drafts table is not there yet (migration unapplied). The
     * composer must keep working exactly as it does today; it simply cannot
     * offer save/resume. NULL = not yet determined.
     */
    provisioned: boolean | null;
    /** Discard the in-hand draft locally without deleting the saved row. */
    clear: () => void;
    /** Re-read the list. */
    refresh: () => Promise<void>;
}

/* ========================================================================== */
/* Helpers                                                                    */
/* ========================================================================== */

/**
 * READ A RESPONSE THAT MIGHT NOT BE JSON.
 *
 * Same rule as AgentConsole's readJson: a bare res.json() against a killed
 * function, a 502 or a rate limiter throws with the first characters of an HTML
 * page as the message — "Unexpected token 'A', "An error o"... is not valid
 * JSON" — which tells the operator nothing and, here, would look exactly like
 * their draft failing to save for an unknowable reason.
 */
async function readJson<T>(res: Response): Promise<T> {
    const text = await res.text();
    try {
        return JSON.parse(text) as T;
    } catch {
        const head = text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
        throw new Error(
            res.status === 504 || /timeout/i.test(head)
                ? `The server took too long and was cut off (HTTP ${res.status}).`
                : `The server replied with ${res.status} and not JSON${head ? `: ${head}` : '.'}`,
        );
    }
}

const EMPTY_DRAFT: AgentDraft = {
    id: null,
    agent_key: null,
    title: null,
    description: '',
    answers: {},
    proposal: null,
    plan: null,
    status: 'describing',
};

/**
 * The value that decides whether a save is needed. `id` is excluded on purpose:
 * minting the id IS a consequence of the first save, so including it would make
 * every successful save look like a fresh change and autosave would never
 * settle.
 */
function fingerprint(d: AgentDraft): string {
    return JSON.stringify({
        agent_key: d.agent_key,
        title: d.title,
        description: d.description,
        answers: d.answers,
        proposal: d.proposal,
        plan: d.plan,
        status: d.status,
    });
}

/** An empty draft is not work. Autosaving one would litter the list with blanks. */
function worthSaving(d: AgentDraft): boolean {
    return Boolean(d.description.trim() || d.proposal || d.plan || Object.keys(d.answers).length);
}

function randomId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    // Older Safari has crypto but not randomUUID. The id only has to be a valid
    // uuid the server will accept as a primary key; uniqueness is per-user.
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
}

interface DraftsListResponse {
    ok?: boolean;
    provisioned?: boolean | null;
    drafts?: AgentDraftListRow[] | null;
    note?: string;
    error?: string;
}

interface DraftOneResponse {
    ok?: boolean;
    provisioned?: boolean | null;
    saved?: boolean;
    draft?: (Partial<AgentDraft> & { id?: string }) | null;
    note?: string;
    error?: string;
}

/* ========================================================================== */
/* The hook                                                                   */
/* ========================================================================== */

export function useAgentDraft(orgId: string): UseAgentDraft {
    const [drafts, setDrafts] = useState<AgentDraftListRow[] | null>(null);
    const [current, setCurrent] = useState<AgentDraft | null>(null);
    const [saving, setSaving] = useState(false);
    const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [provisioned, setProvisioned] = useState<boolean | null>(null);

    /**
     * The fingerprint of the last value the SERVER confirmed. Everything hangs
     * off this: a value equal to it needs no save, and it is only ever advanced
     * by a write that came back saved:true. A failed save leaves it alone, which
     * is what makes the next keystroke retry instead of dropping the change.
     */
    const savedPrint = useRef<string | null>(null);

    /** Read by the debounce timer, which must not re-arm when `current` changes. */
    const currentRef = useRef<AgentDraft | null>(null);
    useEffect(() => {
        currentRef.current = current;
    }, [current]);

    /** Guards against a stale response from a previous org overwriting state. */
    const orgRef = useRef(orgId);
    useEffect(() => {
        orgRef.current = orgId;
    }, [orgId]);

    /* ------------------------------------------------------------ the list */

    const refresh = useCallback(async () => {
        if (!orgId) return;
        try {
            const res = await fetch(`/api/agents/drafts?orgId=${encodeURIComponent(orgId)}`, { cache: 'no-store' });
            const json = await readJson<DraftsListResponse>(res);
            if (orgRef.current !== orgId) return;

            setProvisioned(json.provisioned ?? null);
            // `drafts: null` means the read FAILED — not "you have nothing
            // saved". It is passed straight through so the UI can say so.
            setDrafts(json.drafts ?? null);
            setError(json.error ?? null);
        } catch (e) {
            if (orgRef.current !== orgId) return;
            setDrafts(null);
            setError((e as Error).message);
        }
    }, [orgId]);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    /* ------------------------------------------------------------- the write */

    /**
     * Write whatever is currently in hand. Returns true only when the server
     * confirmed it. Deliberately depends on nothing but `orgId`, so its identity
     * is stable and the autosave effect below cannot be re-armed by it.
     */
    const flush = useCallback(async (): Promise<boolean> => {
        const draft = currentRef.current;
        if (!orgId || !draft || !worthSaving(draft)) return false;

        const print = fingerprint(draft);
        if (print === savedPrint.current) return true;

        setSaving(true);
        try {
            const res = await fetch(`/api/agents/drafts?orgId=${encodeURIComponent(orgId)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: draft.id ?? undefined,
                    agent_key: draft.agent_key,
                    title: draft.title,
                    description: draft.description,
                    answers: draft.answers,
                    proposal: draft.proposal,
                    plan: draft.plan,
                    status: draft.status,
                }),
            });
            const json = await readJson<DraftOneResponse>(res);
            if (orgRef.current !== orgId) return false;

            if (json.provisioned === false) {
                // The migration is not applied. This is a KNOWN state, not a
                // failure of the operator's work: the composer carries on, the
                // draft stays in memory, and nothing claims to have been saved.
                setProvisioned(false);
                setError(json.note ?? 'Drafts are not provisioned yet — nothing is being saved between sessions.');
                return false;
            }

            if (!json.saved || json.error) {
                // savedPrint is NOT advanced, so the local copy stays dirty and
                // the next change retries. The operator sees the reason.
                setError(json.error ?? 'The draft could not be saved. Your work is still here — it is not yet stored.');
                return false;
            }

            setProvisioned(true);
            savedPrint.current = print;
            setLastSavedAt(new Date());
            setError(null);

            // The server minted the id on the first save; adopt it so the next
            // autosave updates this row instead of inserting a second one.
            const assignedId = json.draft?.id;
            if (assignedId && !draft.id) {
                setCurrent((d) => (d && !d.id ? { ...d, id: assignedId } : d));
            }
            void refresh();
            return true;
        } catch (e) {
            if (orgRef.current === orgId) setError((e as Error).message);
            return false;
        } finally {
            if (orgRef.current === orgId) setSaving(false);
        }
    }, [orgId, refresh]);

    /* ---------------------------------------------------------- AUTOSAVE */

    /**
     * DEBOUNCED, AND VALUE-COMPARED. Both halves matter.
     *
     * The bug this is written against is documented at AgentDelivery.tsx:52-62:
     * an effect that depended on an OBJECT whose identity changed every render
     * fired constantly and wiped the field being typed. Here the same mistake
     * would be worse — it would POST on every keystroke and, on a slow network,
     * land out of order.
     *
     * So the dependency is `print`, a STRING derived from the draft's value. A
     * re-render that produces an identical draft produces an identical string
     * and this effect does not re-run at all. When the value genuinely changes,
     * the previous timer is cleared and a new 2s one starts, so a burst of
     * typing results in exactly one write.
     *
     * `flush` and `orgId` are the only other dependencies, and `flush` is
     * memoised on `orgId` alone — if it were memoised on `current`, every
     * keystroke would re-arm the timer through the back door and the debounce
     * would be decorative.
     */
    const print = useMemo(() => (current ? fingerprint(current) : null), [current]);

    useEffect(() => {
        if (!orgId || print === null) return;
        // Unchanged since the last confirmed write: nothing to do. This is the
        // "must not fire on an unchanged value" rule, and it is also what stops
        // resume() from immediately re-saving what it just loaded.
        if (print === savedPrint.current) return;

        const t = setTimeout(() => {
            void flush();
        }, AUTOSAVE_MS);
        return () => clearTimeout(t);
    }, [orgId, print, flush]);

    /* -------------------------------------------------------------- save() */

    const save = useCallback(
        (patch: Partial<AgentDraft>, opts?: { flush?: boolean }) => {
            setCurrent((prev) => {
                const base = prev ?? { ...EMPTY_DRAFT, id: randomId() };
                const next: AgentDraft = { ...base, ...patch };
                // An id is minted locally rather than waiting for the server, so
                // two autosaves racing on a slow link update one row instead of
                // inserting two.
                if (!next.id) next.id = randomId();
                return next;
            });
            // An explicit flush cannot read the state React has not committed
            // yet, so it runs on the next tick, by which point currentRef holds
            // the merged value.
            if (opts?.flush) setTimeout(() => void flush(), 0);
        },
        [flush],
    );

    /* ------------------------------------------------------------ resume() */

    const resume = useCallback(
        async (id: string): Promise<AgentDraft | null> => {
            if (!orgId || !id) return null;
            try {
                const res = await fetch(
                    `/api/agents/drafts?orgId=${encodeURIComponent(orgId)}&id=${encodeURIComponent(id)}`,
                    { cache: 'no-store' },
                );
                const json = await readJson<DraftOneResponse>(res);
                if (orgRef.current !== orgId) return null;

                if (json.provisioned === false) {
                    setProvisioned(false);
                    setError(json.note ?? 'Drafts are not provisioned yet.');
                    return null;
                }
                if (json.error || !json.draft) {
                    setError(json.error ?? 'That draft could not be loaded.');
                    return null;
                }

                const row = json.draft;
                const loaded: AgentDraft = {
                    id: row.id ?? id,
                    agent_key: row.agent_key ?? null,
                    title: row.title ?? null,
                    description: row.description ?? '',
                    answers: (row.answers as Record<string, string> | null) ?? {},
                    proposal: row.proposal ?? null,
                    plan: row.plan ?? null,
                    status: (row.status as AgentDraftStatus) ?? 'describing',
                };

                // Seed the baseline BEFORE the state lands, so the autosave
                // effect sees "unchanged" and does not immediately write back
                // the row it just read.
                savedPrint.current = fingerprint(loaded);
                setCurrent(loaded);
                setError(null);
                return loaded;
            } catch (e) {
                if (orgRef.current === orgId) setError((e as Error).message);
                return null;
            }
        },
        [orgId],
    );

    /* ----------------------------------------------------------- discard() */

    const discard = useCallback(
        async (id?: string): Promise<boolean> => {
            const target = id ?? currentRef.current?.id ?? null;
            if (!orgId || !target) return false;
            try {
                const res = await fetch(
                    `/api/agents/drafts?orgId=${encodeURIComponent(orgId)}&id=${encodeURIComponent(target)}`,
                    { method: 'DELETE' },
                );
                const json = await readJson<{ ok?: boolean; deleted?: boolean; provisioned?: boolean | null; error?: string }>(res);
                if (orgRef.current !== orgId) return false;

                if (json.error) {
                    setError(json.error);
                    return false;
                }

                setDrafts((list) => (list ? list.filter((d) => d.id !== target) : list));
                if (currentRef.current?.id === target) {
                    savedPrint.current = null;
                    setCurrent(null);
                    setLastSavedAt(null);
                }
                setError(null);
                return json.deleted !== false;
            } catch (e) {
                if (orgRef.current === orgId) setError((e as Error).message);
                return false;
            }
        },
        [orgId],
    );

    /* ------------------------------------------------------------- clear() */

    /**
     * Drop the in-hand draft WITHOUT deleting the saved row — what the composer
     * calls after a successful accept, or when the operator starts a new one.
     * Distinct from discard(): this loses nothing.
     */
    const clear = useCallback(() => {
        savedPrint.current = null;
        setCurrent(null);
        setLastSavedAt(null);
        setError(null);
    }, []);

    return { drafts, current, save, resume, discard, saving, lastSavedAt, error, provisioned, clear, refresh };
}

export default useAgentDraft;
