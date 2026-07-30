-- Trigger to automatically insert an event into event_outbox when a comparative is uploaded, approved, or rejected
-- This ensures that approvals/rejections/uploads made from outside the main web app (e.g. mobile app) 
-- still trigger the notification emails.

CREATE OR REPLACE FUNCTION trigger_comparative_status_change()
RETURNS TRIGGER AS $$
BEGIN
    -- Handle new comparative upload (INSERT)
    IF TG_OP = 'INSERT' THEN
        INSERT INTO event_outbox (
            event_type,
            payload,
            status
        ) VALUES (
            'COMPARATIVE_UPLOADED',
            jsonb_build_object(
                'request_id', NEW.request_id,
                'comparative_id', NEW.id,
                'total_cost', NEW.total_cost,
                'approver_uid', NEW.approver_uid
            ),
            'pending'
        );
        
    -- Handle status change (UPDATE)
    ELSIF TG_OP = 'UPDATE' THEN
        -- Check if status actually changed to approved or rejected
        IF NEW.status IN ('approved', 'rejected') AND OLD.status != NEW.status THEN
            INSERT INTO event_outbox (
                event_type,
                payload,
                status
            ) VALUES (
                CASE WHEN NEW.status = 'approved' THEN 'COMPARATIVE_APPROVED' ELSE 'COMPARATIVE_REJECTED' END,
                jsonb_build_object(
                    'request_id', NEW.request_id,
                    'comparative_id', NEW.id,
                    'total_cost', NEW.total_cost,
                    'action_by', NEW.action_by,
                    'approver_uid', NEW.approver_uid
                ),
                'pending'
            );
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS comparative_status_change_trigger ON material_request_comparatives;

CREATE TRIGGER comparative_status_change_trigger
AFTER INSERT OR UPDATE ON material_request_comparatives
FOR EACH ROW
EXECUTE FUNCTION trigger_comparative_status_change();
