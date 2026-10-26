import {
    BarChart3, Bot, Boxes, CalendarClock, ClipboardCheck, Coffee, DoorOpen, LayoutDashboard, Presentation,
    PackageSearch, Settings, ShieldAlert, Ticket, UserRound, Users, Zap, type LucideIcon,
} from 'lucide-react';
import type { NavItem } from './types';

/**
 * Every module the brief lists, with the roles that can use it. Navigation renders only
 * what the viewer's role allows. This is a presentation filter for the preview; the real
 * access rules stay in the app's layouts and APIs, untouched.
 */

const ADMIN = ['property_admin', 'org_admin', 'org_super_admin', 'ops_super_admin', 'master_admin', 'owner', 'soft_service_manager'];
const TECH = ['staff', 'mst', 'technician', 'soft_service_supervisor'];
const SECURITY = ['security'];
const TENANT = ['tenant', 'super_tenant'];
const VENDOR = ['vendor', 'food_vendor'];
const PROCUREMENT = ['procurement', 'purchase_manager', 'purchase_executive'];

interface NavDef extends NavItem {
    icon: LucideIcon;
    roles: string[];
}

const NAV: NavDef[] = [
    { id: 'dashboard', label: 'Dashboard', group: 'main', screen: 'dashboard', icon: LayoutDashboard, roles: [...ADMIN, ...TECH, ...SECURITY, ...VENDOR, ...PROCUREMENT] },
    { id: 'tickets', label: 'Tickets', group: 'main', screen: 'tickets', icon: Ticket, roles: [...ADMIN, ...TECH, ...SECURITY, ...VENDOR] },
    { id: 'checklists', label: 'Checklists', group: 'operations', icon: ClipboardCheck, roles: [...ADMIN, ...TECH, ...SECURITY] },
    { id: 'ppm', label: 'PPM', group: 'operations', icon: CalendarClock, roles: [...ADMIN, ...TECH] },
    { id: 'utilities', label: 'Utilities', group: 'operations', icon: Zap, roles: [...ADMIN, ...TECH] },
    { id: 'visitors', label: 'Visitors', group: 'operations', icon: DoorOpen, roles: [...ADMIN, ...SECURITY] },
    { id: 'stock', label: 'Stock', group: 'operations', icon: Boxes, roles: [...ADMIN, ...TECH, ...PROCUREMENT] },
    { id: 'materials', label: 'Material requests', group: 'operations', icon: PackageSearch, roles: [...ADMIN, ...TECH, ...PROCUREMENT] },
    { id: 'rooms', label: 'Meeting rooms', group: 'operations', icon: Presentation, roles: [...ADMIN] },
    { id: 'cafeteria', label: 'Cafeteria', group: 'operations', icon: Coffee, roles: [...ADMIN, ...VENDOR] },
    { id: 'team', label: 'Team', group: 'people', icon: Users, roles: [...ADMIN] },
    { id: 'escalation', label: 'Escalation', group: 'people', icon: ShieldAlert, roles: [...ADMIN] },
    { id: 'reports', label: 'Reports', group: 'people', icon: BarChart3, roles: [...ADMIN, ...PROCUREMENT] },
    { id: 'my-requests', label: 'My requests', group: 'tenant', screen: 'tickets', icon: Ticket, roles: TENANT },
    { id: 'tenant-rooms', label: 'Rooms', group: 'tenant', icon: Presentation, roles: TENANT },
    { id: 'tenant-visitors', label: 'My visitors', group: 'tenant', icon: DoorOpen, roles: TENANT },
    { id: 'cassandra', label: 'Cassandra AI', group: 'tenant', icon: Bot, roles: TENANT },
    { id: 'profile', label: 'Profile', group: 'account', icon: UserRound, roles: ['*'] },
    { id: 'settings', label: 'Settings', group: 'account', icon: Settings, roles: [...ADMIN] },
];

export type LabNavItem = NavDef;

export function navForRole(role: string): LabNavItem[] {
    const r = role || 'property_admin';
    const known = NAV.some(n => n.roles.includes(r));
    // An unknown role gets the admin view in the preview rather than an empty sidebar.
    const effective = known ? r : 'property_admin';
    return NAV.filter(n => n.roles.includes('*') || n.roles.includes(effective));
}

export const ORG_WIDE_ROLES = ['org_admin', 'org_super_admin', 'ops_super_admin', 'master_admin', 'owner'];

export const ROLE_LABELS: Record<string, string> = {
    property_admin: 'Property admin',
    org_admin: 'Org admin',
    org_super_admin: 'Org super admin',
    ops_super_admin: 'Ops super admin',
    master_admin: 'Master admin',
    owner: 'Owner',
    staff: 'Staff',
    mst: 'Technician',
    technician: 'Technician',
    security: 'Security',
    tenant: 'Tenant',
    super_tenant: 'Tenant admin',
    vendor: 'Vendor',
    food_vendor: 'Food vendor',
    procurement: 'Procurement',
    purchase_manager: 'Purchase manager',
    purchase_executive: 'Purchase executive',
    soft_service_manager: 'Soft services manager',
    soft_service_supervisor: 'Soft services supervisor',
};

export const QUICK_ACTIONS = [
    { id: 'raise', label: 'Raise ticket' },
    { id: 'checkin', label: 'Check in visitor' },
    { id: 'reading', label: 'Log reading' },
    { id: 'scan', label: 'Scan QR' },
] as const;
