ALTER TABLE public.resources ADD COLUMN IF NOT EXISTS capacity integer NOT NULL DEFAULT 1;
ALTER TABLE public.resources ADD CONSTRAINT resources_capacity_positive CHECK (capacity >= 1);