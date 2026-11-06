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
    p_next: next?.at.toISOString() ?? null,
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
  const { data: flows } = await db
    .from("followup_flows")
    .select("id")
    .eq("user_id", userId)
    .eq("kind", "smart")
    .eq("is_active", true)
    .order("created_at")
    .limit(1);
  const flow = flows?.[0];
  if (!flow) throw new Error("Crie um fluxo inteligente ativo antes de ativar o pós-cotação.");
  const { startSmartFlow } = await import("./engine.server");
  return startSmartFlow(db, userId, {
    flowId: flow.id,
    contactId,
    conversationId,
    opportunityId,
    policyKey: POST_QUOTE_POLICY,
  });
}

export async function controlPostQuote(
  db: Db,
  userId: string,
  input: { runId: string; command: "pause" | "resume" | "reschedule" | "end"; at?: string },
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
  if (input.command === "reschedule") {
    const { isBusinessDay } = await import("./business-calendar");
    if (!isBusinessDay(at)) throw new Error("Escolha um dia útil.");
  }
  const paused = input.command === "pause",
    ended = input.command === "end";
  await db
    .from("scheduled_actions")
    .update({ status: "cancelled", last_error: `post_quote_${input.command}` })
    .eq("flow_run_id", run.id)
    .in("status", ["scheduled", "needs_approval", "stale", "blocked"])
    .or("send_state.is.null,send_state.neq.uncertain");
  const next = paused || ended ? null : at.toISOString();
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
      next_evaluation_at: next,
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
