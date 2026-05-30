
-- #1: org-szintű tag katalógus
CREATE TABLE IF NOT EXISTS public.service_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id, name)
);

GRANT SELECT ON public.service_tags TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.service_tags TO authenticated;
GRANT ALL ON public.service_tags TO service_role;

ALTER TABLE public.service_tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tags_public_read" ON public.service_tags
  FOR SELECT TO anon, authenticated
  USING (is_org_active(organization_id) OR has_role(auth.uid(), 'platform_admin'::app_role));

CREATE POLICY "tags_owner_all" ON public.service_tags
  FOR ALL TO authenticated
  USING (is_org_owner(auth.uid(), organization_id))
  WITH CHECK (is_org_owner(auth.uid(), organization_id));

-- Backfill: meglévő services.tags értékekből
INSERT INTO public.service_tags (organization_id, name)
SELECT DISTINCT s.organization_id, unnest(s.tags)
FROM public.services s
WHERE array_length(s.tags, 1) > 0
ON CONFLICT DO NOTHING;

-- #3: min. lead time mezők
ALTER TABLE public.services
  ADD COLUMN IF NOT EXISTS min_lead_time_minutes integer NOT NULL DEFAULT 0;

ALTER TABLE public.staff_profiles
  ADD COLUMN IF NOT EXISTS min_lead_time_minutes integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS allow_instant_after_booking boolean NOT NULL DEFAULT false;
