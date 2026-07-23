-- Track which onboarding tours each user has completed
CREATE TABLE IF NOT EXISTS crm_tour_completions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    tour_id TEXT NOT NULL,
    completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, tour_id)
);

ALTER TABLE crm_tour_completions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own tour completions"
    ON crm_tour_completions FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own tour completions"
    ON crm_tour_completions FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own tour completions"
    ON crm_tour_completions FOR DELETE
    USING (auth.uid() = user_id);
