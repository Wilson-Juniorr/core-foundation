revoke execute on function public.validate_flow_step_ownership() from public;
revoke execute on function public.validate_followup_run_ownership() from public;
revoke execute on function public.validate_scheduled_action_ownership() from public;
revoke execute on function public.validate_flow_step_ownership() from anon, authenticated;
revoke execute on function public.validate_followup_run_ownership() from anon, authenticated;
revoke execute on function public.validate_scheduled_action_ownership() from anon, authenticated;