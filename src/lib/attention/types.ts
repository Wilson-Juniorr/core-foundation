/**
 * Módulo 06 — Central de Atenção.
 *
 * A detecção é determinística (regras sobre dados reais). A IA entra apenas
 * como sugestão de próxima ação, nunca como fonte da prioridade.
 */

export const ATTENTION_KINDS = [
  "customer_replied",
  "high_interest",
  "ready_to_close",
  "objection_needs_human",
  "discount_requested",
  "call_requested",
  "document_received",
  "low_ai_confidence",
  "flow_failed",
  "message_failed",
  "flow_blocked",
  "missing_next_action",
  "overdue_next_action",
  "unlinked_conversation",
  "whatsapp_disconnected",
  "own_promise_overdue",
  "reactivation_due",
] as const;
export type AttentionKind = (typeof ATTENTION_KINDS)[number];

export const ATTENTION_PRIORITIES = ["critical", "high", "medium", "low"] as const;
export type AttentionPriority = (typeof ATTENTION_PRIORITIES)[number];

export const ATTENTION_STATUSES = ["open", "snoozed", "resolved", "dismissed"] as const;
export type AttentionStatus = (typeof ATTENTION_STATUSES)[number];

export const ATTENTION_BUCKETS = ["now", "today", "overdue", "automatic", "waiting"] as const;
export type AttentionBucket = (typeof ATTENTION_BUCKETS)[number];

/** Ações recomendadas — nenhuma é executada automaticamente. */
export const NEXT_ACTION_KINDS = [
  "reply_now",
  "call",
  "send_information",
  "wait",
  "schedule_contact",
  "start_flow",
  "review_proposal",
  "fix_operational",
] as const;
export type NextActionKind = (typeof NEXT_ACTION_KINDS)[number];

/** Cada fator soma (ou subtrai) pontos e é sempre exibido ao usuário. */
export interface ScoreFactor {
  label: string;
  points: number;
}

export interface AttentionItem {
  id: string;
  kind: AttentionKind | string;
  priority: AttentionPriority;
  priority_score: number;
  score_factors: ScoreFactor[];
  bucket: AttentionBucket | string;
  status: AttentionStatus;
  title: string;
  summary: string | null;
  reason: string;
  suggested_action: string | null;
  suggested_action_kind: NextActionKind | string | null;
  suggested_action_source: "rule" | "ai" | string;
  contact_id: string | null;
  contact_name: string | null;
  opportunity_id: string | null;
  conversation_id: string | null;
  blocks_automation: boolean;
  occurrences: number;
  snoozed_until: string | null;
  resolved_at: string | null;
  resolution_note: string | null;
  first_detected_at: string | null;
  last_detected_at: string;
  metadata: Record<string, string | number | boolean | null | string[]>;
}

export interface AttentionCounts {
  now: number;
  today: number;
  overdue: number;
  automatic: number;
  waiting: number;
  snoozed: number;
  critical: number;
}

export interface AttentionView {
  items: AttentionItem[];
  counts: AttentionCounts;
  syncedAt: string;
}

export interface OperationalDashboard {
  followingUp: number;
  waitingOnYou: number;
  scheduledAutomations: number;
  overdue: number;
  withoutNextAction: number;
  recentReplies: number;
  failures: number;
  criticalItems: AttentionItem[];
}

/** Candidato produzido pelas regras antes de ser persistido/deduplicado. */
export interface AttentionCandidate {
  kind: AttentionKind;
  dedupe_key: string;
  priority: AttentionPriority;
  priority_score: number;
  score_factors: ScoreFactor[];
  bucket: AttentionBucket;
  title: string;
  summary: string | null;
  reason: string;
  suggested_action: string;
  suggested_action_kind: NextActionKind;
  contact_id: string | null;
  opportunity_id: string | null;
  conversation_id: string | null;
  blocks_automation: boolean;
  metadata: Record<string, string | number | boolean | null | string[]>;
}
