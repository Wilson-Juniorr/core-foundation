-- Módulo 09: trilha de auditoria + configurações globais adicionais

CREATE TABLE public.audit_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action text NOT NULL,
  severity text NOT NULL DEFAULT 'info',
  entity_type text,
  entity_id uuid,
  summary text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor text NOT NULL DEFAULT 'user',
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.audit_logs TO authenticated;
GRANT ALL ON public.audit_logs TO service_role;

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "audit_logs_select_own" ON public.audit_logs
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "audit_logs_insert_own" ON public.audit_logs
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE INDEX audit_logs_user_created_idx ON public.audit_logs (user_id, created_at DESC);
CREATE INDEX audit_logs_action_idx ON public.audit_logs (user_id, action, created_at DESC);

ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS require_approval_all boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS notify_failures boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_approvals boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_attention boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS test_mode_allowlist text[] NOT NULL DEFAULT '{}'::text[];

-- Índices para a visão técnica / observabilidade
CREATE INDEX IF NOT EXISTS messages_user_status_idx
  ON public.messages (user_id, status, sent_at DESC);
CREATE INDEX IF NOT EXISTS messages_conversation_sent_desc_idx
  ON public.messages (conversation_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS scheduled_actions_stuck_idx
  ON public.scheduled_actions (user_id, status, scheduled_for);
CREATE INDEX IF NOT EXISTS ai_jobs_user_status_idx
  ON public.ai_analysis_jobs (user_id, status, requested_at DESC);