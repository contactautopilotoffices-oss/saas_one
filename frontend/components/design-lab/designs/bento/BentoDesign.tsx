'use client';

import React, { useState } from 'react';
import { Bell, LayoutGrid, Plus } from 'lucide-react';
import type { DesignProps } from '../../DesignLab';
import { DesignFrame, MobileNavSheet, PeriodSwitch, PropertySwitcher, type DrawerSkin, type LabTheme } from '../../lab/frame';
import type { LabNavItem } from '../../lab/nav';
import { Avatar, H, OfflineBanner, SampleBadge, cx } from '../../lab/ui';
import BentoDashboard from './BentoDashboard';
import BentoTickets from './BentoTickets';
import BentoDetail from './BentoDetail';

/**
 * Design 2: Bento. Like the iPhone widget screen: every module is its own widget and all of
 * them are visible at once. Mint page, white borderless widgets, emerald highlights.
 */

export const BENTO = {
    page: '#EBF4EF',
    widget: '#FFFFFF',
    primary: '#0A8A5F',
    deep: '#07714D',
    tint: '#D8EFE4',
    gradient: 'linear-gradient(145deg, #14A874 0%, #0A7F57 100%)',
    text: '#0F201A',
    text2: '#45574F',
    text3: '#7A8C84',
    ramp: ['#054A33', '#0B7A53', '#2E9E71', '#5FBF94'] as [string, string, string, string],
    light: '#B9E2CE',
    lighter: '#DDF1E7',
    track: '#E6EFEA',
    shadow: '0 1px 2px rgba(15,32,26,0.04), 0 10px 28px rgba(15,32,26,0.06)',
};

export const bentoTheme: LabTheme = {
    font: 'var(--font-lab-geist), Geist, system-ui, sans-serif',
    page: BENTO.page,
    surface: '#FFFFFF',
    tile: '#F2F8F5',
    border: '#E3EDE8',
    borderStrong: '#C9DAD1',
    grid: '#EAF2EE',
    text: BENTO.text,
    text2: BENTO.text2,
    text3: BENTO.text3,
    primary: BENTO.primary,
    onPrimary: '#FFFFFF',
    tint: BENTO.tint,
    ramp: BENTO.ramp,
    radius: '26px',
    radiusSm: '18px',
    chipRadius: '999px',
    btnRadius: '14px',
    focus: BENTO.deep,
    skeletonA: '#EEF5F1',
    skeletonB: '#E0ECE6',
    tooltipBg: '#0F201A',
    tooltipFg: '#FFFFFF',
};

const bentoDrawer: DrawerSkin = {
    panel: { background: 'rgba(255,255,255,0.92)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', borderRadius: '26px', margin: 12, boxShadow: '0 24px 60px rgba(15,32,26,0.18)' },
    confirm: { background: BENTO.primary, color: '#FFFFFF', borderRadius: 16 },
    radio: BENTO.primary,
    tabActive: { background: '#FFFFFF', color: BENTO.text, boxShadow: BENTO.shadow },
    row: { background: 'transparent' },
    rowSelected: { background: BENTO.tint },
    input: { background: '#FFFFFF' },
};

export const bentoNum: React.CSSProperties = { fontWeight: 600, letterSpacing: '-0.03em', fontVariantNumeric: 'tabular-nums' };

/** A borderless white widget with a very soft shadow. */
export function Widget({ children, className, style, label, title, icon: Icon, sample, right, tone = 'white', narrow }: {
    children?: React.ReactNode; className?: string; style?: React.CSSProperties; label?: string; title?: string;
    icon?: React.ComponentType<{ className?: string; style?: React.CSSProperties }>; sample?: boolean; right?: React.ReactNode; tone?: 'white' | 'emerald';
    /** One-column widgets drop the title icon so the title and Sample badge both fit. */
    narrow?: boolean;
}) {
    const emerald = tone === 'emerald';
    return (
        <section
            aria-label={label ?? title}
            className={cx('relative flex min-h-0 flex-col overflow-hidden rounded-[26px] p-[18px]', className)}
            style={{ background: emerald ? BENTO.gradient : BENTO.widget, boxShadow: BENTO.shadow, color: emerald ? '#FFFFFF' : BENTO.text, ...style }}
        >
            {title && (
                <div className="mb-[10px] flex items-center justify-between gap-[8px]">
                    <H level={2} className="flex min-w-0 items-center gap-[8px] text-[13.5px] font-semibold" style={{ color: emerald ? 'rgba(255,255,255,0.9)' : BENTO.text2 }}>
                        {Icon && !narrow && <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full" style={{ background: emerald ? 'rgba(255,255,255,0.18)' : BENTO.tint }}><Icon className="h-3.5 w-3.5" style={{ color: emerald ? '#FFFFFF' : BENTO.deep }} /></span>}
                        <span className="truncate">{title}</span>
                    </H>
                    <div className="flex shrink-0 items-center gap-[6px]">
                        {sample && <SampleBadge dark={emerald} size="xs" />}
                        {right}
                    </div>
                </div>
            )}
            {children}
        </section>
    );
}

export function BentoButton({ children, onClick, variant = 'solid', className, icon: Icon, ariaLabel, style }: {
    children?: React.ReactNode; onClick: () => void; variant?: 'solid' | 'tint' | 'white' | 'ghostWhite'; className?: string;
    icon?: React.ComponentType<{ className?: string }>; ariaLabel?: string; style?: React.CSSProperties;
}) {
    const styles: Record<string, React.CSSProperties> = {
        solid: { background: BENTO.primary, color: '#FFFFFF' },
        tint: { background: BENTO.tint, color: BENTO.deep },
        white: { background: '#FFFFFF', color: BENTO.deep },
        ghostWhite: { background: 'rgba(255,255,255,0.18)', color: '#FFFFFF' },
    };
    return (
        <button type="button" onClick={onClick} aria-label={ariaLabel}
            className={cx('inline-flex h-10 shrink-0 items-center justify-center gap-[8px] whitespace-nowrap rounded-[14px] px-[14px] text-[13.5px] font-semibold transition-transform active:scale-[0.98]', className)}
            style={{ ...styles[variant], ...style }}>
            {Icon && <Icon className="h-4 w-4" />}
            {children}
        </button>
    );
}

function Sidebar({ lab, screen, setScreen }: DesignProps) {
    const groups: { id: LabNavItem['group']; label: string }[] = [
        { id: 'main', label: 'Home' }, { id: 'operations', label: 'Operations' }, { id: 'tenant', label: 'Tenant' },
        { id: 'people', label: 'People' }, { id: 'account', label: 'Account' },
    ];
    const isActive = (item: LabNavItem) => !!item.screen && (item.screen === screen || (item.screen === 'tickets' && screen === 'detail'));
    return (
        <aside className="sticky hidden shrink-0 flex-col overflow-y-auto bg-white px-[12px] py-[18px] md:flex md:w-[76px] xl:w-[240px]" style={{ top: 'var(--lab-bar-h)', height: 'calc(100vh - var(--lab-bar-h))' }}>
            <div className="mb-[18px] flex items-center gap-[10px] px-[6px]">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[14px] text-[15px] font-bold text-white" style={{ background: BENTO.gradient }}>A</span>
                <span className="hidden text-[15px] font-semibold xl:block">Autopilot</span>
            </div>
            <nav aria-label="Main" className="flex flex-col gap-[14px]">
                {groups.map(g => {
                    const items = lab.nav.filter(n => n.group === g.id);
                    if (items.length === 0) return null;
                    return (
                        <div key={g.id} className="flex flex-col gap-[2px]">
                            <span className="hidden px-[12px] pb-[4px] text-[11px] font-semibold uppercase tracking-[0.08em] xl:block" style={{ color: BENTO.text3 }}>{g.label}</span>
                            {items.map(item => {
                                const Icon = item.icon;
                                const on = isActive(item);
                                return (
                                    <button key={item.id} type="button" title={item.label} aria-current={on ? 'page' : undefined}
                                        onClick={() => (item.screen ? setScreen(item.screen) : lab.previewAction(`Open ${item.label}`))}
                                        className="flex h-10 items-center justify-center gap-[10px] rounded-full px-[12px] text-[13.5px] font-medium transition-colors xl:justify-start"
                                        style={on ? { background: BENTO.primary, color: '#FFFFFF' } : { color: BENTO.text2 }}>
                                        <Icon className="h-[18px] w-[18px] shrink-0" aria-hidden />
                                        <span className="hidden truncate xl:inline">{item.label}</span>
                                    </button>
                                );
                            })}
                        </div>
                    );
                })}
            </nav>
        </aside>
    );
}

function TopBar({ lab }: DesignProps) {
    return (
        <header className="sticky z-30 flex h-[68px] items-center gap-[10px] px-[16px] md:px-[24px]"
            style={{ top: 'var(--lab-bar-h)', background: 'rgba(255,255,255,0.72)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', borderBottom: '1px solid rgba(255,255,255,0.6)' }}>
            <PropertySwitcher lab={lab} compact className="rounded-[14px] px-[12px] text-[13.5px]" style={{ background: '#FFFFFF', color: BENTO.text, boxShadow: BENTO.shadow }} />
            <div className="hidden lg:block">
                <PeriodSwitch lab={lab} track={{ background: 'rgba(15,32,26,0.06)', borderRadius: 14 }} thumb={{ background: '#FFFFFF', borderRadius: 11, boxShadow: BENTO.shadow }} idleText={BENTO.text2} activeText={BENTO.deep} />
            </div>
            <div className="ml-auto flex items-center gap-[8px]">
                <button type="button" aria-label="Notifications, 3 unread" onClick={() => lab.previewAction('Notifications')} className="relative grid h-10 w-10 place-items-center rounded-[14px] bg-white" style={{ boxShadow: BENTO.shadow }}>
                    <Bell className="h-[18px] w-[18px]" />
                    <span className="absolute right-[9px] top-[9px] h-2 w-2 rounded-full" style={{ background: BENTO.primary }} />
                </button>
                <button type="button" aria-label="Profile" onClick={() => lab.previewAction('Profile')} className="hidden h-10 items-center gap-[8px] rounded-[14px] bg-white pl-[4px] pr-[12px] sm:flex" style={{ boxShadow: BENTO.shadow }}>
                    <Avatar name={lab.user.name} size={32} style={{ background: BENTO.tint, color: BENTO.deep, borderRadius: 11 }} />
                    <span className="hidden text-[13px] font-semibold xl:inline">{lab.user.name}</span>
                </button>
                <span className="hidden sm:block"><BentoButton icon={Plus} onClick={() => lab.previewAction('Raise ticket')}>Raise ticket</BentoButton></span>
                <button type="button" aria-label="Raise ticket" onClick={() => lab.previewAction('Raise ticket')} className="grid h-10 w-10 place-items-center rounded-[14px] text-white sm:hidden" style={{ background: BENTO.primary }}>
                    <Plus className="h-5 w-5" />
                </button>
            </div>
        </header>
    );
}

function BottomBar({ lab, screen, setScreen }: DesignProps) {
    const [more, setMore] = useState(false);
    const items = lab.nav.filter(n => n.group === 'main' || n.id === 'checklists' || n.id === 'visitors').slice(0, 4);
    return (
        <>
            <MobileNavSheet lab={lab} open={more} onClose={() => setMore(false)} screen={screen} setScreen={setScreen} activeStyle={{ background: BENTO.primary, color: '#FFFFFF' }} />
            <nav aria-label="Main" className="fixed inset-x-[12px] bottom-[12px] z-40 grid h-[64px] grid-cols-5 items-center rounded-[22px] px-[6px] md:hidden"
                style={{ background: 'rgba(255,255,255,0.8)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', boxShadow: '0 10px 30px rgba(15,32,26,0.12)' }}>
                {items.map(item => {
                    const Icon = item.icon;
                    const on = !!item.screen && (item.screen === screen || (item.screen === 'tickets' && screen === 'detail'));
                    return (
                        <button key={item.id} type="button" aria-current={on ? 'page' : undefined}
                            onClick={() => (item.screen ? setScreen(item.screen) : lab.previewAction(`Open ${item.label}`))}
                            className="mx-auto flex h-[52px] w-full flex-col items-center justify-center gap-[2px] rounded-[16px] text-[10.5px] font-medium"
                            style={on ? { background: BENTO.tint, color: BENTO.deep } : { color: BENTO.text2 }}>
                            <Icon className="h-5 w-5" aria-hidden />
                            {item.label}
                        </button>
                    );
                })}
                <button type="button" onClick={() => setMore(true)} className="mx-auto flex h-[52px] w-full flex-col items-center justify-center gap-[2px] text-[10.5px] font-medium" style={{ color: BENTO.text2 }}>
                    <LayoutGrid className="h-5 w-5" aria-hidden />
                    More
                </button>
            </nav>
        </>
    );
}

export default function BentoDesign(props: DesignProps) {
    const { lab, screen } = props;
    return (
        <DesignFrame theme={bentoTheme} lab={lab} drawer={bentoDrawer}>
            <div className="flex">
                <Sidebar {...props} />
                <div className="min-w-0 flex-1">
                    <TopBar {...props} />
                    <main className="mx-auto w-full max-w-[1360px] px-[16px] pb-[110px] pt-[20px] md:px-[24px] md:pb-[40px] md:pt-[24px]">
                        <OfflineBanner online={lab.online} className="mb-[16px]" style={{ background: '#FFFFFF', borderRadius: 18, boxShadow: BENTO.shadow }} />
                        {screen === 'dashboard' && <BentoDashboard {...props} />}
                        {screen === 'tickets' && <BentoTickets {...props} />}
                        {screen === 'detail' && <BentoDetail {...props} />}
                    </main>
                </div>
            </div>
            <BottomBar {...props} />
        </DesignFrame>
    );
}
