'use client';
import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import { Wallet } from 'lucide-react';
import { useAuth } from '@/frontend/context/AuthContext';
import { pettyCashCaps } from '@/frontend/lib/pettyCash/roles';
export default function PettyCashNavLink({ onNavigate }: { onNavigate?: () => void } = {}) {
    const pathname = usePathname();
    const params = useParams();
    const { membership } = useAuth();
    const org = typeof params?.orgId === 'string' ? params.orgId
        : membership?.properties?.find(p => p.id === params?.propertyId)?.organization_id || membership?.org_id;
    if (!org || !pettyCashCaps(membership, org).canSee) return null;
    const active = !!pathname && /\/petty-cash(\/|$)/.test(pathname);
    return <Link onClick={onNavigate} aria-current={active ? 'page' : undefined} href={`/${org}/petty-cash`} className={`flex items-center gap-3 px-4 py-2.5 rounded-xl font-bold text-sm ${active ? 'bg-primary text-text-inverse shadow-sm' : 'text-text-secondary hover:bg-muted hover:text-text-primary'}`}><Wallet className="w-4 h-4 shrink-0" /><span>Petty Cash</span></Link>;
}
