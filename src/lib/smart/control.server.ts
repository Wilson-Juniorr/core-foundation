/**
 * Smart Flow — dono da conversa (ownership) e contexto de controle.
 *
 * Regra central: IA e humano nunca conduzem ao mesmo tempo. Qualquer mensagem
 * manual do consultor transfere o controle para ele e invalida ações
 * inteligentes preparadas antes disso.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Json } from "@/integrations/supabase/types";
import { logEvent } from "@/lib/crm.server";
import { writeAudit } from "@/lib/audit/log.server";
import { computePressure, detectClosingSignal, detectIrritation, humanCooldownUntil } from "./rules";
import type { ControlOwner, ControlState, NextResponsible } from "./types";

type Admin = SupabaseClient<Database>;
type ControlRow = Database["public"]["Tables"]["conversation_control"]["Row"];

const DAY_MS = 24 * 60 * 60_000;

export async function ensureControl(
  db: Admin,
  userId: string,
  conversationId: string,
): Promise<ControlRow> {
  const { data: existing } = await db
    .from("conversation_control")
    .select("*")
    .eq("conversation_id", conversationId)
    .maybeSingle();
  if (existing) return existing;

  const { data, error } = await db
    .from("conversation_control")
    .insert({ conversation_id: conversationId, user_id: userId })
    .select("*")
    .single();

  if (error) {
    // Corrida: outro processo criou primeiro.
    const { data: retry } = await db
      .from("conversation_control")
      .select("*")
      .eq("conversation_id", conversationId)
      .maybeSingle();
    if (retry) return retry;
    throw new Error(error.message);
  }
  return data;
}

/**
 * Toda alteração de contexto incrementa `context_version`. Ações preparadas com
 * uma versão anterior são consideradas desatualizadas no pré-check.
 */
export async function patchControl(
  db: Admin,
  conversationId: string,
  patch: Database["public"]["Tables"]["conversation_control"]["Update"],
  options?: { bumpVersion?: boolean },
): Promise<void> {
  const bump = options?.bumpVersion !== false;
  const { data: current } = await db
    .from("conversation_control")
    .select("context_version")
    .eq("conversation_id", conversationId)
    .maybeSingle();

  await db
    .from("conversation_control")
    .update({
      ...patch,
      ...(bump ? { context_version: (current?.context_version ?? 1) + 1 } : {}),
      context_updated_at: new Date().toISOString(),
    })
    .eq("conversation_id", conversationId);
}

export async function loadControl(db: Admin, conversationId: string): Promise<ControlRow | null> {
  const { data } = await db
    .from("conversation_control")
    .select("*")
    .eq("conversation_id", conversationId)
    .maybeSingle();
  return data ?? null;
}

/* ----------------------------- pressão acumulada --------------------------- */

export async function refreshPressure(
  db: Admin,
  userId: string,
  conversationId: string,
): Promise<{ score: number; factors: Record<string, number> }> {
  const since = new Date(Date.now() - 7 * DAY_MS).toISOString();

  const [{ data: outbound }, { data: inbound }, { data: commitments }] = await Promise.all([
    db
      .from("messages")
      .select("id, message_type, sent_at")
      .eq("conversation_id", conversationId)
      .eq("direction", "outbound")
      .gte("sent_at", since)
      .order("sent_at", { ascending: false }),
    db
      .from("messages")
      .select("id, text_content, sent_at")
      .eq("conversation_id", conversationId)
      .eq("direction", "inbound")
      .gte("sent_at", since)
      .order("sent_at", { ascending: false })
      .limit(10),
    db
      .from("commitments")
      .select("id")
      .eq("conversation_id", conversationId)
      .eq("responsible", "customer")
      .eq("status", "pending")
      .limit(1),
  ]);

  const outboundRows = outbound ?? [];
  const lastOutbound = outboundRows[0]?.sent_at ?? null;
  const lastInboundAt = inbound?.[0]?.sent_at ?? null;

  const unanswered = lastInboundAt
    ? outboundRows.filter((row) => row.sent_at > lastInboundAt).length
    : outboundRows.length;

  const negativeSignals = (inbound ?? []).filter((row) => {
    const text = row.text_content ?? "";
    return text.trim().length > 0 && (text.trim().length <= 6 || detectIrritation(text));
  }).length;

  const pressure = computePressure({
    outboundLast7d: outboundRows.length,
    unansweredAttempts: unanswered,
    audioLast7d: outboundRows.filter((row) => row.message_type === "audio").length,
    hoursSinceLastOutbound: lastOutbound
      ? (Date.now() - new Date(lastOutbound).getTime()) / 3_600_000
      : null,
    hasPendingCustomerCommitment: (commitments ?? []).length > 0,
    negativeSignals,
  });

  await db
    .from("conversation_control")
    .update({
      pressure_score: pressure.score,
      pressure_factors: pressure.factors as unknown as Json,
    })
    .eq("conversation_id", conversationId);

  void userId;
  return pressure;
}

/* -------------------------- intervenção humana ---------------------------- */

/**
 * Mensagem manual do consultor (texto, áudio, imagem ou documento).
 * Chamado server-side pela camada de WhatsApp, tanto no envio pelo app quanto
 * na ingestão de mensagens outbound vindas do webhook (celular do consultor).
 */
export async function registerHumanIntervention(
  db: Admin,
  input: {
    userId: string;
    conversationId: string;
    contactId?: string | null;
    messageId?: string | null;
    text?: string | null;
    messageType?: string;
    at?: string;
  },
): Promise<void> {
  const at = input.at ?? new Date().toISOString();
  await ensureControl(db, input.userId, input.conversationId);

  await patchControl(db, input.conversationId, {
    owner: "human",
    state: "human_controlled",
    next_responsible: "customer",
    next_responsible_reason: "Você acabou de falar com o cliente.",
    last_human_message_at: at,
    decision_reason: "Intervenção humana: automação suspensa nesta conversa.",
  });

  /* Ações inteligentes preparadas antes desta mensagem ficam obsoletas.
     Fluxos clássicos não são tocados: o comportamento deles permanece igual. */
  const { data: stale } = await db
    .from("scheduled_actions")
    .update({
      status: "stale",
      decision_reason: "Cancelada porque você enviou uma mensagem manual.",
      last_error: "human_intervention",
    })
    .eq("conversation_id", input.conversationId)
    .in("status", ["scheduled", "needs_approval"])
    .not("smart_strategy", "is", null)
    .select("id");

  // Smart runs entram em modo observação; o clássico segue intacto.
  const { data: runs } = await db
    .from("followup_runs")
    .select("id, flow_id, followup_flows!inner(kind)")
    .eq("conversation_id", input.conversationId)
    .eq("status", "active")
    .eq("followup_flows.kind", "smart");

  const cooldown = humanCooldownUntil(new Date(at));
  for (const run of runs ?? []) {
    await db
      .from("followup_runs")
      .update({
        smart_state: "human_active",
        next_evaluation_at: cooldown.toISOString(),
      })
      .eq("id", run.id);
  }

  await refreshPressure(db, input.userId, input.conversationId);

  await writeAudit(db, input.userId, {
    action: "smart_human_intervention",
    summary: "Mensagem manual detectada: automação inteligente suspensa nesta conversa.",
    entityType: "conversation",
    entityId: input.conversationId,
    actor: "system",
    severity: (stale ?? []).length > 0 ? "warning" : "info",
    metadata: {
      stale_actions: (stale ?? []).length,
      smart_runs_paused: (runs ?? []).length,
      message_type: input.messageType ?? "text",
    },
  });

  if ((stale ?? []).length > 0 && input.contactId) {
    await logEvent(db, input.userId, {
      event_type: "smart_action_stale",
      contact_id: input.contactId,
      metadata: {
        conversation_id: input.conversationId,
        reason: "human_intervention",
        actions: (stale ?? []).length,
      },
    });
  }
}

/* ------------------------------ mensagem do cliente ----------------------- */

/**
 * Mensagem real recebida do cliente. Atualiza quem está com a bola, marca
 * áudio sem transcrição e agenda a reavaliação do Smart Flow (debounce curto
 * para agrupar mensagens em sequência).
 */
export async function registerCustomerMessage(
  db: Admin,
  input: {
    userId: string;
    conversationId: string;
    contactId?: string | null;
    messageId?: string | null;
    text?: string | null;
    messageType: string;
    at: string;
  },
): Promise<void> {
  await ensureControl(db, input.userId, input.conversationId);

  const closing = detectClosingSignal(input.text ?? null);
  const irritated = detectIrritation(input.text ?? null);
  const audioWithoutText = input.messageType === "audio" && !(input.text ?? "").trim();

  const state: ControlState = closing || irritated ? "waiting_human" : "waiting_human";
  const nextResponsible: NextResponsible = "human";

  await patchControl(db, input.conversationId, {
    state,
    next_responsible: nextResponsible,
    next_responsible_reason: closing
      ? "Cliente demonstrou intenção de fechar."
      : irritated
        ? "Cliente demonstrou incômodo: atenda pessoalmente."
        : "Cliente respondeu e espera retorno.",
    last_inbound_at: input.at,
    ...(audioWithoutText ? { audio_context_unknown: true } : {}),
    ...(closing ? { buying_stage: "closing" as const } : {}),
    ...(input.messageId ? { last_analyzed_message_id: input.messageId } : {}),
  });

  await refreshPressure(db, input.userId, input.conversationId);

  // Compromissos declarados pelo cliente.
  const { extractAndStoreCommitments } = await import("./commitments.server");
  await extractAndStoreCommitments(db, {
    userId: input.userId,
    conversationId: input.conversationId,
    contactId: input.contactId ?? null,
    messageId: input.messageId ?? null,
    text: input.text ?? null,
    direction: "inbound",
  });

  // Debounce: mensagens em sequência levam a uma única reavaliação.
  const { data: runs } = await db
    .from("followup_runs")
    .select("id, followup_flows!inner(kind)")
    .eq("conversation_id", input.conversationId)
    .in("status", ["active", "paused"])
    .eq("followup_flows.kind", "smart");

  const criticalNow = closing || irritated;
  const nextEval = new Date(Date.now() + (criticalNow ? 0 : 3 * 60_000)).toISOString();

  for (const run of runs ?? []) {
    await db
      .from("followup_runs")
      .update({
        smart_state: closing ? "closing" : irritated ? "needs_human" : "waiting_decision",
        next_evaluation_at: nextEval,
        ...(irritated || closing ? { status: "paused", paused_at: new Date().toISOString() } : {}),
      })
      .eq("id", run.id);
  }

  if (audioWithoutText) {
    await writeAudit(db, input.userId, {
      action: "smart_audio_context_unknown",
      summary: "Áudio recebido sem transcrição: decisões automáticas de risco ficam suspensas.",
      entityType: "conversation",
      entityId: input.conversationId,
      actor: "system",
      severity: "warning",
      metadata: { message_id: input.messageId ?? null },
    });
  }

  if (closing || irritated) {
    await writeAudit(db, input.userId, {
      action: closing ? "smart_closing_detected" : "smart_irritation_detected",
      summary: closing
        ? "Sinal de fechamento detectado: acompanhamento genérico interrompido."
        : "Incômodo detectado: Smart Flow suspenso e entregue a você.",
      entityType: "conversation",
      entityId: input.conversationId,
      actor: "system",
      severity: closing ? "info" : "warning",
      metadata: {},
    });
  }
}

/* ------------------------------ transferências ---------------------------- */

export async function setOwner(
  db: Admin,
  userId: string,
  conversationId: string,
  owner: ControlOwner,
  reason: string,
): Promise<void> {
  await ensureControl(db, userId, conversationId);
  await patchControl(db, conversationId, {
    owner,
    state: owner === "human" ? "human_controlled" : owner === "ai" ? "ai_controlled" : "waiting_customer",
    decision_reason: reason,
  });
  await writeAudit(db, userId, {
    action: "smart_owner_changed",
    summary: `Controle da conversa alterado para ${owner === "human" ? "você" : owner === "ai" ? "automação" : "ninguém"}.`,
    entityType: "conversation",
    entityId: conversationId,
    metadata: { owner, reason },
  });
}
