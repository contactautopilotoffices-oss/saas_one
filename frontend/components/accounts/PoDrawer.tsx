'use client';

import React from 'react';
import PoDetailWorkspace from './PoDetailWorkspace';

/**
 * The PO page as a right-hand drawer, so opening a PO never changes which dashboard shell the
 * viewer is in. One drawer for every login (Accounts, Procurement, org admin) and every place a
 * PO number is clicked. Same record as /{orgId}/accounts/po/{poId}.
 */
export default function PoDrawer({ orgId, poId, onClose }: { orgId: string; poId: string; onClose: () => void }) {
    return (
        <div className="fixed inset-0 z-[80] flex justify-end" role="dialog" aria-modal="true" aria-label="Purchase order details">
            <div className="absolute inset-0 bg-black/50" onClick={onClose} />
            <div className="relative h-full w-full max-w-5xl bg-background border-l border-border shadow-2xl overflow-y-auto">
                <div className="sticky top-0 z-10 flex items-center justify-between gap-3 px-5 py-3 bg-surface border-b border-border">
                    <span className="text-xs font-bold uppercase tracking-wide text-text-secondary">Purchase order</span>
                    <button onClick={onClose} aria-label="Close" className="px-3 py-1.5 rounded-lg text-xs font-bold text-text-secondary hover:bg-surface-elevated">
                        Close ✕
                    </button>
                </div>
                <div className="p-4 sm:p-6">
                    <PoDetailWorkspace orgId={orgId} poId={poId} onBack={onClose} />
                </div>
            </div>
        </div>
    );
}
