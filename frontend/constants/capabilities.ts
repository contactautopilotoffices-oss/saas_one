import { RoleKey, CapabilityMatrix } from '../types/rbac';

export const CAPABILITY_MATRIX: Record<RoleKey, CapabilityMatrix> = {
    super_admin: {
        users: ['view', 'create', 'update', 'approve', 'assign', 'delete', 'suspend'],
        properties: ['view', 'create', 'update', 'delete'],
        tickets: ['view', 'create', 'update', 'approve', 'assign', 'delete'],
        assets: ['view', 'create', 'update', 'delete'],
        procurement: ['view', 'create', 'update', 'approve', 'delete'],
        visitors: ['view', 'create', 'update', 'delete'],
        security: ['view', 'create', 'update', 'delete'],
        dashboards: ['view'],
        reports: ['view'],
        vendors: ['view', 'create', 'update', 'delete'],
        crm: ['view', 'create', 'update', 'approve', 'assign', 'delete', 'suspend'],
        petty_cash: ['view', 'create', 'update', 'approve', 'delete'],
        accounts: ['view', 'create', 'update', 'approve', 'delete']
    },
    org_admin: {
        users: ['view', 'create', 'update', 'assign', 'suspend'],
        properties: ['view', 'update'],
        tickets: ['view', 'update', 'approve'],
        assets: ['view', 'update'],
        procurement: ['view', 'approve'],
        dashboards: ['view'],
        reports: ['view'],
        petty_cash: ['view', 'create', 'update', 'approve'],
        accounts: ['view', 'approve']
    },
    // Ops Super Admin — org-scoped electricity checker (validation sign-off, dispute
    // accept/reject). Sits below org_super_admin: no procurement approval authority.
    ops_super_admin: {
        users: ['view'],
        tickets: ['view', 'approve'],
        dashboards: ['view'],
        reports: ['view']
    },
    property_admin: {
        users: ['view', 'create', 'update', 'assign', 'suspend'],
        properties: ['view', 'update'],
        tickets: ['view', 'update', 'approve'],
        assets: ['view', 'update'],
        procurement: ['view', 'approve'],
        dashboards: ['view'],
        reports: ['view'],
        petty_cash: ['view', 'create', 'update', 'approve']
    },
    manager_executive: {
        tickets: ['view', 'approve'],
        assets: ['view'],
        dashboards: ['view'],
        reports: ['view'],
        petty_cash: ['view', 'create']
    },
    purchase_manager: {
        procurement: ['view', 'approve'],
        vendors: ['view'],
        dashboards: ['view'],
        petty_cash: ['view', 'create']
    },
    purchase_executive: {
        procurement: ['view', 'create'],
        vendors: ['view'],
        petty_cash: ['view', 'create']
    },
    mst: {
        tickets: ['view', 'update'],
        dashboards: ['view'],
        petty_cash: ['view', 'create']
    },
    hk: {
        tickets: ['view', 'update'],
        petty_cash: ['view', 'create']
    },
    fe: {
        tickets: ['view', 'update'],
        petty_cash: ['view', 'create']
    },
    se: {
        tickets: ['view', 'update'],
        petty_cash: ['view', 'create']
    },
    technician: {
        tickets: ['view', 'update'],
        petty_cash: ['view', 'create']
    },
    field_staff: {
        tickets: ['view'],
        petty_cash: ['view', 'create']
    },
    bms_operator: {
        assets: ['view', 'update'],
        petty_cash: ['view', 'create']
    },
    tenant_user: {
        tickets: ['create', 'view'],
        visitors: ['create'],
        dashboards: ['view']
    },
    vendor: {
        tickets: ['view']
    },
    staff: {
        tickets: ['view', 'create', 'update'],
        dashboards: ['view'],
        petty_cash: ['view', 'create']
    },
    soft_service_staff: {
        stock: ['view', 'create', 'update', 'delete'],
        dashboards: ['view'],
        petty_cash: ['view', 'create']
    },
    soft_service_supervisor: {
        stock: ['view', 'create', 'update', 'delete'],
        tickets: ['view', 'approve'],
        dashboards: ['view'],
        reports: ['view'],
        petty_cash: ['view', 'create']
    },
    soft_service_manager: {
        stock: ['view', 'create', 'update', 'delete'],
        tickets: ['view', 'approve', 'assign', 'delete'],
        dashboards: ['view'],
        reports: ['view'],
        petty_cash: ['view', 'create']
    },
    super_tenant: {
        tickets: ['view'],
        properties: ['view'],
        dashboards: ['view'],
        reports: ['view']
    },
    // CRM Roles
    bd_super_admin: {
        crm: ['view', 'create', 'update', 'approve', 'assign', 'delete', 'suspend'],
        reports: ['view'],
        dashboards: ['view']
    },
    bd_admin: {
        crm: ['view', 'create', 'update', 'approve', 'assign', 'delete'],
        reports: ['view']
    },
    bd_rep: {
        crm: ['view', 'create', 'update']
    },
    // Finance / payments team — owns the Payment Tracker and petty-cash disbursement.
    accounts: {
        accounts: ['view', 'create', 'update', 'approve'],
        petty_cash: ['view', 'create', 'update', 'approve'],
        // No `procurement` capability: accounts is a silo (frontend/lib/auth/silos.ts).
        // Granting it here is what routed accounts users into the Procurement dashboard,
        // where the profile card mislabelled them as Procurement Manager.
        dashboards: ['view'],
        reports: ['view']
    }
};
