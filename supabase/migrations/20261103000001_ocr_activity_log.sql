-- One row per OCR operation (an invoice read, a document-bank read, a bill read, a heartbeat probe),
-- with the steps it took, so the Master Admin OCR Monitor can show what the readers are doing, live.
--
-- No foreign keys: a log row must outlive anything it points at. RLS is on with no policies, so only
-- the service role (the API routes) reads or writes. Rows are plain data: old ones may be deleted.
-- Written, not applied: a person runs it. Until then the monitor falls back to the invoice audit log.

CREATE TABLE IF NOT EXISTS public.ocr_activity_log (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    organization_id UUID,
    source          TEXT NOT NULL,          -- invoice | document_bank | electricity | petty_cash | meter | heartbeat | other
    reference_id    TEXT,                   -- the invoice / document the read was for
    filename        TEXT,
    content_type    TEXT,
    file_bytes      BIGINT,
    path            TEXT,                   -- pdf_text | pdf_scan | image
    ok              BOOLEAN NOT NULL,
    error           TEXT,
    duration_ms     INTEGER,
    pages           INTEGER,
    steps           JSONB NOT NULL DEFAULT '[]'::jsonb,   -- [{step, ms, ok, model, provider, tokens_in, tokens_out, cost_usd, note}]
    tokens_in       INTEGER NOT NULL DEFAULT 0,
    tokens_out      INTEGER NOT NULL DEFAULT 0,
    cost_usd        NUMERIC(10,6) NOT NULL DEFAULT 0,
    fields          JSONB,                  -- small summary of what was read (never the document text)
    triggered_by    UUID
);
CREATE INDEX IF NOT EXISTS idx_ocr_activity_created ON public.ocr_activity_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ocr_activity_source ON public.ocr_activity_log (source, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ocr_activity_failed ON public.ocr_activity_log (created_at DESC) WHERE NOT ok;
ALTER TABLE public.ocr_activity_log ENABLE ROW LEVEL SECURITY;
