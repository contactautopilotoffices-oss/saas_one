'use client';

import React from 'react';
import { BatteryFull, Signal, Wifi } from 'lucide-react';

const W = 390;
const H = 844;
const BEZEL = 12;

/**
 * A 390 x 844 phone. The screen scrolls on its own, so each design's sticky header and
 * bottom tab bar behave as they would on a device. `scale` shrinks the whole phone to fit
 * side by side comparisons without changing the layout inside it.
 */
export function PhoneFrame({ children, scale = 1, statusDark = false, label }: {
    children: React.ReactNode; scale?: number; statusDark?: boolean; label: string;
}) {
    const outerW = (W + BEZEL * 2) * scale;
    const outerH = (H + BEZEL * 2) * scale;
    const ink = statusDark ? '#FFFFFF' : '#0A0A0A';
    return (
        <figure aria-label={`${label} on a phone`} style={{ width: outerW, height: outerH }} className="shrink-0">
            <div style={{ width: W + BEZEL * 2, height: H + BEZEL * 2, transform: `scale(${scale})`, transformOrigin: 'top left' }}
                className="rounded-[56px] bg-[#0A0A0A] p-[12px] shadow-[0_30px_80px_rgba(0,0,0,0.28)]">
                <div className="relative h-[844px] w-[390px] overflow-hidden rounded-[44px] bg-white" style={{ ['--org-safe-top' as string]: '46px' } as React.CSSProperties}>
                    <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 z-50 flex h-[46px] items-center justify-between px-[30px] text-[14px] font-semibold" style={{ color: ink }}>
                        <span>9:41</span>
                        <span className="absolute left-1/2 top-[11px] h-[26px] w-[110px] -translate-x-1/2 rounded-full bg-black" />
                        <span className="flex items-center gap-[5px]"><Signal className="h-[15px] w-[15px]" /><Wifi className="h-[15px] w-[15px]" /><BatteryFull className="h-[18px] w-[18px]" /></span>
                    </div>
                    <div className="h-full overflow-y-auto overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">{children}</div>
                </div>
            </div>
        </figure>
    );
}
