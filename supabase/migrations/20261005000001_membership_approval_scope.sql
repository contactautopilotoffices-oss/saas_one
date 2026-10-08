-- Approval belongs to a workspace membership, not the shared users profile.
-- Prerequisites: users, organization_memberships and property_memberships.
-- Legacy inactive rows with an approved profile cannot be distinguished from revocations;
-- retain them as inactive instead of inventing pending access. No membership is activated.
ALTER TABLE public.organization_memberships
 ADD COLUMN IF NOT EXISTS approval_status text
 CHECK (approval_status IN ('pending','approved','rejected','inactive'));
ALTER TABLE public.property_memberships
 ADD COLUMN IF NOT EXISTS approval_status text
 CHECK (approval_status IN ('pending','approved','rejected','inactive'));

UPDATE public.organization_memberships m SET approval_status = CASE
 WHEN m.is_active THEN 'approved'
 WHEN u.approval_status = 'rejected' THEN 'rejected'
 WHEN u.is_approved = false OR u.approval_status IN ('pending','pending_approval') THEN 'pending'
 ELSE 'inactive' END
FROM public.users u WHERE u.id=m.user_id AND m.approval_status IS NULL;
UPDATE public.property_memberships m SET approval_status = CASE
 WHEN m.is_active THEN 'approved'
 WHEN u.approval_status = 'rejected' THEN 'rejected'
 WHEN u.is_approved = false OR u.approval_status IN ('pending','pending_approval') THEN 'pending'
 ELSE 'inactive' END
FROM public.users u WHERE u.id=m.user_id AND m.approval_status IS NULL;

CREATE OR REPLACE FUNCTION public.membership_approval_state() RETURNS trigger
LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF NEW.is_active THEN
  NEW.approval_status := 'approved';
 ELSIF TG_OP='INSERT' THEN
  NEW.approval_status := coalesce(NEW.approval_status,'pending');
 ELSIF OLD.is_active AND NEW.approval_status IS NOT DISTINCT FROM OLD.approval_status THEN
  -- Existing removal paths that only set is_active=false remain revocations.
  NEW.approval_status := 'inactive';
 END IF;
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.membership_approval_state() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS trg_organization_membership_approval_state ON public.organization_memberships;
CREATE TRIGGER trg_organization_membership_approval_state
 BEFORE INSERT OR UPDATE ON public.organization_memberships
 FOR EACH ROW EXECUTE FUNCTION public.membership_approval_state();
DROP TRIGGER IF EXISTS trg_property_membership_approval_state ON public.property_memberships;
CREATE TRIGGER trg_property_membership_approval_state
 BEFORE INSERT OR UPDATE ON public.property_memberships
 FOR EACH ROW EXECUTE FUNCTION public.membership_approval_state();

COMMENT ON COLUMN public.organization_memberships.approval_status IS
 'Workspace approval state. is_active remains the authorization gate; shared profile status is not membership approval.';
COMMENT ON COLUMN public.property_memberships.approval_status IS
 'Workspace approval state. is_active remains the authorization gate; shared profile status is not membership approval.';
