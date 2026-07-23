'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { PhoneCall, ChevronDown } from 'lucide-react';
import { getStageVisual } from '@/frontend/lib/crm/stages';
import type { LeadStatusConfig } from '@/frontend/types/crm';

interface StagePipelineProps {
    statuses: LeadStatusConfig[];
    currentStatusId?: string;
    onChange: (statusId: string) => void;
    isUpdating?: boolean;
}

const RING_RE = /^ring\s*\d+$/i;
const ACTIVITY_STATUSES = new Set(['visit pending', 'visit done', 'layout shared', 'loi']);

function RingDropdownPortal({
    ringStatuses,
    isCurrentRing,
    currentRingNum,
    isUpdating,
    onChange,
    onClose,
    anchorRef,
}: {
    ringStatuses: LeadStatusConfig[];
    isCurrentRing: boolean;
    currentRingNum: number;
    isUpdating?: boolean;
    onChange: (id: string) => void;
    onClose: () => void;
    anchorRef: React.RefObject<HTMLButtonElement | null>;
}) {
    const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!anchorRef.current) return;
        const rect = anchorRef.current.getBoundingClientRect();
        setPos({ top: rect.bottom + 4, left: rect.left + rect.width / 2 });
    }, [anchorRef]);

    useEffect(() => {
        const close = (e: MouseEvent) => {
            if (
                dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
                anchorRef.current && !anchorRef.current.contains(e.target as Node)
            ) onClose();
        };
        document.addEventListener('mousedown', close);
        return () => document.removeEventListener('mousedown', close);
    }, [onClose, anchorRef]);

    if (!pos) return null;

    return createPortal(
        <div
            ref={dropdownRef}
            className="fixed z-[9999] bg-surface border border-border rounded-xl shadow-lg py-1 min-w-[120px]"
            style={{ top: pos.top, left: pos.left, transform: 'translateX(-50%)' }}
        >
            {Array.from({ length: 10 }, (_, n) => n + 1).map(num => {
                const rs = ringStatuses.find(s => s.name.toLowerCase() === `ring ${num}`);
                const isActive = isCurrentRing && currentRingNum === num;
                return (
                    <button
                        key={num}
                        disabled={!rs || isUpdating}
                        onClick={() => {
                            if (rs) {
                                onChange(rs.id);
                                onClose();
                            }
                        }}
                        className={`w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors ${
                            isActive ? 'bg-orange-50 text-orange-600 font-bold dark:bg-orange-900/30' :
                            rs ? 'text-text-primary hover:bg-surface-elevated' : 'text-text-tertiary opacity-40 cursor-not-allowed'
                        }`}
                    >
                        <PhoneCall className="w-3 h-3" />
                        Ring {num}
                        {isActive && <span className="ml-auto text-[10px]">●</span>}
                    </button>
                );
            })}
        </div>,
        document.body
    );
}

export default function StagePipeline({ statuses, currentStatusId, onChange, isUpdating }: StagePipelineProps) {
    const [ringOpen, setRingOpen] = useState(false);
    const ringBtnRef = useRef<HTMLButtonElement>(null);

    if (!statuses?.length) return null;

    const filteredStatuses = statuses.filter(s => !ACTIVITY_STATUSES.has(s.name.toLowerCase()));
    const ringStatuses = filteredStatuses.filter(s => RING_RE.test(s.name));

    const firstRingIndex = filteredStatuses.findIndex(s => RING_RE.test(s.name));
    const pipeline: (LeadStatusConfig | 'ring-dropdown')[] = [];
    let ringInserted = false;
    for (const s of filteredStatuses) {
        if (RING_RE.test(s.name)) {
            if (!ringInserted) {
                pipeline.push('ring-dropdown');
                ringInserted = true;
            }
        } else {
            pipeline.push(s);
        }
    }

    const currentIndex = filteredStatuses.findIndex(s => s.id === currentStatusId);
    const currentStatus = filteredStatuses.find(s => s.id === currentStatusId);
    const isCurrentRing = currentStatus ? RING_RE.test(currentStatus.name) : false;
    const currentRingNum = isCurrentRing ? parseInt(currentStatus!.name.replace(/\D/g, '')) : 0;

    const ringColor = '#FB923C';

    return (
        <div className="overflow-x-auto -mx-1 px-1 custom-scrollbar">
            <div className="flex items-start min-w-max pt-1 pb-2">
                {pipeline.map((item, i) => {
                    if (item === 'ring-dropdown') {
                        const pipelineIndexOfFirstRing = firstRingIndex;
                        const isDone = currentIndex >= 0 && !isCurrentRing && currentIndex > pipelineIndexOfFirstRing;

                        return (
                            <React.Fragment key="ring-dropdown">
                                <div className="relative flex flex-col items-center gap-1 shrink-0 w-[78px]">
                                    <button
                                        ref={ringBtnRef}
                                        type="button"
                                        disabled={isUpdating}
                                        onClick={() => setRingOpen(v => !v)}
                                        title="Ring (call attempts)"
                                        className="flex flex-col items-center gap-1 group focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:rounded-xl disabled:cursor-wait active:scale-95 transition-transform"
                                    >
                                        <span className="relative flex items-center justify-center" style={{ height: 44 }}>
                                            <span
                                                className={`w-10 h-10 rounded-full border-2 flex items-center justify-center transition-all group-hover:scale-105 ${isCurrentRing ? 'shadow-md ring-2 ring-offset-2 ring-offset-[var(--card)]' : ''}`}
                                                style={{
                                                    backgroundColor: isCurrentRing ? ringColor : 'var(--card)',
                                                    borderColor: isCurrentRing ? ringColor : 'var(--border)',
                                                    color: isCurrentRing ? '#fff' : 'var(--text-tertiary)',
                                                    ...(isCurrentRing ? { boxShadow: `0 0 0 2px ${ringColor}` } : {}),
                                                }}
                                            >
                                                <PhoneCall className="w-4 h-4" />
                                            </span>
                                            {isCurrentRing && (
                                                <span
                                                    className="absolute -top-0.5 -right-0 text-[9px] font-black rounded-full w-4 h-4 flex items-center justify-center border border-white"
                                                    style={{ backgroundColor: ringColor, color: '#fff' }}
                                                >{currentRingNum}</span>
                                            )}
                                        </span>
                                        <span className="flex items-center gap-0.5">
                                            <span
                                                className={`text-[10px] leading-tight text-center ${isCurrentRing ? 'font-bold' : 'font-medium'}`}
                                                style={{ color: isCurrentRing ? ringColor : 'var(--text-secondary)' }}
                                            >{isCurrentRing ? `Active R${currentRingNum}` : 'Active'}</span>
                                            <ChevronDown className={`w-3 h-3 transition-transform ${ringOpen ? 'rotate-180' : ''}`} style={{ color: 'var(--text-tertiary)' }} />
                                        </span>
                                    </button>

                                    {ringOpen && (
                                        <RingDropdownPortal
                                            ringStatuses={ringStatuses}
                                            isCurrentRing={isCurrentRing}
                                            currentRingNum={currentRingNum}
                                            isUpdating={isUpdating}
                                            onChange={onChange}
                                            onClose={() => setRingOpen(false)}
                                            anchorRef={ringBtnRef}
                                        />
                                    )}
                                </div>
                                {i < pipeline.length - 1 && (
                                    <span
                                        className="h-0.5 w-4 shrink-0 rounded-full mt-[21px]"
                                        style={{ backgroundColor: 'var(--border)' }}
                                    />
                                )}
                            </React.Fragment>
                        );
                    }

                    const s = item as LeadStatusConfig;
                    const v = getStageVisual(s.name);
                    const Icon = v.icon;
                    const isCurrent = s.id === currentStatusId;
                    const statusIdx = filteredStatuses.findIndex(st => st.id === s.id);
                    const isDone = currentIndex >= 0 && statusIdx < currentIndex;
                    const big = v.size === 'lg';
                    const circle = big ? 'w-11 h-11' : 'w-8 h-8';
                    const iconSize = big ? 'w-5 h-5' : 'w-4 h-4';

                    const style: React.CSSProperties = isCurrent
                        ? { backgroundColor: v.color, borderColor: v.color, color: '#fff' }
                        : { backgroundColor: 'var(--card)', borderColor: 'var(--border)', color: 'var(--text-tertiary)' };

                    return (
                        <React.Fragment key={s.id}>
                            <button
                                type="button"
                                disabled={isUpdating}
                                onClick={() => onChange(s.id)}
                                title={s.name}
                                className={`flex flex-col items-center gap-1 shrink-0 ${big ? 'w-[68px]' : 'w-[58px]'} group focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:rounded-xl disabled:cursor-wait active:scale-95 transition-transform`}
                            >
                                <span className="relative flex items-center justify-center" style={{ height: 44 }}>
                                    <span
                                        className={`${circle} rounded-full border-2 flex items-center justify-center transition-all group-hover:scale-105 ${isCurrent ? 'shadow-md ring-2 ring-offset-2 ring-offset-[var(--card)]' : ''}`}
                                        style={{ ...style, ...(isCurrent ? { boxShadow: `0 0 0 2px ${v.color}` } : {}) }}
                                    >
                                        <Icon className={iconSize} />
                                    </span>
                                </span>
                                <span
                                    className={`text-[10px] leading-tight text-center px-0.5 ${isCurrent ? 'font-bold' : 'font-medium'}`}
                                    style={{ color: isCurrent ? v.color : 'var(--text-secondary)' }}
                                >{s.name}</span>
                            </button>
                            {i < pipeline.length - 1 && (
                                <span
                                    className="h-0.5 w-4 shrink-0 rounded-full mt-[21px]"
                                    style={{ backgroundColor: 'var(--border)' }}
                                />
                            )}
                        </React.Fragment>
                    );
                })}
            </div>
        </div>
    );
}
