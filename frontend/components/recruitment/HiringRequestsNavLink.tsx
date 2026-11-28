'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import { Briefcase } from 'lucide-react';
import { useAuth } from '@/frontend/context/AuthContext';

/*
 * "Hiring requests" in a login's sidebar (owner 2026-11-20): shown only to the roles and people the Tech team picked in
 * the Tech dashboard's HR Configs tab ("make it configurable somewhere in the tech login on who can have that option in
 * their sidebars"). It asks the server once per organisation (/api/recruitment/can-raise) and shows nothing
 * until the answer is yes. Placed next to Petty Cash in every sidebar that has it. Owner 2026-11-21: department heads
 * get it too (canOpen), to follow and endorse their departments' requests. Owner 2026-11-21: "add it to all dashboards
 * apart from the tenant login" (Tech console, department consoles and Accounts too; not the food vendor, Super Tenant
 * or vendor portal: owner, same day); who sees it is still only what HR Configs says.
 */

const answers = new Map<string, Promise<boolean>>();
function canRaise(orgId: string, key: string): Promise<boolean> {
    let p = answers.get(key);
    if (!p) {
        p = fetch(`/api/recruitment/can-raise?orgId=${encodeURIComponent(orgId)}`, { cache: 'no-store' })
            .then(async res => { if (!res.ok) return false; const body = await res.json(); return Boolean(body?.canOpen ?? body?.canRaise); })
            .catch(() => { answers.delete(key); return false; });
        answers.set(key, p);
    }
    return p;
}

export default function HiringRequestsNavLink({ onNavigate, compact = false, rail = false }: { onNavigate?: () => void; compact?: boolean; rail?: boolean } = {}) {
    const pathname = usePathname();
    const params = useParams();
    const { membership, user } = useAuth();
    // Owner 2026-11-21: in every login but the tenant's; a property-only login (no organisation role) uses its property's organisation.
    const property = membership?.properties?.find(p => p.id === params?.propertyId);
    const org = (typeof params?.orgId === 'string' ? params.orgId : '') || property?.organization_id || membership?.org_id || membership?.properties?.find(p => p.organization_id)?.organization_id || '';
    const key = user?.id && org ? `${user.id}:${org}` : '';
    const [shown, setShown] = useState<{ key: string; yes: boolean } | null>(null);
    useEffect(() => {
        if (!key) return;
        let live = true;
        void canRaise(org, key).then(yes => { if (live) setShown({ key, yes }); });
        return () => { live = false; };
    }, [org, key]);
    if (!key || shown?.key !== key || !shown.yes) return null;

    const active = !!pathname && /\/hiring-requests(\/|$)/.test(pathname);
    return (
        <Link
            onClick={() => onNavigate?.()}
            aria-current={active ? 'page' : undefined}
            title="Hiring requests"
            href={`/${org}/hiring-requests`}
            className={`flex items-center ${compact ? 'gap-2.5 px-2.5 rounded-lg' : 'gap-3 px-4 rounded-xl'} py-2.5 font-bold text-sm ${active ? 'bg-primary text-text-inverse shadow-sm' : 'text-text-secondary hover:bg-muted hover:text-text-primary'}`}
        >
            <Briefcase className="w-4 h-4 shrink-0" />
            <span className={rail ? 'sr-only' : ''}>Hiring requests</span>
        </Link>
    );
}
