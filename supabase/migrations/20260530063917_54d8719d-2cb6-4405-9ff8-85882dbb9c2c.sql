
ALTER TABLE public.staff_profiles
  ADD COLUMN IF NOT EXISTS availability_windows_json jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS booking_widget_bg_url text;

INSERT INTO storage.buckets (id, name, public)
VALUES ('org-assets', 'org-assets', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "org-assets public read"
ON storage.objects FOR SELECT
USING (bucket_id = 'org-assets');

CREATE POLICY "org-assets owner insert"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'org-assets'
  AND public.is_org_owner(auth.uid(), ((storage.foldername(name))[1])::uuid)
);

CREATE POLICY "org-assets owner update"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'org-assets'
  AND public.is_org_owner(auth.uid(), ((storage.foldername(name))[1])::uuid)
);

CREATE POLICY "org-assets owner delete"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'org-assets'
  AND public.is_org_owner(auth.uid(), ((storage.foldername(name))[1])::uuid)
);
