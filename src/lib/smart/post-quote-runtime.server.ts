import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { nextSilenceContact, POST_QUOTE_POLICY } from "./post-quote-cadence";
import { loadControl, patchControl } from "./control.server";
import { pendingCommitments } from "./commitments.server";
type Db = SupabaseClient<Database>;
type Action = Database["public"]["Tables"]["scheduled_actions"]["Row"];

export async function recordPostQuoteAccepted(
  db: Db,
  action: Action,
  messageId: string,
  acceptedAt = new Date(),
) {
  if (!action.flow_run_id || !action.logical_contact) return;
  const { data: run, error } = await db
    .from("followup_runs")
    .select("*")
    .eq("id", action.flow_run_id)
    .single();
  if (error) throw new Error(error.message);
  if (run.policy_key !== POST_QUOTE_POLICY) return;
  const next = nextSilenceContact({
    doneContacts: action.logical_contact,
    activatedAt: new Date(run.policy_activated_at ?? run.started_at),
    lastContactAt: acceptedAt,
  });
  const { error: failure } = await db.rpc("accept_post_quote_contact", {
    p_action: action.id,
    p_message: messageId,
    p_at: acceptedAt.toISOString(),
    p_next: (next?.at.toISOString() ?? null) as unknown as string,
    p_reason: next?.goal ?? "Ciclo de oito contatos concluído; oportunidade preservada.",
  });
  if (failure) throw new Error(failure.message);
}

export async function activatePostQuote(
  db: Db,
  userId: string,
  contactId: string,
  opportunityId: string,
) {
  const { data: contact } = await db
    .from("contacts")
    .select("id")
    .eq("id", contactId)
    .eq("user_id", userId)
    .single();
  const { data: opportunity } = await db
    .from("opportunities")
    .select("id")
    .eq("id", opportunityId)
    .eq("contact_id", contactId)
    .eq("user_id", userId)
    .eq("status", "open")
    .single();
  if (!contact || !opportunity) throw new Error("Selecione uma oportunidade aberta deste cliente.");
  const { data: live } = await db
    .from("followup_runs")
    .select("id")
    .eq("contact_id", contactId)
    .eq("user_id", userId)
    .in("status", ["active", "paused"])
    .limit(1);
  if (live?.length)
    throw new Error("Já existe um acompanhamento ativo ou pausado; nada foi alterado.");
  const { ensureConversationForContact } = await import("@/lib/whatsapp/link.server");
  const { conversationId } = await ensureConversationForContact(userId, contactId);
  // A dedicated policy flow avoids borrowing unrelated strategies/settings.
  const { data: flows } = await db
    .from("followup_flows")
    .select("id")
    .eq("user_id", userId)
    .eq("name", "Pós-cotação · política v1")
    .eq("kind", "smart")
    .eq("is_active", true)
    .limit(1);
  let flowId = flows?.[0]?.id;
  if (!flowId) {
    const { saveSmartFlow } = await import("./flows.server");
    const saved = await saveSmartFlow(db, userId, {
      name: "Pós-cotação · política v1",
      description: "Ciclo explícito de oito contatos",
      is_active: true,
      window_start: "09:00",
      window_end: "19:00",
      goal: "Acompanhar a análise da cotação de plano de saúde; qualquer preço, negociação ou dúvida técnica vai ao consultor.",
      max_duration_days: 180,
      autonomy: "auto",
      allowed_strategies: [
        "LIGHT_FOLLOWUP",
        "VALUE_REINFORCEMENT",
        "QUESTION_DISCOVERY",
        "DECISION_SIMPLIFICATION",
        "FUTURE_CALLBACK",
        "SOFT_CLOSE",
      ],
      allowed_media: ["text"],
      max_pressure: 70,
      min_hours_between_actions: 36,
      max_actions_per_week: 2,
      handoff_situations: ["Preço", "Dúvida técnica"],
      completion_criteria: "Oito contatos aceitos encerram somente o ciclo.",
      confidence_min: 0.6,
    });
    flowId = saved.flowId;
  }
  const { startSmartFlow } = await import("./engine.server");
  return startSmartFlow(db, userId, {
    flowId,
    contactId,
    conversationId,
    opportunityId,
    policyKey: POST_QUOTE_POLICY,
  });
}

export async function controlPostQuote(
  db: Db,
  userId: string,
  input: {
    runId: string;
    command: "pause" | "resume" | "reschedule" | "end";
    at?: string | undefined;
  },
) {
  const { data: run } = await db
    .from("followup_runs")
    .select("*")
    .eq("id", input.runId)
    .eq("user_id", userId)
    .eq("policy_key", POST_QUOTE_POLICY)
    .single();
  if (!run || !["active", "paused"].includes(run.status))
    throw new Error("Ciclo não disponível para alteração.");
  const { data: uncertain } = await db
    .from("scheduled_actions")
    .select("id")
    .eq("flow_run_id", run.id)
    .eq("send_state", "uncertain")
    .limit(1);
  if (uncertain?.length && input.command !== "pause" && input.command !== "end")
    throw new Error(
      "Confirme a tentativa pendente antes de retomar; não haverá reenvio automático.",
    );
  if (input.command === "resume" || input.command === "reschedule") {
    const control = await loadControl(db, run.conversation_id);
    const commitments = await pendingCommitments(db, run.conversation_id);
    if (
      control?.owner === "human" ||
      control?.next_responsible === "human" ||
      commitments.some((c) => c.responsible === "human")
    )
      throw new Error("Você ainda tem uma resposta pendente; envio comercial suspenso.");
  }
  const at = input.at
    ? new Date(input.at)
    : new Date(Math.max(Date.now(), new Date(run.next_contact_at ?? new Date()).getTime()));
  if (!Number.isFinite(at.getTime()) || at.getTime() < Date.now() - 1000)
    throw new Error("Informe uma data futura válida.");
  if (input.command === "reschedule" || input.command === "resume") {
    const { isBusinessDay } = await import("./business-calendar");
    if (!isBusinessDay(at)) throw new Error("Escolha um dia útil.");
    const { makeWindow, mergeWindows, isWithinWindow } = await import("@/lib/followup/time");
    const { data: settings } = await db
      .from("user_settings")
      .select("send_window_start,send_window_end")
      .eq("user_id", userId)
      .maybeSingle();
    const { data: flow } = await db
      .from("followup_flows")
      .select("window_start,window_end")
      .eq("id", run.flow_id)
      .single();
    const window = mergeWindows(
      makeWindow(settings?.send_window_start ?? "09:00", settings?.send_window_end ?? "20:00"),
      makeWindow(flow?.window_start, flow?.window_end),
    );
    if (!isWithinWindow(at, window, "America/Sao_Paulo"))
      throw new Error("Horário fora das janelas permitidas ou janelas incompatíveis.");
    const commitments = await pendingCommitments(db, run.conversation_id);
    if (
      commitments.some((c) => new Date(c.due_at ?? c.due_window_end ?? 0).getTime() > at.getTime())
    )
      throw new Error("O cliente combinou um prazo posterior; preserve o compromisso.");
  }
  const paused = input.command === "pause",
    ended = input.command === "end";
  await db
    .from("scheduled_actions")
    .update({ status: "cancelled", last_error: `post_quote_${input.command}` })
    .eq("flow_run_id", run.id)
    .in("status", ["scheduled", "needs_approval", "stale", "blocked"])
    .or("send_state.is.null,send_state.neq.uncertain");
  const next = ended ? null : paused ? run.next_contact_at : at.toISOString();
  const reason = paused
    ? "Pausado por você."
    : ended
      ? "Encerrado por você."
      : input.command === "reschedule"
        ? "Horário definido por você."
        : "Retomada preservando contatos e compromissos.";
  const { error } = await db
    .from("followup_runs")
    .update({
      status: ended ? "cancelled" : paused ? "paused" : "active",
      paused_at: paused ? new Date().toISOString() : null,
      next_evaluation_at: paused || ended ? null : next,
      next_contact_at: next,
      next_contact_reason: reason,
      next_contact_responsible: paused ? "human" : ended ? "none" : "system",
      stop_reason: ended ? "manually_cancelled" : null,
    })
    .eq("id", run.id);
  if (error) throw new Error(error.message);
  await db
    .from("opportunities")
    .update({ post_quote_run_id: run.id, post_quote_next_at: next, post_quote_next_reason: reason })
    .eq("id", run.opportunity_id ?? "")
    .eq("user_id", userId);
  await patchControl(
    db,
    run.conversation_id,
    { decision_reason: reason },
    { bumpVersion: input.command === "reschedule" },
  );
}

/** What the consultant must check before resolving an uncertain attempt. */
export const UNCERTAIN_CHECKLIST =
  "Abra o WhatsApp do número conectado, entre na conversa deste cliente e confira se a mensagem abaixo aparece como enviada (um ou dois tiques) no horário da tentativa.";

/**
 * Auditable manual resolution of an uncertain send. Requires a written note of
 * what was checked; without it the action stays blocked. "not_delivered" never
 * resends by itself — it only frees the cycle so you can reschedule explicitly.
 */
export async function resolveUncertainSend(
  db: Db,
  userId: string,
  input: { actionId: string; outcome: "delivered" | "not_delivered"; evidence: string },
) {
  const evidence = input.evidence.trim();
  if (evidence.length < 15)
    throw new Error(`Confirmação insuficiente; a tentativa segue bloqueada. ${UNCERTAIN_CHECKLIST}`);
  const { data: action } = await db
    .from("scheduled_actions")
    .select("*")
    .eq("id", input.actionId)
    .eq("user_id", userId)
    .single();
  if (!action || action.send_state !== "uncertain")
    throw new Error("Não há tentativa incerta para resolver.");
  const { writeAudit } = await import("@/lib/audit/log.server");
  if (input.outcome === "delivered") {
    await recordPostQuoteAccepted(
      db,
      action,
      action.message_id as string,
      new Date(action.send_started_at ?? Date.now()),
    );
  } else {
    await db
      .from("scheduled_actions")
      .update({
        status: "failed",
        send_state: "rejected",
        last_error: "uncertain_resolved_not_delivered",
        decision_reason: `Você confirmou que não chegou: ${evidence}`,
      })
      .eq("id", action.id)
      .eq("send_state", "uncertain");
    await db
      .from("followup_runs")
      .update({
        status: "paused",
        paused_at: new Date().toISOString(),
        next_evaluation_at: null,
        next_contact_responsible: "human",
        next_contact_reason: `Contato ${action.logical_contact} não chegou; reagende para tentar de novo.`,
      })
      .eq("id", action.flow_run_id ?? "");
  }
  await writeAudit(db, userId, {
    action: "post_quote_uncertain_resolved",
    summary:
      input.outcome === "delivered"
        ? "Tentativa incerta confirmada como entregue pelo consultor."
        : "Tentativa incerta confirmada como não entregue pelo consultor.",
    entityType: "scheduled_action",
    entityId: action.id,
    actor: "user",
    metadata: { outcome: input.outcome, evidence, logical_contact: action.logical_contact },
  });
}

/** Consultant reviewed an unreadable date: clears the barrier, run stays paused for an explicit reschedule. */
export async function resolveDateReview(
  db: Db,
  userId: string,
  input: { commitmentId: string; note: string },
) {
  const { data: item } = await db
    .from("commitments")
    .update({ status: "cancelled" })
    .eq("id", input.commitmentId)
    .eq("user_id", userId)
    .eq("commitment_type", "date_review")
    .eq("status", "pending")
    .select("*")
    .maybeSingle();
  if (!item) throw new Error("Revisão não encontrada ou já resolvida.");
  if (item.conversation_id) {
    const rest = await pendingCommitments(db, item.conversation_id);
    if (!rest.some((c) => c.responsible === "human"))
      await patchControl(db, item.conversation_id, {
        owner: "ai",
        next_responsible: "customer",
        next_responsible_reason: "Data revisada por você; defina o próximo contato.",
      });
  }
  const { writeAudit } = await import("@/lib/audit/log.server");
  await writeAudit(db, userId, {
    action: "post_quote_date_reviewed",
    summary: `Data revisada: ${item.description}`,
    entityType: "commitment",
    entityId: item.id,
    actor: "user",
    metadata: { note: input.note },
  });
}
