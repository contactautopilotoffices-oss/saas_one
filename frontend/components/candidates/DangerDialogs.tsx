'use client';

import React, { useState } from 'react';
import { Archive, Trash2 } from 'lucide-react';
import type { CandidateSheet } from '@/backend/lib/candidates/types';
import { formatCount } from './format';
import { BTN_SECONDARY, CARD, CARD_HOVER, Dialog, INPUT, Spinner } from './ui';

/** Typed to confirm a permanent delete of one sheet or of selected records. */
export const PERMANENT_PHRASE = 'DELETE';

/** Red filled button (the tab's other buttons are neutral; this one marks the only irreversible actions). */
export const BTN_DANGER =
    'inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl bg-error px-4 text-sm font-bold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50';

/** A text box that must match `phrase` exactly before the irreversible action is enabled. */
function PhraseInput({ phrase, value, onChange, id, disabled }: { phrase: string; value: string; onChange: (v: string) => void; id: string; disabled?: boolean }) {
    return (
        <div className="space-y-1.5">
            <label htmlFor={id} className="block text-sm text-text-secondary">
                Type <span className="font-mono font-semibold text-text-primary">{phrase}</span> to confirm
            </label>
            <input
                id={id} value={value} onChange={e => onChange(e.target.value)} disabled={disabled}
                autoComplete="off" autoCapitalize="characters" spellCheck={false} className={INPUT}
            />
        </div>
    );
}

/**
 * Deleting a sheet (owner 2026-11-03): "Move to deleted" (restorable, as before) or "Delete permanently" (the sheet, its
 * records, and people left with no record), which needs the typed confirmation. A sheet already in Deleted only offers
 * the permanent delete.
 */
export function DeleteSheetDialog({
    sheet, open, alreadyDeleted, busy, onClose, onMoveToDeleted, onDeletePermanently,
}: {
    /** Kept after close so the text stays put during the exit animation. */
    sheet: CandidateSheet | null;
    open: boolean;
    alreadyDeleted: boolean;
    busy: 'soft' | 'permanent' | null;
    onClose: () => void;
    onMoveToDeleted: () => void;
    onDeletePermanently: () => void;
}) {
    const [choice, setChoice] = useState<'soft' | 'permanent'>(alreadyDeleted ? 'permanent' : 'soft');
    const [typed, setTyped] = useState('');
    const permanent = alreadyDeleted || choice === 'permanent';
    const ready = !permanent || typed.trim() === PERMANENT_PHRASE;
    const records = sheet?.liveRecordCount ?? 0;

    const option = (value: 'soft' | 'permanent', Icon: React.ComponentType<{ className?: string }>, title: string, body: string) => (
        <label className={`${CARD} ${CARD_HOVER} flex cursor-pointer items-start gap-3 p-4 ${choice === value ? 'ring-2 ring-primary/40' : ''}`}>
            <input type="radio" name="delete-sheet-mode" value={value} checked={choice === value} onChange={() => setChoice(value)} disabled={!!busy} className="mt-1 h-4 w-4 accent-primary" />
            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-surface-elevated text-text-secondary">
                <Icon className="h-4 w-4" />
            </span>
            <span className="min-w-0">
                <span className="block font-display text-sm font-semibold text-text-primary">{title}</span>
                <span className="mt-1 block text-sm leading-relaxed text-text-secondary">{body}</span>
            </span>
        </label>
    );

    return (
        <Dialog
            open={open && !!sheet}
            onClose={() => { if (!busy) onClose(); }}
            labelId="delete-sheet-title"
            size="md"
            title={alreadyDeleted ? 'Delete this sheet permanently?' : 'Delete this sheet?'}
            description={sheet && (
                <>
                    <span className="break-words font-semibold text-text-primary">{sheet.name}</span> has{' '}
                    <span className="tabular-nums">{formatCount(records)}</span> {records === 1 ? 'record' : 'records'}.
                </>
            )}
            footer={
                <>
                    <button type="button" onClick={onClose} disabled={!!busy} className={BTN_SECONDARY}>Cancel</button>
                    {permanent ? (
                        <button type="button" onClick={onDeletePermanently} disabled={!ready || !!busy} className={BTN_DANGER}>
                            {busy === 'permanent' ? <Spinner /> : <Trash2 className="h-4 w-4" />}Delete permanently
                        </button>
                    ) : (
                        <button type="button" onClick={onMoveToDeleted} disabled={!!busy} className={BTN_SECONDARY}>
                            {busy === 'soft' ? <Spinner /> : <Archive className="h-4 w-4" />}Move to deleted
                        </button>
                    )}
                </>
            }
        >
            <div className="space-y-3">
                {!alreadyDeleted && (
                    <>
                        {option('soft', Archive, 'Move to deleted',
                            'Its records are hidden from search and the table. You can restore the sheet from Show deleted.')}
                        {option('permanent', Trash2, 'Delete permanently',
                            'The sheet and all its records are erased. Candidates who appear only in this sheet are erased too. This cannot be undone.')}
                    </>
                )}
                {alreadyDeleted && (
                    <p className="text-sm leading-relaxed text-text-secondary">
                        The sheet and all its records are erased. Candidates who appear only in this sheet are erased too. This cannot be undone.
                    </p>
                )}
                {permanent && <PhraseInput id="delete-sheet-phrase" phrase={PERMANENT_PHRASE} value={typed} onChange={setTyped} disabled={!!busy} />}
            </div>
        </Dialog>
    );
}

/** A permanent action confirmed by typing `phrase`: "Clear all candidate data", deleting selected records for good. */
export function TypedConfirmDialog({
    open, title, children, phrase, confirmText, busy, onClose, onConfirm, labelId,
}: {
    open: boolean;
    title: string;
    children: React.ReactNode;
    phrase: string;
    confirmText: string;
    busy: boolean;
    onClose: () => void;
    onConfirm: () => void;
    labelId: string;
}) {
    const [typed, setTyped] = useState('');
    const ready = typed.trim() === phrase;
    return (
        <Dialog
            open={open}
            onClose={() => { if (!busy) onClose(); }}
            labelId={labelId}
            size="md"
            title={title}
            footer={
                <>
                    <button type="button" onClick={onClose} disabled={busy} className={BTN_SECONDARY}>Cancel</button>
                    <button type="button" onClick={onConfirm} disabled={!ready || busy} className={BTN_DANGER}>
                        {busy ? <Spinner /> : <Trash2 className="h-4 w-4" />}{confirmText}
                    </button>
                </>
            }
        >
            <div className="space-y-4">
                <div className="text-sm leading-relaxed text-text-secondary">{children}</div>
                <PhraseInput id={`${labelId}-phrase`} phrase={phrase} value={typed} onChange={setTyped} disabled={busy} />
            </div>
        </Dialog>
    );
}
