import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import type {
  AutomationPolicySettings,
  ContactPreferences,
  PolicyEvaluation,
  PolicyRuleResult,
} from "./types";
import { DEFAULT_POLICY } from "./policy.defaults";
import { POLICY_RULE_LABELS } from "./types";

type Admin = SupabaseClient<Database>;

export { DEFAULT_POLICY } from "./policy.defaults";

/** Reavaliação da parada de emergência: nada é perdido, apenas adiado. */
const EMERGENCY_RETRY_MINUTES = 30;

export async function loadPolicySettings(
  db: Admin,
  userId: string,
): Promise<AutomationPolicySettings> {
  const { data } = await db
    .from("user_settings")
    .select(
      "automation_paused, automation_paused_at, test_mode, test_mode_phone, conversation_cooldown_minutes, manual_message_cooldown_minutes, active_conversation_minutes, max_automations_per_day, max_flow_automations_per_day, confidence_auto_min, confidence_approval_min",
    )
    .eq("user_id", userId)
    .maybeSingle();

  if (!data) return { ...DEFAULT_POLICY };

  return {
    automation_paused: data.automation_paused ?? DEFAULT_POLICY.automation_paused,
    automation_paused_at: data.automation_paused_at ?? null,
    test_mode: data.test_mode ?? DEFAULT_POLICY.test_mode,
    test_mode_phone: data.test_mode_phone ?? null,
    conversation_cooldown_minutes:
      data.conversation_cooldown_minutes ?? DEFAULT_POLICY.conversation_cooldown_minutes,
    manual_message_cooldown_minutes:
      data.manual_message_cooldown_minutes ?? DEFAULT_POLICY.manual_message_cooldown_minutes,
    active_conversation_minutes:
      data.active_conversation_minutes ?? DEFAULT_POLICY.active_conversation_minutes,
    max_automations_per_day: data.max_automations_per_day ?? DEFAULT_POLICY.max_automations_per_day,
    max_flow_automations_per_day:
      data.max_flow_automations_per_day ?? DEFAULT_POLICY.max_flow_automations_per_day,
    confidence_auto_min: Number(data.confidence_auto_min ?? DEFAULT_POLICY.confidence_auto_min),
    confidence_approval_min: Number(
      data.confidence_approval_min ?? DEFAULT_POLICY.confidence_approval_min,
    ),
  };
}

export async function loadContactPreferences(
  db: Admin,
  contactId: string,
): Promise<ContactPreferences | null> {
  const { data } = await db
    .from("contact_preferences")
    .select(
      "contact_id, automation_allowed, whatsapp_allowed, do_not_contact, do_not_contact_reason, do_not_contact_source, contact_not_before, max_automations_per_day",
    )
    .eq("contact_id", contactId)
    .maybeSingle();
  return data ?? null;
}

export interface PolicyRequest {
  userId: string;
  conversationId: string;
  contactId: string | null;
  flowId?: string | null;
  flowRunId?: string | null;
  /** Ignora as regras de silêncio (ex.: primeira etapa disparada manualmente). */
  ignoreCooldown?: boolean;
  now?: Date;
}

function pass(rule: string, detail?: string): PolicyRuleResult {
  return {
    rule,
    label: POLICY_RULE_LABELS[rule] ?? rule,
    passed: true,
    ...(detail ? { detail } : {}),
  };
}

function fail(rule: string, detail: string): PolicyRuleResult {
  return { rule, label: POLICY_RULE_LABELS[rule] ?? rule, passed: false, detail };
}

function minutesAgo(now: Date, minutes: number): string {
  return new Date(now.getTime() - minutes * 60_000).toISOString();
}

function inMinutes(now: Date, minutes: number): string {
  return new Date(now.getTime() + minutes * 60_000).toISOString();
}

/**
 * Orquestrador: decide se uma automação pode sair agora. Cada regra é
 * registrada, independentemente do resultado, para que a decisão seja
 * explicável depois.
 */
export async function evaluatePolicy(
  db: Admin,
  settings: AutomationPolicySettings,
  request: PolicyRequest,
): Promise<PolicyEvaluation> {
  const now = request.now ?? new Date();
  const rules: PolicyRuleResult[] = [];

  const block = (
    rule: string,
    detail: string,
    decision: PolicyEvaluation["decision"],
    deferUntil: string | null,
  ): PolicyEvaluation => {
    rules.push(fail(rule, detail));
    return { decision, blockedBy: rule, reason: detail, rules, deferUntil };
  };

  // 1. Parada de emergência global.
  if (settings.automation_paused) {
    return block(
      "emergency_stop",
      "Todas as automações estão pausadas pela parada de emergência.",
      "deferred",
      inMinutes(now, EMERGENCY_RETRY_MINUTES),
    );
  }
  rules.push(pass("emergency_stop"));

  // 2. Preferências do contato (opt-out tem prioridade sobre qualquer fluxo).
  const preferences = request.contactId
    ? await loadContactPreferences(db, request.contactId)
    : null;

  if (preferences?.do_not_contact) {
    return block(
      "contact_opt_out",
      preferences.do_not_contact_reason
        ? `Cliente pediu para não receber mensagens: ${preferences.do_not_contact_reason}`
        : "Cliente pediu para não receber mensagens.",
      "blocked",
      null,
    );
  }
  rules.push(pass("contact_opt_out"));

  if (preferences && !preferences.automation_allowed) {
    return block(
      "contact_automation_blocked",
      "As automações estão desligadas para este cliente.",
      "blocked",
      null,
    );
  }
  rules.push(pass("contact_automation_blocked"));

  if (preferences && !preferences.whatsapp_allowed) {
    return block(
      "contact_whatsapp_blocked",
      "O envio por WhatsApp está bloqueado para este cliente.",
      "blocked",
      null,
    );
  }
  rules.push(pass("contact_whatsapp_blocked"));

  if (preferences?.contact_not_before && preferences.contact_not_before > now.toISOString()) {
    return block(
      "contact_not_before",
      "O cliente pediu para ser contatado apenas mais adiante.",
      "deferred",
      preferences.contact_not_before,
    );
  }
  rules.push(pass("contact_not_before"));

  // 3. Item de atenção que exige intervenção humana.
  if (request.contactId) {
    const { data: handoff } = await db
      .from("attention_items")
      .select("id, title")
      .eq("user_id", request.userId)
      .eq("contact_id", request.contactId)
      .eq("status", "open")
      .eq("blocks_automation", true)
      .limit(1)
      .maybeSingle();
    if (handoff) {
      return block(
        "human_handoff",
        `Existe um item aguardando você: ${handoff.title}`,
        "handoff",
        null,
      );
    }
  }
  rules.push(pass("human_handoff"));

  if (request.ignoreCooldown) {
    rules.push(pass("active_conversation", "Silêncio inteligente ignorado nesta etapa"));
    return {
      decision: settings.test_mode ? "simulated" : "allowed",
      blockedBy: null,
      reason: settings.test_mode
        ? "Modo teste: envio simulado."
        : "Todas as políticas foram atendidas.",
      rules,
      deferUntil: null,
    };
  }

  // 4. Silêncio inteligente: conversa acontecendo agora.
  const activeSince = minutesAgo(now, settings.active_conversation_minutes);
  const { data: liveInbound } = await db
    .from("messages")
    .select("id, sent_at")
    .eq("conversation_id", request.conversationId)
    .eq("direction", "inbound")
    .gte("sent_at", activeSince)
    .order("sent_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (liveInbound) {
    return block(
      "active_conversation",
      "O cliente está conversando agora; a automação não interrompe.",
      "deferred",
      inMinutes(now, settings.active_conversation_minutes),
    );
  }
  rules.push(pass("active_conversation"));

  // 5. Resposta manual recente do vendedor.
  const manualSince = minutesAgo(now, settings.manual_message_cooldown_minutes);
  const { data: manual } = await db
    .from("messages")
    .select("id, sent_at, metadata")
    .eq("conversation_id", request.conversationId)
    .eq("direction", "outbound")
    .gte("sent_at", manualSince)
    .order("sent_at", { ascending: false })
    .limit(10);
  const manualHuman = (manual ?? []).find((row) => {
    const meta = (row.metadata ?? {}) as Record<string, unknown>;
    return meta["source"] !== "automation";
  });
  if (manualHuman) {
    return block(
      "manual_reply_cooldown",
      "Você já falou com este cliente há pouco tempo.",
      "deferred",
      inMinutes(now, settings.manual_message_cooldown_minutes),
    );
  }
  rules.push(pass("manual_reply_cooldown"));

  // 6. Intervalo mínimo entre automações na mesma conversa.
  const cooldownSince = minutesAgo(now, settings.conversation_cooldown_minutes);
  const { data: recentAutomation } = await db
    .from("scheduled_actions")
    .select("id, executed_at")
    .eq("conversation_id", request.conversationId)
    .eq("status", "sent")
    .gte("executed_at", cooldownSince)
    .order("executed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (recentAutomation) {
    return block(
      "conversation_cooldown",
      "Uma automação já foi enviada nesta conversa há pouco tempo.",
      "deferred",
      inMinutes(now, settings.conversation_cooldown_minutes),
    );
  }
  rules.push(pass("conversation_cooldown"));

  // 7. Limites diários (contato e fluxo).
  const dayStart = minutesAgo(now, 24 * 60);
  const contactCap = preferences?.max_automations_per_day ?? settings.max_automations_per_day;
  const { count: contactSent } = await db
    .from("scheduled_actions")
    .select("id", { count: "exact", head: true })
    .eq("conversation_id", request.conversationId)
    .eq("status", "sent")
    .gte("executed_at", dayStart);
  if ((contactSent ?? 0) >= contactCap) {
    return block(
      "daily_contact_cap",
      `Limite de ${contactCap} automações por dia para este cliente já foi atingido.`,
      "deferred",
      inMinutes(now, 12 * 60),
    );
  }
  rules.push(pass("daily_contact_cap", `${contactSent ?? 0}/${contactCap} hoje`));

  if (request.flowRunId) {
    const { count: flowSent } = await db
      .from("scheduled_actions")
      .select("id", { count: "exact", head: true })
      .eq("flow_run_id", request.flowRunId)
      .eq("status", "sent")
      .gte("executed_at", dayStart);
    if ((flowSent ?? 0) >= settings.max_flow_automations_per_day) {
      return block(
        "daily_flow_cap",
        `Limite de ${settings.max_flow_automations_per_day} etapas por dia neste fluxo já foi atingido.`,
        "deferred",
        inMinutes(now, 12 * 60),
      );
    }
    rules.push(
      pass("daily_flow_cap", `${flowSent ?? 0}/${settings.max_flow_automations_per_day} hoje`),
    );
  } else {
    rules.push(pass("daily_flow_cap"));
  }

  // 8. Modo teste: nada sai para o cliente, exceto números da lista de teste.
  if (settings.test_mode) {
    const allowed = await isTestAllowlisted(db, settings, request.conversationId);
    if (!allowed) {
      rules.push(fail("test_mode", "Modo teste ativo: a mensagem foi registrada, não enviada."));
      return {
        decision: "simulated",
        blockedBy: "test_mode",
        reason: "Modo teste ativo: a mensagem foi registrada, não enviada.",
        rules,
        deferUntil: null,
      };
    }
    rules.push(pass("test_mode", "Número liberado na lista de teste."));
  } else {
    rules.push(pass("test_mode"));
  }

  return {
    decision: "allowed",
    blockedBy: null,
    reason: "Todas as políticas foram atendidas.",
    rules,
    deferUntil: null,
  };
}
