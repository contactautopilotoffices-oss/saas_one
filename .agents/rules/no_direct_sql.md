# 🚨 MANDATORY RULE: NO DIRECT DB EXECUTION FOR SCHEMAS / MIGRATIONS

1. **NEVER Execute Schema Alterations or Direct SQL Mutations directly on Supabase DB via scripts**:
   - Do NOT run automated node scripts or CLI commands that execute `ALTER TABLE`, `CREATE TABLE`, `DROP TABLE`, or bulk table schema mutations against production/staging Supabase.

2. **ALWAYS Provide Clean SQL Scripts for the User**:
   - Whenever database changes, migrations, or schema fixes are required, generate a clean, idempotently written SQL file under `supabase/migrations/` or present the exact SQL snippet to the user.
   - Tell the user to copy/paste and execute it directly in the Supabase SQL Editor.

3. **Validate Migration Scripts Before Sharing**:
   - Ensure SQL scripts use `IF EXISTS`, `IF NOT EXISTS`, or conditional checks so they run cleanly and safely without unexpected side effects.
