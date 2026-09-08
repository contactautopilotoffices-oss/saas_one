-- Proof attachments (signed-off PDFs, screenshots) the team mails back against
-- Ira's findings, uploaded by backend/lib/ira/procurement/collectReplies.ts.
--
-- PRIVATE, like 'electricity-bills': all reads and writes go through the
-- service role, which bypasses storage RLS, so no storage.objects policies are
-- created here. The file_size_limit matches the collector's 10MB cap.
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('ira-proof', 'ira-proof', false, 10485760)
ON CONFLICT (id) DO NOTHING;
