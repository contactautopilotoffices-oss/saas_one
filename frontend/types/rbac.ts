export type RoleLevel = 0 | 1 | 2 | 3 | 4;

export type RoleKey =
    | 'super_admin'
    | 'org_admin'
    | 'property_admin'
    | 'manager_executive'
    | 'purchase_manager'
    | 'purchase_executive'
    | 'mst' | 'hk' | 'fe' | 'se' | 'technician' | 'field_staff' | 'bms_operator' | 'staff'
    | 'soft_service_staff' | 'soft_service_supervisor' | 'soft_service_manager'
    | 'tenant_user' | 'vendor'
    | 'super_tenant'
    | 'bd_rep'
    | 'bd_admin'
    | 'bd_super_admin';

export type CapabilityDomain =
    | 'users'
    | 'properties'
    | 'tickets'
    | 'assets'
    | 'procurement'
    | 'visitors'
    | 'security'
    | 'dashboards'
    | 'reports'
    | 'vendors'
    | 'stock'
    | 'crm';

export type CapabilityAction = 'view' | 'create' | 'update' | 'approve' | 'assign' | 'delete' | 'suspend';

export interface RoleCapability {
    role_key: RoleKey;
    domain: CapabilityDomain;
    actions: CapabilityAction[];
}

export type CapabilityMatrix = Partial<Record<CapabilityDomain, CapabilityAction[]>>;

export interface User {
    id: string;
    external_auth_id?: string;
    full_name: string;
    email: string;
    phone?: string;
    role_key: RoleKey;
    role_level: RoleLevel;
    property_id: string;
    status: 'invited' | 'active' | 'suspended';
    created_at: number;
}

export interface Property {
    id: string;
    name: string;
    status: 'active' | 'inactive';
}

export interface RequestContext {
    user_id: string;
    role_key: RoleKey;
    role_level: RoleLevel;
    property_id: string;
    capabilities: CapabilityMatrix;
}
