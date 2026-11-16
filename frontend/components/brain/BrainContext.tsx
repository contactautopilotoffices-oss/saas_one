'use client';

/**
 * Brain Console state shared by every screen: which API is in use (server or demo), the latest status the server
 * reported (set-up missing, kill switch, labelling unavailable), the ONE settings draft that Switches and Skills both
 * edit, the reviewer's choices for marking a turn wrong, and toasts.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { BrainSettings } from '@/backend/lib/aiLayer/brain/config';
import type { ConsoleStatus, ReviewView, SettingsView, SkillView } from '@/backend/lib/aiLayer/brain/console/types';
import type { BrainApi, LabelBody, Result } from './api';
import { describeChanges, riskyChanges } from './settingsDiff';

export type ScreenId = 'overview' | 'switches' | 'skills' | 'conversations' | 'shadow' | 'review' | 'guidance' | 'memory' | 'cost' | 'models' | 'scorecard';

export interface SettingsState {
    /** null until the first answer. */
    res: Result<SettingsView> | null;
    view: SettingsView | null;
    skills: SkillView[] | null;
    skillsError: string | null;
    draft: BrainSettings | null;
    dirty: boolean;
    changes: string[];
    risks: string[];
    saving: boolean;
    edit: (fn: (d: BrainSettings) => BrainSettings) => void;
    discard: () => void;
    reload: () => void;
    save: () => Promise<Result<SettingsView>>;
}

interface BrainCtx {
    api: BrainApi;
    /** The organisation the console is for (panels that call their own API need it). */
    orgId: string;
    demo: boolean;
    status: ConsoleStatus | null;
    forbidden: boolean;
    report: (r: Result<unknown>) => void;
    settings: SettingsState;
    reviewOptions: Pick<ReviewView, 'outcomes' | 'skills'> | null;
    needReviewOptions: () => void;
    acceptReview: (v: ReviewView) => void;
    label: (body: LabelBody) => Promise<Result<ReviewView>>;
    toast: (message: string, tone?: 'ok' | 'bad') => void;
    toastState: { message: string; tone: 'ok' | 'bad'; n: number } | null;
    go: (screen: ScreenId) => void;
}

const Ctx = createContext<BrainCtx | null>(null);

export function useBrain(): BrainCtx {
    const c = useContext(Ctx);
    if (!c) throw new Error('useBrain outside BrainProvider');
    return c;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function BrainProvider({ api, orgId, demo, go, children }: { api: BrainApi; orgId: string; demo: boolean; go: (s: ScreenId) => void; children: React.ReactNode }) {
    const [status, setStatus] = useState<ConsoleStatus | null>(null);
    const [forbidden, setForbidden] = useState(false);

    const report = useCallback((r: Result<unknown>) => {
        if (r.ok) setStatus(prev => (same(prev, r.status) ? prev : r.status));
        else if (r.kind === 'forbidden') setForbidden(true);
    }, []);

    // ── Toasts ──
    const [toastState, setToast] = useState<BrainCtx['toastState']>(null);
    const toast = useCallback((message: string, tone: 'ok' | 'bad' = 'ok') => setToast(t => ({ message, tone, n: (t?.n ?? 0) + 1 })), []);
    useEffect(() => {
        if (!toastState) return;
        const id = window.setTimeout(() => setToast(null), 4200);
        return () => window.clearTimeout(id);
    }, [toastState]);

    // ── Settings and skills: one draft for Switches and Skills ──
    const [settingsRes, setSettingsRes] = useState<Result<SettingsView> | null>(null);
    const [skillsRes, setSkillsRes] = useState<Result<SkillView[]> | null>(null);
    const [draft, setDraft] = useState<BrainSettings | null>(null);
    const [saving, setSaving] = useState(false);
    const [nonce, setNonce] = useState(0);
    useEffect(() => {
        let live = true;
        Promise.all([api.settings(), api.skills()]).then(([a, b]) => {
            if (!live) return;
            report(a); report(b);
            setSettingsRes(a); setSkillsRes(b);
            setDraft(a.ok ? a.data.settings : null);
        });
        return () => { live = false; };
    }, [api, nonce, report]);

    const view = settingsRes?.ok ? settingsRes.data : null;
    const skills = skillsRes?.ok ? skillsRes.data : null;
    // Dirty means there is something to say about it: undoing an edit by hand leaves nothing to save.
    const changes = useMemo(() => (view && draft && !same(view.settings, draft) ? describeChanges(view.settings, draft, skills ?? []) : []), [view, draft, skills]);
    const risks = useMemo(() => (view && draft && changes.length ? riskyChanges(view.settings, draft, skills ?? []) : []), [view, draft, skills, changes]);
    const dirty = changes.length > 0;

    const save = useCallback(async (): Promise<Result<SettingsView>> => {
        if (!view || !draft) return { ok: false, kind: 'error', message: 'The switches have not loaded yet.' };
        setSaving(true);
        const r = await api.saveSettings({ settings: draft, updatedAt: view.updatedAt });
        setSaving(false);
        report(r);
        if (r.ok) {
            setSettingsRes(r);
            setDraft(r.data.settings);
            // Skill modes in force come from the saved settings: read them again.
            api.skills().then(sr => { report(sr); if (sr.ok) setSkillsRes(sr); });
        }
        return r;
    }, [api, draft, view, report]);

    const settings: SettingsState = {
        res: settingsRes, view, skills, skillsError: skillsRes && !skillsRes.ok ? skillsRes.message : null, draft, dirty, changes, risks, saving,
        edit: fn => setDraft(d => (d ? fn(d) : d)),
        discard: () => setDraft(view ? view.settings : null),
        reload: () => setNonce(n => n + 1),
        save,
    };

    // ── What a reviewer may choose when a turn was wrong (loaded the first time someone needs it) ──
    const [reviewOptions, setReviewOptions] = useState<BrainCtx['reviewOptions']>(null);
    const asked = useRef(false);
    const acceptReview = useCallback((v: ReviewView) => setReviewOptions(prev => (prev && same(prev.outcomes, v.outcomes) && same(prev.skills, v.skills) ? prev : { outcomes: v.outcomes, skills: v.skills })), []);
    const needReviewOptions = useCallback(() => {
        if (asked.current) return;
        asked.current = true;
        api.review().then(r => { report(r); if (r.ok) acceptReview(r.data); else asked.current = false; });
    }, [api, report, acceptReview]);
    const label = useCallback(async (body: LabelBody) => {
        const r = await api.postReview(body);
        report(r);
        if (r.ok) acceptReview(r.data);
        return r;
    }, [api, report, acceptReview]);

    const value: BrainCtx = { api, orgId, demo, status, forbidden, report, settings, reviewOptions, needReviewOptions, acceptReview, label, toast, toastState, go };
    return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/**
 * Load one view and keep it. The previous answer stays on screen while a new one loads (so a range switch does not
 * flash a skeleton); `loading` says a newer answer is on its way.
 */
export function useView<T>(load: (api: BrainApi) => Promise<Result<T>>, key: string) {
    const { api, report } = useBrain();
    const [nonce, setNonce] = useState(0);
    const full = `${key}#${nonce}`;
    const [state, setState] = useState<{ key: string; res: Result<T>; at: string } | null>(null);
    const loadRef = useRef(load);
    useEffect(() => { loadRef.current = load; });
    useEffect(() => {
        let live = true;
        loadRef.current(api).then(res => {
            if (!live) return;
            report(res);
            setState({ key: full, res, at: new Date().toISOString() });
        });
        return () => { live = false; };
    }, [api, full, report]);
    return {
        res: state?.res ?? null,
        data: state?.res.ok ? state.res.data : null,
        error: state && !state.res.ok ? state.res.message : null,
        loading: !state || state.key !== full,
        loadedAt: state?.at ?? null,
        reload: () => setNonce(n => n + 1),
        /** Change the data on screen after a successful action (marking a turn), without a reload. */
        mutate: (fn: (d: T) => T) => setState(st => (st && st.res.ok ? { ...st, res: { ...st.res, data: fn(st.res.data) } } : st)),
    };
}
