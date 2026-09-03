-- ============ Smart Flow — Fase 1: modelagem ============

ALTER TYPE public.scheduled_action_status ADD VALUE IF NOT EXISTS 'needs_approval';
ALTER TYPE public.scheduled_action_status ADD VALUE IF NOT EXISTS 'stale';

ALTER TABLE public.followup_flows
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'classic';
ALTER TABLE public.followup_flows
  ADD CONSTRAINT followup_flows_kind_check CHECK (kind IN ('classic', 'smart'));

ALTER TABLE public.followup_runs
  ADD COLUMN IF NOT EXISTS smart_state text,
  ADD COLUMN IF NOT EXISTS deadline_at timestamptz,
  ADD COLUMN IF NOT EXISTS next_evaluation_at timestamptz;

ALTER TABLE public.scheduled_actions
  ADD COLUMN IF NOT EXISTS smart_strategy text,
  ADD COLUMN IF NOT EXISTS context_version integer,
  ADD COLUMN IF NOT EXISTS generated_at timestamptz,
  ADD COLUMN IF NOT EXISTS decision_reason text,
  ADD COLUMN IF NOT EXISTS requires_approval boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_followup_runs_next_eval
  ON public.followup_runs (next_evaluation_at)
  WHERE status = 'active';

-- ---------------- configuração do Smart Flow ----------------
CREATE TABLE public.smart_flow_configs (
  flow_id uuid PRIMARY KEY REFERENCES public.followup_flows(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  goal text NOT NULL,
  max_duration_days integer NOT NULL DEFAULT 30,
  autonomy text NOT NULL DEFAULT 'assist' CHECK (autonomy IN ('observe', 'assist', 'auto')),
  allowed_strategies text[] NOT NULL DEFAULT '{}',
  allowed_media text[] NOT NULL DEFAULT ARRAY['text']::text[],
  max_pressure integer NOT NULL DEFAULT 60,
  min_hours_between_actions integer NOT NULL DEFAULT 24,
  max_actions_per_week integer NOT NULL DEFAULT 3,
  handoff_situations text[] NOT NULL DEFAULT '{}',
  completion_criteria text,
  confidence_min numeric NOT NULL DEFAULT 0.6,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.smart_flow_configs TO authenticated;
GRANT ALL ON public.smart_flow_configs TO service_role;
ALTER TABLE public.smart_flow_configs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "smart_flow_configs_own" ON public.smart_flow_configs
  FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE TRIGGER set_smart_flow_configs_updated_at BEFORE UPDATE ON public.smart_flow_configs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------- controle / dono da conversa ----------------
CREATE TABLE public.conversation_control (
  conversation_id uuid PRIMARY KEY REFERENCES public.conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  owner text NOT NULL DEFAULT 'none' CHECK (owner IN ('ai', 'human', 'none')),
  state text NOT NULL DEFAULT 'waiting_customer'
    CHECK (state IN ('ai_controlled','human_controlled','waiting_customer','waiting_human','waiting_third_party','paused','completed')),
  next_responsible text NOT NULL DEFAULT 'system'
    CHECK (next_responsible IN ('customer','human','system','third_party','none')),
  next_responsible_reason text,
  next_responsible_at timestamptz,
  buying_stage text NOT NULL DEFAULT 'unknown'
    CHECK (buying_stage IN ('researching','comparing','validating','deciding','closing','deferred','lost','unknown')),
  interest_score numeric,
  response_probability numeric,
  primary_objection text,
  pressure_score integer NOT NULL DEFAULT 0,
  pressure_factors jsonb NOT NULL DEFAULT '{}'::jsonb,
  audio_context_unknown boolean NOT NULL DEFAULT false,
  last_human_message_at timestamptz,
  last_inbound_at timestamptz,
  last_automation_at timestamptz,
  last_analyzed_message_id uuid,
  context_updated_at timestamptz,
  context_version integer NOT NULL DEFAULT 1,
  confidence numeric,
  decision_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.conversation_control TO authenticated;
GRANT ALL ON public.conversation_control TO service_role;
ALTER TABLE public.conversation_control ENABLE ROW LEVEL SECURITY;
CREATE POLICY "conversation_control_own" ON public.conversation_control
  FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE TRIGGER set_conversation_control_updated_at BEFORE UPDATE ON public.conversation_control
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX idx_conversation_control_user ON public.conversation_control (user_id);

-- ---------------- compromissos ----------------
CREATE TABLE public.commitments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES public.contacts(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES public.conversations(id) ON DELETE CASCADE,
  opportunity_id uuid REFERENCES public.opportunities(id) ON DELETE SET NULL,
  commitment_type text NOT NULL,
  responsible text NOT NULL CHECK (responsible IN ('customer','human','third_party')),
  description text NOT NULL,
  due_at timestamptz,
  due_window_end timestamptz,
  is_ambiguous boolean NOT NULL DEFAULT false,
  confidence numeric NOT NULL DEFAULT 0.5,
  source_message_id uuid REFERENCES public.messages(id) ON DELETE SET NULL,
  source text NOT NULL DEFAULT 'ai' CHECK (source IN ('ai','human','system')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','fulfilled','cancelled','missed')),
  dedupe_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.commitments TO authenticated;
GRANT ALL ON public.commitments TO service_role;
ALTER TABLE public.commitments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "commitments_own" ON public.commitments
  FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE TRIGGER set_commitments_updated_at BEFORE UPDATE ON public.commitments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE UNIQUE INDEX idx_commitments_dedupe ON public.commitments (user_id, conversation_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL;
CREATE INDEX idx_commitments_pending ON public.commitments (user_id, status, due_at);
CREATE INDEX idx_commitments_conversation ON public.commitments (conversation_id, status);

-- ---------------- histórico de estratégias ----------------
CREATE TABLE public.smart_strategy_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES public.conversations(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES public.contacts(id) ON DELETE CASCADE,
  flow_run_id uuid REFERENCES public.followup_runs(id) ON DELETE SET NULL,
  scheduled_action_id uuid REFERENCES public.scheduled_actions(id) ON DELETE SET NULL,
  strategy text NOT NULL,
  channel text NOT NULL DEFAULT 'whatsapp',
  message_id uuid REFERENCES public.messages(id) ON DELETE SET NULL,
  content_preview text,
  outcome text NOT NULL DEFAULT 'sent' CHECK (outcome IN ('suggested','sent','simulated','cancelled','failed')),
  got_reply boolean NOT NULL DEFAULT false,
  reply_after_minutes integer,
  sentiment_after text,
  used_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.smart_strategy_usage TO authenticated;
GRANT ALL ON public.smart_strategy_usage TO service_role;
ALTER TABLE public.smart_strategy_usage ENABLE ROW LEVEL SECURITY;
CREATE POLICY "smart_strategy_usage_own" ON public.smart_strategy_usage
  FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE TRIGGER set_smart_strategy_usage_updated_at BEFORE UPDATE ON public.smart_strategy_usage
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX idx_strategy_usage_conversation ON public.smart_strategy_usage (conversation_id, used_at DESC);