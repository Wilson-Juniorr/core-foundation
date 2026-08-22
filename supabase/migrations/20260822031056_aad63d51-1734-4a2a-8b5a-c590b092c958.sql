CREATE TYPE public.attention_priority AS ENUM ('critical', 'high', 'medium', 'low');
CREATE TYPE public.attention_status AS ENUM ('open', 'snoozed', 'resolved', 'dismissed');

CREATE TABLE public.attention_items (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES public.contacts(id) ON DELETE CASCADE,
  opportunity_id uuid REFERENCES public.opportunities(id) ON DELETE SET NULL,
  conversation_id uuid REFERENCES public.conversations(id) ON DELETE SET NULL,
  kind text NOT NULL,
  priority public.attention_priority NOT NULL DEFAULT 'medium',
  priority_score integer NOT NULL DEFAULT 0,
  score_factors jsonb NOT NULL DEFAULT '[]'::jsonb,
  title text NOT NULL,
  summary text,
  reason text NOT NULL,
  suggested_action text,
  suggested_action_kind text,
  suggested_action_source text NOT NULL DEFAULT 'rule',
  bucket text NOT NULL DEFAULT 'now',
  status public.attention_status NOT NULL DEFAULT 'open',
  dedupe_key text NOT NULL,
  snoozed_until timestamp with time zone,
  resolved_at timestamp with time zone,
  resolution_note text,
  blocks_automation boolean NOT NULL DEFAULT false,
  occurrences integer NOT NULL DEFAULT 1,
  first_detected_at timestamp with time zone NOT NULL DEFAULT now(),
  last_detected_at timestamp with time zone NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX attention_items_dedupe_uidx ON public.attention_items (user_id, dedupe_key);
CREATE INDEX attention_items_open_idx ON public.attention_items (user_id, status, priority_score DESC);
CREATE INDEX attention_items_contact_idx ON public.attention_items (user_id, contact_id);
CREATE INDEX attention_items_snooze_idx ON public.attention_items (status, snoozed_until);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.attention_items TO authenticated;
GRANT ALL ON public.attention_items TO service_role;

ALTER TABLE public.attention_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own attention items"
  ON public.attention_items FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER attention_items_set_updated_at
  BEFORE UPDATE ON public.attention_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER attention_items_validate_ownership
  BEFORE INSERT OR UPDATE ON public.attention_items
  FOR EACH ROW EXECUTE FUNCTION public.validate_timeline_event_ownership();

ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS pause_automation_on_handoff boolean NOT NULL DEFAULT true;