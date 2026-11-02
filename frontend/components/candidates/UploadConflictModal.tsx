'use client';

import React from 'react';
import { GitMerge, Replace } from 'lucide-react';
import type { UploadConflict, UploadMode } from '@/backend/lib/candidates/types';
import { formatCount, formatDateTime } from './format';
import { BTN_SECONDARY, CARD, CARD_HOVER, Dialog, Spinner } from './ui';

/**
 * Owner requirement (2026-11-02): re-uploading a file whose name matches a live sheet asks Replace or Merge.
 * Opened when POST /api/candidates/sheets answers 409 with an UploadConflict body; the choice resends the same file.
 */
export default function UploadConflictModal({
    open, conflict, fileName, busyMode, onChoose, onCancel,
}: {
    open: boolean;
    /** Kept after close so the text stays put during the exit animation. */
    conflict: UploadConflict['conflict'] | null;
    fileName: string;
    /** The mode being sent right now (buttons show a spinner and lock). */
    busyMode: Exclude<UploadMode, 'new'> | null;
    onChoose: (mode: Exclude<UploadMode, 'new'>) => void;
    onCancel: () => void;
}) {
    const busy = busyMode !== null;
    const option = (mode: Exclude<UploadMode, 'new'>, Icon: React.ComponentType<{ className?: string }>, title: string, body: string) => (
        <button
            type="button"
            onClick={() => onChoose(mode)}
            disabled={busy}
            className={`${CARD} ${CARD_HOVER} flex w-full items-start gap-3 p-4 text-left disabled:cursor-not-allowed disabled:opacity-60`}
        >
            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-surface-elevated text-primary-dark">
                {busyMode === mode ? <Spinner /> : <Icon className="h-4 w-4" />}
            </span>
            <span className="min-w-0">
                <span className="block font-display text-sm font-semibold text-text-primary">{title}</span>
                <span className="mt-1 block text-sm leading-relaxed text-text-secondary">{body}</span>
            </span>
        </button>
    );

    return (
        <Dialog
            open={open && !!conflict}
            onClose={() => { if (!busy) onCancel(); }}
            labelId="upload-conflict-title"
            size="md"
            title="This sheet already exists"
            description={conflict && (
                <>
                    A sheet named <span className="break-words font-semibold text-text-primary">{conflict.name}</span> already exists
                    (<span className="tabular-nums">{formatCount(conflict.liveRecordCount)}</span> {conflict.liveRecordCount === 1 ? 'record' : 'records'},
                    uploaded <span className="tabular-nums">{formatDateTime(conflict.uploadedAt)}</span>). Do you want to replace it or merge into it?
                </>
            )}
            footer={<button type="button" onClick={onCancel} disabled={busy} className={BTN_SECONDARY}>Cancel</button>}
        >
            <div className="space-y-3">
                {option('replace', Replace, 'Replace',
                    'The old sheet is moved to Deleted (restorable) and this file is imported fresh.')}
                {option('merge', GitMerge, 'Merge',
                    'Matching candidates (same email or phone) are updated, new ones are added.')}
                {fileName && <p className="truncate pt-1 text-xs text-text-tertiary" title={fileName}>File: {fileName}</p>}
            </div>
        </Dialog>
    );
}
