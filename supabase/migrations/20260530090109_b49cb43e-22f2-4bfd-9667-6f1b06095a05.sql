ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS note text,
  ADD COLUMN IF NOT EXISTS note_visible_to_customer boolean NOT NULL DEFAULT false;

ALTER TABLE public.booking_audit
  ADD COLUMN IF NOT EXISTS note text,
  ADD COLUMN IF NOT EXISTS note_visible_to_customer boolean NOT NULL DEFAULT false;