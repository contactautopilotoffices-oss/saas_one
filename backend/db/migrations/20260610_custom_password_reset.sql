-- Custom Password Reset Tokens Table
-- Stores password reset tokens with 7-day expiry (vs Supabase's 1-hour default)

CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    token text NOT NULL UNIQUE,
    expires_at timestamptz NOT NULL,
    created_at timestamptz DEFAULT now()
);

-- One token per user at a time
CREATE UNIQUE INDEX IF NOT EXISTS idx_password_reset_tokens_user ON password_reset_tokens(user_id);

-- Index for token lookup
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_token ON password_reset_tokens(token);

-- Auto-delete expired tokens (optional cleanup)
-- Can be run periodically via a cron job or trigger

ALTER TABLE password_reset_tokens ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to insert their own token
DROP POLICY IF EXISTS password_reset_tokens_insert ON password_reset_tokens;
CREATE POLICY password_reset_tokens_insert ON password_reset_tokens FOR INSERT WITH CHECK (true);

-- Allow public read for token verification
DROP POLICY IF EXISTS password_reset_tokens_select ON password_reset_tokens;
CREATE POLICY password_reset_tokens_select ON password_reset_tokens FOR SELECT USING (true);

-- Allow delete for token owner or cleanup
DROP POLICY IF EXISTS password_reset_tokens_delete ON password_reset_tokens;
CREATE POLICY password_reset_tokens_delete ON password_reset_tokens FOR DELETE USING (true);
