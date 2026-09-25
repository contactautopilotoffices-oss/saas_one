# 🔄 MULTI-ROLE FEATURE SCOPING & PARITY RULE

In SaaS One, features exist across multiple user roles and dashboards. Follow these exact scoping rules based on the user's explicit request:

---

## 1. USER INTENT & SCOPE CONTROL
- **Single Dashboard / Role Specific Requests**:
  - If the user explicitly asks to add or change a feature in **one specific account/dashboard** (e.g. *"Add this button in Property Admin"* or *"Update Tenant view only"*):
  - **STRICT RULE**: Modify ONLY that specified dashboard/account. Do NOT touch or force changes onto other dashboards.
- **Global / All-Role / Cross-Account Requests**:
  - If the user explicitly asks to add a feature **across all accounts / all roles** (e.g. *"Add feature X in all accounts"* or *"Update this logic across all dashboards"*):
  - Audit and implement feature parity across all relevant role dashboards listed below.

---

## 2. DASHBOARD REGISTRY

Dashboard Component | File Location | Target User Role
:--- | :--- | :---
`MasterAdminDashboard.tsx` | `frontend/components/dashboard/MasterAdminDashboard.tsx` | Ops Super Admin / Master Admin
`OrgAdminDashboard.tsx` | `frontend/components/dashboard/OrgAdminDashboard.tsx` | Organization Admin / Executive
`PropertyAdminDashboard.tsx` | `frontend/components/dashboard/PropertyAdminDashboard.tsx` | Property Manager / Site Admin
`StaffDashboard.tsx` | `frontend/components/dashboard/StaffDashboard.tsx` | Ground Staff / MST / Technician
`TenantDashboard.tsx` | `frontend/components/dashboard/TenantDashboard.tsx` | Tenant Occupant / Employee
`ProcurementDashboard.tsx` | `frontend/components/dashboard/ProcurementDashboard.tsx` | Procurement Manager / Buyer
`FoodVendorDashboard.tsx` | `frontend/components/dashboard/FoodVendorDashboard.tsx` | Cafeteria Vendor Partner

---

## 3. CHECKLIST BEFORE CONCLUDING
1. **Scope Check**: Confirm whether the user requested a single-account update or a multi-account update.
2. **Permission Scoping**: For multi-role implementations, ensure actions are properly restricted per role (e.g. view-only for Tenants vs edit/approve for Admins).
3. **No Unrequested Mutations**: Never modify unrequested dashboards when single-account scope is specified.
