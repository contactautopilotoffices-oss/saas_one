# 🚨 DATABASE SCHEMA & COLUMN VERIFICATION RULE

To eliminate PostgreSQL column mismatch errors (e.g., `column "name" does not exist`, `Postgres 42703`, `record 'new' has no field...`), EVERY AI agent operating in this repository MUST STRICTLY FOLLOW these rules:

## 1. MANDATORY SCHEMA CHECK BEFORE WRITING ANY SQL
- **NEVER assume or guess column names**. Table columns often differ from intuition (e.g., `sop_templates` has `title` not `name`, `visitor_logs` has `mobile` not `phone`, `vendor_daily_revenue` has `revenue_date` not `entry_date`).
- Before writing any SQL migration, PostgreSQL trigger function, backend query, or Supabase `from('table').select(...)` call:
  1. **Search existing migration files** in `supabase/migrations/` and `backend/db/migrations/` to find the exact `CREATE TABLE` definition.
  2. Verify all column names, nullability, and data types referenced in your code/trigger.

## 2. STRICT TRIGGER FUNCTION CHECKS
- When writing outbox triggers or PostgreSQL PL/pgSQL functions:
  - Verify every `NEW.<column_name>` or `OLD.<column_name>` exists on the target table.
  - Verify every column in `SELECT col1, col2 FROM public.<table_name>` exists on `<table_name>`.
  - Do NOT use `COALESCE(colA, colB)` where `colB` does not exist on the table.

## 3. SAFE DESTRUCTIVE AND ALTER PRECAUTIONS
- Always run `ALTER TABLE ... ADD COLUMN IF NOT EXISTS ...` defensive scripts if introducing new columns.
- Ensure API routes include fallback handling for PostgREST schema cache delay when new columns are added.
