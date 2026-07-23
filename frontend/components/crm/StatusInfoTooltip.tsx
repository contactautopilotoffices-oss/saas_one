'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Info } from 'lucide-react';

const QUALIFICATION_INFO: Record<string, { label: string; color: string; criteria: string[] }> = {
    mql: {
        label: 'MQL',
        color: '#F59E0B',
        criteria: [
            'Marketing Qualified Lead — entry stage',
            'Lead came in via marketing channel (ads, website, referral)',
            'Basic info captured, not yet contacted',
        ],
    },
    active: {
        label: 'ACTIVE',
        color: '#3B82F6',
        criteria: [
            'Lead is being actively worked on',
            'Ring 1-10 tracks successive call attempts',
            'Move to Warm/Hot once qualified through conversation',
        ],
    },
    ring: {
        label: 'RING',
        color: '#FB923C',
        criteria: [
            'Call attempt tracking (Ring 1-10) within Active stage',
            'Each ring represents a successive call attempt to reach the prospect',
            'Higher ring numbers indicate more follow-up attempts',
        ],
    },
    warm: {
        label: 'WARM',
        color: '#F59E0B',
        criteria: [
            'Lead has shown interest after contact',
            'Requirement identified but not fully committed',
            'Needs further nurturing or follow-up',
        ],
    },
    hot: {
        label: 'HOT',
        color: '#EF4444',
        criteria: [
            'Defined requirement (use, size, location, specs)',
            'Decision-maker engaged and responsive',
            'Budget / financing confirmed',
            'Timeline to decision within ~90 days',
            'High intent — ready for site visit, proposal, or negotiation',
        ],
    },
    future: {
        label: 'FUTURE',
        color: '#8B5CF6',
        criteria: [
            'Lead is real and reasonably qualified',
            'Trigger event known but distant (e.g., lease expires in 18 months)',
            'No current activity expected yet — park and revisit',
        ],
    },
    cold: {
        label: 'COLD',
        color: '#38BDF8',
        criteria: [
            'Requirement vague or exploratory',
            'Timeline undefined or beyond 12 months',
            'Budget unknown',
            'Low responsiveness; may re-engage later',
        ],
    },
    lost: {
        label: 'LOST',
        color: '#64748B',
        criteria: [
            'Reached qualification but did not close',
            'Signed elsewhere, requirement cancelled, or went dark',
            'Requires a comment/reason when marking',
        ],
    },
    disqualified: {
        label: 'DISQUALIFIED',
        color: '#EF4444',
        criteria: [
            'Not a valid MQL lead',
            'Wrong contact info, spam, or irrelevant enquiry',
            'Does not meet minimum qualification criteria',
            'Requires a comment/reason when marking',
        ],
    },
    won: {
        label: 'WON',
        color: '#22C55E',
        criteria: [
            'Deal successfully closed',
            'Agreement signed, payment initiated or completed',
            'Lead exits the active pipeline',
        ],
    },
};

interface StatusInfoTooltipProps {
    statusName: string;
    className?: string;
}

export default function StatusInfoTooltip({ statusName, className = '' }: StatusInfoTooltipProps) {
    const [enabled, setEnabled] = useState(true);
    const [show, setShow] = useState(false);
    const [pos, setPos] = useState({ top: 0, left: 0 });
    const iconRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        try {
            const orgId = window.location.pathname.split('/')[1];
            const stored = localStorage.getItem(`crm_show_info_tooltips_${orgId}`);
            if (stored === 'false') setEnabled(false);
        } catch {}
    }, []);

    const handleEnter = useCallback(() => {
        if (!iconRef.current) return;
        const rect = iconRef.current.getBoundingClientRect();
        setPos({
            top: rect.top - 8,
            left: rect.left + rect.width / 2,
        });
        setShow(true);
    }, []);

    const handleLeave = useCallback(() => setShow(false), []);

    const key = statusName.toLowerCase().trim();
    const info = QUALIFICATION_INFO[key] || (key.startsWith('ring') ? QUALIFICATION_INFO['ring'] : undefined);
    if (!info || !enabled) return null;

    return (
        <>
            <div
                ref={iconRef}
                className={`inline-flex cursor-help ${className}`}
                onMouseEnter={handleEnter}
                onMouseLeave={handleLeave}
            >
                <Info className="w-3 h-3 text-text-tertiary" />
            </div>
            {show && typeof document !== 'undefined' && createPortal(
                <div
                    className="fixed z-[9999] w-72 p-3 bg-surface border border-border rounded-xl shadow-xl pointer-events-none"
                    style={{
                        top: pos.top,
                        left: pos.left,
                        transform: 'translate(-50%, -100%)',
                    }}
                >
                    <p className="text-[10px] font-black uppercase tracking-wider mb-1.5" style={{ color: info.color }}>
                        {info.label}
                    </p>
                    <ul className="space-y-0.5">
                        {info.criteria.map((c, i) => (
                            <li key={i} className="text-[10px] text-text-secondary flex items-start gap-1">
                                <span className="text-text-tertiary mt-px">·</span>
                                {c}
                            </li>
                        ))}
                    </ul>
                </div>,
                document.body
            )}
        </>
    );
}
