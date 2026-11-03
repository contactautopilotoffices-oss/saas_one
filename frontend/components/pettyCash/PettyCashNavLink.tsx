'use client';
import Link from 'next/link';
import { useParams, usePathname, useSearchParams } from 'next/navigation';
import { Wallet } from 'lucide-react';
import { useAuth } from '@/frontend/context/AuthContext';
import { pettyCashCaps } from '@/frontend/lib/pettyCash/roles';
import { pushDashboardNavigation } from '@/frontend/lib/dashboard/orgTabs';

export default function PettyCashNavLink({ onNavigate, compact=false, fromCrm=false }: { onNavigate?: () => void; compact?: boolean; fromCrm?: boolean } = {}) {
    const pathname = usePathname();
    const params = useParams();
    const searchParams = useSearchParams();
    const { membership } = useAuth();
    const org = typeof params?.orgId === 'string' ? params.orgId
        : membership?.properties?.find(p => p.id === params?.propertyId)?.organization_id || membership?.org_id;
    if (!org || !pettyCashCaps(membership, org).canSee) return null;

    const isDashboard = !!pathname && (pathname.includes('/dashboard') || pathname === '/dashboard');
    const isTabActive = isDashboard && searchParams?.get('tab') === 'petty-cash';
    const isPathActive = !!pathname && /\/petty-cash(\/|$)/.test(pathname);
    const active = isPathActive || isTabActive;

    const inCrm = fromCrm || (!!pathname && pathname.includes('/crm'));
    const href = typeof params?.orgId === 'string'
        ? (inCrm ? `/${org}/petty-cash?from=crm` : `/${org}/petty-cash`)
        : (inCrm ? `/petty-cash?from=crm` : `/petty-cash`);

    const handleClick = (e: React.MouseEvent) => {
        onNavigate?.();
        if (isDashboard && typeof window !== 'undefined') {
            e.preventDefault();
            const search = new URLSearchParams(window.location.search);
            search.set('tab', 'petty-cash');
            const target = `${pathname}?${search.toString()}`;
            pushDashboardNavigation(target);
            window.dispatchEvent(new Event('popstate'));
        }
    };

    return (
        <Link
            onClick={handleClick}
            aria-current={active ? 'page' : undefined}
            href={href}
            className={`flex items-center ${compact ? 'gap-2.5 px-2.5 rounded-lg' : 'gap-3 px-4 rounded-xl'} py-2.5 font-bold text-sm ${active ? 'bg-primary text-text-inverse shadow-sm' : 'text-text-secondary hover:bg-muted hover:text-text-primary'}`}
        >
            <Wallet className="w-4 h-4 shrink-0" />
            <span>Petty Cash</span>
        </Link>
    );
}

