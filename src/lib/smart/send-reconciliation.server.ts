import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { recordPostQuoteAccepted } from "./post-quote-runtime.server";
/** Durable local message receipt; without a confirmed receipt never retry. */
export async function reconcileSmartSends(db: SupabaseClient<Database>) {
  const { data: actions, error } = await db
    .from("scheduled_actions")
    .select("*")
    .not("logical_contact", "is", null)
    .in("status", ["processing", "blocked"])
    .in("send_state", ["started", "uncertain", "accepted"])
    .lt("send_started_at", new Date(Date.now() - 60_000).toISOString())
    .limit(25);
  if (error) throw new Error(error.message);
  for (const action of actions ?? []) {
    const { data: message } = action.message_id
      ? await db
          .from("messages")
          .select("id,status,sent_at,external_message_id")
          .eq("id", action.message_id)
          .eq("user_id", action.user_id)
          .single()
      : { data: null };
    if (message && ["sent", "delivered", "read"].includes(message.status)) {
      await recordPostQuoteAccepted(db, action, message.id, new Date(message.sent_at));
    } else {
      await db
        .from("scheduled_actions")
        .update({
          status: "blocked",
          send_state: "uncertain",
          last_error: "send_result_uncertain",
          decision_reason: "Sem confirmação do provedor; reenvio automático suspenso.",
        })
        .eq("id", action.id);
      await db
        .from("followup_runs")
        .update({
          next_contact_responsible: "human",
          next_contact_reason: "Confirmação de envio pendente; não reenviar.",
          next_evaluation_at: null,
        })
        .eq("id", action.flow_run_id ?? "");
    }
  }
}
