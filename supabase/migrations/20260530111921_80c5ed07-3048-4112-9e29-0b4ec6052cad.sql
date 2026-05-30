UPDATE public.role_permissions
SET roles = (SELECT array_agg(DISTINCT r)::app_role[] FROM unnest(roles || ARRAY['guest']::app_role[]) r)
WHERE route_path IN ('/login', '/', '/search', '/provider/$slug', '/book/$slug', '/book/confirmed/$bookingId')
  AND NOT ('guest'::app_role = ANY(roles));