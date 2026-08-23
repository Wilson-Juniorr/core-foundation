export type AutomationDecisionKind =
  "allowed" | "blocked" | "deferred" | "simulated" | "approval_required" | "handoff";

export interface AutomationPolicySettings {
  automation_paused: boolean;
  automation_paused_at: string | null;
  test_mode: boolean;
  test_mode_phone: string | null;
  /** Módulo 09: números que continuam recebendo de verdade em modo teste. */
  test_mode_allowlist: string[];
  /** Módulo 09: nada é enviado sem aprovação humana quando ligado. */
  require_approval_all: boolean;
  conversation_cooldown_minutes: number;
  manual_message_cooldown_minutes: number;
  active_conversation_minutes: number;
  max_automations_per_day: number;
  max_flow_automations_per_day: number;
  confidence_auto_min: number;
  confidence_approval_min: number;
}

export interface ContactPreferences {
  contact_id: string;
  automation_allowed: boolean;
  whatsapp_allowed: boolean;
  do_not_contact: boolean;
  do_not_contact_reason: string | null;
  do_not_contact_source: string;
  contact_not_before: string | null;
  max_automations_per_day: number | null;
}

/** Resultado de uma única regra do orquestrador (sempre auditável). */
export interface PolicyRuleResult {
  rule: string;
  label: string;
  passed: boolean;
  detail?: string;
}

export interface PolicyEvaluation {
  decision: AutomationDecisionKind;
  /** Regra que determinou a decisão, quando não foi permitida. */
  blockedBy: string | null;
  reason: string;
  rules: PolicyRuleResult[];
  /** Quando a decisão foi adiar: instante mínimo para reavaliar. */
  deferUntil: string | null;
}

export interface AutomationDecisionView {
  id: string;
  created_at: string;
  decision: AutomationDecisionKind;
  reason: string;
  blocked_by: string | null;
  contact_id: string | null;
  contact_name: string | null;
  strategy_name: string | null;
  confidence: number | null;
  model: string | null;
  rules: PolicyRuleResult[];
}

export const POLICY_RULE_LABELS: Record<string, string> = {
  emergency_stop: "Parada de emergência",
  contact_opt_out: "Cliente pediu para não receber mensagens",
  contact_automation_blocked: "Automação desligada para este cliente",
  contact_whatsapp_blocked: "WhatsApp bloqueado para este cliente",
  contact_not_before: "Cliente pediu contato apenas depois de uma data",
  active_conversation: "Conversa ativa agora",
  manual_reply_cooldown: "Você respondeu recentemente",
  conversation_cooldown: "Intervalo mínimo entre automações",
  daily_contact_cap: "Limite diário por cliente",
  daily_flow_cap: "Limite diário por fluxo",
  human_handoff: "Item aguardando você",
  low_confidence: "Confiança da IA abaixo do limite",
  test_mode: "Modo teste",
  require_approval: "Aprovação obrigatória",
};

export const DECISION_LABELS: Record<AutomationDecisionKind, string> = {
  allowed: "Liberado",
  blocked: "Bloqueado",
  deferred: "Adiado",
  simulated: "Simulado",
  approval_required: "Enviado para aprovação",
  handoff: "Entregue ao humano",
};
