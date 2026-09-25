// Client-side asset-management capabilities, derived from the user's membership.
// Mirrors backend/lib/assets/access.ts so the UI shows the right tabs/actions.
// (The API still enforces permissions server-side.)

const TENANT_LIKE = new Set(['tenant', 'tenant_user', 'super_tenant', 'vendor']);
const ORG_ADMIN = new Set(['org_super_admin', 'org_admin', 'master_admin', 'ops_super_admin', 'owner']);
const MANAGER = new Set([
    ...ORG_ADMIN,
    'property_admin', 'manager_executive', 'soft_service_manager', 'soft_service_supervisor', 'accounts',
]);

export interface AssetCaps {
    /** may open the module at all (everyone except tenant-like roles) */
    canSee: boolean;
    /** whole-org scope */
    isAdmin: boolean;
    /** create / edit / import / categories / costs */
    canManage: boolean;
    properties: { id: string; name: string; code?: string; role?: string }[];
}

interface MembershipLike {
    org_role?: string | null;
    is_master_admin?: boolean;
    properties?: { id: string; name: string; code?: string; role?: string; organization_id?: string | null }[];
}

export function assetCaps(membership: MembershipLike | null | undefined): AssetCaps {
    const roles = [membership?.org_role, ...(membership?.properties?.map((p) => p.role) || [])].filter(Boolean) as string[];
    const isMaster = !!membership?.is_master_admin;
    const isAdmin = isMaster || roles.some((r) => ORG_ADMIN.has(r));
    return {
        canSee: isMaster || roles.some((r) => !TENANT_LIKE.has(r)),
        isAdmin,
        canManage: isAdmin || roles.some((r) => MANAGER.has(r)),
        properties: membership?.properties || [],
    };
}

export const ASSET_STATUS_META: Record<string, { label: string; color: string }> = {
    active: { label: 'Active', color: '#10B981' },
    under_repair: { label: 'Under repair', color: '#F59E0B' },
    inactive: { label: 'Inactive', color: '#94A3B8' },
    decommissioned: { label: 'Decommissioned', color: '#64748B' },
    disposed: { label: 'Disposed', color: '#EF4444' },
};

export const EVENT_TYPE_META: Record<string, { label: string; color: string }> = {
    created: { label: 'Registered', color: '#708F96' },
    imported: { label: 'Imported', color: '#708F96' },
    updated: { label: 'Details updated', color: '#94A3B8' },
    ticket_work: { label: 'Ticket work', color: '#3B82F6' },
    ppm: { label: 'Preventive maintenance', color: '#10B981' },
    amc: { label: 'AMC', color: '#7C3AED' },
    warranty: { label: 'Warranty', color: '#0EA5E9' },
    cost: { label: 'Cost incurred', color: '#F59E0B' },
    status_change: { label: 'Status change', color: '#EF4444' },
    note: { label: 'Note', color: '#64748B' },
    scan: { label: 'Scanned', color: '#94A3B8' },
};

export const inr = (n: number | null | undefined) =>
    `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

/**
 * The site address printed into QR labels. Same rule as the existing poster QRs
 * (ClientQRGeneratorModal): the address the admin is on, else the configured
 * public URL. Returns '' only when neither is known — callers must not print then,
 * because a label encoding a bare "/a/<token>" cannot be opened by a phone camera.
 */
export function appOrigin(): string {
    if (typeof window !== 'undefined' && window.location?.origin) return window.location.origin;
    return (process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/+$/, '');
}

/** The URL a printed QR resolves to. */
export const assetScanUrl = (token: string, origin?: string) => `${origin || appOrigin()}/a/${token}`;

/** Parse a scanned string into an asset token, or null. */
export function assetTokenFromScan(decoded: string): string | null {
    const m = decoded.match(/\/a\/([A-Za-z0-9_-]{8,64})(?:[?#]|$)/);
    if (m) return m[1];
    try {
        const parsed = JSON.parse(decoded);
        if (parsed?.asset_token) return String(parsed.asset_token);
    } catch { /* not JSON */ }
    return null;
}
