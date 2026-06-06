
-- 1. audit_logs: restrict INSERT to org members; restrict NULL-org SELECT to platform admins
DROP POLICY IF EXISTS audit_insert ON public.audit_logs;
CREATE POLICY audit_insert ON public.audit_logs
  FOR INSERT TO authenticated
  WITH CHECK (
    organization_id IS NOT NULL AND (
      public.is_org_owner(auth.uid(), organization_id)
      OR public.is_org_member(auth.uid(), organization_id)
    )
  );

DROP POLICY IF EXISTS audit_select_org ON public.audit_logs;
CREATE POLICY audit_select_org ON public.audit_logs
  FOR SELECT TO authenticated
  USING (
    organization_id IS NOT NULL AND public.is_org_owner(auth.uid(), organization_id)
  );

-- 2. booking_audit: restrict INSERT to org members
DROP POLICY IF EXISTS booking_audit_insert_any_auth ON public.booking_audit;
CREATE POLICY booking_audit_insert_org ON public.booking_audit
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_org_owner(auth.uid(), organization_id)
    OR public.is_org_member(auth.uid(), organization_id)
  );

-- 3. notification_logs: restrict INSERT to org members
DROP POLICY IF EXISTS notif_insert ON public.notification_logs;
CREATE POLICY notif_insert ON public.notification_logs
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_org_owner(auth.uid(), organization_id)
    OR public.is_org_member(auth.uid(), organization_id)
  );

-- 4. booking_locks: remove unrestricted authenticated access.
-- Server code uses service_role (bypasses RLS), so no permissive policy is needed.
DROP POLICY IF EXISTS locks_all_auth ON public.booking_locks;

-- 5. coupons: stop exposing codes to anonymous visitors.
-- Server code validates coupon codes via the service role.
DROP POLICY IF EXISTS coupons_public_read ON public.coupons;
CREATE POLICY coupons_org_read ON public.coupons
  FOR SELECT TO authenticated
  USING (
    public.is_org_owner(auth.uid(), organization_id)
    OR public.is_org_member(auth.uid(), organization_id)
    OR public.has_role(auth.uid(), 'platform_admin'::app_role)
  );

-- 6. staff_profiles: hide email / phone / full_name from anonymous (and authenticated)
-- direct reads. Server code uses service_role; dashboard reads happen via server functions.
REVOKE SELECT (email, phone, full_name) ON public.staff_profiles FROM anon;
REVOKE SELECT (email, phone, full_name) ON public.staff_profiles FROM authenticated;

-- 7. Function search_path hygiene
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$function$;

-- 8. Lock down destructive admin RPC: only service_role may invoke.
REVOKE EXECUTE ON FUNCTION public.delete_organization_cascade(uuid) FROM PUBLIC, anon, authenticated;
