
-- Útvonalakhoz tartozó szerepkör-engedélyek
CREATE TABLE public.role_permissions (
  route_path text PRIMARY KEY,
  label text NOT NULL,
  roles app_role[] NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.role_permissions TO anon, authenticated;
GRANT ALL ON public.role_permissions TO service_role;

ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;

-- Mindenki olvashatja (UI gating-hez), írni csak service_role-on keresztül (server fn admin ellenőrzéssel).
CREATE POLICY "role_permissions_public_read"
  ON public.role_permissions FOR SELECT
  TO anon, authenticated
  USING (true);

-- Kezdő seed (a frontend `permissions.ts` jelenlegi mátrixa)
INSERT INTO public.role_permissions (route_path, label, roles) VALUES
  ('/', 'Főoldal', ARRAY['guest','staff','owner','platform_admin']::app_role[]),
  ('/search', 'Felfedezés', ARRAY['guest','staff','owner','platform_admin']::app_role[]),
  ('/login', 'Bejelentkezés', ARRAY['guest','staff','owner','platform_admin']::app_role[]),
  ('/my-bookings', 'Foglalásaim', ARRAY['guest','staff','owner','platform_admin']::app_role[]),
  ('/organizations/new', 'Új üzlet létrehozása', ARRAY['guest','staff','owner','platform_admin']::app_role[]),
  ('/dashboard', 'Vezérlőpult – Áttekintés', ARRAY['staff','owner','platform_admin']::app_role[]),
  ('/dashboard/calendar', 'Vezérlőpult – Naptár', ARRAY['staff','owner','platform_admin']::app_role[]),
  ('/dashboard/customers', 'Vezérlőpult – Ügyfelek', ARRAY['staff','owner','platform_admin']::app_role[]),
  ('/dashboard/services', 'Vezérlőpult – Szolgáltatások', ARRAY['owner','platform_admin']::app_role[]),
  ('/dashboard/staff', 'Vezérlőpult – Munkatársak', ARRAY['owner','platform_admin']::app_role[]),
  ('/dashboard/resources', 'Vezérlőpult – Erőforrások', ARRAY['owner','platform_admin']::app_role[]),
  ('/dashboard/marketing', 'Vezérlőpult – Marketing', ARRAY['owner','platform_admin']::app_role[]),
  ('/dashboard/reviews', 'Vezérlőpult – Vélemények', ARRAY['owner','platform_admin']::app_role[]),
  ('/dashboard/reports', 'Vezérlőpult – Riportok', ARRAY['owner','platform_admin']::app_role[]),
  ('/dashboard/inventory', 'Vezérlőpult – Készlet', ARRAY['staff','owner','platform_admin']::app_role[]),
  ('/dashboard/settings', 'Vezérlőpult – Beállítások', ARRAY['owner','platform_admin']::app_role[]),
  ('/dashboard/audit-log', 'Vezérlőpult – Audit napló', ARRAY['owner','platform_admin']::app_role[]),
  ('/dashboard/ai-assistant', 'Vezérlőpult – AI asszisztens', ARRAY['owner','platform_admin']::app_role[]),
  ('/admin', 'Admin – Felhasználók', ARRAY['platform_admin']::app_role[]);
