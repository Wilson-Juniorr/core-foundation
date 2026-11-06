CREATE OR REPLACE FUNCTION public.invalidate_smart_business_context() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF TG_TABLE_NAME='agent_instructions' THEN
  UPDATE public.conversation_control SET context_version=context_version+1,context_updated_at=now() WHERE conversation_id=NEW.conversation_id AND user_id=NEW.user_id;
 ELSE
  UPDATE public.conversation_control c SET context_version=c.context_version+1,context_updated_at=now() FROM public.conversations v WHERE v.id=c.conversation_id AND v.contact_id=NEW.contact_id AND c.user_id=NEW.user_id;
 END IF;
 RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.invalidate_smart_business_context() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER smart_instruction_context AFTER INSERT OR UPDATE OF text,note,return_mode,return_at ON public.agent_instructions FOR EACH ROW EXECUTE FUNCTION public.invalidate_smart_business_context();
CREATE TRIGGER smart_quote_context AFTER UPDATE OF quoted_operator,quoted_plan,quoted_value,quoted_lives,decision_maker,deal_stage ON public.customer_memory FOR EACH ROW WHEN (OLD.quoted_operator IS DISTINCT FROM NEW.quoted_operator OR OLD.quoted_plan IS DISTINCT FROM NEW.quoted_plan OR OLD.quoted_value IS DISTINCT FROM NEW.quoted_value OR OLD.quoted_lives IS DISTINCT FROM NEW.quoted_lives OR OLD.decision_maker IS DISTINCT FROM NEW.decision_maker OR OLD.deal_stage IS DISTINCT FROM NEW.deal_stage) EXECUTE FUNCTION public.invalidate_smart_business_context();
CREATE OR REPLACE FUNCTION public.sync_post_quote_opportunity() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NEW.policy_key='post_quote_v1' AND NEW.opportunity_id IS NOT NULL THEN
 UPDATE public.opportunities SET post_quote_run_id=NEW.id,post_quote_next_at=CASE WHEN NEW.status='active' THEN NEW.next_contact_at ELSE NULL END,post_quote_next_reason=NEW.next_contact_reason WHERE id=NEW.opportunity_id AND user_id=NEW.user_id;
 END IF;
 RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.sync_post_quote_opportunity() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER post_quote_crm_sync AFTER INSERT OR UPDATE OF status,next_contact_at,next_contact_reason,next_contact_responsible ON public.followup_runs FOR EACH ROW EXECUTE FUNCTION public.sync_post_quote_opportunity();