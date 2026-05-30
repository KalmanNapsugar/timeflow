
-- 1. Tags on services
ALTER TABLE public.services ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}'::text[];
CREATE INDEX IF NOT EXISTS idx_services_tags ON public.services USING GIN(tags);

-- 2. booking_audit table — denormalized snapshot per booking
CREATE TABLE public.booking_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  booking_id uuid,
  booked_at timestamptz NOT NULL DEFAULT now(),
  start_at timestamptz NOT NULL,
  organization_name text NOT NULL,
  customer_name text NOT NULL,
  customer_email text,
  customer_phone text,
  is_new_customer boolean NOT NULL DEFAULT true,
  service_id uuid,
  service_name text NOT NULL,
  service_price numeric NOT NULL DEFAULT 0,
  prepaid boolean NOT NULL DEFAULT false,
  staff_profile_id uuid,
  staff_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.booking_audit TO authenticated;
GRANT ALL ON public.booking_audit TO service_role;

ALTER TABLE public.booking_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "booking_audit_owner_member_read"
ON public.booking_audit FOR SELECT
TO authenticated
USING (
  is_org_owner(auth.uid(), organization_id)
  OR is_org_member(auth.uid(), organization_id)
  OR has_role(auth.uid(), 'platform_admin'::app_role)
);

CREATE POLICY "booking_audit_insert_any_auth"
ON public.booking_audit FOR INSERT
TO authenticated
WITH CHECK (true);

CREATE INDEX idx_booking_audit_org_start ON public.booking_audit(organization_id, start_at DESC);
CREATE INDEX idx_booking_audit_org_booked ON public.booking_audit(organization_id, booked_at DESC);
CREATE INDEX idx_booking_audit_email ON public.booking_audit(organization_id, lower(customer_email));
CREATE INDEX idx_booking_audit_phone ON public.booking_audit(organization_id, customer_phone);
