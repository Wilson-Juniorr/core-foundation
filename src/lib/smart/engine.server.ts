/**
 * Smart Flow — orquestrador de acompanhamento.
 *
 * Reaproveita a infraestrutura existente: `followup_runs`, `scheduled_actions`,
 * o scheduler server-side, o claim atômico, as janelas de horário, o Policy
 * Engine e a camada de WhatsApp. O que muda é *como* o próximo passo nasce:
 * em vez de uma sequência fixa, cada passo é decidido no momento da avaliação
 * e reconferido imediatamente antes do envio.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Json } from "@/integrations/supabase/types";
import { writeAudit } from "@/lib/audit/log.server";
import { logEvent } from "@/lib/crm.server";
import { resolveSendWindow, nextAllowedInstant } from "@/lib/followup/time";
import {
  blockingDeadline,
  fulfillCommitmentsBy,
  pendingCommitments,
} from "./commitments.server";
import { ensureControl, loadControl, patchControl, refreshPressure } from "./control.server";
import { decideNextStep } from "./decision.server";
import { evaluatePreSend, humanCooldownUntil } from "./rules";
import type { PreSendDecision } from "./rules";
import { SMART_STRATEGY_META } from "./types";

type Admin = SupabaseClient<Database>;
type ActionRow = Database["public"]["Tables"]["scheduled_actions"]["Row"];

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

export class SmartFlowError extends Error {
  constructor(
    message: string,
    public code: string,
  ) {
    super(message);
    this.name = "SmartFlowError";
  }
}

/* ------------------------------- utilidades ------------------------------- */

async function loadSettings(db: Admin, userId: string) {
  const { data } = await db
    .from("user_settings")
    .select("timezone, send_window_start, send_window_end")
    .eq("user_id", userId)
    .maybeSingle();
  return {
    timezone: data?.timezone ?? "America/Sao_Paulo",
    windowStart: data?.send_window_start ?? "09:00",
    windowEnd: data?.send_window_end ?? "20:00",
  };
}

async function loadSmartRun(db: Admin, runId: string) {
  const { data } = await db
    .from("followup_runs")
    .select(
      "id, user_id, flow_id, contact_id, conversation_id, opportunity_id, status, smart_state, deadline_at, next_evaluation_at, started_at, followup_flows!inner(id, name, kind, window_start, window_end, is_active)",
    )
    .eq("id", runId)
    .maybeSingle();
  if (!data || data.followup_flows.kind !== "smart") return null;
  return data;
}

async function loadConfig(db: Admin, flowId: string) {
  const { data } = await db
    .from("smart_flow_configs")
    .select("*")
    .eq("flow_id", flowId)
    .maybeSingle();
  return data ?? null;
}

/* ------------------------------ iniciar fluxo ----------------------------- */

export async function startSmartFlow(
  db: Admin,
  userId: string,
  input: {
    flowId: string;
    contactId: string;
    conversationId: string;
    opportunityId?: string | null;
  },
): Promise<{ runId: string; evaluateAt: string }> {
  const config = await loadConfig(db, input.flowId);
  if (!config) throw new SmartFlowError("Este fluxo não tem configuração inteligente.", "no_config");

  const { data: flow } = await db
    .from("followup_flows")
    .select("id, name, kind, is_active")
    .eq("id", input.flowId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!flow || flow.kind !== "smart") {
    throw new SmartFlowError("Fluxo inteligente não encontrado.", "not_found");
  }
  if (!flow.is_active) {
    throw new SmartFlowError("Este fluxo está desativado.", "inactive");
  }

  // Um acompanhamento por conversa: clássico ou inteligente, nunca os dois.
  const { data: conflicting } = await db
    .from("followup_runs")
    .select("id")
    .eq("conversation_id", input.conversationId)
    .eq("status", "active")
    .limit(1);
  if ((conflicting ?? []).length > 0) {
    throw new SmartFlowError(
      "Já existe um acompanhamento ativo nesta conversa. Encerre antes de iniciar outro.",
      "conflict",
    );
  }

  const { data: preferences } = await db
    .from("contact_preferences")
    .select("do_not_contact, automation_allowed")
    .eq("contact_id", input.contactId)
    .maybeSingle();
  if (preferences?.do_not_contact) {
    throw new SmartFlowError("Este cliente pediu para não receber mensagens.", "do_not_contact");
  }
  if (preferences && preferences.automation_allowed === false) {
    throw new SmartFlowError("A automação está desligada para este cliente.", "automation_blocked");
  }

  const now = new Date();
  const deadline = new Date(now.getTime() + config.max_duration_days * DAY_MS);

  const { data: run, error } = await db
    .from("followup_runs")
    .insert({
      user_id: userId,
      flow_id: input.flowId,
      contact_id: input.contactId,
      conversation_id: input.conversationId,
      opportunity_id: input.opportunityId ?? null,
      status: "active",
      smart_state: "evaluating",
      deadline_at: deadline.toISOString(),
      next_evaluation_at: now.toISOString(),
    })
    .select("id")
    .single();
  if (error) throw new SmartFlowError(error.message, "insert_failed");

  await ensureControl(db, userId, input.conversationId);
  await patchControl(db, input.conversationId, {
    owner: config.autonomy === "observe" ? "human" : "ai",
    state: "waiting_customer",
    next_responsible: "system",
    next_responsible_reason: "Acompanhamento inteligente iniciado.",
  });
  await refreshPressure(db, userId, input.conversationId);

  await writeAudit(db, userId, {
    action: "smart_flow_started",
    summary: `Smart Flow "${flow.name}" iniciado.`,
    entityType: "followup_run",
    entityId: run.id,
    metadata: { flow_id: input.flowId, contact_id: input.contactId, autonomy: config.autonomy },
  });
  await logEvent(db, userId, {
    event_type: "smart_flow_started",
    contact_id: input.contactId,
    opportunity_id: input.opportunityId ?? null,
    metadata: { flow_id: input.flowId, flow_name: flow.name, deadline_at: deadline.toISOString() },
  });

  // A avaliação real acontece no ciclo do scheduler, nunca de forma síncrona.
  return { runId: run.id, evaluateAt: now.toISOString() };
}

/* ------------------------------- reavaliação ------------------------------ */

async function completeRun(
  db: Admin,
  run: { id: string; user_id: string; contact_id: string; opportunity_id: string | null },
  reason: string,
) {
  await db
    .from("followup_runs")
    .update({
      status: "completed",
      smart_state: "completed",
      completed_at: new Date().toISOString(),
      stop_reason: reason,
      next_evaluation_at: null,
    })
    .eq("id", run.id);

  await writeAudit(db, run.user_id, {
    action: "smart_flow_completed",
    summary: `Smart Flow encerrado: ${reason}`,
    entityType: "followup_run",
    entityId: run.id,
    metadata: { reason },
  });
  await logEvent(db, run.user_id, {
    event_type: "smart_flow_completed",
    contact_id: run.contact_id,
    opportunity_id: run.opportunity_id,
    metadata: { reason },
  });
}

async function handoff(
  db: Admin,
  run: {
    id: string;
    user_id: string;
    contact_id: string;
    conversation_id: string;
    opportunity_id: string | null;
  },
  reason: string,
  extra?: Record<string, unknown>,
) {
  await db
    .from("followup_runs")
    .update({
      smart_state: "needs_human",
      status: "paused",
      paused_at: new Date().toISOString(),
      next_evaluation_at: new Date(Date.now() + 12 * HOUR_MS).toISOString(),
    })
    .eq("id", run.id);

  await patchControl(db, run.conversation_id, {
    owner: "human",
    state: "waiting_human",
    next_responsible: "human",
    next_responsible_reason: reason,
    decision_reason: reason,
  });

  await writeAudit(db, run.user_id, {
    action: "smart_low_confidence_handoff",
    summary: `Smart Flow entregue a você: ${reason}`,
    entityType: "followup_run",
    entityId: run.id,
    severity: "warning",
    metadata: { reason, ...(extra ?? {}) },
  });
  await logEvent(db, run.user_id, {
    event_type: "smart_handoff",
    contact_id: run.contact_id,
    opportunity_id: run.opportunity_id,
    metadata: { reason },
  });
}

/**
 * Avalia um Smart Run: decide se age, espera, chama o humano ou encerra.
 * Não envia nada — apenas cria (ou não) uma `scheduled_action` inteligente,
 * que passará pelo pré-check antes do envio real.
 */
export async function evaluateSmartRun(db: Admin, runId: string): Promise<string> {
  const run = await loadSmartRun(db, runId);
  if (!run) return "not_smart";
  if (run.status !== "active") return `skipped_${run.status}`;

  const config = await loadConfig(db, run.flow_id);
  if (!config) return "no_config";

  const now = new Date();
  const runRef = {
    id: run.id,
    user_id: run.user_id,
    contact_id: run.contact_id,
    conversation_id: run.conversation_id,
    opportunity_id: run.opportunity_id,
  };

  if (run.deadline_at && new Date(run.deadline_at) <= now) {
    await completeRun(db, runRef, "Prazo máximo do acompanhamento alcançado.");
    return "deadline_reached";
  }

  // Oportunidade encerrada: nada mais a acompanhar.
  if (run.opportunity_id) {
    const { data: opportunity } = await db
      .from("opportunities")
      .select("status")
      .eq("id", run.opportunity_id)
      .maybeSingle();
    if (opportunity && opportunity.status !== "open") {
      await completeRun(db, runRef, "Oportunidade encerrada.");
      return "opportunity_closed";
    }
  }

  // Já existe ação pendente para esta conversa: não empilhamos automações.
  const { data: existing } = await db
    .from("scheduled_actions")
    .select("id")
    .eq("conversation_id", run.conversation_id)
    .in("status", ["scheduled", "processing", "needs_approval"])
    .limit(1);
  if ((existing ?? []).length > 0) return "action_pending";

  const control = (await ensureControl(db, run.user_id, run.conversation_id))!;
  const pressure = await refreshPressure(db, run.user_id, run.conversation_id);

  // Cooldown após intervenção humana: a IA observa, não fala.
  if (control.last_human_message_at) {
    const cooldown = humanCooldownUntil(new Date(control.last_human_message_at));
    if (now < cooldown) {
      await db
        .from("followup_runs")
        .update({ smart_state: "human_active", next_evaluation_at: cooldown.toISOString() })
        .eq("id", run.id);
      return "human_cooldown";
    }
  }

  const commitments = await pendingCommitments(db, run.conversation_id);
  const commitmentDeadline = blockingDeadline(commitments, now);
  const humanCommitment = commitments.find((item) => item.responsible === "human");

  if (humanCommitment) {
    await handoff(
      db,
      runRef,
      `Você assumiu um retorno: ${humanCommitment.description}`,
      { commitment_id: humanCommitment.id },
    );
    return "human_commitment";
  }

  if (commitmentDeadline) {
    await db
      .from("followup_runs")
      .update({
        smart_state: "waiting_customer",
        next_evaluation_at: new Date(commitmentDeadline.getTime() + HOUR_MS).toISOString(),
      })
      .eq("id", run.id);
    await patchControl(db, run.conversation_id, {
      state: "waiting_customer",
      next_responsible: "customer",
      next_responsible_reason: "Cliente combinou um retorno com prazo.",
    });
    return "waiting_commitment";
  }

  // Limites de frequência do próprio fluxo.
  const weekAgo = new Date(now.getTime() - 7 * DAY_MS).toISOString();
  const { data: weekUsage } = await db
    .from("smart_strategy_usage")
    .select("strategy, used_at, got_reply")
    .eq("conversation_id", run.conversation_id)
    .gte("used_at", weekAgo)
    .order("used_at", { ascending: false });

  const usage = (weekUsage ?? []).map((item) => ({
    strategy: item.strategy,
    used_at: item.used_at,
    got_reply: Boolean(item.got_reply),
  }));

  if (usage.length >= config.max_actions_per_week) {
    await db
      .from("followup_runs")
      .update({
        smart_state: "waiting_customer",
        next_evaluation_at: new Date(now.getTime() + 2 * DAY_MS).toISOString(),
      })
      .eq("id", run.id);
    return "weekly_cap";
  }

  const lastUsedAt = usage[0]?.used_at ? new Date(usage[0].used_at) : null;
  if (lastUsedAt) {
    const minNext = new Date(lastUsedAt.getTime() + config.min_hours_between_actions * HOUR_MS);
    if (now < minNext) {
      await db
        .from("followup_runs")
        .update({ next_evaluation_at: minNext.toISOString() })
        .eq("id", run.id);
      return "min_interval";
    }
  }

  if (pressure.score > config.max_pressure) {
    await db
      .from("followup_runs")
      .update({
        smart_state: "waiting_customer",
        next_evaluation_at: new Date(now.getTime() + 3 * DAY_MS).toISOString(),
      })
      .eq("id", run.id);
    return "pressure_limit";
  }

  /* ------------------------- contexto para a decisão ---------------------- */

  const { data: messages } = await db
    .from("messages")
    .select("direction, message_type, text_content, sent_at")
    .eq("conversation_id", run.conversation_id)
    .order("sent_at", { ascending: false })
    .limit(25);

  const { data: memory } = await db
    .from("customer_memory")
    .select("current_summary, confidence, last_analyzed_at")
    .eq("contact_id", run.contact_id)
    .maybeSingle();

  const { data: contact } = await db
    .from("contacts")
    .select("name")
    .eq("id", run.contact_id)
    .maybeSingle();

  const decision = await decideNextStep(db, {
    config,
    control,
    contactName: contact?.name ?? null,
    objective: config.goal,
    deadlineAt: run.deadline_at,
    recentMessages: (messages ?? [])
      .slice()
      .reverse()
      .map((item) => ({
        direction: item.direction,
        type: item.message_type,
        text: item.text_content,
        at: item.sent_at,
      })),
    memorySummary: memory?.current_summary ?? null,
    pendingCommitments: commitments.map((item) => ({
      responsible: item.responsible,
      description: item.description,
      due_at: item.due_at,
    })),
    recentStrategies: usage,
    attemptsThisWeek: usage.length,
  });

  await writeAudit(db, run.user_id, {
    action: "smart_strategy_selected",
    summary: `Decisão do acompanhamento: ${decision.action}${decision.strategy ? ` (${SMART_STRATEGY_META[decision.strategy]?.label ?? decision.strategy})` : ""}`,
    entityType: "followup_run",
    entityId: run.id,
    actor: "system",
    metadata: {
      action: decision.action,
      strategy: decision.strategy,
      confidence: decision.confidence,
      reason: decision.reason,
      model: decision.model,
      prompt_version: decision.promptVersion,
    },
  });

  if (decision.action === "complete") {
    await completeRun(db, runRef, decision.reason);
    return "completed";
  }

  if (decision.action === "handoff") {
    await handoff(db, runRef, decision.reason, { confidence: decision.confidence });
    return "handoff";
  }

  if (decision.action === "wait" || !decision.strategy || !decision.message) {
    const waitHours = decision.waitHours > 0 ? decision.waitHours : 24;
    await db
      .from("followup_runs")
      .update({
        smart_state: "waiting_customer",
        next_evaluation_at: new Date(now.getTime() + waitHours * HOUR_MS).toISOString(),
      })
      .eq("id", run.id);
    await patchControl(db, run.conversation_id, {
      next_responsible: decision.nextResponsible,
      next_responsible_reason: decision.reason,
      decision_reason: decision.reason,
    });
    return "waiting";
  }

  /* --------------------------- agendar a ação ---------------------------- */

  const settings = await loadSettings(db, run.user_id);
  const window = resolveSendWindow(
    { start: settings.windowStart, end: settings.windowEnd },
    { start: run.followup_flows.window_start, end: run.followup_flows.window_end },
    null,
  );

  const target = new Date(now.getTime() + Math.max(0, decision.waitHours) * HOUR_MS);
  const scheduledFor = nextAllowedInstant(target, window, settings.timezone);

  const needsApproval =
    config.autonomy !== "auto" || decision.confidence < Number(config.confidence_min);

  const { data: action, error } = await db
    .from("scheduled_actions")
    .insert({
      user_id: run.user_id,
      flow_run_id: run.id,
      contact_id: run.contact_id,
      conversation_id: run.conversation_id,
      opportunity_id: run.opportunity_id,
      action_type: "text_message",
      content: decision.message,
      content_mode: "ai_generated",
      scheduled_for: scheduledFor.toISOString(),
      status: needsApproval ? "needs_approval" : "scheduled",
      cancel_on_reply: true,
      idempotency_key: `smart:${run.id}:${decision.strategy}:${scheduledFor.toISOString()}`,
      smart_strategy: decision.strategy,
      context_version: control.context_version,
      generated_at: now.toISOString(),
      decision_reason: decision.reason,
      requires_approval: needsApproval,
    })
    .select("id")
    .maybeSingle();

  if (error && error.code !== "23505") {
    throw new SmartFlowError(error.message, "schedule_failed");
  }

  await db
    .from("followup_runs")
    .update({
      smart_state: needsApproval ? "waiting_approval" : "acting",
      next_evaluation_at: new Date(
        scheduledFor.getTime() + config.min_hours_between_actions * HOUR_MS,
      ).toISOString(),
    })
    .eq("id", run.id);

  await patchControl(db, run.conversation_id, {
    state: "waiting_customer",
    next_responsible: "system",
    next_responsible_reason: decision.reason,
    decision_reason: decision.reason,
    confidence: decision.confidence,
  });

  return action ? (needsApproval ? "needs_approval" : "scheduled") : "duplicate";
}

/**
 * Ciclo do cron: reavalia os Smart Runs vencidos. Roda junto do scheduler
 * clássico, sem substituí-lo.
 */
export async function evaluateDueSmartRuns(
  db: Admin,
  limit = 20,
): Promise<{ evaluated: number; results: Record<string, number> }> {
  const nowIso = new Date().toISOString();
  const { data: runs } = await db
    .from("followup_runs")
    .select("id, followup_flows!inner(kind)")
    .eq("status", "active")
    .eq("followup_flows.kind", "smart")
    .not("next_evaluation_at", "is", null)
    .lte("next_evaluation_at", nowIso)
    .order("next_evaluation_at", { ascending: true })
    .limit(limit);

  const results: Record<string, number> = {};
  for (const run of runs ?? []) {
    try {
      const outcome = await evaluateSmartRun(db, run.id);
      results[outcome] = (results[outcome] ?? 0) + 1;
    } catch (error) {
      results["error"] = (results["error"] ?? 0) + 1;
      await writeAudit(db, "00000000-0000-0000-0000-000000000000", {
        action: "smart_flow_paused",
        summary: "Falha ao reavaliar um acompanhamento inteligente.",
        entityType: "followup_run",
        entityId: run.id,
        severity: "error",
        actor: "system",
        metadata: { error: error instanceof Error ? error.message : "erro" },
      }).catch(() => undefined);
    }
  }

  return { evaluated: (runs ?? []).length, results };
}

/* --------------------------- pré-check antes do envio --------------------- */

export interface SmartPreSendResult {
  allowed: boolean;
  verdict: PreSendDecision["verdict"];
  reason: string;
  deferUntil: Date | null;
}

/**
 * Chamado pelo executor imediatamente antes de acionar o provider de WhatsApp,
 * depois do claim. Fecha a janela de race condition entre claim e envio.
 * Ações clássicas passam direto (comportamento preservado).
 */
export async function smartPreSendCheck(
  db: Admin,
  action: ActionRow,
): Promise<SmartPreSendResult> {
  if (!action.smart_strategy) {
    return { allowed: true, verdict: "send", reason: "Ação clássica.", deferUntil: null };
  }

  const now = new Date();
  const control = await loadControl(db, action.conversation_id);
  const config = action.flow_run_id
    ? await (async () => {
        const { data: run } = await db
          .from("followup_runs")
          .select("flow_id")
          .eq("id", action.flow_run_id!)
          .maybeSingle();
        return run ? await loadConfig(db, run.flow_id) : null;
      })()
    : null;

  let opportunityClosed = false;
  if (action.opportunity_id) {
    const { data: opportunity } = await db
      .from("opportunities")
      .select("status")
      .eq("id", action.opportunity_id)
      .maybeSingle();
    opportunityClosed = Boolean(opportunity && opportunity.status !== "open");
  }

  const { data: conflicting } = await db
    .from("followup_runs")
    .select("id")
    .eq("conversation_id", action.conversation_id)
    .eq("status", "active")
    .neq("id", action.flow_run_id ?? "00000000-0000-0000-0000-000000000000")
    .limit(1);

  const commitments = await pendingCommitments(db, action.conversation_id);
  const customerDeadline = blockingDeadline(
    commitments.filter((item) => item.responsible !== "human"),
    now,
  );

  const decision = evaluatePreSend({
    now,
    generatedAt: action.generated_at ? new Date(action.generated_at) : null,
    actionContextVersion: action.context_version ?? null,
    currentContextVersion: control?.context_version ?? 1,
    controlOwner: (control?.owner ?? "none") as "ai" | "human" | "none",
    lastHumanMessageAt: control?.last_human_message_at
      ? new Date(control.last_human_message_at)
      : null,
    lastInboundAt: control?.last_inbound_at ? new Date(control.last_inbound_at) : null,
    humanCooldownUntil: control?.last_human_message_at
      ? humanCooldownUntil(new Date(control.last_human_message_at))
      : null,
    pressureScore: control?.pressure_score ?? 0,
    maxPressure: config?.max_pressure ?? 70,
    audioContextUnknown: Boolean(control?.audio_context_unknown),
    opportunityClosed,
    pendingCommitmentDueAt: customerDeadline,
    conflictingRun: (conflicting ?? []).length > 0,
    requiresApproval: Boolean(action.requires_approval),
    confidence: control?.confidence != null ? Number(control.confidence) : null,
    confidenceMin: config?.confidence_min != null ? Number(config.confidence_min) : 0.6,
  });

  if (decision.verdict === "send") {
    return { allowed: true, verdict: "send", reason: decision.reason, deferUntil: null };
  }

  const nextStatus =
    decision.verdict === "cancel"
      ? "cancelled"
      : decision.verdict === "stale"
        ? "stale"
        : decision.verdict === "approval"
          ? "needs_approval"
          : "scheduled";

  await db
    .from("scheduled_actions")
    .update({
      status: nextStatus,
      decision_reason: decision.reason,
      requires_approval: decision.verdict === "approval",
      ...(decision.deferUntil ? { scheduled_for: decision.deferUntil.toISOString() } : {}),
    })
    .eq("id", action.id);

  await writeAudit(db, action.user_id, {
    action:
      decision.verdict === "cancel"
        ? "smart_action_cancelled_by_context"
        : decision.verdict === "stale"
          ? "smart_action_stale"
          : decision.verdict === "approval"
            ? "smart_low_confidence_handoff"
            : "smart_action_deferred",
    summary: `Envio inteligente interrompido antes de sair: ${decision.reason}`,
    entityType: "scheduled_action",
    entityId: action.id,
    actor: "system",
    severity: decision.verdict === "cancel" ? "warning" : "info",
    metadata: {
      verdict: decision.verdict,
      strategy: action.smart_strategy,
      defer_until: decision.deferUntil?.toISOString() ?? null,
    } as unknown as Json,
  });

  if (action.contact_id) {
    await logEvent(db, action.user_id, {
      event_type:
        decision.verdict === "cancel"
          ? "smart_action_cancelled_by_context"
          : decision.verdict === "stale"
            ? "smart_action_stale"
            : "smart_action_deferred",
      contact_id: action.contact_id,
      opportunity_id: action.opportunity_id,
      metadata: { reason: decision.reason, strategy: action.smart_strategy },
    });
  }

  if (action.flow_run_id) {
    await db
      .from("followup_runs")
      .update({
        smart_state: decision.verdict === "approval" ? "waiting_approval" : "evaluating",
        next_evaluation_at: (decision.deferUntil ?? new Date(now.getTime() + 6 * HOUR_MS)).toISOString(),
      })
      .eq("id", action.flow_run_id);
  }

  return {
    allowed: false,
    verdict: decision.verdict,
    reason: decision.reason,
    deferUntil: decision.deferUntil,
  };
}

/** Registro do que foi realmente enviado, para evitar repetir estratégia. */
export async function recordStrategyUsage(
  db: Admin,
  action: ActionRow,
  messageId: string | null,
): Promise<void> {
  if (!action.smart_strategy) return;
  await db.from("smart_strategy_usage").insert({
    user_id: action.user_id,
    conversation_id: action.conversation_id,
    contact_id: action.contact_id,
    scheduled_action_id: action.id,
    message_id: messageId,
    strategy: action.smart_strategy,
    channel: action.action_type,
    message_preview: (action.content ?? "").slice(0, 300),
  });

  await patchControl(db, action.conversation_id, {
    last_ai_message_at: new Date().toISOString(),
    state: "waiting_customer",
    next_responsible: "customer",
    next_responsible_reason: "Aguardando resposta do cliente.",
  });
}

/** Resposta do cliente marca a última estratégia como efetiva. */
export async function markStrategyReply(db: Admin, conversationId: string): Promise<void> {
  const { data: last } = await db
    .from("smart_strategy_usage")
    .select("id")
    .eq("conversation_id", conversationId)
    .is("got_reply", null)
    .order("used_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!last) return;
  await db
    .from("smart_strategy_usage")
    .update({ got_reply: true, replied_at: new Date().toISOString() })
    .eq("id", last.id);
  await fulfillCommitmentsBy(db, {
    userId: "",
    conversationId,
    responsible: "customer",
  });
}
