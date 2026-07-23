-- Allow 'linkedin_ads' as a campaign channel (Advertising API spend).
ALTER TABLE crm_campaigns DROP CONSTRAINT IF EXISTS crm_campaigns_channel_check;
ALTER TABLE crm_campaigns
    ADD CONSTRAINT crm_campaigns_channel_check
    CHECK (channel IN ('meta_ads','google_ads','linkedin_ads','whatsapp','email','referral','organic','manual','other'));
