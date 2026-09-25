# 🔒 SUPABASE RLS & SECURITY RULE

To protect user data and prevent authorization vulnerabilities across tenants and properties:

---

## 1. ROW LEVEL SECURITY (RLS) POLICIES
- Every new database table created in `supabase/migrations/` MUST enable Row Level Security:
  ```sql
  ALTER TABLE public.table_name ENABLE ROW LEVEL SECURITY;
  ```
- Always define explicit tenant/organization scoping policies:
  ```sql
  CREATE POLICY "tenant_isolation_select" ON public.table_name
    FOR SELECT USING (organization_id IN (
      SELECT organization_id FROM public.organization_memberships WHERE user_id = auth.uid()
    ));
  ```

---

## 2. BACKEND API IDOR PROTECTION
- In Next.js route handlers (`app/api/`):
  - Always verify user authentication first: `const { data: { user }, error } = await supabase.auth.getUser();`
  - Never allow updating or deleting records without checking `organization_id` or `property_id` matching the authenticated user's permissions.
