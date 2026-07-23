'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname, useParams } from 'next/navigation';
import { ArrowLeftRight, LayoutDashboard, Building2 } from 'lucide-react';
import { useAuth } from '@/frontend/context/AuthContext';
import { isBdSuperAdmin } from '@/frontend/constants/bdSuperAdmins';

/**
 * Floating CRM ⇄ FMS switch — only for BD Super Admins.
 *
 * The CRM uses the shared sidebar while the FMS dashboard renders its own chrome
 * (and bypasses the shared layout), so a layout-level floating pill is the one
 * control that works consistently across both. Self-gates: renders nothing for
 * anyone who isn't a BD Super Admin.
 */
export default function ModuleSwitch() {
    const { user, membership } = useAuth();
    const pathname = usePathname();
    const params = useParams();
    const orgId = params?.orgId as string;

    if (!orgId || !isBdSuperAdmin(user?.email, membership?.org_role)) return null;

    const inCrm = !!pathname?.includes('/crm');
    const target = inCrm ? `/${orgId}/dashboard` : `/${orgId}/crm`;
    const label = inCrm ? 'Switch to FMS' : 'Switch to CRM';
    const Icon = inCrm ? Building2 : LayoutDashboard;

    return (
        <Link
            href={target}
            aria-label={label}
            className="fixed bottom-5 right-5 z-[60] flex items-center gap-2 pl-3.5 pr-4 py-2.5 rounded-full bg-primary text-white shadow-lg shadow-primary/30 hover:bg-primary/90 hover:gap-2.5 transition-all text-sm font-bold"
        >
            <span className="relative flex items-center">
                <ArrowLeftRight className="w-4 h-4" />
            </span>
            <Icon className="w-4 h-4 opacity-90" />
            <span>{label}</span>
        </Link>
    );
}
