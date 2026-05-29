
-- Staff invitations enum + table
CREATE TYPE public.staff_invitation_status AS ENUM ('pending','accepted','declined','revoked');

CREATE TABLE public.staff_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  invited_email text NOT NULL,
  invited_by uuid NOT NULL,
  status public.staff_invitation_status NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz
);

CREATE INDEX idx_staff_invitations_email ON public.staff_invitations (lower(invited_email));
CREATE INDEX idx_staff_invitations_org ON public.staff_invitations (organization_id);
CREATE UNIQUE INDEX uniq_pending_invitation ON public.staff_invitations (organization_id, lower(invited_email)) WHERE status = 'pending';

GRANT SELECT, INSERT, UPDATE, DELETE ON public.staff_invitations TO authenticated;
GRANT ALL ON public.staff_invitations TO service_role;

ALTER TABLE public.staff_invitations ENABLE ROW LEVEL SECURITY;

-- Owners can manage their org's invitations
CREATE POLICY staff_inv_owner_all ON public.staff_invitations
  FOR ALL TO authenticated
  USING (public.is_org_owner(auth.uid(), organization_id))
  WITH CHECK (public.is_org_owner(auth.uid(), organization_id));

-- Invited user can see their own pending invitations (email match against auth.users)
CREATE POLICY staff_inv_invitee_select ON public.staff_invitations
  FOR SELECT TO authenticated
  USING (lower(invited_email) = lower((SELECT email FROM auth.users WHERE id = auth.uid())));

CREATE POLICY staff_inv_invitee_update ON public.staff_invitations
  FOR UPDATE TO authenticated
  USING (lower(invited_email) = lower((SELECT email FROM auth.users WHERE id = auth.uid())));

-- Allow inserting into organization_members via server (insert policy was missing)
CREATE POLICY org_members_owner_insert ON public.organization_members
  FOR INSERT TO authenticated
  WITH CHECK (public.is_org_owner(auth.uid(), organization_id));

CREATE POLICY org_members_owner_update ON public.organization_members
  FOR UPDATE TO authenticated
  USING (public.is_org_owner(auth.uid(), organization_id));

CREATE POLICY org_members_owner_delete ON public.organization_members
  FOR DELETE TO authenticated
  USING (public.is_org_owner(auth.uid(), organization_id));

-- Register /profile route permission
INSERT INTO public.role_permissions (route_path, label, roles)
VALUES ('/profile', 'Saját profil', ARRAY['customer','staff','owner','platform_admin']::app_role[])
ON CONFLICT (route_path) DO UPDATE SET roles = EXCLUDED.roles, label = EXCLUDED.label;
