-- Add approver_uid to material_request_comparatives
ALTER TABLE public.material_request_comparatives
ADD COLUMN IF NOT EXISTS approver_uid UUID REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_mat_req_comp_approver_uid 
ON public.material_request_comparatives(approver_uid);
