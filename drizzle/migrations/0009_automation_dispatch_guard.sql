ALTER TABLE public.scheduled_actions ADD COLUMN dispatch_approved_at timestamptz;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.begin_automation_dispatch(
  p_action uuid, p_user uuid, p_message uuid
) RETURNS boolean
LANGUAGE sql
SET search_path = public
AS $$
  WITH started AS (
    UPDATE public.scheduled_actions AS a
    SET message_id = p_message, send_state = 'started', send_started_at = clock_timestamp()
    WHERE a.id = p_action AND a.user_id = p_user AND a.status = 'processing'
      AND (a.send_state IS NULL OR a.send_state = 'rejected')
      AND NOT coalesce(a.requires_approval, false)
      AND EXISTS (
        SELECT 1 FROM public.messages AS m
        JOIN public.conversations AS c ON c.id = m.conversation_id AND c.user_id = p_user
        WHERE m.id = p_message AND m.user_id = p_user AND m.conversation_id = a.conversation_id
          AND m.direction = 'outbound' AND m.status = 'pending'
          AND c.phone_number = m.recipient_phone
      )
      AND (a.flow_run_id IS NULL OR EXISTS (
        SELECT 1 FROM public.followup_runs AS r
        WHERE r.id = a.flow_run_id AND r.user_id = p_user AND r.status = 'active'
      ))
      AND (a.contact_id IS NULL OR EXISTS (
        SELECT 1 FROM public.contacts AS c
        WHERE c.id = a.contact_id AND c.user_id = p_user AND NOT c.is_archived
      ))
      AND NOT EXISTS (
        SELECT 1 FROM public.user_settings AS s WHERE s.user_id = p_user
          AND (
            s.automation_paused
            OR (s.require_approval_all AND a.dispatch_approved_at IS NULL)
            OR (s.test_mode AND NOT EXISTS (
              SELECT 1
              FROM unnest(coalesce(s.test_mode_allowlist, '{}'::text[]) || ARRAY[s.test_mode_phone]) AS allowed(phone)
              CROSS JOIN LATERAL (
                SELECT regexp_replace(allowed.phone, '[^0-9]', '', 'g') AS digits
              ) AS n
              JOIN public.conversations AS c ON c.id = a.conversation_id AND c.user_id = p_user
              WHERE regexp_replace(c.phone_number, '[^0-9]', '', 'g') = CASE
                WHEN left(btrim(allowed.phone), 1) <> '+' AND length(n.digits) IN (10, 11)
                  THEN '55' || n.digits
                WHEN length(n.digits) BETWEEN 10 AND 15 THEN n.digits
              END
            ))
          )
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.contact_preferences AS p
        WHERE p.contact_id = a.contact_id
          AND (p.do_not_contact OR NOT p.whatsapp_allowed OR NOT p.automation_allowed
            OR p.contact_not_before > clock_timestamp())
      )
      AND (a.opportunity_id IS NULL OR EXISTS (
        SELECT 1 FROM public.opportunities AS o
        WHERE o.id = a.opportunity_id AND o.user_id = p_user AND o.status = 'open'
      ))
      AND NOT EXISTS (
        SELECT 1 FROM public.messages AS reply
        WHERE reply.conversation_id = a.conversation_id AND reply.user_id = p_user
          AND reply.direction = 'inbound'
          AND (
            (a.smart_strategy IS NOT NULL AND a.analyzed_through_at IS NOT NULL
              AND reply.sent_at >= a.analyzed_through_at
              AND NOT (a.analyzed_message_ids ? reply.id::text))
            OR
            (a.smart_strategy IS NULL AND a.cancel_on_reply
              AND reply.message_type IN ('text', 'audio', 'image', 'document', 'video')
              AND reply.sent_at > coalesce(
              (SELECT r.started_at FROM public.followup_runs AS r WHERE r.id = a.flow_run_id),
              a.created_at
            ))
          )
      )
    RETURNING a.id
  )
  SELECT EXISTS (SELECT 1 FROM started)
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.begin_automation_dispatch(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.begin_automation_dispatch(uuid, uuid, uuid) TO service_role;
