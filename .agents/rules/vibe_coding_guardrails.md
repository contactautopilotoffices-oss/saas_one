# ⚡ VIBE CODING GUARDRAILS & ACCELERATION GUIDE

To achieve fast, seamless "vibe coding" without database schema mismatches, broken APIs, or context loss, follow these 5 core engineering rules in every development turn:

---

## 1. PRE-CHECK SCHEMA BEFORE CODING (Zero Guessing)
- **Always inspect migration schemas first**: Run `grep_search` across `supabase/migrations/` to find table definitions before writing SQL or Supabase queries.
- **Never guess column names**: Always verify exact column names (`title` vs `name`, `mobile` vs `phone`, `revenue_date` vs `entry_date`).
- **Run the SQL Linter**: Execute `node scripts/lint_sql_migrations.js` whenever adding new database triggers or functions.

---

## 2. DUAL-LAYER FALLBACKS IN API ENDPOINTS
- When fetching data in Next.js API routes (`app/api/`), wrap database calls in try/catch or graceful property resolution.
- If a database column might be missing or pending PostgREST schema cache refresh (PostgreSQL code `42703` or PostgREST `PGRST204`), fallback gracefully so the UI doesn't crash:
```typescript
const { data, error } = await supabaseAdmin.from('table').select('*');
if (error && error.code === '42703') {
    // Retry with essential fallback columns
}
```

---

## 3. REAL-TIME FEATURE DOCUMENTATION
- Whenever creating or extending a feature, update or create its documentation file in `docs/features/<feature_name>.md`.
- Document:
  - Table schemas & foreign keys
  - Trigger functions & outbox events
  - API endpoints & frontend components
- Future agent sessions read these docs to gain instant 100% context.

---

## 4. DEFENSIVE MIGRATION WRITING
- Always write idempotent SQL migrations (`CREATE TABLE IF NOT EXISTS`, `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION`).
- Explicitly set `SECURITY DEFINER` and `SET search_path = public` on PostgreSQL trigger functions.

---

## 5. AUTO-VERIFICATION BEFORE DECLARING DONE
- Always test SQL changes, API routes, or TypeScript builds before concluding the task.
- Ensure all toast error messages are caught and handled.
