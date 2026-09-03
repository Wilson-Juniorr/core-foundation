/**
 * Smart Flow — compromissos assumidos na conversa.
 *
 * Um compromisso pendente é uma barreira: o Smart Flow não fala por cima de
 * "me chama sexta" nem assume no lugar do consultor um retorno que ele prometeu.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import { logEvent } from "@/lib/crm.server";
import { writeAudit } from "@/lib/audit/log.server";
import { extractCommitments } from "./rules";
import type { CommitmentResponsible } from "./types";

type Admin = SupabaseClient<Database>;
type CommitmentRow = Database["public"]["Tables"]["commitments"]["Row"];

export async function extractAndStoreCommitments(
  db: Admin,
  input: {
    userId: string;
    conversationId: string;
    contactId: string | null;
    opportunityId?: string | null;
    messageId: string | null;
    text: string | null;
    direction: "inbound" | "outbound";
  },
): Promise<CommitmentRow[]> {
  const found = extractCommitments({
    text: input.text,
    direction: input.direction,
    now: new Date(),
  });
  if (found.length === 0) return [];

  const created: CommitmentRow[] = [];

  for (const item of found) {
    const { data, error } = await db
      .from("commitments")
      .insert({
        user_id: input.userId,
        conversation_id: input.conversationId,
        contact_id: input.contactId,
        opportunity_id: input.opportunityId ?? null,
        commitment_type: item.commitment_type,
        responsible: item.responsible,
        description: item.description,
        due_at: item.due_at,
        due_window_end: item.due_window_end,
        is_ambiguous: item.is_ambiguous,
        confidence: item.confidence,
        source_message_id: input.messageId,
        source: "ai",
        dedupe_key: item.dedupe_key,
      })
      .select("*")
      .maybeSingle();

    // 23505 = mesmo compromisso já registrado nesta conversa.
    if (error && error.code !== "23505") continue;
    if (data) created.push(data);
  }

  for (const commitment of created) {
    await writeAudit(db, input.userId, {
      action: "smart_commitment_created",
      summary: `Compromisso registrado: ${commitment.description}`,
      entityType: "commitment",
      entityId: commitment.id,
      actor: "system",
      metadata: {
        responsible: commitment.responsible,
        due_at: commitment.due_at,
        ambiguous: commitment.is_ambiguous,
      },
    });
    if (input.contactId) {
      await logEvent(db, input.userId, {
        event_type: "smart_commitment_created",
        contact_id: input.contactId,
        opportunity_id: input.opportunityId ?? null,
        metadata: {
          conversation_id: input.conversationId,
          description: commitment.description,
          responsible: commitment.responsible,
          due_at: commitment.due_at,
        },
      });
    }
  }

  return created;
}

/** Compromissos pendentes que ainda bloqueiam automação nesta conversa. */
export async function pendingCommitments(
  db: Admin,
  conversationId: string,
): Promise<CommitmentRow[]> {
  const { data } = await db
    .from("commitments")
    .select("*")
    .eq("conversation_id", conversationId)
    .eq("status", "pending")
    .order("due_at", { ascending: true, nullsFirst: false });
  return data ?? [];
}

/**
 * Prazo mais restritivo que impede um envio agora. Compromissos ambíguos usam
 * a janela; nunca inventamos horário exato.
 */
export function blockingDeadline(commitments: CommitmentRow[], now: Date): Date | null {
  let deadline: Date | null = null;
  for (const commitment of commitments) {
    const reference = commitment.due_at ?? commitment.due_window_end;
    if (!reference) continue;
    const at = new Date(reference);
    if (at.getTime() <= now.getTime()) continue;
    if (!deadline || at.getTime() < deadline.getTime()) deadline = at;
  }
  return deadline;
}

/** Resposta do cliente cumpre compromissos dele que estavam pendentes. */
export async function fulfillCommitmentsBy(
  db: Admin,
  input: { userId: string; conversationId: string; responsible: CommitmentResponsible },
): Promise<number> {
  const { data } = await db
    .from("commitments")
    .update({ status: "fulfilled" })
    .eq("conversation_id", input.conversationId)
    .eq("responsible", input.responsible)
    .eq("status", "pending")
    .select("id");
  return (data ?? []).length;
}

/** Compromissos vencidos sem cumprimento viram "perdidos" (visibilidade). */
export async function markMissedCommitments(db: Admin, userId: string): Promise<number> {
  const { data } = await db
    .from("commitments")
    .update({ status: "missed" })
    .eq("user_id", userId)
    .eq("status", "pending")
    .lt("due_at", new Date(Date.now() - 12 * 60 * 60_000).toISOString())
    .select("id");
  return (data ?? []).length;
}
