'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X, Save, Loader2, RotateCcw } from 'lucide-react';
import AopTrendChart from './AopTrendChart';
import NumberInputWheelGuard from '@/frontend/components/ui/NumberInputWheelGuard';
import {
    formatByUnit, monthLabelLong, varianceTone, TONE_COLOR, toneLabel,
    type AopCell, type AopLineItem, type AopSite,
} from '@/frontend/lib/aop/types';

/**
 * Correct one cell of the matrix.
 *
 * A drawer rather than a popover on the cell. At 16 columns a popover anchored to a cell
 * near the right edge either overflows the viewport or has to flip, and it covers the
 * neighbouring figures the editor is most likely being compared against. The drawer keeps
 * the grid visible and leaves room for the cell's own history, which is the context that
 * actually tells you whether a number is wrong.
 *
 * The write is optimistic: the parent's cell map is updated before the request goes out
 * and restored verbatim if it fails. A 16x43 grid re-fetched on every keystroke-sized edit
 * would make correcting a column of figures feel broken.
 */

interface Props {
    orgId: string;
    month: string;
    site: AopSite;
    lineItem: AopLineItem;
    cell: AopCell | null;
    canEdit: boolean;
    /** Applies a cell to the parent's map. Called twice on failure — forward, then back. */
    onApply: (cell: AopCell) => void;
    /**
     * Fired once, after the server confirms. The roll-ups are computed server-side, so the
     * subtotals need one quiet refetch to catch up — but only on a real commit, never on
     * the optimistic paint or the rollback.
     */
    onCommitted?: () => void;
    onClose: () => void;
}

const toInput = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(v));

/** '' means "clear this value"; anything unparseable is rejected before we submit. */
function parse(raw: string): number | null | 'invalid' {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const n = Number(trimmed.replace(/[,₹\s]/g, ''));
    return Number.isFinite(n) ? n : 'invalid';
}

export default function AopCellEditor({
    orgId, month, site, lineItem, cell, canEdit, onApply, onCommitted, onClose,
}: Props) {
    const [budget, setBudget] = useState(toInput(cell?.budget));
    const [actual, setActual] = useState(toInput(cell?.actual));
    const [remarks, setRemarks] = useState(cell?.remarks ?? '');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const firstFieldRef = useRef<HTMLInputElement>(null);

    // Re-seed when the user clicks straight from one cell to another without closing.
    useEffect(() => {
        setBudget(toInput(cell?.budget));
        setActual(toInput(cell?.actual));
        setRemarks(cell?.remarks ?? '');
        setError(null);
    }, [cell?.id, cell?.budget, cell?.actual, cell?.remarks]);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    useEffect(() => { if (canEdit) firstFieldRef.current?.focus(); }, [canEdit]);

    const parsedBudget = parse(budget);
    const parsedActual = parse(actual);
    const invalid = parsedBudget === 'invalid' || parsedActual === 'invalid';

    const preview = useMemo(() => {
        const b = parsedBudget === 'invalid' ? null : parsedBudget;
        const a = parsedActual === 'invalid' ? null : parsedActual;
        return { budget: b, actual: a, saving: (b ?? 0) - (a ?? 0), tone: varianceTone(b, a) };
    }, [parsedBudget, parsedActual]);

    const dirty =
        toInput(cell?.budget) !== budget.trim() ||
        toInput(cell?.actual) !== actual.trim() ||
        (cell?.remarks ?? '') !== remarks;

    const reset = () => {
        setBudget(toInput(cell?.budget));
        setActual(toInput(cell?.actual));
        setRemarks(cell?.remarks ?? '');
        setError(null);
    };

    async function save() {
        if (invalid || saving) return;
        setSaving(true);
        setError(null);

        const previous: AopCell = cell ?? {
            id: '', site_id: site.id, line_item_id: lineItem.id,
            budget: null, actual: null, saving: null, remarks: null, source: 'manual',
        };
        // `invalid` is an aliased condition, so the early return above has already
        // narrowed both of these out of their 'invalid' branch.
        const nextBudget = parsedBudget;
        const nextActual = parsedActual;
        const optimistic: AopCell = {
            ...previous,
            budget: nextBudget,
            actual: nextActual,
            saving: (nextBudget ?? 0) - (nextActual ?? 0),
            remarks: remarks.trim() || null,
            source: 'manual',
        };
        onApply(optimistic);

        try {
            const res = await fetch('/api/aop/entry', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    org_id: orgId,
                    site_id: site.id,
                    line_item_id: lineItem.id,
                    period_month: month,
                    budget: nextBudget,
                    actual: nextActual,
                    remarks: remarks.trim() || null,
                }),
            });
            const payload = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(payload?.error || 'Could not save the correction');
            // The server's row is authoritative — `saving` is a generated column, so its
            // rounding is the one the rest of the module will read back.
            onApply(payload.entry as AopCell);
            onCommitted?.();
            onClose();
        } catch (e) {
            onApply(previous);
            setError(e instanceof Error ? e.message : 'Could not save the correction');
        } finally {
            setSaving(false);
        }
    }

    const field = 'w-full px-3 py-2 rounded-xl border border-border bg-surface text-sm font-bold ' +
        'text-text-primary tabular-nums outline-none focus:border-primary transition-colors ' +
        'disabled:opacity-60 disabled:cursor-not-allowed';

    return (
        <>
            <NumberInputWheelGuard />
            <div className="fixed inset-0 z-50 flex justify-end">
                <div className="absolute inset-0 bg-black/30" onClick={onClose} aria-hidden />

                <aside
                    role="dialog"
                    aria-label={`${site.name} — ${lineItem.name}`}
                    className="relative w-full max-w-md h-full bg-surface border-l border-border flex flex-col shadow-xl"
                >
                    <header className="px-5 py-4 border-b border-border flex items-start justify-between gap-3">
                        <div className="min-w-0">
                            <p className="text-[10px] font-black uppercase tracking-[0.14em] text-primary truncate">
                                {site.name}
                            </p>
                            <h2 className="text-base font-bold text-text-primary truncate">{lineItem.name}</h2>
                            <p className="text-[11px] font-semibold text-text-tertiary mt-0.5">
                                {monthLabelLong(month)}
                                {cell?.source === 'manual' && ' · corrected manually'}
                                {cell?.source === 'xlsx_import' && ' · from the workbook import'}
                            </p>
                        </div>
                        <button onClick={onClose} className="p-1.5 -mr-1.5 rounded-lg hover:bg-muted" aria-label="Close">
                            <X className="w-4 h-4 text-text-secondary" />
                        </button>
                    </header>

                    <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
                        <div className="grid grid-cols-2 gap-3">
                            <label className="block">
                                <span className="text-[10px] font-black uppercase tracking-[0.12em] text-text-tertiary">Budget</span>
                                <input
                                    ref={firstFieldRef}
                                    type="number"
                                    inputMode="decimal"
                                    step="any"
                                    className={`${field} mt-1`}
                                    value={budget}
                                    disabled={!canEdit || saving}
                                    onChange={e => setBudget(e.target.value)}
                                    placeholder="—"
                                />
                            </label>
                            <label className="block">
                                <span className="text-[10px] font-black uppercase tracking-[0.12em] text-text-tertiary">Actual</span>
                                <input
                                    type="number"
                                    inputMode="decimal"
                                    step="any"
                                    className={`${field} mt-1`}
                                    value={actual}
                                    disabled={!canEdit || saving}
                                    onChange={e => setActual(e.target.value)}
                                    placeholder="—"
                                />
                            </label>
                        </div>

                        <div
                            className="rounded-xl border border-border px-3 py-2.5 flex items-center justify-between"
                            style={{ background: 'var(--surface-elevated)' }}
                        >
                            <div>
                                <p className="text-[10px] font-black uppercase tracking-[0.12em] text-text-tertiary">
                                    Variance (budget − actual)
                                </p>
                                <p className="text-[11px] font-semibold text-text-tertiary mt-0.5">
                                    {toneLabel(preview.tone)}
                                </p>
                            </div>
                            <p
                                className="text-lg font-extrabold tabular-nums"
                                style={{ color: TONE_COLOR[preview.tone] }}
                            >
                                {formatByUnit(preview.saving, lineItem.unit)}
                            </p>
                        </div>

                        <label className="block">
                            <span className="text-[10px] font-black uppercase tracking-[0.12em] text-text-tertiary">Remarks</span>
                            <textarea
                                rows={3}
                                className={`${field} mt-1 font-semibold resize-none`}
                                value={remarks}
                                disabled={!canEdit || saving}
                                onChange={e => setRemarks(e.target.value)}
                                placeholder="Why this figure looks the way it does"
                            />
                        </label>

                        {error && (
                            <p className="text-xs font-bold px-3 py-2 rounded-xl" style={{ color: 'var(--error)', background: 'rgba(239,68,68,0.10)' }}>
                                {error}
                            </p>
                        )}
                        {!canEdit && (
                            <p className="text-xs font-semibold text-text-tertiary">
                                Your role can read the plan but not correct it.
                            </p>
                        )}

                        <div className="pt-2 border-t border-border">
                            <AopTrendChart
                                orgId={orgId}
                                siteId={site.id}
                                lineItemCode={lineItem.code}
                                height={180}
                            />
                        </div>
                    </div>

                    {canEdit && (
                        <footer className="px-5 py-3 border-t border-border flex items-center gap-2">
                            <button
                                onClick={save}
                                disabled={!dirty || invalid || saving}
                                className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-white text-sm font-bold disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
                            >
                                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                                Save correction
                            </button>
                            <button
                                onClick={reset}
                                disabled={!dirty || saving}
                                className="inline-flex items-center gap-2 px-3 py-2.5 rounded-xl border border-border text-sm font-bold text-text-secondary disabled:opacity-40 hover:bg-muted transition-colors"
                            >
                                <RotateCcw className="w-4 h-4" />
                                Reset
                            </button>
                        </footer>
                    )}
                </aside>
            </div>
        </>
    );
}
