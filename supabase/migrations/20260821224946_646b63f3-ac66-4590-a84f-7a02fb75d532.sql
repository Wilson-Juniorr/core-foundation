REVOKE EXECUTE ON FUNCTION public.validate_opportunity_ownership() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.validate_timeline_event_ownership() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_updated_at() FROM anon, authenticated, PUBLIC;