import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { resolveAccountsAccess, isAccountsAccessError, readOrgId, type AccountsAccess } from '@/backend/lib/accounts/access';
import { loadInvoiceSettings } from './settings';
import type { InvoiceSettings } from './types';

/**
 * Who may do what in Invoice Control. Built ON the Payment Tracker's access check, so
 * the org scoping and role membership rules are the ones already trusted there; this
 * file only adds the invoice-specific capabilities on top.
 *
 *   view            everyone the tracker lets in (purchase, accounts, admins, ops view-only)
 *   generate link   purchase roles + org admins
 *   fast-track ask  purchase roles + org admins
 *   resolve a blocking mismatch   purchase_manager + org admins
 *   resolve a soft issue          any purchase role, accounts, org admins
 *   accept (reconcile)            accounts + super admins
 *   decide an exception           roles listed in settings.approver_roles (and master admin)
 *   decide above the limit        roles listed in settings.escalation_roles
 *   record alignment              accounts + super admins  (purchase cannot align its own ask)
 *   change policy                 org_super_admin + master_admin
 *
 * ops_super_admin is view-only here, same as the tracker.
 */

const PURCHASE_ROLES = ['purchase_manager', 'purchase_executive', 'procurement'];
const ORG_ADMINS = ['org_super_admin', 'org_admin', 'master_admin'];
const SUPER = ['org_super_admin', 'master_admin'];

export interface InvoiceAccess {
    userId: string;
    orgId: string;
    roles: string[];
    isMaster: boolean;
    settings: InvoiceSettings;
    canGenerateLink: boolean;
    canRaiseFastTrack: boolean;
    canResolveSoft: boolean;
    canResolveBlocking: boolean;
    canAccept: boolean;
    canDecide: boolean;
    canDecideAboveLimit: boolean;
    canAlign: boolean;
    canConfigure: boolean;
}

export function invoiceCaps(roles: string[], isMaster: boolean, settings: InvoiceSettings) {
    const any = (list: string[]) => isMaster || roles.some((r) => list.includes(r));
    return {
        canGenerateLink: any([...PURCHASE_ROLES, ...ORG_ADMINS]),
        canRaiseFastTrack: any([...PURCHASE_ROLES, ...ORG_ADMINS]),
        canResolveSoft: any([...PURCHASE_ROLES, 'accounts', ...ORG_ADMINS]),
        canResolveBlocking: any(['purchase_manager', ...ORG_ADMINS]),
        canAccept: any(['accounts', ...SUPER]),
        canDecide: any(settings.approver_roles),
        canDecideAboveLimit: any(settings.escalation_roles),
        canAlign: any(['accounts', ...SUPER]),
        canConfigure: any(SUPER),
    };
}

export async function requireInvoiceAccess(request: NextRequest, body?: unknown): Promise<InvoiceAccess | NextResponse> {
    const access: AccountsAccess | NextResponse = await resolveAccountsAccess(request, readOrgId(request, body));
    if (isAccountsAccessError(access)) return access;
    const settings = await loadInvoiceSettings(access.organizationId);
    return {
        userId: access.user.id,
        orgId: access.organizationId,
        roles: access.roles,
        isMaster: access.isMasterAdmin,
        settings,
        ...invoiceCaps(access.roles, access.isMasterAdmin, settings),
    };
}

export const isInvoiceAccessError = (x: InvoiceAccess | NextResponse): x is NextResponse => x instanceof NextResponse;

export const forbidden = (message = 'You do not have permission to do this.') =>
    NextResponse.json({ error: message }, { status: 403 });
