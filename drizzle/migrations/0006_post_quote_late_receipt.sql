CREATE OR REPLACE FUNCTION public.accept_post_quote_contact(
  p_action uuid, p_message uuid, p_at timestamptz, p_next timestamptz, p_reason text
) RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  a public.scheduled_actions;
  r public.followup_runs;
  done integer;
  finished boolean;
  next_evaluation timestamptz;
BEGIN
  SELECT * INTO a FROM public.scheduled_actions WHERE id = p_action FOR UPDATE;
  SELECT * INTO r FROM public.followup_runs WHERE id = a.flow_run_id FOR UPDATE;
  IF r.policy_key IS DISTINCT FROM 'post_quote_v1' OR a.logical_contact IS NULL
     OR a.send_state = 'accepted' THEN
    RETURN false;
  END IF;
  done := r.contacts_done + 1;
  IF a.logical_contact <> done THEN
    RAISE EXCEPTION 'logical contact out of order';
  END IF;

  UPDATE public.scheduled_actions
  SET send_state = 'accepted', status = 'sent', executed_at = p_at,
      message_id = p_message, last_error = NULL
  WHERE id = a.id;

  -- Um recibo tardio entra no histórico, sem trocar a agenda de um ciclo encerrado.
  IF r.status NOT IN ('active', 'paused') THEN
    UPDATE public.followup_runs
    SET contacts_done = done, last_contact_accepted_at = p_at
    WHERE id = r.id;
    RETURN true;
  END IF;

  finished := r.status = 'active' AND done >= 8;
  next_evaluation := CASE WHEN r.status = 'active' AND NOT finished THEN p_next END;
  UPDATE public.followup_runs
  SET contacts_done = done, last_contact_accepted_at = p_at,
      next_contact_at = p_next,
      next_contact_reason = CASE WHEN r.status = 'paused' THEN r.next_contact_reason ELSE p_reason END,
      next_contact_responsible = CASE
        WHEN r.status = 'paused' THEN r.next_contact_responsible
        WHEN p_next IS NULL THEN 'none' ELSE 'system' END,
      next_evaluation_at = next_evaluation,
      status = CASE WHEN finished THEN 'completed'::public.followup_run_status ELSE r.status END,
      smart_state = CASE WHEN r.status = 'paused' THEN r.smart_state
        WHEN finished THEN 'completed' ELSE 'waiting_customer' END,
      completed_at = CASE WHEN finished THEN p_at ELSE r.completed_at END,
      stop_reason = CASE WHEN finished THEN 'post_quote_cycle_completed' ELSE r.stop_reason END
  WHERE id = r.id;

  UPDATE public.opportunities
  SET post_quote_run_id = r.id, post_quote_next_at = next_evaluation,
      post_quote_next_reason = CASE WHEN r.status = 'paused' THEN r.next_contact_reason ELSE p_reason END
  WHERE id = r.opportunity_id AND user_id = r.user_id;
  RETURN true;
END $$;
