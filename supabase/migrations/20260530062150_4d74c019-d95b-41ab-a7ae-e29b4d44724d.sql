-- 1) staff_resource_assignments tábla
CREATE TABLE public.staff_resource_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  staff_profile_id uuid NOT NULL REFERENCES public.staff_profiles(id) ON DELETE CASCADE,
  resource_id uuid NOT NULL REFERENCES public.resources(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('always','weekly','window')),
  weekly_pattern_json jsonb,
  starts_at timestamptz,
  ends_at timestamptz,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_sra_org ON public.staff_resource_assignments(organization_id);
CREATE INDEX idx_sra_staff ON public.staff_resource_assignments(staff_profile_id);
CREATE INDEX idx_sra_resource ON public.staff_resource_assignments(resource_id);
CREATE INDEX idx_sra_window ON public.staff_resource_assignments(starts_at, ends_at) WHERE kind = 'window';

GRANT SELECT, INSERT, UPDATE, DELETE ON public.staff_resource_assignments TO authenticated;
GRANT SELECT ON public.staff_resource_assignments TO anon;
GRANT ALL ON public.staff_resource_assignments TO service_role;

ALTER TABLE public.staff_resource_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sra_public_read" ON public.staff_resource_assignments
FOR SELECT TO anon, authenticated
USING (is_org_active(organization_id) OR has_role(auth.uid(), 'platform_admin'::app_role));

CREATE POLICY "sra_owner_write" ON public.staff_resource_assignments
FOR ALL TO authenticated
USING (is_org_owner(auth.uid(), organization_id))
WITH CHECK (is_org_owner(auth.uid(), organization_id));

CREATE POLICY "sra_admin_all" ON public.staff_resource_assignments
FOR ALL TO authenticated
USING (has_role(auth.uid(), 'platform_admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'platform_admin'::app_role));

CREATE TRIGGER sra_updated_at BEFORE UPDATE ON public.staff_resource_assignments
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 2) bookings UPDATE bővítés: érintett alkalmazott is módosíthassa
DROP POLICY IF EXISTS "bookings_update" ON public.bookings;
CREATE POLICY "bookings_update" ON public.bookings
FOR UPDATE TO authenticated
USING (
  customer_auth_user_id = auth.uid()
  OR is_org_owner(auth.uid(), organization_id)
  OR (
    is_org_member(auth.uid(), organization_id)
    AND staff_profile_id IN (
      SELECT id FROM public.staff_profiles WHERE user_id = auth.uid()
    )
  )
  OR has_role(auth.uid(), 'platform_admin'::app_role)
);

-- 3) bookings DELETE policy (owner / érintett alkalmazott / platform admin)
CREATE POLICY "bookings_delete" ON public.bookings
FOR DELETE TO authenticated
USING (
  is_org_owner(auth.uid(), organization_id)
  OR (
    is_org_member(auth.uid(), organization_id)
    AND staff_profile_id IN (
      SELECT id FROM public.staff_profiles WHERE user_id = auth.uid()
    )
  )
  OR has_role(auth.uid(), 'platform_admin'::app_role)
);