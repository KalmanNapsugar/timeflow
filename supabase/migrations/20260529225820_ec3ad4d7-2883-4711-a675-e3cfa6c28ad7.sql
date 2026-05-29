
-- 1) Üzlet-szintű e-mail beállítások
CREATE TYPE public.email_provider AS ENUM ('lovable_shared', 'lovable_custom_domain', 'resend');

CREATE TABLE public.organization_email_settings (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  sender_name text NOT NULL DEFAULT '',
  sender_email text,
  reply_to text,
  provider public.email_provider NOT NULL DEFAULT 'lovable_shared',
  custom_domain text,
  domain_verified_at timestamptz,
  resend_api_key_secret_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.organization_email_settings TO authenticated;
GRANT ALL ON public.organization_email_settings TO service_role;

ALTER TABLE public.organization_email_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "email_settings_owner_all"
ON public.organization_email_settings
FOR ALL TO authenticated
USING (public.is_org_owner(auth.uid(), organization_id))
WITH CHECK (public.is_org_owner(auth.uid(), organization_id));

CREATE POLICY "email_settings_admin_read"
ON public.organization_email_settings
FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'platform_admin'));

CREATE TRIGGER trg_email_settings_updated
BEFORE UPDATE ON public.organization_email_settings
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 2) Impersonációs napló (read-only admin nézet más felhasználó nevében)
CREATE TABLE public.impersonation_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id uuid NOT NULL,
  target_user_id uuid NOT NULL,
  reason text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  viewed_routes jsonb NOT NULL DEFAULT '[]'::jsonb
);

GRANT SELECT, INSERT, UPDATE ON public.impersonation_log TO authenticated;
GRANT ALL ON public.impersonation_log TO service_role;

ALTER TABLE public.impersonation_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "impersonation_admin_all"
ON public.impersonation_log
FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'platform_admin'))
WITH CHECK (public.has_role(auth.uid(), 'platform_admin') AND admin_user_id = auth.uid());

CREATE INDEX idx_impersonation_admin ON public.impersonation_log(admin_user_id, started_at DESC);
CREATE INDEX idx_impersonation_target ON public.impersonation_log(target_user_id, started_at DESC);
