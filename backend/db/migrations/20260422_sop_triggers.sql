-- Migration: SOP Triggers
-- Description: Auto-populate sop_completion_items when a sop_completions record is created.
-- Date: 2026-04-22

-- Function to clone items
CREATE OR REPLACE FUNCTION fn_clone_sop_checklist_items()
RETURNS TRIGGER AS $$
BEGIN
    -- Only clone if no items exist yet (prevents double population if manually added)
    IF NOT EXISTS (SELECT 1 FROM sop_completion_items WHERE completion_id = NEW.id) THEN
        INSERT INTO sop_completion_items (
            completion_id,
            checklist_item_id,
            is_checked
        )
        SELECT
            NEW.id,
            id,
            false
        FROM sop_checklist_items
        WHERE template_id = NEW.template_id;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger
DROP TRIGGER IF EXISTS trig_clone_sop_checklist_items ON sop_completions;
CREATE TRIGGER trig_clone_sop_checklist_items
AFTER INSERT ON sop_completions
FOR EACH ROW
EXECUTE FUNCTION fn_clone_sop_checklist_items();
