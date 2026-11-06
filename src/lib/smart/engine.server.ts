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

import { nextSilenceContact, POST_QUOTE_POLICY } from "./post-quote-cadence";
import type { Database } from "@/integrations/supabase/types";
import { writeAudit } from "@/lib/audit/log.server";
import { logEvent } from "@/lib/crm.server";
import {
  mergeWindows,
  makeWindow,
  nextAllowedInstant,
  DEFAULT_TIMEZONE,
} from "@/lib/followup/time";
import { blockingDeadline, pendingCommitments } from "./commitments.server";
import { ensureControl, loadControl, patchControl, refreshPressure } from "./control.server";
import { describeDealSheet, toDealSheet } from "@/lib/ai/deal-sheet";
import { decideNextStep } from "./decision.server";
import { describePerformance, rankStrategies, strategyPerformance } from "./learning.server";
import { reviewMessage } from "./quality.server";
import { classifyLossReason, evaluatePreSend, humanCooldownUntil } from "./rules";
import type { PreSendDecision } from "./rules";
import { alignToPreferredHour, learnContactTiming } from "./timing.server";
import { LOSS_REASON_LABELS, SMART_STRATEGY_META } from "./types";
import type { SmartStrategy } from "./types";

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
    timezone: data?.timezone ?? DEFAULT_TIMEZONE,
    windowStart: data?.send_window_start ?? "09:00",
    windowEnd: data?.send_window_end ?? "20:00",
  };
}

async function loadSmartRun(db: Admin, runId: string) {
  const { data } = await db
    .from("followup_runs")
    .select(
      "id, user_id, flow_id, contact_id, conversation_id, opportunity_id, status, smart_state, deadline_at, next_evaluation_at, started_at, policy_key, policy_activated_at, contacts_done, last_contact_accepted_at, next_contact_at, next_contact_reason, followup_flows!inner(id, name, kind, window_start, window_end, is_active)",
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
    policyKey?: typeof POST_QUOTE_POLICY;
  },
): Promise<{ runId: string; evaluateAt: string }> {
  const config = await loadConfig(db, input.flowId);
  if (!config)
    throw new SmartFlowError("Este fluxo não tem configuração inteligente.", "no_config");

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
    .in("status", ["active", "paused"])
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
  const postQuote = input.policyKey === POST_QUOTE_POLICY;
  const previousControl = await ensureControl(db, userId, input.conversationId);
  const commitments = await pendingCommitments(db, input.conversationId);
  const humanPending =
    previousControl.owner === "human" ||
    previousControl.next_responsible === "human" ||
    commitments.some((c) => c.responsible === "human");
  const initial = postQuote
    ? nextSilenceContact({ doneContacts: 0, activatedAt: now, lastContactAt: null })
    : null;
  const committed = commitments
    .map((c) => c.due_at ?? c.due_window_end)
    .filter((v): v is string => Boolean(v))
    .sort()
    .at(-1);
  const initialAt = initial
    ? new Date(
        Math.max(initial.at.getTime(), committed ? new Date(committed).getTime() : 0),
      ).toISOString()
    : now.toISOString();

  const { data: run, error } = await db
    .from("followup_runs")
    .insert({
      user_id: userId,
      flow_id: input.flowId,
      contact_id: input.contactId,
      conversation_id: input.conversationId,
      opportunity_id: input.opportunityId ?? null,
      status: postQuote && humanPending ? "paused" : "active",
      smart_state: postQuote && humanPending ? "needs_human" : "evaluating",
      deadline_at: postQuote ? null : deadline.toISOString(),
      next_evaluation_at: postQuote && humanPending ? null : now.toISOString(),
      ...(postQuote
        ? {
            policy_key: POST_QUOTE_POLICY,
            policy_version: 1,
            policy_activated_at: now.toISOString(),
            contacts_done: 0,
            next_contact_at: initialAt,
            next_contact_reason: humanPending
              ? "Você ainda deve uma resposta ao cliente."
              : initial?.goal,
            next_contact_responsible: humanPending ? "human" : "system",
          }
        : {}),
    })
    .select("id")
    .single();
  if (error) throw new SmartFlowError(error.message, "insert_failed");

  await ensureControl(db, userId, input.conversationId);
  if (!postQuote)
    await patchControl(db, input.conversationId, {
      owner: config.autonomy === "observe" ? "human" : "ai",
      state: "waiting_customer",
      next_responsible: "system",
      next_responsible_reason: "Acompanhamento inteligente iniciado.",
      handoff_kind: null,
      handoff_at: null,
      handoff_reason: null,
      sensitive_since_handoff: false,
      return_check_at: null,
      return_mode: null,
      return_at: null,
      return_reason: null,
      return_source: null,
      force_approval_next: false,
    });
  if (postQuote && !humanPending && previousControl.owner !== "ai")
    await patchControl(db, input.conversationId, { owner: "ai" });
  if (postQuote && input.opportunityId)
    await db
      .from("opportunities")
      .update({
        post_quote_run_id: run.id,
        post_quote_next_at: humanPending ? null : initialAt,
        post_quote_next_reason: humanPending
          ? "Você ainda deve uma resposta ao cliente."
          : initial?.goal,
      })
      .eq("id", input.opportunityId)
      .eq("user_id", userId);
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

/** Silêncio após sua mensagem; dispensado quando você mesmo mandou o agente voltar. */
function effectiveCooldown(control: {
  last_human_message_at: string | null;
  cooldown_waived_at: string | null;
}): Date | null {
  if (!control.last_human_message_at) return null;
  if (control.cooldown_waived_at && control.cooldown_waived_at >= control.last_human_message_at) {
    return null;
  }
  return humanCooldownUntil(new Date(control.last_human_message_at));
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

  try {
    const { markHandoff } = await import("./return.server");
    await markHandoff(db, {
      conversationId: run.conversation_id,
      kind: extra?.["commitment_id"] ? "human_promise" : "low_confidence",
      reason,
    });
  } catch (error) {
    console.error("smart_handoff_mark_failed", error);
  }

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
  const token = crypto.randomUUID();
  const { data: claimed, error } = await db
    .from("followup_runs")
    .update({
      evaluation_token: token,
      evaluation_lease_until: new Date(Date.now() + 5 * 60_000).toISOString(),
    })
    .eq("id", runId)
    .eq("status", "active")
    .or(`evaluation_lease_until.is.null,evaluation_lease_until.lt.${new Date().toISOString()}`)
    .select("id")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!claimed) return "evaluation_claimed";
  try {
    return await evaluateClaimedSmartRun(db, runId);
  } finally {
    await db
      .from("followup_runs")
      .update({ evaluation_token: null, evaluation_lease_until: null })
      .eq("id", runId)
      .eq("evaluation_token", token);
  }
}

async function evaluateClaimedSmartRun(db: Admin, runId: string): Promise<string> {
  const run = await loadSmartRun(db, runId);
  if (!run) return "not_smart";
  if (run.status !== "active") return `skipped_${run.status}`;

  const config = await loadConfig(db, run.flow_id);
  if (!config) return "no_config";

  const now = new Date();
  const postQuote = run.policy_key === POST_QUOTE_POLICY;
  const cadence = postQuote
    ? nextSilenceContact({
        doneContacts: run.contacts_done,
        activatedAt: new Date(run.policy_activated_at ?? run.started_at),
        lastContactAt: run.last_contact_accepted_at ? new Date(run.last_contact_accepted_at) : null,
      })
    : null;
  if (postQuote && !cadence) {
    await completeRun(db, run, "Ciclo de oito contatos concluído.");
    return "cycle_completed";
  }
  const runRef = {
    id: run.id,
    user_id: run.user_id,
    contact_id: run.contact_id,
    conversation_id: run.conversation_id,
    opportunity_id: run.opportunity_id,
  };

  const phase =
    run.smart_state === "refusal_recovery"
      ? ("recovery" as const)
      : run.smart_state === "declining"
        ? ("decline" as const)
        : run.smart_state === "reactivation"
          ? ("reactivation" as const)
          : null;

  // Prazo máximo alcançado sem recusa: o acompanhamento não morre, ele muda de
  // ritmo — passa a reativação de longo prazo (uma tentativa por mês).
  if (
    !postQuote &&
    run.deadline_at &&
    new Date(run.deadline_at) <= now &&
    phase !== "reactivation"
  ) {
    if (phase === "recovery" || phase === "decline") {
      await db
        .from("followup_runs")
        .update({ next_evaluation_at: new Date(now.getTime() + HOUR_MS).toISOString() })
        .eq("id", run.id);
    } else {
      await db
        .from("followup_runs")
        .update({
          smart_state: "reactivation",
          deadline_at: null,
          next_evaluation_at: new Date(now.getTime() + 30 * DAY_MS).toISOString(),
        })
        .eq("id", run.id);
      await writeAudit(db, run.user_id, {
        action: "smart_strategy_selected",
        summary:
          "Prazo principal alcançado sem recusa do cliente: acompanhamento passa a reativação mensal.",
        entityType: "followup_run",
        entityId: run.id,
        actor: "system",
        metadata: { smart_state: "reactivation" },
      });
      return "reactivation_mode";
    }
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
    .in("status", ["scheduled", "processing", "needs_approval", "blocked"])
    .limit(1);
  if ((existing ?? []).length > 0) return "action_pending";

  const control = await ensureControl(db, run.user_id, run.conversation_id);
  const pressure = await refreshPressure(db, run.user_id, run.conversation_id);

  /* Conversa com você: o agente não prepara nada. Quem decide a volta é a
     análise de retorno (return.server), nunca este ciclo. */
  if (control.owner === "human" && config.autonomy !== "observe") {
    await db
      .from("followup_runs")
      .update({
        smart_state: "human_active",
        next_evaluation_at:
          control.return_at ?? new Date(now.getTime() + 12 * HOUR_MS).toISOString(),
      })
      .eq("id", run.id);
    if (!control.handoff_at && !control.return_check_at) {
      await db
        .from("conversation_control")
        .update({
          handoff_kind: "manual",
          handoff_at: control.last_human_message_at ?? now.toISOString(),
          handoff_reason: "Você conversou com o cliente.",
          return_check_at: now.toISOString(),
        })
        .eq("conversation_id", run.conversation_id);
    }
    return "owner_human";
  }

  // Cooldown após intervenção humana: a IA observa, não fala.
  {
    const cooldown = effectiveCooldown(control);
    if (cooldown && now < cooldown) {
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
    await handoff(db, runRef, `Você assumiu um retorno: ${humanCommitment.description}`, {
      commitment_id: humanCommitment.id,
    });
    return "human_commitment";
  }

  if (commitmentDeadline) {
    await db
      .from("followup_runs")
      .update({
        smart_state: "waiting_customer",
        next_evaluation_at: commitmentDeadline.toISOString(),
        ...(postQuote
          ? {
              next_contact_at: commitmentDeadline.toISOString(),
              next_contact_reason: "Compromisso explícito com o cliente.",
              next_contact_responsible: "system",
            }
          : {}),
      })
      .eq("id", run.id);
    await patchControl(
      db,
      run.conversation_id,
      {
        state: "waiting_customer",
        next_responsible: "customer",
        next_responsible_reason: "Cliente combinou um retorno com prazo.",
      },
      { bumpVersion: false },
    );
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

  if (!postQuote && usage.length >= config.max_actions_per_week && !phase) {
    await db
      .from("followup_runs")
      .update({
        smart_state: "waiting_customer",
        next_evaluation_at: new Date(now.getTime() + 2 * DAY_MS).toISOString(),
      })
      .eq("id", run.id);
    return "weekly_cap";
  }

  /* Ritmo por temperatura: cliente que interagiu há pouco merece cadência mais
     curta (ficar em cima); cliente frio há semanas recebe espaçamento maior.
     Os limites do fluxo continuam soberanos — só o intervalo mínimo varia. */
  const lastInboundAt = control.last_inbound_at ? new Date(control.last_inbound_at) : null;
  const inboundAgeDays = lastInboundAt ? (now.getTime() - lastInboundAt.getTime()) / DAY_MS : null;
  const rhythmFactor =
    inboundAgeDays === null ? 1.25 : inboundAgeDays <= 2 ? 0.6 : inboundAgeDays <= 7 ? 0.85 : 1.4;
  const minHours = Math.max(6, Math.round(config.min_hours_between_actions * rhythmFactor));

  const lastUsedAt = usage[0]?.used_at ? new Date(usage[0].used_at) : null;
  if (!postQuote && lastUsedAt && !phase) {
    const minNext = new Date(lastUsedAt.getTime() + minHours * HOUR_MS);
    if (now < minNext) {
      await db
        .from("followup_runs")
        .update({ next_evaluation_at: minNext.toISOString() })
        .eq("id", run.id);
      return "min_interval";
    }
  }

  if (pressure.score > config.max_pressure && !phase) {
    await db
      .from("followup_runs")
      .update({
        smart_state: "waiting_customer",
        next_evaluation_at: new Date(now.getTime() + 3 * DAY_MS).toISOString(),
      })
      .eq("id", run.id);
    return "pressure_limit";
  }

  const plannedAt = postQuote ? new Date(run.next_contact_at ?? cadence?.at ?? now) : null;
  // Preparar só próximo do envio evita manter um texto envelhecido por semanas.
  if (plannedAt && plannedAt.getTime() > now.getTime() + 15 * 60_000) {
    await db
      .from("followup_runs")
      .update({ next_evaluation_at: new Date(plannedAt.getTime() - 15 * 60_000).toISOString() })
      .eq("id", run.id);
    return "waiting_cadence";
  }
  /* ------------------------- contexto para a decisão ---------------------- */

  const { data: messages } = await db
    .from("messages")
    .select("id, direction, message_type, text_content, sent_at")
    .eq("conversation_id", run.conversation_id)
    .order("sent_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(25);

  const { data: memory } = await db
    .from("customer_memory")
    .select(
      "current_summary, confidence, last_analyzed_at, deal_stage, decision_maker, quoted_operator, quoted_plan, quoted_value, quoted_lives, temperature, temperature_reason",
    )
    .eq("contact_id", run.contact_id)
    .is("opportunity_id", null)
    .maybeSingle();

  const { data: contact } = await db
    .from("contacts")
    .select("name")
    .eq("id", run.contact_id)
    .maybeSingle();

  const settings = await loadSettings(db, run.user_id);

  // Aprendizado por resultado + horário habitual do cliente.
  const performance = await strategyPerformance(db, run.user_id);
  const allowedStrategies = (config.allowed_strategies as string[]) ?? [];
  const timing = await learnContactTiming(db, run.conversation_id, settings.timezone);

  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  const { data: conditionRows } = await db
    .from("commercial_conditions")
    .select("operator, title, discount_percent, audience, valid_until, issuance_days, notes")
    .eq("user_id", run.user_id)
    .eq("is_active", true)
    .or(`valid_until.is.null,valid_until.gte.${today}`)
    .limit(20);
  const activeConditions = (conditionRows ?? []).map((c) =>
    [
      `${c.operator}: ${c.title}`,
      c.discount_percent != null ? `${c.discount_percent}% de desconto` : null,
      c.audience ? `válida para ${c.audience}` : null,
      c.valid_until ? `até ${c.valid_until.split("-").reverse().join("/")}` : null,
      c.issuance_days != null ? `emissão leva ${c.issuance_days} dia(s)` : null,
      c.notes,
    ]
      .filter(Boolean)
      .join(" · "),
  );

  const { consultantNotes } = await import("./return.server");
  const notes = await consultantNotes(db, run.conversation_id);

  const decision = await decideNextStep(db, {
    consultantNotes: notes,
    activeConditions,
    config,
    control,
    contactName: contact?.name ?? null,
    objective: postQuote
      ? `${config.goal}. Contato ${cadence?.contact} de 8: ${cadence?.goal}. Silêncio não encerra antes do contato 8. Sem negociação ou respostas técnicas.`
      : config.goal,
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
    dealSheet: memory ? describeDealSheet(toDealSheet(memory as Record<string, unknown>)) : [],
    pendingCommitments: commitments.map((item) => ({
      responsible: item.responsible,
      description: item.description,
      due_at: item.due_at,
    })),
    recentStrategies: usage,
    attemptsThisWeek: usage.length,
    phase,
    performanceNote: describePerformance(allowedStrategies, performance),
    rankedStrategies: rankStrategies(allowedStrategies, performance),
    timingNote: timing.preferredHour !== null ? timing.reason : null,
  });

  const currentControl = await loadControl(db, run.conversation_id);
  if (currentControl?.context_version !== control.context_version) {
    await db
      .from("followup_runs")
      .update({ next_evaluation_at: new Date().toISOString() })
      .eq("id", run.id);
    return "context_changed_during_generation";
  }
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

  if (phase && !decision.message) {
    await handoff(
      db,
      runRef,
      phase === "decline"
        ? "Não foi possível redigir o encerramento automaticamente."
        : "Não foi possível redigir a pergunta sobre o motivo da recusa.",
    );
    return "phase_handoff";
  }

  if (!postQuote && decision.action === "complete" && !phase) {
    await completeRun(db, runRef, decision.reason);
    return "completed";
  }

  if (decision.action === "handoff" && !phase) {
    await handoff(db, runRef, decision.reason, { confidence: decision.confidence });
    return "handoff";
  }

  if (!phase && (decision.action === "wait" || !decision.strategy || !decision.message)) {
    const waitHours = decision.waitHours > 0 ? decision.waitHours : 24;
    await db
      .from("followup_runs")
      .update({
        smart_state: "waiting_customer",
        next_evaluation_at: new Date(now.getTime() + waitHours * HOUR_MS).toISOString(),
      })
      .eq("id", run.id);
    await patchControl(
      db,
      run.conversation_id,
      {
        next_responsible: decision.nextResponsible,
        next_responsible_reason: decision.reason,
        decision_reason: decision.reason,
      },
      { bumpVersion: false },
    );
    return "waiting";
  }

  /* ------------------- controle de qualidade da mensagem ------------------ */

  const quality = reviewMessage({
    message: decision.message ?? "",
    contactName: contact?.name ?? null,
    previousOutbound: (messages ?? [])
      .filter((item) => item.direction === "outbound" && item.text_content)
      .map((item) => item.text_content as string),
    inboundTexts: (messages ?? [])
      .filter((item) => item.direction === "inbound" && item.text_content)
      .map((item) => item.text_content as string),
    memorySummary: memory?.current_summary ?? null,
    sensitivePhase: Boolean(phase),
  });

  if (quality.verdict === "reject") {
    await handoff(db, runRef, `Mensagem reprovada na revisão: ${quality.reason}`, {
      quality_reason: quality.reason,
      similarity: quality.similarity,
      strategy: decision.strategy,
    });
    return "quality_rejected";
  }

  /* --------------------------- agendar a ação ---------------------------- */

  const window = mergeWindows(
    makeWindow(settings.windowStart, settings.windowEnd),
    makeWindow(run.followup_flows.window_start, run.followup_flows.window_end),
  );

  if (window && window.startMinutes === window.endMinutes) {
    await db
      .from("followup_runs")
      .update({
        smart_state: "blocked",
        next_contact_reason: "Janelas de envio sem horário em comum.",
        next_contact_responsible: "human",
        next_evaluation_at: new Date(now.getTime() + HOUR_MS).toISOString(),
      })
      .eq("id", run.id);
    return "window_conflict";
  }
  const target = plannedAt ?? new Date(now.getTime() + Math.max(0, decision.waitHours) * HOUR_MS);
  // Horário inteligente: dentro da janela, preferimos a hora em que este
  // cliente costuma interagir.
  const scheduledFor = postQuote
    ? nextAllowedInstant(target, window, DEFAULT_TIMEZONE)
    : alignToPreferredHour({
        target,
        preferredHour: timing.preferredHour,
        window,
        timezone: settings.timezone,
      });

  const forcedStrategy: SmartStrategy | null =
    phase === "recovery"
      ? "LOSS_REASON_DISCOVERY"
      : phase === "decline"
        ? "GRACEFUL_DECLINE"
        : null;
  const strategy = forcedStrategy ?? decision.strategy;

  // Recuperação de objeção, declínio e mensagens de qualidade duvidosa
  // nunca saem sem você ver.
  const needsApproval =
    Boolean(forcedStrategy) ||
    control.force_approval_next ||
    config.autonomy !== "auto" ||
    quality.verdict === "review" ||
    decision.confidence < Number(config.confidence_min);

  const { data: actionId, error } = await db.rpc("schedule_smart_action", {
    p_action: {
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
      idempotency_key: postQuote
        ? `post_quote:${run.id}:${cadence?.contact}:${control.context_version}`
        : `smart:${run.id}:${strategy}:${scheduledFor.toISOString()}`,
      smart_strategy: strategy,
      context_version: control.context_version,
      generated_at: now.toISOString(),
      analyzed_through_at: now.toISOString(),
      analyzed_message_ids: (messages ?? [])
        .filter((m) => m.direction === "inbound")
        .map((m) => m.id),
      logical_contact: postQuote ? cadence?.contact : null,
      decision_reason:
        quality.verdict === "review"
          ? `${decision.reason} | Revisão: ${quality.reason}`
          : decision.reason,

      requires_approval: needsApproval,
    },
  });
  const action = actionId ? { id: actionId } : null;

  if (error && error.code !== "23505") {
    throw new SmartFlowError(error.message, "schedule_failed");
  }

  if (!action) {
    await db
      .from("followup_runs")
      .update({ next_evaluation_at: new Date().toISOString() })
      .eq("id", run.id);
    return "duplicate_or_context_changed";
  }
  /* Volta "avisa e espera seu ok": a mensagem fica em Aprovações e você
     recebe um aviso no celular com o texto que ele mandaria. */
  if (action && control.force_approval_next) {
    await db
      .from("conversation_control")
      .update({ force_approval_next: false })
      .eq("conversation_id", run.conversation_id);
    try {
      const { queueOwnerAlert } = await import("./owner-alerts.server");
      await queueOwnerAlert(db, {
        userId: run.user_id,
        kind: "approval",
        conversationId: run.conversation_id,
        contactId: run.contact_id,
        title: `${contact?.name ?? "Cliente"}: agente quer voltar, precisa do seu ok`,
        body: `🤖 O agente quer voltar a falar com *${contact?.name ?? "o cliente"}* e precisa do seu ok:\n\n"${decision.message ?? ""}"\n\nAprove ou recuse em Follow-ups → Aprovações:\nhttps://engage-flow-89.lovable.app/followups`,
        dedupeKey: `approval:${action.id}`,
      });
    } catch (alertError) {
      console.error("approval_alert_failed", alertError);
    }
  }

  await db
    .from("followup_runs")
    .update({
      smart_state: phase
        ? phase === "recovery"
          ? "refusal_recovery"
          : phase === "decline"
            ? "declining"
            : "reactivation"
        : needsApproval
          ? "waiting_approval"
          : "acting",
      next_evaluation_at: new Date(scheduledFor.getTime() + minHours * HOUR_MS).toISOString(),
      ...(postQuote
        ? {
            next_contact_at: scheduledFor.toISOString(),
            next_contact_reason: decision.reason,
            next_contact_responsible: needsApproval ? "human" : "system",
          }
        : {}),
    })
    .eq("id", run.id);

  await patchControl(
    db,
    run.conversation_id,
    {
      state: "waiting_customer",
      next_responsible: "system",
      next_responsible_reason: decision.reason,
      decision_reason: decision.reason,
      confidence: decision.confidence,
    },
    { bumpVersion: false },
  );

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
        severity: "critical",
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
export async function smartPreSendCheck(db: Admin, action: ActionRow): Promise<SmartPreSendResult> {
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
          .eq("id", action.flow_run_id ?? "")
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
    humanCooldownUntil: control ? effectiveCooldown(control) : null,
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
    },
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
        next_evaluation_at: (
          decision.deferUntil ?? new Date(now.getTime() + 6 * HOUR_MS)
        ).toISOString(),
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
    content_preview: (action.content ?? "").slice(0, 300),
  });

  await patchControl(
    db,
    action.conversation_id,
    {
      last_automation_at: new Date().toISOString(),
      state: "waiting_customer",
      next_responsible: "customer",
      next_responsible_reason: "Aguardando resposta do cliente.",
    },
    { bumpVersion: false },
  );

  if (action.smart_strategy === "GRACEFUL_DECLINE" && !action.logical_contact) {
    await finalizeDecline(db, action);
  }
}

/**
 * Declínio digno concluído: a oportunidade é marcada como perdida com o motivo
 * classificado, o acompanhamento é encerrado e fica um lembrete de reativação
 * para daqui a seis meses. Não aplicamos `do_not_contact`: o cliente recusou
 * esta cotação, não o relacionamento.
 */
async function finalizeDecline(db: Admin, action: ActionRow): Promise<void> {
  const { data: lastInbound } = await db
    .from("messages")
    .select("text_content")
    .eq("conversation_id", action.conversation_id)
    .eq("direction", "inbound")
    .order("sent_at", { ascending: false })
    .limit(3);

  const reasonText = (lastInbound ?? [])
    .map((item) => item.text_content ?? "")
    .join(" ")
    .trim();
  const lossReason = classifyLossReason(reasonText);
  const lossLabel = LOSS_REASON_LABELS[lossReason];

  if (action.opportunity_id) {
    const { data: opportunity } = await db
      .from("opportunities")
      .select("id, status, notes")
      .eq("id", action.opportunity_id)
      .maybeSingle();
    if (opportunity && opportunity.status === "open") {
      await db
        .from("opportunities")
        .update({
          status: "lost",
          next_action_at: null,
          next_action_description: null,
          notes: [opportunity.notes, `Perda registrada pelo acompanhamento — motivo: ${lossLabel}.`]
            .filter(Boolean)
            .join("\n"),
        })
        .eq("id", opportunity.id);
      await logEvent(db, action.user_id, {
        event_type: "opportunity_lost",
        contact_id: action.contact_id,
        opportunity_id: opportunity.id,
        metadata: { loss_reason: lossReason, source: "smart_decline" },
      });
    }
  }

  if (action.flow_run_id) {
    await db
      .from("followup_runs")
      .update({
        status: "completed",
        smart_state: "completed",
        completed_at: new Date().toISOString(),
        stop_reason: `Cliente recusou (${lossLabel}). Acompanhamento declinado com elegância.`,
        next_evaluation_at: null,
      })
      .eq("id", action.flow_run_id);
  }

  await patchControl(db, action.conversation_id, {
    owner: "none",
    state: "completed",
    next_responsible: "none",
    next_responsible_reason: `Cliente recusou (${lossLabel}).`,
    buying_stage: "lost",
  });

  // Lembrete de reativação em 6 meses (fica adormecido na Central de Atenção).
  const reactivateAt = new Date(Date.now() + 180 * DAY_MS);
  await db.from("attention_items").insert({
    user_id: action.user_id,
    contact_id: action.contact_id,
    conversation_id: action.conversation_id,
    opportunity_id: action.opportunity_id,
    kind: "reactivation_due",
    priority: "low",
    priority_score: 10,
    title: "Reativação sugerida",
    summary: `Cliente recusou por ${lossLabel}. Vale um novo contato agora.`,
    reason: "Seis meses desde o declínio do acompanhamento.",
    suggested_action: "Refazer a cotação com condições atuais.",
    suggested_action_source: "rule",
    bucket: "waiting",
    status: "snoozed",
    snoozed_until: reactivateAt.toISOString(),
    dedupe_key: `reactivation:${action.conversation_id}:${reactivateAt.toISOString().slice(0, 10)}`,
    blocks_automation: false,
    metadata: { loss_reason: lossReason },
  });

  await writeAudit(db, action.user_id, {
    action: "smart_declined",
    summary: `Acompanhamento declinado: ${lossLabel}. Reativação sugerida em 6 meses.`,
    entityType: "conversation",
    entityId: action.conversation_id,
    actor: "system",
    metadata: { loss_reason: lossReason },
  });
  await logEvent(db, action.user_id, {
    event_type: "smart_declined",
    contact_id: action.contact_id,
    opportunity_id: action.opportunity_id,
    metadata: { loss_reason: lossReason },
  });
  await logEvent(db, action.user_id, {
    event_type: "smart_reactivation_scheduled",
    contact_id: action.contact_id,
    metadata: { at: reactivateAt.toISOString() },
  });
}

/** Resposta do cliente marca a última estratégia como efetiva. */
export async function markStrategyReply(db: Admin, conversationId: string): Promise<void> {
  const { data: last } = await db
    .from("smart_strategy_usage")
    .select("id")
    .eq("conversation_id", conversationId)
    .eq("got_reply", false)
    .order("used_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!last) return;
  await db.from("smart_strategy_usage").update({ got_reply: true }).eq("id", last.id);
}
