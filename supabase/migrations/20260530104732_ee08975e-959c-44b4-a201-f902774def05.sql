
ALTER TABLE public.service_resources
  ADD COLUMN IF NOT EXISTS group_no integer NOT NULL DEFAULT 1;

-- Backfill: each existing row gets its own group (preserves current AND-only behavior)
WITH numbered AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY service_id ORDER BY id) AS rn
  FROM public.service_resources
)
UPDATE public.service_resources sr
SET group_no = n.rn
FROM numbered n
WHERE sr.id = n.id;

CREATE INDEX IF NOT EXISTS service_resources_service_group_idx
  ON public.service_resources (service_id, group_no);
