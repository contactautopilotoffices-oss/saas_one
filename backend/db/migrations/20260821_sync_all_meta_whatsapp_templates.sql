-- ==============================================================================
-- MIGRATION: 20260821_sync_all_meta_whatsapp_templates.sql
-- DESCRIPTION: Synchronizes organization_settings.whatsapp_templates JSONB map
--              with all approved Meta / AiSensy campaign names and parameter sequences.
-- ==============================================================================

-- 1. Update DEFAULT for organization_settings.whatsapp_templates column
ALTER TABLE public.organization_settings
ALTER COLUMN whatsapp_templates SET DEFAULT '{
  "ticket_created": {
    "campaign_name": "ticket_created_v3",
    "params": ["user_name", "ticket_number", "title", "property", "priority", "raised_by", "raised_by_phone", "assigned_to", "assigned_to_phone", "ticket_id"]
  },
  "ticket_created_media": {
    "campaign_name": "ticket_created_v3_media",
    "params": ["user_name", "ticket_number", "title", "property", "priority", "raised_by", "raised_by_phone", "assigned_to", "assigned_to_phone", "ticket_id"],
    "is_media": true
  },
  "ticket_assigned": {
    "campaign_name": "ticket_assigned_v1",
    "params": ["user_name", "ticket_number", "title", "property", "priority", "raised_by", "raised_by_phone", "ticket_id"]
  },
  "ticket_completed": {
    "campaign_name": "ticket_completed_v1",
    "params": ["user_name", "ticket_number", "title", "property", "resolved_by", "ticket_id"]
  },
  "ticket_completed_media": {
    "campaign_name": "ticket_completed_v1_media",
    "params": ["user_name", "ticket_number", "title", "property", "resolved_by", "ticket_id"],
    "is_media": true
  },
  "reminder_ticket_sla": {
    "campaign_name": "reminder_ticket_sla_v1",
    "params": ["user_name", "ticket_number", "title", "property", "sla_deadline", "priority", "assignee_name"]
  },
  "checklist_slot_reminder": {
    "campaign_name": "checklist_slot_reminder_v2",
    "params": ["user_name", "checklist_name", "property", "due_time", "property_id"]
  },
  "checklist_overdue_alert": {
    "campaign_name": "checklist_overdue_alert_v2",
    "params": ["checklist_name", "property", "scheduled_time"]
  },
  "daily_property_report": {
    "campaign_name": "ai_property_report_v1",
    "params": ["user_name", "org_name", "date", "critical_count", "open_count", "resolved_count", "electricity_kwh", "dg_liters", "ppm_completed", "ppm_missed", "sop_compliance", "property_summary", "ai_insights"]
  },
  "material_request_created": {
    "campaign_name": "material_request_created_v3",
    "params": ["user_name", "ticket_number", "property", "requested_by", "requester_phone", "items_summary", "ticket_id"]
  },
  "comparative_approval_requested": {
    "campaign_name": "comparative_approval_requested_v1",
    "params": ["user_name", "uploaded_by", "ticket_number", "title", "property", "total_cost", "notes", "ticket_id"]
  },
  "comparative_uploaded_info": {
    "campaign_name": "comparative_uploaded_info_v1",
    "params": ["user_name", "uploaded_by", "ticket_number", "title", "property", "total_cost", "approver_name", "notes", "ticket_id"]
  },
  "comparative_uploaded": {
    "campaign_name": "comparative_approval_requested_v1",
    "params": ["user_name", "uploaded_by", "ticket_number", "title", "property", "total_cost", "notes", "ticket_id"]
  },
  "comparative_approved": {
    "campaign_name": "comparative_approved_v1",
    "params": ["user_name", "ticket_number", "title", "property", "approved_by", "total_cost", "approver_comment", "ticket_id"]
  },
  "comparative_rejected": {
    "campaign_name": "comparative_rejected_v1",
    "params": ["user_name", "ticket_number", "title", "property", "total_cost", "action_by", "rejection_reason", "ticket_id"]
  },
  "material_delivered": {
    "campaign_name": "material_delivered_v1",
    "params": ["user_name", "ticket_number", "title", "property", "delivered_items", "verified_by", "ticket_id"]
  },
  "monthly_requisition_uploaded": {
    "campaign_name": "requisition_submitted_v1",
    "params": ["user_name", "property", "month", "year", "items_count", "total_amount", "requested_by"]
  },
  "requisition_approval_requested": {
    "campaign_name": "requisition_approval_requested_v1",
    "params": ["approver_name", "property", "month", "year", "vendor_name", "total_amount", "notes"]
  },
  "requisition_status_updated": {
    "campaign_name": "requisition_status_updated_v1",
    "params": ["user_name", "property", "month", "year", "status", "approver_name", "total_amount", "remarks"]
  },
  "requisition_po_issued": {
    "campaign_name": "requisition_po_issued_v1",
    "params": ["user_name", "month", "year", "property", "vendor_name", "po_number", "total_amount"]
  },
  "procurement_vendor_tag": {
    "campaign_name": "procurement_vendor_tag_v1",
    "params": ["user_name", "ticket_number", "title", "property", "tagged_by", "note", "assigned_procurement", "ticket_id"]
  },
  "procurement_vendor_aligned": {
    "campaign_name": "procurement_vendor_aligned_v1",
    "params": ["user_name", "ticket_number", "title", "property", "vendor_details", "arranged_by", "ticket_id"]
  },
  "reminder_ppm": {
    "campaign_name": "reminder_ppm_v2",
    "params": ["user_name", "system_name", "property", "due_date", "vendor_name", "location"]
  },
  "meeting_room_booked": {
    "campaign_name": "meeting_room_booked_v3",
    "params": ["user_name", "room_name", "property", "date", "start_time", "end_time", "booker", "booker_phone"]
  },
  "meeting_room_cancelled": {
    "campaign_name": "meeting_room_cancelled_v2",
    "params": ["user_name", "room_name", "property", "date", "start_time", "end_time", "booker"]
  },
  "lead_created": {
    "campaign_name": "crm_lead_created_v1",
    "params": ["user_name", "company_name", "contact_person", "phone", "source", "property_interest"]
  },
  "lead_assigned": {
    "campaign_name": "crm_lead_assigned_v1",
    "params": ["user_name", "company_name", "contact_person", "phone", "property_interest", "next_followup"]
  },
  "fms_welcome_onboarding": {
    "campaign_name": "fms_welcome_onboarding_v1",
    "params": ["user_name", "helpdesk_contact"]
  }
}'::jsonb;

-- 2. Update existing rows in organization_settings with full template configuration
UPDATE public.organization_settings
SET whatsapp_templates = '{
  "ticket_created": {
    "campaign_name": "ticket_created_v3",
    "params": ["user_name", "ticket_number", "title", "property", "priority", "raised_by", "raised_by_phone", "assigned_to", "assigned_to_phone", "ticket_id"]
  },
  "ticket_created_media": {
    "campaign_name": "ticket_created_v3_media",
    "params": ["user_name", "ticket_number", "title", "property", "priority", "raised_by", "raised_by_phone", "assigned_to", "assigned_to_phone", "ticket_id"],
    "is_media": true
  },
  "ticket_assigned": {
    "campaign_name": "ticket_assigned_v1",
    "params": ["user_name", "ticket_number", "title", "property", "priority", "raised_by", "raised_by_phone", "ticket_id"]
  },
  "ticket_completed": {
    "campaign_name": "ticket_completed_v1",
    "params": ["user_name", "ticket_number", "title", "property", "resolved_by", "ticket_id"]
  },
  "ticket_completed_media": {
    "campaign_name": "ticket_completed_v1_media",
    "params": ["user_name", "ticket_number", "title", "property", "resolved_by", "ticket_id"],
    "is_media": true
  },
  "reminder_ticket_sla": {
    "campaign_name": "reminder_ticket_sla_v1",
    "params": ["user_name", "ticket_number", "title", "property", "sla_deadline", "priority", "assignee_name"]
  },
  "checklist_slot_reminder": {
    "campaign_name": "checklist_slot_reminder_v2",
    "params": ["user_name", "checklist_name", "property", "due_time", "property_id"]
  },
  "checklist_overdue_alert": {
    "campaign_name": "checklist_overdue_alert_v2",
    "params": ["checklist_name", "property", "scheduled_time"]
  },
  "daily_property_report": {
    "campaign_name": "ai_property_report_v1",
    "params": ["user_name", "org_name", "date", "critical_count", "open_count", "resolved_count", "electricity_kwh", "dg_liters", "ppm_completed", "ppm_missed", "sop_compliance", "property_summary", "ai_insights"]
  },
  "material_request_created": {
    "campaign_name": "material_request_created_v3",
    "params": ["user_name", "ticket_number", "property", "requested_by", "requester_phone", "items_summary", "ticket_id"]
  },
  "comparative_approval_requested": {
    "campaign_name": "comparative_approval_requested_v1",
    "params": ["user_name", "uploaded_by", "ticket_number", "title", "property", "total_cost", "notes", "ticket_id"]
  },
  "comparative_uploaded_info": {
    "campaign_name": "comparative_uploaded_info_v1",
    "params": ["user_name", "uploaded_by", "ticket_number", "title", "property", "total_cost", "approver_name", "notes", "ticket_id"]
  },
  "comparative_uploaded": {
    "campaign_name": "comparative_approval_requested_v1",
    "params": ["user_name", "uploaded_by", "ticket_number", "title", "property", "total_cost", "notes", "ticket_id"]
  },
  "comparative_approved": {
    "campaign_name": "comparative_approved_v1",
    "params": ["user_name", "ticket_number", "title", "property", "approved_by", "total_cost", "approver_comment", "ticket_id"]
  },
  "comparative_rejected": {
    "campaign_name": "comparative_rejected_v1",
    "params": ["user_name", "ticket_number", "title", "property", "total_cost", "action_by", "rejection_reason", "ticket_id"]
  },
  "material_delivered": {
    "campaign_name": "material_delivered_v1",
    "params": ["user_name", "ticket_number", "title", "property", "delivered_items", "verified_by", "ticket_id"]
  },
  "monthly_requisition_uploaded": {
    "campaign_name": "requisition_submitted_v1",
    "params": ["user_name", "property", "month", "year", "items_count", "total_amount", "requested_by"]
  },
  "requisition_approval_requested": {
    "campaign_name": "requisition_approval_requested_v1",
    "params": ["approver_name", "property", "month", "year", "vendor_name", "total_amount", "notes"]
  },
  "requisition_status_updated": {
    "campaign_name": "requisition_status_updated_v1",
    "params": ["user_name", "property", "month", "year", "status", "approver_name", "total_amount", "remarks"]
  },
  "requisition_po_issued": {
    "campaign_name": "requisition_po_issued_v1",
    "params": ["user_name", "month", "year", "property", "vendor_name", "po_number", "total_amount"]
  },
  "procurement_vendor_tag": {
    "campaign_name": "procurement_vendor_tag_v1",
    "params": ["user_name", "ticket_number", "title", "property", "tagged_by", "note", "assigned_procurement", "ticket_id"]
  },
  "procurement_vendor_aligned": {
    "campaign_name": "procurement_vendor_aligned_v1",
    "params": ["user_name", "ticket_number", "title", "property", "vendor_details", "arranged_by", "ticket_id"]
  },
  "reminder_ppm": {
    "campaign_name": "reminder_ppm_v2",
    "params": ["user_name", "system_name", "property", "due_date", "vendor_name", "location"]
  },
  "meeting_room_booked": {
    "campaign_name": "meeting_room_booked_v3",
    "params": ["user_name", "room_name", "property", "date", "start_time", "end_time", "booker", "booker_phone"]
  },
  "meeting_room_cancelled": {
    "campaign_name": "meeting_room_cancelled_v2",
    "params": ["user_name", "room_name", "property", "date", "start_time", "end_time", "booker"]
  },
  "lead_created": {
    "campaign_name": "crm_lead_created_v1",
    "params": ["user_name", "company_name", "contact_person", "phone", "source", "property_interest"]
  },
  "lead_assigned": {
    "campaign_name": "crm_lead_assigned_v1",
    "params": ["user_name", "company_name", "contact_person", "phone", "property_interest", "next_followup"]
  },
  "fms_welcome_onboarding": {
    "campaign_name": "fms_welcome_onboarding_v1",
    "params": ["user_name", "helpdesk_contact"]
  }
}'::jsonb;
