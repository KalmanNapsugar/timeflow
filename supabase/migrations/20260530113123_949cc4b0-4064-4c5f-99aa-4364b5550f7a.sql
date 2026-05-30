-- Align staff_resource_assignments availability model with staff_profiles availability model
ALTER TABLE public.staff_resource_assignments
  ADD COLUMN IF NOT EXISTS working_hours_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS availability_windows_json jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Migrate existing weekly patterns
UPDATE public.staff_resource_assignments
SET working_hours_json = weekly_pattern_json
WHERE kind = 'weekly' AND weekly_pattern_json IS NOT NULL;

-- Migrate existing single-window into availability windows array
UPDATE public.staff_resource_assignments
SET availability_windows_json = jsonb_build_array(jsonb_build_object(
  'start', to_char(starts_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
  'end',   to_char(ends_at   AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
))
WHERE kind = 'window' AND starts_at IS NOT NULL AND ends_at IS NOT NULL;

-- Normalize kind values: collapse weekly/window into a single 'scheduled' kind
UPDATE public.staff_resource_assignments
SET kind = 'scheduled'
WHERE kind IN ('weekly','window');