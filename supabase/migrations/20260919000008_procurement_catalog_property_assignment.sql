-- Migration: 20260919000008_procurement_catalog_property_assignment.sql
-- Description: Add assigned_property_ids column to procurement_catalog to restrict monthly requisition items by property

ALTER TABLE public.procurement_catalog
    ADD COLUMN IF NOT EXISTS assigned_property_ids TEXT[] DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_procurement_catalog_assigned_properties
    ON public.procurement_catalog USING GIN (assigned_property_ids);
