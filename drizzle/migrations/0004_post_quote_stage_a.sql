ALTER TABLE public.followup_runs ADD COLUMN policy_key text, ADD COLUMN policy_version integer, ADD COLUMN policy_activated_at timestamptz, ADD COLUMN contacts_done integer NOT NULL DEFAULT 0, ADD COLUMN last_contact_accepted_at timestamptz, ADD COLUMN next_contact_at timestamptz, ADD COLUMN next_contact_reason text, ADD COLUMN next_contact_responsible text, ADD COLUMN evaluation_token uuid, ADD COLUMN evaluation_lease_until timestamptz;
ALTER TABLE public.scheduled_actions ADD COLUMN logical_contact integer, ADD COLUMN analyzed_through_at timestamptz, ADD COLUMN analyzed_message_ids jsonb NOT NULL DEFAULT '[]', ADD COLUMN send_state text, ADD COLUMN send_started_at timestamptz;
ALTER TABLE public.customer_memory ADD COLUMN message_cursor_at timestamptz, ADD COLUMN message_cursor_id uuid;
ALTER TABLE public.opportunities ADD COLUMN post_quote_run_id uuid, ADD COLUMN post_quote_next_at timestamptz, ADD COLUMN post_quote_next_reason text;
CREATE UNIQUE INDEX post_quote_one_pending_contact ON public.scheduled_actions(flow_run_id,logical_contact) WHERE logical_contact IS NOT NULL AND status IN ('scheduled','processing','needs_approval','blocked');
CREATE INDEX messages_memory_cursor ON public.messages(user_id,contact_id,sent_at,id);
CREATE OR REPLACE FUNCTION public.patch_conversation_control(p_conversation uuid,p_patch jsonb,p_bump boolean DEFAULT true) RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE assignments text; BEGIN
 SELECT string_agg(format('%I = (jsonb_populate_record(NULL::public.conversation_control, $1)).%I',key,key), ', ') INTO assignments FROM jsonb_object_keys(p_patch) key WHERE key NOT IN ('id','user_id','conversation_id','context_version','context_updated_at') AND EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='public.conversation_control'::regclass AND attname=key AND NOT attisdropped);
 EXECUTE 'UPDATE public.conversation_control SET ' || COALESCE(assignments || ', ','') || 'context_version=context_version + CASE WHEN $2 THEN 1 ELSE 0 END, context_updated_at=CASE WHEN $2 THEN now() ELSE context_updated_at END WHERE conversation_id=$3' USING p_patch,p_bump,p_conversation;
END $$;
GRANT EXECUTE ON FUNCTION public.patch_conversation_control(uuid,jsonb,boolean) TO authenticated,service_role;
REVOKE EXECUTE ON FUNCTION public.patch_conversation_control(uuid,jsonb,boolean) FROM PUBLIC,anon;
CREATE OR REPLACE FUNCTION public.schedule_smart_action(p_action jsonb) RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE v integer; aid uuid; a public.scheduled_actions; BEGIN
 a := jsonb_populate_record(NULL::public.scheduled_actions,p_action);
 SELECT context_version INTO v FROM public.conversation_control WHERE conversation_id=a.conversation_id FOR UPDATE;
 IF v IS NULL OR v <> a.context_version THEN RETURN NULL; END IF;
 IF EXISTS(SELECT 1 FROM public.scheduled_actions WHERE conversation_id=a.conversation_id AND status IN ('scheduled','processing','needs_approval','blocked')) THEN RETURN NULL; END IF;
 INSERT INTO public.scheduled_actions(user_id,flow_run_id,contact_id,conversation_id,opportunity_id,action_type,content,content_mode,scheduled_for,status,cancel_on_reply,idempotency_key,smart_strategy,context_version,generated_at,decision_reason,requires_approval,logical_contact,analyzed_through_at,analyzed_message_ids)
 VALUES(a.user_id,a.flow_run_id,a.contact_id,a.conversation_id,a.opportunity_id,a.action_type,a.content,a.content_mode,a.scheduled_for,a.status,a.cancel_on_reply,a.idempotency_key,a.smart_strategy,a.context_version,a.generated_at,a.decision_reason,a.requires_approval,a.logical_contact,a.analyzed_through_at,coalesce(a.analyzed_message_ids,'[]')) ON CONFLICT DO NOTHING RETURNING id INTO aid;
 RETURN aid;
END $$;
GRANT EXECUTE ON FUNCTION public.schedule_smart_action(jsonb) TO service_role;
REVOKE EXECUTE ON FUNCTION public.schedule_smart_action(jsonb) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.accept_post_quote_contact(p_action uuid,p_message uuid,p_at timestamptz,p_next timestamptz,p_reason text) RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE a public.scheduled_actions; r public.followup_runs; BEGIN
 SELECT * INTO a FROM public.scheduled_actions WHERE id=p_action FOR UPDATE;
 SELECT * INTO r FROM public.followup_runs WHERE id=a.flow_run_id FOR UPDATE;
 IF r.policy_key IS DISTINCT FROM 'post_quote_v1' OR a.logical_contact IS NULL THEN RETURN false; END IF;
 IF a.send_state='accepted' THEN RETURN false; END IF;
 IF a.logical_contact <> r.contacts_done+1 THEN RAISE EXCEPTION 'logical contact out of order'; END IF;
 UPDATE public.scheduled_actions SET send_state='accepted',status='sent',executed_at=p_at,message_id=p_message,last_error=NULL WHERE id=a.id;
 UPDATE public.followup_runs SET contacts_done=contacts_done+1,last_contact_accepted_at=p_at,next_contact_at=p_next,next_contact_reason=p_reason,next_contact_responsible=CASE WHEN p_next IS NULL THEN 'none' ELSE 'system' END,next_evaluation_at=p_next,status=CASE WHEN contacts_done+1>=8 THEN 'completed'::public.followup_run_status ELSE status END,smart_state=CASE WHEN contacts_done+1>=8 THEN 'completed' ELSE 'waiting_customer' END,completed_at=CASE WHEN contacts_done+1>=8 THEN p_at ELSE completed_at END,stop_reason=CASE WHEN contacts_done+1>=8 THEN 'post_quote_cycle_completed' ELSE stop_reason END WHERE id=r.id;
 UPDATE public.opportunities SET post_quote_run_id=r.id,post_quote_next_at=p_next,post_quote_next_reason=p_reason WHERE id=r.opportunity_id AND user_id=r.user_id;
 RETURN true;
END $$;
GRANT EXECUTE ON FUNCTION public.accept_post_quote_contact(uuid,uuid,timestamptz,timestamptz,text) TO service_role;
REVOKE EXECUTE ON FUNCTION public.accept_post_quote_contact(uuid,uuid,timestamptz,timestamptz,text) FROM PUBLIC,anon,authenticated;