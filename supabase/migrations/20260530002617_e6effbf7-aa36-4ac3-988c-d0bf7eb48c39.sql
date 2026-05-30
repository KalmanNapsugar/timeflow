
-- 1. Archive column
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ NULL;
CREATE INDEX IF NOT EXISTS organizations_archived_at_idx ON public.organizations(archived_at);

-- 2. Helper function: returns true if org exists AND not archived
CREATE OR REPLACE FUNCTION public.is_org_active(_org_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.organizations WHERE id = _org_id AND archived_at IS NULL)
$$;

-- 3. organizations RLS: platform admin sees all; everyone else only non-archived
DROP POLICY IF EXISTS orgs_public_read ON public.organizations;
DROP POLICY IF EXISTS orgs_owner_all ON public.organizations;
DROP POLICY IF EXISTS orgs_admin_all ON public.organizations;

CREATE POLICY orgs_public_read ON public.organizations
  FOR SELECT TO anon, authenticated
  USING (public_profile_enabled = true AND archived_at IS NULL);

CREATE POLICY orgs_owner_all ON public.organizations
  FOR ALL TO authenticated
  USING (owner_id = auth.uid() AND archived_at IS NULL)
  WITH CHECK (owner_id = auth.uid());

CREATE POLICY orgs_admin_all ON public.organizations
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'platform_admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'platform_admin'::app_role));

-- 4. is_org_owner / is_org_member: return false when archived (admin gets through via separate admin policies)
CREATE OR REPLACE FUNCTION public.is_org_owner(_user_id uuid, _org_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.organizations
    WHERE id = _org_id AND owner_id = _user_id AND archived_at IS NULL
  )
$$;

CREATE OR REPLACE FUNCTION public.is_org_member(_user_id uuid, _org_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.organization_members om
    JOIN public.organizations o ON o.id = om.organization_id
    WHERE om.user_id = _user_id AND om.organization_id = _org_id
      AND om.active = true AND o.archived_at IS NULL
  )
$$;

-- 5. Update public_read policies on related tables to hide rows of archived orgs
DROP POLICY IF EXISTS locations_public_read ON public.locations;
CREATE POLICY locations_public_read ON public.locations FOR SELECT TO anon, authenticated
  USING (public.is_org_active(organization_id) OR has_role(auth.uid(), 'platform_admin'::app_role));

DROP POLICY IF EXISTS services_public_read ON public.services;
CREATE POLICY services_public_read ON public.services FOR SELECT TO anon, authenticated
  USING (public.is_org_active(organization_id) OR has_role(auth.uid(), 'platform_admin'::app_role));

DROP POLICY IF EXISTS cats_public_read ON public.service_categories;
CREATE POLICY cats_public_read ON public.service_categories FOR SELECT TO anon, authenticated
  USING (public.is_org_active(organization_id) OR has_role(auth.uid(), 'platform_admin'::app_role));

DROP POLICY IF EXISTS packages_public_read ON public.service_packages;
CREATE POLICY packages_public_read ON public.service_packages FOR SELECT TO anon, authenticated
  USING (active = true AND (public.is_org_active(organization_id) OR has_role(auth.uid(), 'platform_admin'::app_role)));

DROP POLICY IF EXISTS resources_public_read ON public.resources;
CREATE POLICY resources_public_read ON public.resources FOR SELECT TO anon, authenticated
  USING (public.is_org_active(organization_id) OR has_role(auth.uid(), 'platform_admin'::app_role));

DROP POLICY IF EXISTS staff_public_read ON public.staff_profiles;
CREATE POLICY staff_public_read ON public.staff_profiles FOR SELECT TO anon, authenticated
  USING (public.is_org_active(organization_id) OR has_role(auth.uid(), 'platform_admin'::app_role));

DROP POLICY IF EXISTS intake_forms_public_read ON public.intake_forms;
CREATE POLICY intake_forms_public_read ON public.intake_forms FOR SELECT TO anon, authenticated
  USING (public.is_org_active(organization_id) OR has_role(auth.uid(), 'platform_admin'::app_role));

DROP POLICY IF EXISTS coupons_public_read ON public.coupons;
CREATE POLICY coupons_public_read ON public.coupons FOR SELECT TO anon, authenticated
  USING (active = true AND (public.is_org_active(organization_id) OR has_role(auth.uid(), 'platform_admin'::app_role)));

-- 6. Cascading delete via SECURITY DEFINER function (no FK cascade currently)
CREATE OR REPLACE FUNCTION public.delete_organization_cascade(_org_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT has_role(auth.uid(), 'platform_admin'::app_role) THEN
    RAISE EXCEPTION 'Only platform admin can delete organizations';
  END IF;

  DELETE FROM public.intake_answers WHERE booking_id IN (SELECT id FROM public.bookings WHERE organization_id = _org_id);
  DELETE FROM public.payments WHERE booking_id IN (SELECT id FROM public.bookings WHERE organization_id = _org_id);
  DELETE FROM public.booking_locks WHERE organization_id = _org_id;
  DELETE FROM public.bookings WHERE organization_id = _org_id;
  DELETE FROM public.intake_questions WHERE form_id IN (SELECT id FROM public.intake_forms WHERE organization_id = _org_id);
  DELETE FROM public.intake_forms WHERE organization_id = _org_id;
  DELETE FROM public.service_package_items WHERE package_id IN (SELECT id FROM public.service_packages WHERE organization_id = _org_id);
  DELETE FROM public.service_packages WHERE organization_id = _org_id;
  DELETE FROM public.service_resources WHERE service_id IN (SELECT id FROM public.services WHERE organization_id = _org_id);
  DELETE FROM public.staff_services WHERE service_id IN (SELECT id FROM public.services WHERE organization_id = _org_id);
  DELETE FROM public.services WHERE organization_id = _org_id;
  DELETE FROM public.service_categories WHERE organization_id = _org_id;
  DELETE FROM public.resources WHERE organization_id = _org_id;
  DELETE FROM public.staff_profiles WHERE organization_id = _org_id;
  DELETE FROM public.customers WHERE organization_id = _org_id;
  DELETE FROM public.inventory_movements WHERE organization_id = _org_id;
  DELETE FROM public.inventory_items WHERE organization_id = _org_id;
  DELETE FROM public.notification_logs WHERE organization_id = _org_id;
  DELETE FROM public.notification_templates WHERE organization_id = _org_id;
  DELETE FROM public.organization_email_settings WHERE organization_id = _org_id;
  DELETE FROM public.organization_members WHERE organization_id = _org_id;
  DELETE FROM public.locations WHERE organization_id = _org_id;
  DELETE FROM public.coupons WHERE organization_id = _org_id;
  DELETE FROM public.vouchers WHERE organization_id = _org_id;
  DELETE FROM public.reviews WHERE organization_id = _org_id;
  DELETE FROM public.audit_logs WHERE organization_id = _org_id;
  DELETE FROM public.staff_invitations WHERE organization_id = _org_id;
  DELETE FROM public.organizations WHERE id = _org_id;
END;
$$;
