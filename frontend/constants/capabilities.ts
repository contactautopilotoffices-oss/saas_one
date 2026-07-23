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
        crm: ['view', 'create', 'update', 'approve', 'assign', 'delete', 'suspend']
    },
    org_admin: {
        users: ['view', 'create', 'update', 'assign', 'suspend'],
        properties: ['view', 'update'],
        tickets: ['view', 'update', 'approve'],
        assets: ['view', 'update'],
        procurement: ['view', 'approve'],
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
        reports: ['view']
    },
    manager_executive: {
        tickets: ['view', 'approve'],
        assets: ['view'],
        dashboards: ['view'],
        reports: ['view']
    },
    purchase_manager: {
        procurement: ['view', 'approve'],
        vendors: ['view'],
        dashboards: ['view']
    },
    purchase_executive: {
        procurement: ['view', 'create'],
        vendors: ['view']
    },
    mst: {
        tickets: ['view', 'update'],
        dashboards: ['view']
    },
    hk: {
        tickets: ['view', 'update']
    },
    fe: {
        tickets: ['view', 'update']
    },
    se: {
        tickets: ['view', 'update']
    },
    technician: {
        tickets: ['view', 'update']
    },
    field_staff: {
        tickets: ['view']
    },
    bms_operator: {
        assets: ['view', 'update']
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
        dashboards: ['view']
    },
    soft_service_staff: {
        stock: ['view', 'create', 'update', 'delete'],
        dashboards: ['view']
    },
    soft_service_supervisor: {
        stock: ['view', 'create', 'update', 'delete'],
        tickets: ['view', 'approve'],
        dashboards: ['view'],
        reports: ['view']
    },
    soft_service_manager: {
        stock: ['view', 'create', 'update', 'delete'],
        tickets: ['view', 'approve', 'assign', 'delete'],
        dashboards: ['view'],
        reports: ['view']
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
    }
};
