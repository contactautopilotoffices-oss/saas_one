-- Create system_config table for global application settings
CREATE TABLE IF NOT EXISTS system_config (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now(),
    updated_by UUID REFERENCES users(id)
);

-- Enable RLS
ALTER TABLE system_config ENABLE ROW LEVEL SECURITY;

-- Only Master Admins can view/manage system_config
CREATE POLICY "Master Admins full access on system_config" ON system_config
    FOR ALL TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM users
            WHERE users.id = auth.uid()
            AND users.is_master_admin = true
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM users
            WHERE users.id = auth.uid()
            AND users.is_master_admin = true
        )
    );

-- Seed initial WhatsApp toggle (default to false as requested to stay 'off' for now)
INSERT INTO system_config (key, value)
VALUES ('whatsapp_notifications_enabled', 'false'::jsonb)
ON CONFLICT (key) DO NOTHING;
