-- Add Push to the existing Petty Cash outbox delivery ledger. No events/settings are replayed or enabled.
BEGIN;
ALTER TABLE public.petty_cash_notification_deliveries
 DROP CONSTRAINT IF EXISTS petty_cash_notification_deliveries_channel_check;
ALTER TABLE public.petty_cash_notification_deliveries
 ADD CONSTRAINT petty_cash_notification_deliveries_channel_check CHECK(channel IN ('email','whatsapp','push'));
COMMIT;
