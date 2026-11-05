ALTER TABLE public.conversation_control
  ADD COLUMN IF NOT EXISTS handoff_kind text,
  ADD COLUMN IF NOT EXISTS handoff_at timestamptz,
  ADD COLUMN IF NOT EXISTS handoff_reason text,
  ADD COLUMN IF NOT EXISTS sensitive_since_handoff boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS return_check_at timestamptz,
  ADD COLUMN IF NOT EXISTS return_mode text,
  ADD COLUMN IF NOT EXISTS return_at timestamptz,
  ADD COLUMN IF NOT EXISTS return_reason text,
  ADD COLUMN IF NOT EXISTS return_source text,
  ADD COLUMN IF NOT EXISTS force_approval_next boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_alerted_inbound_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_stuck_alert_at timestamptz;

CREATE INDEX IF NOT EXISTS conversation_control_return_check_idx
  ON public.conversation_control (return_check_at) WHERE return_check_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS conversation_control_return_at_idx
  ON public.conversation_control (return_at) WHERE return_at IS NOT NULL;

ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS alert_phone text,
  ADD COLUMN IF NOT EXISTS alert_waiting_minutes integer NOT NULL DEFAULT 10;

CREATE TABLE public.agent_instructions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  contact_id uuid,
  text text NOT NULL,
  kind text NOT NULL DEFAULT 'context',
  return_mode text,
  return_at timestamptz,
  note text,
  agent_reply text,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  applied_at timestamptz
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_instructions TO authenticated;
GRANT ALL ON public.agent_instructions TO service_role;
ALTER TABLE public.agent_instructions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own agent instructions select" ON public.agent_instructions FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Own agent instructions insert" ON public.agent_instructions FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Own agent instructions update" ON public.agent_instructions FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Own agent instructions delete" ON public.agent_instructions FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE INDEX agent_instructions_conversation_idx ON public.agent_instructions (conversation_id, created_at DESC);

CREATE TABLE public.owner_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  kind text NOT NULL,
  conversation_id uuid,
  contact_id uuid,
  title text NOT NULL,
  body text NOT NULL,
  send_after timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  dedupe_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);
GRANT SELECT ON public.owner_alerts TO authenticated;
GRANT ALL ON public.owner_alerts TO service_role;
ALTER TABLE public.owner_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own owner alerts select" ON public.owner_alerts FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE INDEX owner_alerts_pending_idx ON public.owner_alerts (status, send_after) WHERE status = 'pending';