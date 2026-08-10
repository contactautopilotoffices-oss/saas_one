-- Migration: Organization Email Service Configs
-- Adds email_service_config JSONB column to public.organization_settings

ALTER TABLE public.organization_settings
ADD COLUMN IF NOT EXISTS email_service_config JSONB DEFAULT '{
  "material_requests": {
    "enabled": true,
    "roles": ["procurement", "org_super_admin"],
    "user_ids": [],
    "notify_assignee": true
  },
  "comparative_quotes": {
    "enabled": true,
    "roles": ["org_super_admin", "procurement"],
    "user_ids": [],
    "notify_approver": true
  },
  "material_delivery": {
    "enabled": true,
    "roles": ["property_admin", "procurement", "org_super_admin"],
    "user_ids": [],
    "notify_requester": true
  },
  "monthly_requisitions": {
    "enabled": true,
    "roles": ["procurement", "org_super_admin"],
    "user_ids": []
  },
  "meeting_rooms": {
    "enabled": true,
    "roles": ["property_admin", "org_super_admin"],
    "user_ids": [],
    "notify_requester": true
  },
  "crm_leads": {
    "enabled": true,
    "roles": ["org_super_admin"],
    "user_ids": [],
    "notify_assignee": true
  }
}'::jsonb;
