import type { LucideIcon } from 'lucide-react';
import {
  LayoutDashboard,
  Sparkles,
  Ticket,
  CalendarDays,
  Users,
  Package,
  ShoppingCart,
  Mail,
  Zap,
  Droplets,
  Fuel,
  Trash2,
  Wallet,
  FileText,
  CreditCard,
  BarChart3,
  FolderOpen,
  Settings,
} from 'lucide-react';

/**
 * navMap — single source of truth for where every Command Center rail item
 * and card CTA actually lands in the app.
 *
 * Route reality (discovered Aug 2026):
 * - The org admin workspace lives at `/{orgId}/dashboard`; most modules are
 *   tabs inside OrgAdminDashboard opened via `?tab=<name>` (it restores
 *   `tab`, `filter` and `propertyId` from the query string on mount).
 * - Procurement is its own route (`/{orgId}/procurement-management`).
 * - Budget vs Actual is the AOP module (`/{orgId}/aop`).
 * - Invoices / Payments live in the Accounts workspace (`/{orgId}/accounts`).
 * - Settings is `/{orgId}/settings`.
 * - Purchase Mailbox, AI Brief (full view), Waste Management and Documents
 *   have no page yet — those items come back `disabled` instead of pointing
 *   at a dead anchor.
 */

export type NavItem = {
  label: string;
  icon: LucideIcon;
  href?: string;
  active?: boolean;
  disabled?: boolean;
};

export type NavSection = { label: string; items: NavItem[] };

export type CardLinks = {
  investigate: string;
  viewBudget: string;
  openMailbox?: string;
  viewRoster: string;
  viewAllTickets: string;
  viewFullReport: string;
  viewDg: string;
  viewAllBuildings: string;
  viewFullBrief?: string;
};

export type NavMap = {
  rail: NavSection[];
  cardLinks: CardLinks;
};

export function buildNavMap(orgId: string, propertyId?: string): NavMap {
  const org = `/${orgId}`;

  // OrgAdminDashboard restores `tab` + `propertyId` from the query string, so
  // tab links can deep-link a property scope too.
  const tab = (t: string) =>
    `${org}/dashboard?tab=${t}${propertyId ? `&propertyId=${propertyId}` : ''}`;

  const rail: NavSection[] = [
    {
      label: 'Overview',
      items: [
        { label: 'Command Center', icon: LayoutDashboard, href: `${org}/dashboard`, active: true },
        // No full AI Brief page exists yet.
        { label: 'AI Brief', icon: Sparkles, disabled: true },
      ],
    },
    {
      label: 'Operations',
      items: [
        { label: 'Tickets', icon: Ticket, href: tab('requests') },
        { label: 'PPM Calendar', icon: CalendarDays, href: tab('ppm') },
        { label: 'Roster Management', icon: Users, href: tab('roster') },
        { label: 'Material Requests', icon: Package, href: `${org}/procurement-management` },
        { label: 'Purchase Orders', icon: ShoppingCart, href: `${org}/procurement-management` },
        // Mailbox is API + digest only (app/api/procurement/mailbox) — no UI page.
        { label: 'Purchase Mailbox', icon: Mail, disabled: true },
      ],
    },
    {
      label: 'Utilities',
      items: [
        { label: 'Electricity', icon: Zap, href: tab('electricity') },
        { label: 'Water', icon: Droplets, href: tab('water') },
        { label: 'DG Monitoring', icon: Fuel, href: tab('diesel') },
        // No waste module page exists anywhere in the app.
        { label: 'Waste Management', icon: Trash2, disabled: true },
      ],
    },
    {
      label: 'Finance',
      items: [
        { label: 'Budget vs Actual', icon: Wallet, href: `${org}/aop` },
        { label: 'Invoices', icon: FileText, href: `${org}/accounts` },
        { label: 'Payments', icon: CreditCard, href: `${org}/accounts` },
      ],
    },
    {
      label: 'Other',
      items: [
        { label: 'Reports', icon: BarChart3, href: tab('reports') },
        // No documents module exists yet.
        { label: 'Documents', icon: FolderOpen, disabled: true },
        { label: 'Settings', icon: Settings, href: `${org}/settings` },
      ],
    },
  ];

  const cardLinks: CardLinks = {
    investigate: tab('requests'),
    viewBudget: `${org}/aop`,
    openMailbox: undefined, // no mailbox UI page yet
    viewRoster: tab('roster'),
    viewAllTickets: tab('requests'),
    viewFullReport: tab('reports'),
    viewDg: tab('diesel'),
    viewAllBuildings: tab('properties'),
    viewFullBrief: undefined, // no full brief page yet
  };

  return { rail, cardLinks };
}
