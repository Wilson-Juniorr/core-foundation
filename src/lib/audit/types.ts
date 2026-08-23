/**
 * Módulo 09 — trilha de auditoria de ações críticas.
 *
 * `automation_decisions` explica *por que* uma automação saiu ou não.
 * `audit_logs` responde outra pergunta: *quem mexeu no sistema e quando*.
 */
export type AuditAction =
  | "settings_updated"
  | "automation_policy_updated"
  | "notification_settings_updated"
  | "profile_updated"
  | "emergency_stop_enabled"
  | "emergency_stop_disabled"
  | "test_mode_enabled"
  | "test_mode_disabled"
  | "followup_started"
  | "followup_cancelled"
  | "followup_paused"
  | "followup_resumed"
  | "scheduled_action_cancelled"
  | "scheduled_action_retried"
  | "message_retried"
  | "ai_analysis_retried"
  | "conversation_resynced"
  | "automatic_message_sent"
  | "opt_out_applied"
  | "opt_out_removed"
  | "contact_preferences_updated"
  | "draft_approved"
  | "draft_rejected"
  | "whatsapp_connected"
  | "whatsapp_disconnected"
  | "asset_archived"
  | "strategy_archived";

export type AuditSeverity = "info" | "warning" | "critical";

export interface AuditLogEntry {
  id: string;
  created_at: string;
  action: AuditAction | string;
  severity: AuditSeverity;
  entity_type: string | null;
  entity_id: string | null;
  summary: string;
  actor: string;
  metadata: Record<string, unknown>;
}

export const AUDIT_ACTION_LABELS: Record<string, string> = {
  settings_updated: "Configurações alteradas",
  automation_policy_updated: "Políticas de automação alteradas",
  notification_settings_updated: "Notificações alteradas",
  profile_updated: "Perfil atualizado",
  emergency_stop_enabled: "Parada de emergência ativada",
  emergency_stop_disabled: "Parada de emergência desativada",
  test_mode_enabled: "Modo teste ativado",
  test_mode_disabled: "Modo teste desativado",
  followup_started: "Follow-up iniciado",
  followup_cancelled: "Follow-up cancelado",
  followup_paused: "Follow-up pausado",
  followup_resumed: "Follow-up retomado",
  scheduled_action_cancelled: "Ação agendada cancelada",
  scheduled_action_retried: "Ação agendada reprocessada",
  message_retried: "Mensagem reenviada",
  ai_analysis_retried: "Análise de IA reprocessada",
  conversation_resynced: "Conversa ressincronizada",
  automatic_message_sent: "Mensagem automática enviada",
  opt_out_applied: "Cliente marcado como não contatar",
  opt_out_removed: "Não contatar removido",
  contact_preferences_updated: "Preferências do cliente alteradas",
  draft_approved: "Rascunho aprovado",
  draft_rejected: "Rascunho recusado",
  whatsapp_connected: "WhatsApp conectado",
  whatsapp_disconnected: "WhatsApp desconectado",
  asset_archived: "Material arquivado",
  strategy_archived: "Estratégia arquivada",
};

export const AUDIT_FILTERS = [
  { value: "all", label: "Tudo" },
  { value: "settings", label: "Configurações" },
  { value: "automation", label: "Automação" },
  { value: "recovery", label: "Reprocessamento" },
] as const;

export type AuditFilter = (typeof AUDIT_FILTERS)[number]["value"];

export const AUDIT_FILTER_ACTIONS: Record<Exclude<AuditFilter, "all">, string[]> = {
  settings: [
    "settings_updated",
    "automation_policy_updated",
    "notification_settings_updated",
    "profile_updated",
    "test_mode_enabled",
    "test_mode_disabled",
    "contact_preferences_updated",
  ],
  automation: [
    "emergency_stop_enabled",
    "emergency_stop_disabled",
    "followup_started",
    "followup_cancelled",
    "followup_paused",
    "followup_resumed",
    "automatic_message_sent",
    "opt_out_applied",
    "opt_out_removed",
    "draft_approved",
    "draft_rejected",
  ],
  recovery: [
    "scheduled_action_cancelled",
    "scheduled_action_retried",
    "message_retried",
    "ai_analysis_retried",
    "conversation_resynced",
  ],
};
