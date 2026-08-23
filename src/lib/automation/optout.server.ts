import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import { logEvent } from "@/lib/crm.server";
import { recordDecision } from "./audit.server";

type Admin = SupabaseClient<Database>;

/** Pedidos explícitos de parada. Mantidos conservadores para evitar falso positivo. */
const OPT_OUT_PATTERNS: RegExp[] = [
  /n[ãa]o\s+quero\s+mais\s+(receber|mensagens|nada)/i,
  /n[ãa]o\s+(me\s+)?(mande|envie|manda|envia)\s+mais/i,
  /pa?re?\s+de\s+me\s+(mandar|enviar|chamar)/i,
  /me\s+(tira|remove|retire|exclua)\s+(da|dessa|desta)\s+lista/i,
  /descadastr/i,
  /sair\s+da\s+lista/i,
  /me\s+deixe?\s+em\s+paz/i,
  /n[ãa]o\s+tenho\s+interesse\s+(nenhum|mais)/i,
];

export function detectOptOut(text: string | null | undefined): boolean {
  if (!text) return false;
  const clean = text.trim();
  if (clean.length < 4) return false;
  return OPT_OUT_PATTERNS.some((pattern) => pattern.test(clean));
}

export interface OptOutInput {
  userId: string;
  contactId: string;
  conversationId: string;
  quote: string;
}

/**
 * Registra o opt-out do cliente, interrompe automações em andamento e deixa o
 * pedido visível no histórico. Sempre irreversível por automação: só um humano
 * pode reabrir.
 */
export async function applyCustomerOptOut(db: Admin, input: OptOutInput): Promise<void> {
  const reason = input.quote.slice(0, 240);

  const { error } = await db.from("contact_preferences").upsert(
    {
      contact_id: input.contactId,
      user_id: input.userId,
      automation_allowed: false,
      do_not_contact: true,
      do_not_contact_reason: reason,
      do_not_contact_source: "customer",
    },
    { onConflict: "contact_id" },
  );
  if (error) {
    console.error("opt_out_upsert_failed", error.message);
    return;
  }

  await db
    .from("customer_memory")
    .update({ do_not_contact: true })
    .eq("user_id", input.userId)
    .eq("contact_id", input.contactId);

  const nowIso = new Date().toISOString();

  await db
    .from("scheduled_actions")
    .update({ status: "cancelled", last_error: "customer_opt_out" })
    .eq("conversation_id", input.conversationId)
    .eq("status", "scheduled");

  await db
    .from("followup_runs")
    .update({ status: "stopped", stopped_at: nowIso, stop_reason: "customer_opt_out" })
    .eq("conversation_id", input.conversationId)
    .in("status", ["active", "paused"]);

  const { writeAudit } = await import("@/lib/audit/log.server");
  await writeAudit(db, input.userId, {
    action: "opt_out_applied",
    summary: "Cliente pediu para não receber mensagens: automações interrompidas.",
    entityType: "contact",
    entityId: input.contactId,
    actor: "system",
    severity: "warning",
  });

  await logEvent(db as never, input.userId, {
    event_type: "customer_opt_out",
    contact_id: input.contactId,
    metadata: { conversation_id: input.conversationId, quote: reason },
  });

  await recordDecision(db, {
    userId: input.userId,
    decision: "blocked",
    blockedBy: "contact_opt_out",
    reason: `Cliente pediu para não receber mensagens: ${reason}`,
    contactId: input.contactId,
    conversationId: input.conversationId,
    rules: [
      {
        rule: "contact_opt_out",
        label: "Cliente pediu para não receber mensagens",
        passed: false,
        detail: reason,
      },
    ],
  });
}
