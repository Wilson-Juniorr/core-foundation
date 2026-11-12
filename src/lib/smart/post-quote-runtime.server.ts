import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  isPostQuoteManuallyPaused,
  nextSilenceContact,
  POST_QUOTE_FLOW_NAME,
  POST_QUOTE_MANUAL_PAUSE,
  POST_QUOTE_MANUAL_PAUSE_LABEL,
  POST_QUOTE_POLICY,
} from "./post-quote-cadence";
import { ensureControl, loadControl, patchControl } from "./control.server";
import { pendingCommitments } from "./commitments.server";
import { applyCustomerOptOut } from "@/lib/automation/optout.server";
import { messageContextText } from "@/lib/whatsapp/message-context";
import {
  POST_QUOTE_HISTORY_REQUIRED,
  POST_QUOTE_NOTE_MIN,
  POST_QUOTE_NOTE_MAX,
} from "./post-quote-history";
import {
  hasPostQuoteHistory,
  loadPostQuoteMessages,
  optOutInHistory,
  recoverPostQuoteMessages,
} from "./post-quote-history.server";
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
  const { data: accepted, error: failure } = await db.rpc("accept_post_quote_contact", {
    p_action: action.id,
    p_message: messageId,
    p_at: acceptedAt.toISOString(),
    p_next: (next?.at.toISOString() ?? null) as unknown as string,
    p_reason: next?.goal ?? "Ciclo de oito contatos concluído; oportunidade preservada.",
  });
  if (failure) throw new Error(failure.message);
  if (accepted && action.context_version !== null) {
    // Só consome a aprovação da versão aceita, mesmo quando o recibo chega depois.
    await db
      .from("conversation_control")
      .update({ force_approval_next: false })
      .eq("conversation_id", action.conversation_id)
      .eq("context_version", action.context_version);
  }
}

export async function activatePostQuote(
  db: Db,
  userId: string,
  contactId: string,
  opportunityId: string,
  options: {
    contextNote?: string | undefined;
    recoverRunId?: string | undefined;
    lookupOnly?: boolean | undefined;
  } = {},
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
  const { data: live, error: liveError } = await db
    .from("followup_runs")
    .select("id,conversation_id,policy_key,opportunity_id,status,next_contact_reason")
    .eq("contact_id", contactId)
    .eq("user_id", userId)
    .in("status", ["active", "paused"])
    .limit(1)
    .maybeSingle();
  if (liveError) throw new Error(liveError.message);
  if (
    options.recoverRunId &&
    (!live ||
      live.id !== options.recoverRunId ||
      live.policy_key !== POST_QUOTE_POLICY ||
      live.opportunity_id !== opportunityId ||
      live.status !== "active" ||
      live.next_contact_reason !== POST_QUOTE_HISTORY_REQUIRED)
  )
    throw new Error("Este ciclo não está aguardando a recuperação do histórico.");
  if (live && !options.recoverRunId)
    throw new Error("Já existe um acompanhamento ativo ou pausado; nada foi alterado.");
  const contextNote = options.contextNote?.trim() || null;
  if (
    contextNote &&
    (contextNote.length < POST_QUOTE_NOTE_MIN || contextNote.length > POST_QUOTE_NOTE_MAX)
  )
    throw new Error("Registre o que enviou na cotação e o que ficou combinado.");
  const { ensureConversationForContact } = await import("@/lib/whatsapp/link.server");
  const conversationId =
    live?.conversation_id ??
    (await ensureConversationForContact(userId, contactId, { importHistory: false }))
      .conversationId;
  const scope = { userId, contactId, conversationId };
  let messages = await loadPostQuoteMessages(db, scope);
  let imported = false;
  if (!contextNote && !hasPostQuoteHistory(messages)) {
    const sync = await recoverPostQuoteMessages(db, scope, !options.lookupOnly);
    imported = sync === "imported" || sync === "requested";
    messages = await loadPostQuoteMessages(db, scope);
    if (!hasPostQuoteHistory(messages) && !optOutInHistory(messages))
      return { status: "history_required" as const, sync };
  }
  const optOut = optOutInHistory(messages);
  if (optOut) {
    await applyCustomerOptOut(db, { ...scope, quote: messageContextText(optOut) ?? "" });
    throw new Error("O cliente pediu para parar no WhatsApp. Pós-cotação bloqueado.");
  }
  if (imported) {
    await ensureControl(db, userId, conversationId);
    await patchControl(db, conversationId, { force_approval_next: true });
  }
  if (live) {
    const { data: updated, error } = await db
      .from("followup_runs")
      .update({
        ...(contextNote ? { post_quote_context_note: contextNote } : {}),
        smart_state: "evaluating",
        next_evaluation_at: new Date().toISOString(),
        next_contact_responsible: "system",
        next_contact_reason: contextNote
          ? "Resumo registrado. O próximo envio exige aprovação."
          : "Histórico disponível. Reavaliando o próximo contato.",
      })
      .eq("id", live.id)
      .eq("user_id", userId)
      .eq("status", "active")
      .eq("next_contact_reason", POST_QUOTE_HISTORY_REQUIRED)
      .select("id")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!updated) throw new Error("O ciclo mudou. Atualize a ficha antes de continuar.");
    await enqueuePostQuoteHistory(db, scope);
    return { status: "recovered" as const, contextNote: Boolean(contextNote), imported };
  }
  // A dedicated policy flow avoids borrowing unrelated strategies/settings.
  const { data: flows } = await db
    .from("followup_flows")
    .select("id")
    .eq("user_id", userId)
    .eq("name", POST_QUOTE_FLOW_NAME)
    .eq("kind", "smart")
    .eq("is_active", true)
    .limit(1);
  let flowId = flows?.[0]?.id;
  if (!flowId) {
    const { saveSmartFlow } = await import("./flows.server");
    const saved = await saveSmartFlow(db, userId, {
      name: POST_QUOTE_FLOW_NAME,
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
  const result = await startSmartFlow(db, userId, {
    flowId,
    contactId,
    conversationId,
    opportunityId,
    policyKey: POST_QUOTE_POLICY,
    ...(contextNote ? { postQuoteContextNote: contextNote } : {}),
  });
  await enqueuePostQuoteHistory(db, scope);
  return { status: "activated" as const, contextNote: Boolean(contextNote), imported, ...result };
}

async function enqueuePostQuoteHistory(
  db: Db,
  scope: { userId: string; contactId: string; conversationId: string },
) {
  try {
    const { enqueueAnalysis } = await import("@/lib/ai/analysis.server");
    await enqueueAnalysis(db, {
      ...scope,
      reason: "post_quote_history",
    });
  } catch (error) {
    console.error(
      "post_quote_history_enqueue_failed",
      error instanceof Error ? error.name : "unknown",
    );
  }
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
    ? POST_QUOTE_MANUAL_PAUSE_LABEL
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
      stop_reason: ended ? "manually_cancelled" : paused ? POST_QUOTE_MANUAL_PAUSE : null,
      ...(ended
        ? { smart_state: "completed", stopped_at: new Date().toISOString() }
        : !paused && isPostQuoteManuallyPaused(run)
          ? { smart_state: "evaluating" }
          : {}),
    })
    .eq("id", run.id);
  if (error) throw new Error(error.message);
  await db
    .from("opportunities")
    .update({
      post_quote_run_id: run.id,
      post_quote_next_at: paused || ended ? null : next,
      post_quote_next_reason: reason,
    })
    .eq("id", run.opportunity_id ?? "")
    .eq("user_id", userId);
  await patchControl(
    db,
    run.conversation_id,
    { decision_reason: reason },
    { bumpVersion: input.command !== "resume" },
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
    throw new Error(
      `Confirmação insuficiente; a tentativa segue bloqueada. ${UNCERTAIN_CHECKLIST}`,
    );
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
