CREATE TABLE public.equipment_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  equipment_resource_id uuid NOT NULL,
  location_resource_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (equipment_resource_id, location_resource_id)
);

CREATE INDEX idx_equipment_locations_org ON public.equipment_locations(organization_id);
CREATE INDEX idx_equipment_locations_equipment ON public.equipment_locations(equipment_resource_id);
CREATE INDEX idx_equipment_locations_location ON public.equipment_locations(location_resource_id);

GRANT SELECT ON public.equipment_locations TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.equipment_locations TO authenticated;
GRANT ALL ON public.equipment_locations TO service_role;

ALTER TABLE public.equipment_locations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "equipment_locations_public_read"
  ON public.equipment_locations FOR SELECT
  TO anon, authenticated
  USING (is_org_active(organization_id) OR has_role(auth.uid(), 'platform_admin'::app_role));

CREATE POLICY "equipment_locations_owner_write"
  ON public.equipment_locations FOR ALL
  TO authenticated
  USING (is_org_owner(auth.uid(), organization_id))
  WITH CHECK (is_org_owner(auth.uid(), organization_id));

CREATE POLICY "equipment_locations_admin_all"
  ON public.equipment_locations FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'platform_admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'platform_admin'::app_role));