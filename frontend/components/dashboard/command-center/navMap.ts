import type { LucideIcon } from 'lucide-react';
import {
  LayoutDashboard,
  Sparkles,
  Gauge,
  Bot,
  Network,
  ListChecks,
  PhoneCall,
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
 * - Invoices / Payments live in the Accounts workspace (`/{orgId}/accounts`), which is
 *   also where the electricity payment queue (the open-bill money at risk) lives.
 * - Organization Progress and the wider OEM console (agent registry, data bundles,
 *   council log) both render as console TABS — `?tab=org_progress` and
 *   `?tab=org_efficiency`. Standalone `/{orgId}/org-progress` and
 *   `/{orgId}/org-efficiency` pages still exist, but they live in the (dashboard)
 *   route group and so paint the staff sidebar. Linking them from this rail threw
 *   the super admin out of their own console; always route these two via tab().
 * - Settings is `/{orgId}/settings`.
 * - Purchase Mailbox, AI Brief (full view), Waste Management and Documents
 *   have no page yet — those items come back `disabled` instead of pointing
 *   at a dead anchor.
 * - Agents have no route of their own: the Agent Console is a card on the
 *   Command Center board, and Ira's digest is API-rendered HTML
 *   (`cardLinks.agentDigest`), which the rail's next/link cannot route to.
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
  /** Full Organization Progress tracker — the glance card only summarises it. */
  orgProgress: string;
  viewVisitors: string;
  viewVendors: string;
  /** Open electricity bills sit in the Accounts payment queue, not the electricity tab. */
  viewElectricityBills: string;
  /** Ira's digest, served as HTML by the API route. Open it with a plain anchor. */
  agentDigest?: string;
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
        // Was `${org}/org-progress` — a page in the (dashboard) route group, which
        // renders the *staff* DashboardSidebar. Clicking Org Progress from inside the
        // super-admin console therefore threw the user out of the console into staff
        // chrome. It is a console tab; link it as one.
        { label: 'Org Progress', icon: Gauge, href: tab('org_progress') },
        // No full AI Brief page exists yet.
        { label: 'AI Brief', icon: Sparkles, disabled: true },
      ],
    },
    {
      label: 'Agents',
      items: [
        // The console is a card on the Command Center board, not its own route.
        { label: 'Agent Console', icon: Bot, href: `${org}/dashboard` },
        // The OEM console's Agents & Council tab — agent registry, data bundles,
        // generated prompts and the council log. A real page, previously unlinked.
        { label: 'Agents & Council', icon: Network, href: tab('org_efficiency') },
        // Digest is API-rendered HTML (app/api/ira/daily-digest) — the card opens it
        // with a plain anchor; there is no page for the rail to route to.
        { label: 'Ira — Daily Digest', icon: ListChecks, disabled: true },
        // Pratiksha is voice-call templates only; nothing to open yet.
        { label: 'Pratiksha', icon: PhoneCall, disabled: true },
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
    // The glance card only summarises the meter; the full tracker is a console tab.
    orgProgress: tab('org_progress'),
    viewVisitors: tab('visitors'),
    viewVendors: tab('vendors'),
    // Open bills are settled from the Accounts payment queue, not the electricity tab —
    // the electricity tab logs consumption, Accounts is where money moves.
    viewElectricityBills: `${org}/accounts`,
    agentDigest: '/api/ira/daily-digest',
  };

  return { rail, cardLinks };
}
