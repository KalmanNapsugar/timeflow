
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS dst_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS booking_timezone_mode text NOT NULL DEFAULT 'business' CHECK (booking_timezone_mode IN ('business','user'));
