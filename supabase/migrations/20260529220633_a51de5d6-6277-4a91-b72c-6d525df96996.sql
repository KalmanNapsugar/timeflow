
-- =====================
-- COUPONS
-- =====================
CREATE TYPE public.coupon_type AS ENUM ('percent', 'fixed');

CREATE TABLE public.coupons (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL,
  code TEXT NOT NULL,
  type public.coupon_type NOT NULL DEFAULT 'percent',
  value NUMERIC NOT NULL DEFAULT 0,
  valid_from TIMESTAMPTZ,
  valid_until TIMESTAMPTZ,
  max_uses INTEGER,
  used_count INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, code)
);
GRANT SELECT ON public.coupons TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.coupons TO authenticated;
GRANT ALL ON public.coupons TO service_role;
ALTER TABLE public.coupons ENABLE ROW LEVEL SECURITY;
CREATE POLICY coupons_public_read ON public.coupons FOR SELECT TO anon, authenticated USING (active = true);
CREATE POLICY coupons_owner_write ON public.coupons FOR ALL TO authenticated
  USING (is_org_owner(auth.uid(), organization_id))
  WITH CHECK (is_org_owner(auth.uid(), organization_id));

-- =====================
-- VOUCHERS
-- =====================
CREATE TABLE public.vouchers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL,
  code TEXT NOT NULL,
  initial_amount NUMERIC NOT NULL DEFAULT 0,
  balance NUMERIC NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'HUF',
  customer_id UUID,
  recipient_email TEXT,
  expires_at TIMESTAMPTZ,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, code)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vouchers TO authenticated;
GRANT ALL ON public.vouchers TO service_role;
ALTER TABLE public.vouchers ENABLE ROW LEVEL SECURITY;
CREATE POLICY vouchers_owner_all ON public.vouchers FOR ALL TO authenticated
  USING (is_org_owner(auth.uid(), organization_id))
  WITH CHECK (is_org_owner(auth.uid(), organization_id));
CREATE POLICY vouchers_customer_read ON public.vouchers FOR SELECT TO authenticated
  USING (customer_id IN (SELECT id FROM public.customers WHERE auth_user_id = auth.uid()));

-- =====================
-- SERVICE PACKAGES
-- =====================
CREATE TABLE public.service_packages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  price NUMERIC NOT NULL DEFAULT 0,
  validity_months INTEGER NOT NULL DEFAULT 12,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.service_packages TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.service_packages TO authenticated;
GRANT ALL ON public.service_packages TO service_role;
ALTER TABLE public.service_packages ENABLE ROW LEVEL SECURITY;
CREATE POLICY packages_public_read ON public.service_packages FOR SELECT TO anon, authenticated USING (active = true);
CREATE POLICY packages_owner_write ON public.service_packages FOR ALL TO authenticated
  USING (is_org_owner(auth.uid(), organization_id))
  WITH CHECK (is_org_owner(auth.uid(), organization_id));

CREATE TABLE public.service_package_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  package_id UUID NOT NULL,
  service_id UUID NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1
);
GRANT SELECT ON public.service_package_items TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.service_package_items TO authenticated;
GRANT ALL ON public.service_package_items TO service_role;
ALTER TABLE public.service_package_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY package_items_public_read ON public.service_package_items FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY package_items_owner_write ON public.service_package_items FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.service_packages p WHERE p.id = package_id AND is_org_owner(auth.uid(), p.organization_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.service_packages p WHERE p.id = package_id AND is_org_owner(auth.uid(), p.organization_id)));

-- =====================
-- REVIEWS
-- =====================
CREATE TYPE public.review_status AS ENUM ('pending', 'approved', 'hidden');

CREATE TABLE public.reviews (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL,
  booking_id UUID,
  customer_id UUID,
  customer_auth_user_id UUID,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT,
  status public.review_status NOT NULL DEFAULT 'pending',
  reply TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.reviews TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.reviews TO authenticated;
GRANT ALL ON public.reviews TO service_role;
ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY reviews_public_read_approved ON public.reviews FOR SELECT TO anon, authenticated USING (status = 'approved');
CREATE POLICY reviews_owner_all ON public.reviews FOR ALL TO authenticated
  USING (is_org_owner(auth.uid(), organization_id))
  WITH CHECK (is_org_owner(auth.uid(), organization_id));
CREATE POLICY reviews_customer_insert ON public.reviews FOR INSERT TO authenticated
  WITH CHECK (customer_auth_user_id = auth.uid());
CREATE POLICY reviews_customer_read_own ON public.reviews FOR SELECT TO authenticated
  USING (customer_auth_user_id = auth.uid());

-- =====================
-- INVENTORY
-- =====================
CREATE TABLE public.inventory_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL,
  name TEXT NOT NULL,
  sku TEXT,
  quantity NUMERIC NOT NULL DEFAULT 0,
  unit TEXT NOT NULL DEFAULT 'db',
  low_stock_threshold NUMERIC NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.inventory_items TO authenticated;
GRANT ALL ON public.inventory_items TO service_role;
ALTER TABLE public.inventory_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY inv_items_owner_all ON public.inventory_items FOR ALL TO authenticated
  USING (is_org_owner(auth.uid(), organization_id))
  WITH CHECK (is_org_owner(auth.uid(), organization_id));

CREATE TABLE public.inventory_movements (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  item_id UUID NOT NULL,
  organization_id UUID NOT NULL,
  delta NUMERIC NOT NULL,
  reason TEXT,
  booking_id UUID,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.inventory_movements TO authenticated;
GRANT ALL ON public.inventory_movements TO service_role;
ALTER TABLE public.inventory_movements ENABLE ROW LEVEL SECURITY;
CREATE POLICY inv_mov_owner_all ON public.inventory_movements FOR ALL TO authenticated
  USING (is_org_owner(auth.uid(), organization_id))
  WITH CHECK (is_org_owner(auth.uid(), organization_id));

-- =====================
-- NOTIFICATION TEMPLATES
-- =====================
CREATE TABLE public.notification_templates (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL,
  template_key TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'email',
  subject TEXT,
  body TEXT NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, template_key, channel)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notification_templates TO authenticated;
GRANT ALL ON public.notification_templates TO service_role;
ALTER TABLE public.notification_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY notif_tmpl_owner_all ON public.notification_templates FOR ALL TO authenticated
  USING (is_org_owner(auth.uid(), organization_id))
  WITH CHECK (is_org_owner(auth.uid(), organization_id));

-- =====================
-- Triggers for updated_at
-- =====================
CREATE TRIGGER trg_coupons_updated BEFORE UPDATE ON public.coupons FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_vouchers_updated BEFORE UPDATE ON public.vouchers FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_packages_updated BEFORE UPDATE ON public.service_packages FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_reviews_updated BEFORE UPDATE ON public.reviews FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_inv_items_updated BEFORE UPDATE ON public.inventory_items FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_notif_tmpl_updated BEFORE UPDATE ON public.notification_templates FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =====================
-- INDEXES
-- =====================
CREATE INDEX idx_coupons_org ON public.coupons(organization_id);
CREATE INDEX idx_vouchers_org ON public.vouchers(organization_id);
CREATE INDEX idx_packages_org ON public.service_packages(organization_id);
CREATE INDEX idx_pkg_items_pkg ON public.service_package_items(package_id);
CREATE INDEX idx_reviews_org ON public.reviews(organization_id);
CREATE INDEX idx_reviews_status ON public.reviews(status);
CREATE INDEX idx_inv_items_org ON public.inventory_items(organization_id);
CREATE INDEX idx_inv_mov_item ON public.inventory_movements(item_id);
CREATE INDEX idx_notif_tmpl_org ON public.notification_templates(organization_id);
