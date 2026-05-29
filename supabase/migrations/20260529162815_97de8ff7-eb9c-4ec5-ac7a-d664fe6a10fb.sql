
-- ========== ENUMS ==========
CREATE TYPE public.app_role AS ENUM ('guest','staff','owner','platform_admin');
CREATE TYPE public.booking_status AS ENUM ('draft','pending_payment','confirmed','checked_in','completed','cancelled_by_guest','cancelled_by_provider','no_show');
CREATE TYPE public.payment_status AS ENUM ('none','pending','mock_paid','paid','refunded','failed');
CREATE TYPE public.org_member_role AS ENUM ('owner','staff');

-- ========== UTILITY: updated_at trigger ==========
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

-- ========== PROFILES ==========
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id UUID UNIQUE NOT NULL,
  full_name TEXT,
  phone TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE POLICY "profiles_select_own" ON public.profiles FOR SELECT TO authenticated USING (auth_user_id = auth.uid());
CREATE POLICY "profiles_update_own" ON public.profiles FOR UPDATE TO authenticated USING (auth_user_id = auth.uid());
CREATE POLICY "profiles_insert_own" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth_user_id = auth.uid());

-- ========== USER ROLES ==========
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_roles_select_own" ON public.user_roles FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

-- ========== AUTO-CREATE PROFILE ON SIGNUP ==========
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (auth_user_id, full_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email));
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'guest');
  RETURN NEW;
END; $$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ========== ORGANIZATIONS ==========
CREATE TABLE public.organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  description TEXT,
  cover_url TEXT,
  plan TEXT NOT NULL DEFAULT 'free',
  country TEXT NOT NULL DEFAULT 'HU',
  currency TEXT NOT NULL DEFAULT 'HUF',
  timezone TEXT NOT NULL DEFAULT 'Europe/Budapest',
  public_profile_enabled BOOLEAN NOT NULL DEFAULT true,
  owner_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.organizations TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.organizations TO authenticated;
GRANT ALL ON public.organizations TO service_role;
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER organizations_updated_at BEFORE UPDATE ON public.organizations FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE POLICY "orgs_public_read" ON public.organizations FOR SELECT TO anon, authenticated USING (public_profile_enabled = true);
CREATE POLICY "orgs_owner_all" ON public.organizations FOR ALL TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());

-- ========== ORGANIZATION MEMBERS ==========
CREATE TABLE public.organization_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  role public.org_member_role NOT NULL DEFAULT 'staff',
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id, user_id)
);
GRANT SELECT ON public.organization_members TO authenticated;
GRANT ALL ON public.organization_members TO service_role;
ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_org_member(_user_id UUID, _org_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.organization_members WHERE user_id = _user_id AND organization_id = _org_id AND active = true)
$$;

CREATE OR REPLACE FUNCTION public.is_org_owner(_user_id UUID, _org_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.organizations WHERE id = _org_id AND owner_id = _user_id)
$$;

CREATE POLICY "org_members_self_read" ON public.organization_members FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.is_org_owner(auth.uid(), organization_id));

-- ========== LOCATIONS ==========
CREATE TABLE public.locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  address TEXT,
  city TEXT,
  latitude NUMERIC,
  longitude NUMERIC,
  timezone TEXT NOT NULL DEFAULT 'Europe/Budapest',
  opening_hours_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.locations TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.locations TO authenticated;
GRANT ALL ON public.locations TO service_role;
ALTER TABLE public.locations ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER locations_updated_at BEFORE UPDATE ON public.locations FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE POLICY "locations_public_read" ON public.locations FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "locations_owner_write" ON public.locations FOR ALL TO authenticated USING (public.is_org_owner(auth.uid(), organization_id)) WITH CHECK (public.is_org_owner(auth.uid(), organization_id));

-- ========== SERVICE CATEGORIES ==========
CREATE TABLE public.service_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.service_categories TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.service_categories TO authenticated;
GRANT ALL ON public.service_categories TO service_role;
ALTER TABLE public.service_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cats_public_read" ON public.service_categories FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "cats_owner_write" ON public.service_categories FOR ALL TO authenticated USING (public.is_org_owner(auth.uid(), organization_id)) WITH CHECK (public.is_org_owner(auth.uid(), organization_id));

-- ========== SERVICES ==========
CREATE TABLE public.services (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  category_id UUID REFERENCES public.service_categories(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  description TEXT,
  price NUMERIC NOT NULL DEFAULT 0,
  duration_minutes INT NOT NULL DEFAULT 30,
  buffer_before_minutes INT NOT NULL DEFAULT 0,
  buffer_after_minutes INT NOT NULL DEFAULT 0,
  deposit_required BOOLEAN NOT NULL DEFAULT false,
  deposit_amount NUMERIC NOT NULL DEFAULT 0,
  cancellation_policy_json JSONB NOT NULL DEFAULT '{"free_until_hours":24,"late_fee":0,"no_show_fee":0,"deposit_non_refundable":false}'::jsonb,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.services TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.services TO authenticated;
GRANT ALL ON public.services TO service_role;
ALTER TABLE public.services ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER services_updated_at BEFORE UPDATE ON public.services FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE POLICY "services_public_read" ON public.services FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "services_owner_write" ON public.services FOR ALL TO authenticated USING (public.is_org_owner(auth.uid(), organization_id)) WITH CHECK (public.is_org_owner(auth.uid(), organization_id));

-- ========== STAFF PROFILES ==========
CREATE TABLE public.staff_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID,
  display_name TEXT NOT NULL,
  bio TEXT,
  avatar_url TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  working_hours_json JSONB NOT NULL DEFAULT '{"mon":["09:00","17:00"],"tue":["09:00","17:00"],"wed":["09:00","17:00"],"thu":["09:00","17:00"],"fri":["09:00","17:00"],"sat":null,"sun":null}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.staff_profiles TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.staff_profiles TO authenticated;
GRANT ALL ON public.staff_profiles TO service_role;
ALTER TABLE public.staff_profiles ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER staff_updated_at BEFORE UPDATE ON public.staff_profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE POLICY "staff_public_read" ON public.staff_profiles FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "staff_owner_write" ON public.staff_profiles FOR ALL TO authenticated USING (public.is_org_owner(auth.uid(), organization_id)) WITH CHECK (public.is_org_owner(auth.uid(), organization_id));

-- ========== STAFF SERVICES ==========
CREATE TABLE public.staff_services (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_profile_id UUID NOT NULL REFERENCES public.staff_profiles(id) ON DELETE CASCADE,
  service_id UUID NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  UNIQUE(staff_profile_id, service_id)
);
GRANT SELECT ON public.staff_services TO anon, authenticated;
GRANT INSERT, DELETE ON public.staff_services TO authenticated;
GRANT ALL ON public.staff_services TO service_role;
ALTER TABLE public.staff_services ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff_services_public_read" ON public.staff_services FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "staff_services_owner_write" ON public.staff_services FOR ALL TO authenticated USING (
  EXISTS (SELECT 1 FROM public.services s WHERE s.id = service_id AND public.is_org_owner(auth.uid(), s.organization_id))
) WITH CHECK (
  EXISTS (SELECT 1 FROM public.services s WHERE s.id = service_id AND public.is_org_owner(auth.uid(), s.organization_id))
);

-- ========== RESOURCES ==========
CREATE TABLE public.resources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  location_id UUID REFERENCES public.locations(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'room',
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.resources TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.resources TO authenticated;
GRANT ALL ON public.resources TO service_role;
ALTER TABLE public.resources ENABLE ROW LEVEL SECURITY;
CREATE POLICY "resources_public_read" ON public.resources FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "resources_owner_write" ON public.resources FOR ALL TO authenticated USING (public.is_org_owner(auth.uid(), organization_id)) WITH CHECK (public.is_org_owner(auth.uid(), organization_id));

-- ========== SERVICE RESOURCES ==========
CREATE TABLE public.service_resources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id UUID NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  resource_id UUID NOT NULL REFERENCES public.resources(id) ON DELETE CASCADE,
  required BOOLEAN NOT NULL DEFAULT true,
  UNIQUE(service_id, resource_id)
);
GRANT SELECT ON public.service_resources TO anon, authenticated;
GRANT INSERT, DELETE ON public.service_resources TO authenticated;
GRANT ALL ON public.service_resources TO service_role;
ALTER TABLE public.service_resources ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_res_public_read" ON public.service_resources FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "service_res_owner_write" ON public.service_resources FOR ALL TO authenticated USING (
  EXISTS (SELECT 1 FROM public.services s WHERE s.id = service_id AND public.is_org_owner(auth.uid(), s.organization_id))
) WITH CHECK (
  EXISTS (SELECT 1 FROM public.services s WHERE s.id = service_id AND public.is_org_owner(auth.uid(), s.organization_id))
);

-- ========== CUSTOMERS ==========
CREATE TABLE public.customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  auth_user_id UUID,
  full_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  notes_private TEXT,
  tags TEXT[] NOT NULL DEFAULT '{}',
  gdpr_consent_at TIMESTAMPTZ,
  blacklisted BOOLEAN NOT NULL DEFAULT false,
  requires_deposit_override BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.customers TO authenticated;
GRANT ALL ON public.customers TO service_role;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER customers_updated_at BEFORE UPDATE ON public.customers FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE POLICY "customers_self_read" ON public.customers FOR SELECT TO authenticated USING (auth_user_id = auth.uid() OR public.is_org_owner(auth.uid(), organization_id) OR public.is_org_member(auth.uid(), organization_id));
CREATE POLICY "customers_owner_write" ON public.customers FOR ALL TO authenticated USING (public.is_org_owner(auth.uid(), organization_id)) WITH CHECK (public.is_org_owner(auth.uid(), organization_id));

-- ========== BOOKINGS ==========
CREATE TABLE public.bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  location_id UUID REFERENCES public.locations(id) ON DELETE SET NULL,
  customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  customer_auth_user_id UUID,
  staff_profile_id UUID REFERENCES public.staff_profiles(id) ON DELETE SET NULL,
  service_id UUID NOT NULL REFERENCES public.services(id) ON DELETE RESTRICT,
  resource_id UUID REFERENCES public.resources(id) ON DELETE SET NULL,
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  status public.booking_status NOT NULL DEFAULT 'confirmed',
  price_total NUMERIC NOT NULL DEFAULT 0,
  deposit_amount NUMERIC NOT NULL DEFAULT 0,
  payment_status public.payment_status NOT NULL DEFAULT 'none',
  source TEXT NOT NULL DEFAULT 'web',
  cancellation_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bookings TO authenticated;
GRANT ALL ON public.bookings TO service_role;
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER bookings_updated_at BEFORE UPDATE ON public.bookings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE POLICY "bookings_select" ON public.bookings FOR SELECT TO authenticated USING (
  customer_auth_user_id = auth.uid()
  OR public.is_org_owner(auth.uid(), organization_id)
  OR public.is_org_member(auth.uid(), organization_id)
);
CREATE POLICY "bookings_insert_self" ON public.bookings FOR INSERT TO authenticated WITH CHECK (
  customer_auth_user_id = auth.uid() OR public.is_org_owner(auth.uid(), organization_id)
);
CREATE POLICY "bookings_update" ON public.bookings FOR UPDATE TO authenticated USING (
  customer_auth_user_id = auth.uid() OR public.is_org_owner(auth.uid(), organization_id)
);
CREATE INDEX idx_bookings_org_start ON public.bookings(organization_id, start_at);
CREATE INDEX idx_bookings_staff_start ON public.bookings(staff_profile_id, start_at);

-- ========== BOOKING LOCKS ==========
CREATE TABLE public.booking_locks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  service_id UUID NOT NULL,
  staff_profile_id UUID,
  resource_id UUID,
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  guest_session_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, DELETE ON public.booking_locks TO authenticated;
GRANT ALL ON public.booking_locks TO service_role;
ALTER TABLE public.booking_locks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "locks_all_auth" ON public.booking_locks FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ========== INTAKE FORMS ==========
CREATE TABLE public.intake_forms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  service_id UUID REFERENCES public.services(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.intake_forms TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.intake_forms TO authenticated;
GRANT ALL ON public.intake_forms TO service_role;
ALTER TABLE public.intake_forms ENABLE ROW LEVEL SECURITY;
CREATE POLICY "intake_forms_public_read" ON public.intake_forms FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "intake_forms_owner_write" ON public.intake_forms FOR ALL TO authenticated USING (public.is_org_owner(auth.uid(), organization_id)) WITH CHECK (public.is_org_owner(auth.uid(), organization_id));

CREATE TABLE public.intake_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id UUID NOT NULL REFERENCES public.intake_forms(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'text',
  required BOOLEAN NOT NULL DEFAULT false,
  options_json JSONB,
  sort_order INT NOT NULL DEFAULT 0
);
GRANT SELECT ON public.intake_questions TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.intake_questions TO authenticated;
GRANT ALL ON public.intake_questions TO service_role;
ALTER TABLE public.intake_questions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "intake_q_public_read" ON public.intake_questions FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "intake_q_owner_write" ON public.intake_questions FOR ALL TO authenticated USING (
  EXISTS (SELECT 1 FROM public.intake_forms f WHERE f.id = form_id AND public.is_org_owner(auth.uid(), f.organization_id))
) WITH CHECK (
  EXISTS (SELECT 1 FROM public.intake_forms f WHERE f.id = form_id AND public.is_org_owner(auth.uid(), f.organization_id))
);

CREATE TABLE public.intake_answers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  question_id UUID NOT NULL REFERENCES public.intake_questions(id) ON DELETE CASCADE,
  answer_text TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.intake_answers TO authenticated;
GRANT ALL ON public.intake_answers TO service_role;
ALTER TABLE public.intake_answers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "intake_a_select" ON public.intake_answers FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.bookings b WHERE b.id = booking_id AND (b.customer_auth_user_id = auth.uid() OR public.is_org_owner(auth.uid(), b.organization_id) OR public.is_org_member(auth.uid(), b.organization_id)))
);
CREATE POLICY "intake_a_insert" ON public.intake_answers FOR INSERT TO authenticated WITH CHECK (
  EXISTS (SELECT 1 FROM public.bookings b WHERE b.id = booking_id AND (b.customer_auth_user_id = auth.uid() OR public.is_org_owner(auth.uid(), b.organization_id)))
);

-- ========== PAYMENTS ==========
CREATE TABLE public.payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'mock',
  amount NUMERIC NOT NULL,
  currency TEXT NOT NULL DEFAULT 'HUF',
  status public.payment_status NOT NULL DEFAULT 'mock_paid',
  external_reference TEXT,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.payments TO authenticated;
GRANT ALL ON public.payments TO service_role;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "payments_select" ON public.payments FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.bookings b WHERE b.id = booking_id AND (b.customer_auth_user_id = auth.uid() OR public.is_org_owner(auth.uid(), b.organization_id)))
);
CREATE POLICY "payments_insert" ON public.payments FOR INSERT TO authenticated WITH CHECK (
  EXISTS (SELECT 1 FROM public.bookings b WHERE b.id = booking_id AND (b.customer_auth_user_id = auth.uid() OR public.is_org_owner(auth.uid(), b.organization_id)))
);

-- ========== NOTIFICATION LOGS ==========
CREATE TABLE public.notification_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  booking_id UUID REFERENCES public.bookings(id) ON DELETE SET NULL,
  customer_id UUID,
  channel TEXT NOT NULL DEFAULT 'email',
  template_key TEXT NOT NULL,
  recipient TEXT,
  status TEXT NOT NULL DEFAULT 'mock_sent',
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  payload_json JSONB
);
GRANT SELECT, INSERT ON public.notification_logs TO authenticated;
GRANT ALL ON public.notification_logs TO service_role;
ALTER TABLE public.notification_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "notif_select_org" ON public.notification_logs FOR SELECT TO authenticated USING (
  public.is_org_owner(auth.uid(), organization_id) OR public.is_org_member(auth.uid(), organization_id)
);
CREATE POLICY "notif_insert" ON public.notification_logs FOR INSERT TO authenticated WITH CHECK (true);

-- ========== AUDIT LOGS ==========
CREATE TABLE public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID,
  actor_profile_id UUID,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id UUID,
  metadata_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.audit_logs TO authenticated;
GRANT ALL ON public.audit_logs TO service_role;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "audit_select_org" ON public.audit_logs FOR SELECT TO authenticated USING (
  organization_id IS NULL OR public.is_org_owner(auth.uid(), organization_id)
);
CREATE POLICY "audit_insert" ON public.audit_logs FOR INSERT TO authenticated WITH CHECK (true);
