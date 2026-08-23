import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import { writeAudit } from "@/lib/audit/log.server";

type Client = SupabaseClient<Database>;

export interface RecoveryResult {
  ok: true;
  message: string;
}

/** Reenvia uma mensagem de texto que falhou, mantendo o histórico da falha. */
export async function retryFailedMessage(
  client: Client,
  userId: string,
  messageId: string,
): Promise<RecoveryResult> {
  const { data: message, error } = await client
    .from("messages")
    .select("id, conversation_id, text_content, message_type, status")
    .eq("id", messageId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!message) throw new Error("Mensagem não encontrada.");
  if (message.status !== "failed")
    throw new Error("Só é possível reenviar mensagens que falharam.");
  if (message.message_type !== "text" || !message.text_content) {
    throw new Error(
      "Só é possível reenviar mensagens de texto. Envie o arquivo novamente na conversa.",
    );
  }

  const { sendText } = await import("@/lib/whatsapp/service.server");
  await sendText(userId, {
    conversationId: message.conversation_id,
    text: message.text_content,
  });

  await writeAudit(client, userId, {
    action: "message_retried",
    summary: "Mensagem que havia falhado foi reenviada.",
    entityType: "message",
    entityId: message.id,
    severity: "warning",
  });

  return { ok: true, message: "Mensagem reenviada." };
}

/** Devolve uma ação agendada travada/falha para a fila, sem duplicar envio. */
export async function retryScheduledAction(
  client: Client,
  userId: string,
  actionId: string,
): Promise<RecoveryResult> {
  const { data: action, error } = await client
    .from("scheduled_actions")
    .select("id, status")
    .eq("id", actionId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!action) throw new Error("Ação não encontrada.");
  if (!["failed", "processing", "blocked", "skipped"].includes(action.status)) {
    throw new Error("Esta ação não está pendente de reprocessamento.");
  }

  const { error: updateError } = await client
    .from("scheduled_actions")
    .update({
      status: "scheduled",
      scheduled_for: new Date().toISOString(),
      attempts: 0,
      last_error: null,
    })
    .eq("id", actionId);
  if (updateError) throw new Error(updateError.message);

  await writeAudit(client, userId, {
    action: "scheduled_action_retried",
    summary: "Ação agendada devolvida à fila para nova tentativa.",
    entityType: "scheduled_action",
    entityId: actionId,
    severity: "warning",
    metadata: { previous_status: action.status },
  });

  return { ok: true, message: "Ação recolocada na fila." };
}

/** Cancela definitivamente uma ação agendada travada. */
export async function cancelScheduledAction(
  client: Client,
  userId: string,
  actionId: string,
): Promise<RecoveryResult> {
  const { error } = await client
    .from("scheduled_actions")
    .update({ status: "cancelled", last_error: "Cancelada manualmente" })
    .eq("id", actionId)
    .in("status", ["scheduled", "processing", "failed", "blocked", "skipped"]);
  if (error) throw new Error(error.message);

  await writeAudit(client, userId, {
    action: "scheduled_action_cancelled",
    summary: "Ação agendada cancelada manualmente.",
    entityType: "scheduled_action",
    entityId: actionId,
  });

  return { ok: true, message: "Ação cancelada." };
}

/** Recoloca uma análise de IA na fila. */
export async function retryAnalysisJob(
  client: Client,
  userId: string,
  jobId: string,
): Promise<RecoveryResult> {
  const { error } = await client
    .from("ai_analysis_jobs")
    .update({ status: "pending", attempts: 0, claimed_at: null, last_error: null })
    .eq("id", jobId)
    .in("status", ["failed", "processing"]);
  if (error) throw new Error(error.message);

  await writeAudit(client, userId, {
    action: "ai_analysis_retried",
    summary: "Análise de conversa recolocada na fila.",
    entityType: "ai_analysis_job",
    entityId: jobId,
    severity: "warning",
  });

  return { ok: true, message: "Análise recolocada na fila." };
}
