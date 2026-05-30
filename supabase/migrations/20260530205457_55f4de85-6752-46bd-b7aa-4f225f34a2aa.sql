ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS equipment_ids uuid[] NOT NULL DEFAULT '{}';
CREATE INDEX IF NOT EXISTS idx_bookings_equipment_ids ON public.bookings USING GIN (equipment_ids);