/** Módulo 09 — observabilidade técnica em linguagem de operação. */
export interface SystemConnection {
  id: string;
  status: string;
  phone_number: string | null;
  display_name: string | null;
  last_event_at: string | null;
  last_synced_at: string | null;
  last_sync_status: string | null;
  last_error: string | null;
}

export interface SystemQueues {
  scheduled_pending: number;
  scheduled_overdue: number;
  scheduled_stuck: number;
  ai_pending: number;
  ai_stuck: number;
}

export interface SystemFailures {
  messages_failed_24h: number;
  actions_failed_24h: number;
  actions_blocked_24h: number;
  ai_jobs_failed_24h: number;
}

export interface SystemGuardrails {
  automation_paused: boolean;
  automation_paused_at: string | null;
  test_mode: boolean;
  require_approval_all: boolean;
  attention_open: number;
  drafts_waiting: number;
}

export interface SystemIncident {
  id: string;
  severity: "critical" | "warning" | "info";
  title: string;
  detail: string;
  hint: string;
}

export interface FailedMessageItem {
  id: string;
  conversation_id: string;
  contact_name: string | null;
  preview: string | null;
  sent_at: string;
  can_retry: boolean;
}

export interface StuckActionItem {
  id: string;
  status: string;
  scheduled_for: string;
  contact_name: string | null;
  last_error: string | null;
  attempts: number;
}

export interface FailedJobItem {
  id: string;
  reason: string;
  status: string;
  attempts: number;
  requested_at: string;
  last_error: string | null;
  contact_name: string | null;
}

export interface SystemStatus {
  generated_at: string;
  connections: SystemConnection[];
  webhook_last_event_at: string | null;
  queues: SystemQueues;
  failures: SystemFailures;
  guardrails: SystemGuardrails;
  incidents: SystemIncident[];
  failed_messages: FailedMessageItem[];
  stuck_actions: StuckActionItem[];
  failed_jobs: FailedJobItem[];
}
