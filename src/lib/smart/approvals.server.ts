/**
 * Smart Flow — aprovação humana das ações inteligentes.
 *
 * Nada é enviado direto daqui: aprovar apenas devolve a ação ao scheduler,
 * que ainda executa o pré-check contextual antes do envio real.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { writeAudit } from "@/lib/audit/log.server";
import type { Database } from "@/integrations/supabase/types";

type Client = SupabaseClient<Database>;

export class SmartApprovalError extends Error {}

async function loadAction(db: Client, userId: string, actionId: string) {
  const { data } = await db
    .from("scheduled_actions")
    .select("id, status, content, conversation_id, contact_id, smart_strategy")
    .eq("id", actionId)
    .eq("user_id", userId)
    .maybeSingle();
  return data;
}

export async function approveSmartAction(
  db: Client,
  userId: string,
  input: { actionId: string; content?: string | null },
): Promise<void> {
  const action = await loadAction(db, userId, input.actionId);
  if (!action) throw new SmartApprovalError("Ação não encontrada.");
  if (!["needs_approval", "stale"].includes(action.status)) {
    throw new SmartApprovalError("Esta ação não está aguardando aprovação.");
  }

  const edited = input.content && input.content !== action.content;

  const { error } = await db
    .from("scheduled_actions")
    .update({
      status: "scheduled",
      requires_approval: false,
      content: input.content ?? action.content,
      // Liberada agora: o pré-check ainda roda antes do envio.
      scheduled_for: new Date().toISOString(),
      last_error: null,
    })
    .eq("id", action.id)
    .eq("user_id", userId)
    .in("status", ["needs_approval", "stale"]);
  if (error) throw new SmartApprovalError(error.message);

  await writeAudit(db, userId, {
    action: "smart_action_approved",
    summary: edited
      ? "Mensagem inteligente editada e aprovada para envio."
      : "Mensagem inteligente aprovada para envio.",
    entityType: "scheduled_action",
    entityId: action.id,
    metadata: { strategy: action.smart_strategy, edited: Boolean(edited) },
  });
}

export async function rejectSmartAction(
  db: Client,
  userId: string,
  input: { actionId: string },
): Promise<void> {
  const action = await loadAction(db, userId, input.actionId);
  if (!action) throw new SmartApprovalError("Ação não encontrada.");

  const { error } = await db
    .from("scheduled_actions")
    .update({ status: "cancelled", requires_approval: false })
    .eq("id", action.id)
    .eq("user_id", userId)
    .in("status", ["needs_approval", "stale", "scheduled"]);
  if (error) throw new SmartApprovalError(error.message);

  await writeAudit(db, userId, {
    action: "smart_action_rejected",
    summary: "Mensagem inteligente descartada pelo usuário.",
    entityType: "scheduled_action",
    entityId: action.id,
    metadata: { strategy: action.smart_strategy },
  });
}
