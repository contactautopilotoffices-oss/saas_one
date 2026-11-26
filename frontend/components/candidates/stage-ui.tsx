'use client';

import React, { useEffect, useState } from 'react';
import { DEFAULT_REJECTION_REASONS, type StageDef, type StageList, type StageTone } from '@/backend/lib/candidates/stage-list';
import { api, qs } from './api';

/*
 * The pipeline's stages on the screens (owner 2026-11-19): one copy of the list per organisation, shared by the board,
 * the table, the candidate's panel and the Positions tab, and replaced when Configurations saves. Plus the coloured
 * chip a stage is shown with.
 */

const lists = new Map<string, StageList>();
const loading = new Map<string, Promise<void>>();
const failed = new Set<string>();
const listeners = new Set<() => void>();
const changed = () => listeners.forEach(l => l());

function fetchList(orgId: string): Promise<void> {
    let p = loading.get(orgId);
    if (!p) {
        failed.delete(orgId);
        p = api<StageList>(`/api/candidates/stages${qs({ orgId })}`).then(res => {
            if (res.ok) lists.set(orgId, res.data);
            else failed.add(orgId);
            changed();
        }).finally(() => loading.delete(orgId));
        loading.set(orgId, p);
    }
    return p;
}

/** Configurations saved a new list: every screen shows it at once. */
export function setStageList(orgId: string, list: StageList) {
    const { counts: _c, changes: _h, ...plain } = list;
    void _c; void _h;
    lists.set(orgId, { ...plain, stages: plain.stages.filter(s => !s.unlisted) });
    changed();
}

/** The list could not be loaded (the board says so, with "Try again"). */
export function stagesFailed(orgId: string): boolean {
    return failed.has(orgId) && !lists.has(orgId);
}
export function retryStages(orgId: string) {
    void fetchList(orgId);
}

/** Owner 2026-11-21: the rejection reasons HR set in Configurations (the defaults until loaded). */
const reasonLists = new Map<string, string[]>();
const reasonLoads = new Map<string, Promise<void>>();
export function setRejectionReasons(orgId: string, reasons: string[]) {
    reasonLists.set(orgId, reasons);
    changed();
}
export function useRejectionReasons(orgId: string): string[] {
    const [, setTick] = useState(0);
    useEffect(() => {
        const l = () => setTick(t => t + 1);
        listeners.add(l);
        if (!reasonLists.has(orgId) && !reasonLoads.has(orgId)) {
            reasonLoads.set(orgId, api<{ reasons: string[] }>(`/api/candidates/rejection-reasons${qs({ orgId })}`).then(res => {
                if (res.ok) setRejectionReasons(orgId, res.data.reasons);
            }).finally(() => reasonLoads.delete(orgId)));
        }
        return () => { listeners.delete(l); };
    }, [orgId]);
    return reasonLists.get(orgId) ?? [...DEFAULT_REJECTION_REASONS];
}

/** The organisation's stages (null while loading, or when loading failed: see stagesFailed). */
export function useStages(orgId: string): StageList | null {
    const [, setTick] = useState(0);
    useEffect(() => {
        const l = () => setTick(t => t + 1);
        listeners.add(l);
        if (!lists.has(orgId)) void fetchList(orgId);
        return () => { listeners.delete(l); };
    }, [orgId]);
    return lists.get(orgId) ?? null;
}

/** Light tint, dark text of the same family (as the module's other tags). */
export const TONE_CHIP: Record<StageTone, string> = {
    amber: 'bg-amber-100 text-amber-900',
    green: 'bg-green-100 text-green-900',
    red: 'bg-red-100 text-red-900',
    blue: 'bg-stone-100 text-stone-900',
    violet: 'bg-neutral-100 text-neutral-900',
    teal: 'bg-amber-50 text-amber-900',
    grey: 'bg-muted text-text-secondary',
};
export const TONE_DOT: Record<StageTone, string> = {
    amber: 'bg-amber-500', green: 'bg-green-500', red: 'bg-red-500', blue: 'bg-stone-500', violet: 'bg-neutral-500', teal: 'bg-amber-300', grey: 'bg-neutral-400',
};
export const TONE_LABELS: Record<StageTone, string> = { amber: 'Amber', green: 'Green', red: 'Red', blue: 'Stone', violet: 'Neutral', teal: 'Sand', grey: 'Grey' };

/** A stage as a coloured chip (the board, the cards, the panel). */
export function StageChip({ stage, title }: { stage: Pick<StageDef, 'name' | 'tone'>; title?: string }) {
    return (
        <span title={title} className={`inline-flex h-[22px] max-w-full items-center gap-x-1.5 whitespace-nowrap rounded-full pl-1.5 pr-2 text-xs font-semibold ${TONE_CHIP[stage.tone]}`}>
            <span className={`h-2 w-2 shrink-0 rounded-full ${TONE_DOT[stage.tone]}`} aria-hidden />
            <span className="truncate">{stage.name}</span>
        </span>
    );
}

/** A dropdown's options for the stages people can be moved to, grouped by round; the current one is always listed. */
export function StageOptions({ groups, current }: { groups: { label: string; stages: StageDef[] }[]; current?: StageDef | null }) {
    const listed = groups.some(g => g.stages.some(s => s.key === current?.key));
    return (
        <>
            {current && !listed && <option value={current.key}>{current.name}{current.hidden ? ' (hidden)' : ''}</option>}
            {groups.map(g => <optgroup key={g.label} label={g.label}>{g.stages.map(s => <option key={s.key} value={s.key}>{s.name}</option>)}</optgroup>)}
        </>
    );
}
