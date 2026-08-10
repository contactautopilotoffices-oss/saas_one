import {
    IndianRupee, Zap, ReceiptIndianRupee, Mail, FileText,
    LifeBuoy, PackageSearch, Boxes,
} from 'lucide-react';
import type { WidgetDef } from './types';

/**
 * The widget registry — the definitive list of cards the ops board can render.
 *
 * Adding a widget here is the only step needed to make it available: the grid picks up the
 * new entry, existing users get it appended to their saved board at its default position,
 * and it lazy-loads on first paint.
 *
 * ROLES are a UX filter for the picker, not a security boundary. Every widget's API
 * enforces its own access independently, and each widget returns null on a 403 — so a card
 * that slips through this filter still shows nothing rather than leaking. The mail digest
 * is the sharpest case: it is procurement + super admin only and 403s for accounts and
 * org_admin, which is enforced server-side regardless of what this list says.
 *
 * WHAT IS DELIBERATELY ABSENT: BD Pipeline / CRM and Visitor Management. An operations
 * super admin has no use for lead-stage counts, and visitor tallies had been crowding out
 * the mailbox digest. Both are removed from this board by decision, not oversight.
 */

const SUPER_ADMIN = ['org_super_admin', 'master_admin'];
const PROCUREMENT = ['procurement', 'purchase_manager', 'purchase_executive'];
const OPS_LEADERSHIP = [...SUPER_ADMIN, 'org_admin', 'ops_super_admin'];
const FINANCE = [...SUPER_ADMIN, 'accounts'];

export const OPS_WIDGETS: WidgetDef[] = [
    {
        id: 'aop-spend',
        title: 'Budget vs Actual',
        description: 'Operating plan utilisation and the sites running over.',
        icon: IndianRupee,
        roles: FINANCE,
        sizes: ['sm', 'md', 'lg', 'xl'],
        defaultSize: 'lg',
        defaultOrder: 0,
        href: (orgId) => `/${orgId}/aop`,
        load: () => import('@/frontend/components/dashboard/widgets/AopSpendWidget'),
    },
    {
        id: 'mail-digest',
        title: 'Purchase mailbox',
        description: 'Threads waiting on a reply, by subject and by person.',
        icon: Mail,
        roles: [...SUPER_ADMIN, ...PROCUREMENT],
        sizes: ['sm', 'md', 'lg', 'xl'],
        defaultSize: 'lg',
        defaultOrder: 1,
        load: () => import('@/frontend/components/dashboard/widgets/MailDigestWidget'),
    },
    {
        id: 'purchase-orders',
        title: 'Purchase orders',
        description: 'Value stuck in the alignment queue and what is critical.',
        icon: FileText,
        roles: [...FINANCE, ...PROCUREMENT],
        sizes: ['sm', 'md', 'lg', 'xl'],
        defaultSize: 'md',
        defaultOrder: 2,
        href: (orgId) => `/${orgId}/accounts`,
        load: () => import('@/frontend/components/dashboard/widgets/PurchaseOrdersWidget'),
    },
    {
        id: 'tickets',
        title: 'Tickets',
        description: 'Active backlog and how much of it is past SLA.',
        icon: LifeBuoy,
        roles: [...OPS_LEADERSHIP, ...PROCUREMENT],
        sizes: ['sm', 'md', 'lg', 'xl'],
        defaultSize: 'md',
        defaultOrder: 3,
        load: () => import('@/frontend/components/dashboard/widgets/TicketsWidget'),
    },
    {
        id: 'electricity-bills',
        title: 'Electricity bills',
        description: 'Early-payment discounts about to expire and overdue bills.',
        icon: ReceiptIndianRupee,
        roles: FINANCE,
        sizes: ['sm', 'md', 'lg', 'xl'],
        defaultSize: 'md',
        defaultOrder: 4,
        load: () => import('@/frontend/components/dashboard/widgets/ElectricityBillsWidget'),
    },
    {
        id: 'electricity-pace',
        title: 'Electricity use',
        description: 'Consumption against the same days last month, with data-quality alerts.',
        icon: Zap,
        roles: OPS_LEADERSHIP,
        sizes: ['sm', 'md', 'lg', 'xl'],
        defaultSize: 'md',
        defaultOrder: 5,
        load: () => import('@/frontend/components/dashboard/widgets/ElectricityPaceWidget'),
    },
    {
        id: 'material-requests',
        title: 'Material requests',
        description: 'Requests waiting on a quote or a decision, and how long.',
        icon: PackageSearch,
        roles: [...OPS_LEADERSHIP, ...PROCUREMENT],
        sizes: ['sm', 'md', 'lg', 'xl'],
        defaultSize: 'md',
        defaultOrder: 6,
        load: () => import('@/frontend/components/dashboard/widgets/MaterialRequestsWidget'),
    },
    {
        id: 'stock',
        title: 'Stock',
        description: 'Items below reorder level and what has run to zero.',
        icon: Boxes,
        roles: OPS_LEADERSHIP,
        sizes: ['sm', 'md', 'lg', 'xl'],
        defaultSize: 'md',
        defaultOrder: 7,
        load: () => import('@/frontend/components/dashboard/widgets/StockWidget'),
    },
];

/** Widgets this user's role is allowed to place on their board. */
export function widgetsForRole(role: string | null | undefined): WidgetDef[] {
    if (!role) return [];
    const r = role.toLowerCase();
    return OPS_WIDGETS.filter(w => w.roles.includes(r));
}
