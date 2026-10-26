'use client';

import React, { useState } from 'react';
import { Bell, LayoutGrid, Plus } from 'lucide-react';
import type { DesignProps } from '../../DesignLab';
import { DesignFrame, MobileNavSheet, PeriodSwitch, PropertySwitcher, type DrawerSkin, type LabTheme } from '../../lab/frame';
import { Avatar, OfflineBanner, cx } from '../../lab/ui';
import type { LabNavItem } from '../../lab/nav';
import InkDashboard from './InkDashboard';
import InkTickets from './InkTickets';
import InkDetail from './InkDetail';

/**
 * Design 1: Ink. Editorial and calm. Monochrome brand with one black card per screen,
 * big confident numbers and a 72px black icon rail that opens to 240px with labels.
 */

export const INK = {
    page: '#FFFFFF',
    tile: '#F3F3F4',
    border: '#ECECEE',
    text: '#0B0B0C',
    text2: '#6B6B70',
    text3: '#8A8A8F',
    black: '#0B0B0C',
    ramp: ['#0B0B0C', '#3F3F44', '#717176', '#9E9EA3'] as [string, string, string, string],
    raised: '#ABABB0',
};

export const inkTheme: LabTheme = {
    font: 'var(--font-lab-inter), Inter, system-ui, sans-serif',
    page: INK.page,
    surface: '#FFFFFF',
    tile: INK.tile,
    border: INK.border,
    borderStrong: '#D4D4D8',
    grid: '#EFEFF1',
    text: INK.text,
    text2: INK.text2,
    text3: INK.text3,
    primary: INK.black,
    onPrimary: '#FFFFFF',
    tint: INK.tile,
    ramp: INK.ramp,
    radius: '24px',
    radiusSm: '16px',
    chipRadius: '999px',
    btnRadius: '999px',
    focus: '#0B0B0C',
    skeletonA: '#F3F3F4',
    skeletonB: '#E6E6E8',
    tooltipBg: '#0B0B0C',
    tooltipFg: '#FFFFFF',
};

const inkDrawer: DrawerSkin = {
    panel: { background: '#FFFFFF', borderLeft: `1px solid ${INK.border}`, borderRadius: '24px 0 0 24px', boxShadow: '-24px 0 60px rgba(0,0,0,0.12)' },
    confirm: { background: INK.black, color: '#FFFFFF', borderRadius: 999 },
    radio: INK.black,
    tabActive: { background: '#FFFFFF', color: INK.text, boxShadow: '0 1px 2px rgba(0,0,0,0.08)' },
    row: { background: 'transparent' },
    rowSelected: { background: INK.tile },
};

/** Numbers: weight 600, -0.04em. */
export const inkNum: React.CSSProperties = { fontWeight: 600, letterSpacing: '-0.04em', fontVariantNumeric: 'tabular-nums' };

export function InkCard({ children, className, style, as: As = 'section', label }: { children: React.ReactNode; className?: string; style?: React.CSSProperties; as?: 'section' | 'div'; label?: string }) {
    return (
        <As aria-label={label} className={cx('rounded-[24px] border bg-white', className)} style={{ borderColor: INK.border, ...style }}>
            {children}
        </As>
    );
}

export function InkButton({ children, onClick, variant = 'solid', className, icon: Icon, ariaLabel }: {
    children?: React.ReactNode; onClick: () => void; variant?: 'solid' | 'outline' | 'ghost' | 'white'; className?: string; icon?: React.ComponentType<{ className?: string }>; ariaLabel?: string;
}) {
    const styles: Record<string, React.CSSProperties> = {
        solid: { background: INK.black, color: '#FFFFFF' },
        outline: { background: '#FFFFFF', color: INK.text, border: `1px solid ${INK.border}` },
        ghost: { background: INK.tile, color: INK.text },
        white: { background: '#FFFFFF', color: INK.text },
    };
    return (
        <button
            type="button"
            onClick={onClick}
            aria-label={ariaLabel}
            className={cx('inline-flex h-10 shrink-0 items-center justify-center gap-[8px] whitespace-nowrap rounded-full px-4 text-[13.5px] font-semibold transition-opacity hover:opacity-85', className)}
            style={styles[variant]}
        >
            {Icon && <Icon className="h-4 w-4" />}
            {children}
        </button>
    );
}

function InkRail({ lab, screen, setScreen }: DesignProps) {
    const groups: LabNavItem['group'][] = ['main', 'operations', 'tenant', 'people', 'account'];
    const onNav = (item: LabNavItem) => (item.screen ? setScreen(item.screen) : lab.previewAction(`Open ${item.label}`));
    const isActive = (item: LabNavItem) => !!item.screen && (item.screen === screen || (item.screen === 'tickets' && screen === 'detail'));
    return (
        <div className="relative hidden w-[72px] shrink-0 md:block">
            <nav
                aria-label="Main"
                className="group fixed bottom-0 z-40 flex w-[72px] flex-col overflow-hidden bg-[#0B0B0C] py-4 text-white transition-[width] duration-200 ease-out hover:w-[240px] focus-within:w-[240px]"
                style={{ top: 'var(--lab-bar-h)' }}
            >
                <div className="mb-4 flex h-10 items-center gap-[12px] px-4">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white text-[15px] font-bold text-black">A</span>
                    <span className="whitespace-nowrap text-[15px] font-semibold opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">Autopilot</span>
                </div>
                <div className="flex flex-1 flex-col gap-0.5 overflow-y-auto overflow-x-hidden px-4">
                    {groups.map(g => {
                        const items = lab.nav.filter(n => n.group === g);
                        if (items.length === 0) return null;
                        return (
                            <div key={g} className="flex flex-col gap-0.5 border-t border-white/10 py-2 first:border-0 first:pt-0">
                                {items.map(item => {
                                    const Icon = item.icon;
                                    const on = isActive(item);
                                    return (
                                        <button
                                            key={item.id}
                                            type="button"
                                            onClick={() => onNav(item)}
                                            aria-current={on ? 'page' : undefined}
                                            className="flex h-10 items-center gap-[12px] rounded-full text-left"
                                        >
                                            <span className={cx('grid h-10 w-10 shrink-0 place-items-center rounded-full transition-colors', on ? 'bg-white text-black' : 'text-white/70 hover:bg-white/10 hover:text-white')}>
                                                <Icon className="h-[18px] w-[18px]" aria-hidden />
                                            </span>
                                            <span className={cx('whitespace-nowrap text-[13.5px] opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100', on ? 'font-semibold text-white' : 'text-white/75')}>
                                                {item.label}
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>
                        );
                    })}
                </div>
            </nav>
        </div>
    );
}

function InkTopBar({ lab }: DesignProps) {
    return (
        <header
            className="sticky z-30 flex h-[72px] items-center gap-[12px] border-b bg-white/95 px-4 backdrop-blur md:px-8"
            style={{ top: 'var(--lab-bar-h)', borderColor: INK.border }}
        >
            <PropertySwitcher lab={lab} compact className="rounded-full px-4 text-[13.5px]" style={{ background: INK.tile, color: INK.text }} />
            <div className="hidden lg:block">
            <PeriodSwitch
                lab={lab}
                className="rounded-full"
                track={{ background: INK.tile, borderRadius: 999 }}
                thumb={{ background: INK.black, borderRadius: 999 }}
                idleText={INK.text2}
                activeText="#FFFFFF"
            />
            </div>
            <div className="ml-auto flex items-center gap-[8px]">
                <button type="button" aria-label="Notifications, 3 unread" onClick={() => lab.previewAction('Notifications')} className="relative grid h-10 w-10 place-items-center rounded-full" style={{ background: INK.tile }}>
                    <Bell className="h-[18px] w-[18px]" />
                    <span className="absolute right-2.5 top-2.5 h-2 w-2 rounded-full border-2 border-[#F3F3F4] bg-black" />
                </button>
                <button type="button" onClick={() => lab.previewAction('Profile')} className="hidden h-10 items-center gap-2.5 rounded-full pl-1 pr-3 sm:flex" style={{ background: INK.tile }} aria-label="Profile">
                    <Avatar name={lab.user.name} size={32} style={{ background: INK.black, color: '#FFFFFF' }} />
                    <span className="hidden text-left leading-tight xl:block">
                        <span className="block text-[13px] font-semibold">{lab.user.name}</span>
                        <span className="block text-[11.5px]" style={{ color: INK.text2 }}>{lab.user.roleLabel}</span>
                    </span>
                </button>
                <span className="hidden sm:block"><InkButton icon={Plus} onClick={() => lab.previewAction('Raise ticket')}>Raise ticket</InkButton></span>
                <button type="button" aria-label="Raise ticket" onClick={() => lab.previewAction('Raise ticket')} className="grid h-10 w-10 place-items-center rounded-full bg-black text-white sm:hidden">
                    <Plus className="h-5 w-5" />
                </button>
            </div>
        </header>
    );
}

function InkBottomBar({ lab, screen, setScreen }: DesignProps) {
    const [more, setMore] = useState(false);
    const items = lab.nav.filter(n => n.group === 'main' || n.id === 'checklists' || n.id === 'visitors').slice(0, 4);
    return (
        <>
        <MobileNavSheet lab={lab} open={more} onClose={() => setMore(false)} screen={screen} setScreen={setScreen} activeStyle={{ background: INK.black, color: '#FFFFFF' }} />
        <nav aria-label="Main" className="fixed inset-x-3 bottom-3 z-40 flex h-16 items-center justify-around rounded-full bg-[#0B0B0C] px-2 text-white md:hidden">
            {items.map(item => {
                const Icon = item.icon;
                const on = !!item.screen && (item.screen === screen || (item.screen === 'tickets' && screen === 'detail'));
                return (
                    <button key={item.id} type="button" aria-label={item.label} aria-current={on ? 'page' : undefined}
                        onClick={() => (item.screen ? setScreen(item.screen) : lab.previewAction(`Open ${item.label}`))}
                        className={cx('grid h-11 w-11 place-items-center rounded-full', on ? 'bg-white text-black' : 'text-white/70')}>
                        <Icon className="h-5 w-5" aria-hidden />
                    </button>
                );
            })}
            <button type="button" aria-label="All modules" onClick={() => setMore(true)} className="grid h-11 w-11 place-items-center rounded-full text-white/70">
                <LayoutGrid className="h-5 w-5" aria-hidden />
            </button>
        </nav>
        </>
    );
}

export default function InkDesign(props: DesignProps) {
    const { lab, screen } = props;
    return (
        <DesignFrame theme={inkTheme} lab={lab} drawer={inkDrawer}>
            <div className="flex">
                <InkRail {...props} />
                <div className="min-w-0 flex-1">
                    <InkTopBar {...props} />
                    <main className="mx-auto w-full max-w-[1360px] px-4 pb-28 pt-6 md:px-8 md:pb-12 md:pt-8">
                        <OfflineBanner online={lab.online} className="mb-6" style={{ borderRadius: 16 }} />
                        {screen === 'dashboard' && <InkDashboard {...props} />}
                        {screen === 'tickets' && <InkTickets {...props} />}
                        {screen === 'detail' && <InkDetail {...props} />}
                    </main>
                </div>
            </div>
            <InkBottomBar {...props} />
        </DesignFrame>
    );
}
