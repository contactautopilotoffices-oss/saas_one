'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname, useParams } from 'next/navigation';
import { Wallet, IndianRupee, ArrowLeft, LogOut, Menu, X, Lock, Target, Siren } from 'lucide-react';
import { useAuth } from '@/frontend/context/AuthContext';
import { accountsCaps } from '@/frontend/lib/accounts/roles';
import { canSeeAop } from '@/frontend/lib/aop/access';
import { FMS_ROLES } from '@/frontend/lib/auth/silos';

/**
 * Accounts (Finance) workspace chrome.
 *
 * The Finance module now has its OWN sidebar instead of being injected into the
 * FMS / CRM chromes — the parent (dashboard) layout skips the shared sidebar for
 * /accounts and /petty-cash so this provides the whole shell. Same "own chrome"
 * pattern the FMS dashboard already uses.
 */
export default function AccountsWorkspace({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    const params = useParams();
    const orgId = params?.orgId as string;
    const { membership, signOut } = useAuth();
    const [mobileOpen, setMobileOpen] = useState(false);

    const caps = accountsCaps(membership);
    const tenantLike = new Set(['tenant', 'tenant_user', 'super_tenant', 'vendor']);
    const roles = [membership?.org_role, ...(membership?.properties?.map((p) => p.role) || [])].filter(Boolean) as string[];
    const canSeePettyCash = !!membership?.is_master_admin || roles.some((r) => !tenantLike.has(r));

    // A siloed finance user has no FMS dashboard to go back to — offering the link would
    // bounce them into a screen they cannot access.
    const hasFmsHome = !!membership?.is_master_admin || roles.some((r) => FMS_ROLES.includes(r));

    // The AOP tracker is site-level P&L — narrower than the rest of this workspace.
    const canSeeAopTracker = canSeeAop(membership);

    // Escalation routing is org configuration, not finance data — admins only. It lives in
    // this workspace because the critical-PO path in the Payment Tracker depends on it, and
    // a matrix nobody can find is the reason workflow_spoc_rules stayed empty.
    const canEditEscalation = !!membership?.is_master_admin
        || roles.some((r) => ['org_super_admin', 'org_admin', 'master_admin'].includes(r));

    const links = [
        caps.canSee && { href: `/${orgId}/accounts`, label: 'Payment Tracker', icon: IndianRupee },
        canSeePettyCash && { href: `/${orgId}/petty-cash`, label: 'Petty Cash', icon: Wallet },
        canSeeAopTracker && { href: `/${orgId}/aop`, label: 'AOP Budget vs Actual', icon: Target },
        canEditEscalation && { href: `/${orgId}/settings/escalation`, label: 'Escalation SPOCs', icon: Siren },
    ].filter(Boolean) as { href: string; label: string; icon: React.ComponentType<{ className?: string }> }[];

    const sidebar = (
        <div className="flex flex-col h-full">
            <div className="px-5 py-5 border-b border-border">
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-primary">Accounts</p>
                <p className="text-sm font-bold text-text-primary mt-0.5">Finance workspace</p>
            </div>

            <nav className="flex-1 px-3 pt-4 space-y-1 overflow-y-auto">
                {links.map((l) => {
                    const active = pathname?.startsWith(l.href);
                    const Icon = l.icon;
                    return (
                        <Link
                            key={l.href}
                            href={l.href}
                            onClick={() => setMobileOpen(false)}
                            className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-bold transition-all ${
                                active ? 'bg-primary text-white shadow-sm' : 'text-text-secondary hover:bg-surface-elevated hover:text-text-primary'
                            }`}
                        >
                            <Icon className="w-4 h-4" />
                            {l.label}
                        </Link>
                    );
                })}
            </nav>

            <div className="px-3 py-4 border-t border-border space-y-1">
                {hasFmsHome && (
                    <Link
                        href={`/${orgId}/dashboard`}
                        className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-bold text-text-secondary hover:bg-surface-elevated hover:text-text-primary"
                    >
                        <ArrowLeft className="w-4 h-4" />
                        Back to Dashboard
                    </Link>
                )}
                <button
                    onClick={() => signOut?.()}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-bold text-text-secondary hover:bg-red-50 hover:text-red-600 transition-all"
                >
                    <LogOut className="w-4 h-4" />
                    Sign out
                </button>
            </div>
        </div>
    );

    // Nothing in the workspace is for a user with neither capability. Render a bare denial
    // instead of the chrome so the nav itself is not exposed. (The API layer enforces this
    // independently — see backend/lib/accounts/access.ts — this is the UI half.)
    if (!caps.canSee && !canSeePettyCash && !canSeeAopTracker && !canEditEscalation) {
        return (
            <div className="min-h-screen bg-background flex flex-col items-center justify-center p-10 text-center">
                <div className="w-14 h-14 rounded-2xl bg-red-50 text-red-500 flex items-center justify-center mb-4">
                    <Lock className="w-7 h-7" />
                </div>
                <h2 className="text-lg font-bold text-text-primary">Finance workspace is restricted</h2>
                <p className="text-sm text-text-secondary mt-1 max-w-sm">
                    Your role doesn’t have access to the Payment Tracker or Petty Cash. Contact your administrator if you believe this is wrong.
                </p>
            </div>
        );
    }

    return (
        <div className="flex min-h-screen bg-background">
            {/* Desktop sidebar */}
            <aside className="hidden lg:flex w-64 shrink-0 bg-surface border-r border-border flex-col">{sidebar}</aside>

            {/* Mobile top bar */}
            <div className="lg:hidden fixed top-0 inset-x-0 z-40 h-14 bg-surface border-b border-border flex items-center justify-between px-4">
                <div className="flex items-center gap-1 min-w-0">
                    {hasFmsHome && (
                        <Link href={`/${orgId}/dashboard`} className="-ml-2 p-2 text-text-secondary" aria-label="Back to dashboard">
                            <ArrowLeft className="w-5 h-5" />
                        </Link>
                    )}
                    <p className="text-sm font-bold text-text-primary truncate">Accounts · Finance</p>
                </div>
                <button onClick={() => setMobileOpen(true)} className="p-2" aria-label="Open menu">
                    <Menu className="w-5 h-5 text-text-secondary" />
                </button>
            </div>
            {mobileOpen && (
                <div className="lg:hidden fixed inset-0 z-50 flex">
                    <div className="absolute inset-0 bg-black/40" onClick={() => setMobileOpen(false)} />
                    <aside className="relative w-64 bg-surface border-r border-border flex flex-col">
                        <div className="flex justify-end p-2">
                            <button onClick={() => setMobileOpen(false)} className="p-2" aria-label="Close menu">
                                <X className="w-5 h-5 text-text-secondary" />
                            </button>
                        </div>
                        {sidebar}
                    </aside>
                </div>
            )}

            {/* Main content */}
            <main className="flex-1 min-w-0 pt-14 lg:pt-0 overflow-x-hidden">
                <div className="responsive-container py-4 lg:py-6">{children}</div>
            </main>
        </div>
    );
}
