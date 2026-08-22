import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import { completeStructured } from "@/lib/ai/gateway.server";
import { mapItem } from "./store.server";
import { NEXT_ACTION_KINDS, type AttentionItem } from "./types";

type Client = SupabaseClient<Database>;

const MODEL = "google/gemini-3.7-flash";
const PROMPT_VERSION = "nba-1";

const SYSTEM = `Você é o copiloto comercial de um vendedor brasileiro.
Receberá um item da Central de Atenção com dados reais do CRM.
Sua tarefa: recomendar a PRÓXIMA MELHOR AÇÃO do vendedor.

Regras rígidas:
- Nunca invente fatos comerciais (preços, prazos, condições) que não estejam no contexto.
- A prioridade já foi calculada por regras: não a contradiga.
- Se faltar informação, recomende a ação que obtém essa informação.
- Ações sensíveis (desconto, fechamento, promessa) sempre exigem decisão humana: recomende, nunca afirme que será feito automaticamente.
- Responda em português do Brasil, direto, em no máximo 2 frases.`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["action_kind", "recommendation"],
  properties: {
    action_kind: { type: "string", enum: [...NEXT_ACTION_KINDS] },
    recommendation: { type: "string" },
  },
};

/**
 * Sugestão de próxima ação. É apenas recomendação: nada é executado aqui.
 */
export async function suggestNextBestAction(
  db: Client,
  userId: string,
  itemId: string,
): Promise<AttentionItem> {
  const { data: row, error } = await db
    .from("attention_items")
    .select("*, contacts(name)")
    .eq("id", itemId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!row) throw new Error("Item de atenção não encontrado.");

  const [memoryResult, opportunityResult, messagesResult] = await Promise.all([
    row.contact_id
      ? db
          .from("customer_memory")
          .select(
            "current_summary, customer_intent, interest_level, sentiment, main_objections, pending_information, seller_commitments, next_step_detected",
          )
          .eq("contact_id", row.contact_id)
          .is("opportunity_id", null)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    row.opportunity_id
      ? db
          .from("opportunities")
          .select("title, estimated_value, next_action_description, next_action_at")
          .eq("id", row.opportunity_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    row.conversation_id
      ? db
          .from("messages")
          .select("direction, text_content, sent_at, message_type")
          .eq("conversation_id", row.conversation_id)
          .order("sent_at", { ascending: false })
          .limit(12)
      : Promise.resolve({ data: [] }),
  ]);

  const history = (messagesResult.data ?? [])
    .slice()
    .reverse()
    .map(
      (message) =>
        `${message.direction === "inbound" ? "Cliente" : "Vendedor"}: ${
          message.text_content ?? `[${message.message_type}]`
        }`,
    )
    .join("\n");

  const context = JSON.stringify(
    {
      situacao: row.title,
      motivo: row.reason,
      prioridade: row.priority,
      score: row.priority_score,
      cliente: (row as { contacts?: { name: string } | null }).contacts?.name ?? null,
      memoria: memoryResult.data,
      oportunidade: opportunityResult.data,
      acao_sugerida_por_regra: row.suggested_action,
    },
    null,
    2,
  );

  const start = Date.now();
  try {
    const result = await completeStructured<{ action_kind: string; recommendation: string }>({
      model: MODEL,
      system: SYSTEM,
      user: `CONTEXTO:\n${context}\n\nÚLTIMAS MENSAGENS:\n${history || "(sem histórico)"}`,
      schemaName: "next_best_action",
      schema: SCHEMA,
    });

    await logUsage(userId, row.contact_id, {
      status: "success",
      tokens: result.usage,
      duration: Date.now() - start,
    });

    const { data: updated } = await db
      .from("attention_items")
      .update({
        suggested_action: result.data.recommendation,
        suggested_action_kind: result.data.action_kind,
        suggested_action_source: "ai",
      })
      .eq("id", itemId)
      .select("*, contacts(name)")
      .maybeSingle();

    return mapItem((updated ?? row) as never);
  } catch (aiError) {
    await logUsage(userId, row.contact_id, {
      status: "failed",
      tokens: { input: null, output: null, total: null },
      duration: Date.now() - start,
      error: aiError instanceof Error ? aiError.message : "erro desconhecido",
    });
    throw aiError;
  }
}

/** O registro de custo usa credencial privilegiada (RLS bloqueia insert do usuário). */
async function logUsage(
  userId: string,
  contactId: string | null,
  input: {
    status: "success" | "failed";
    tokens: { input: number | null; output: number | null; total: number | null };
    duration: number;
    error?: string;
  },
): Promise<void> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const total = input.tokens.total ?? 0;
    await (supabaseAdmin as unknown as Client).from("ai_usage_events").insert({
      user_id: userId,
      contact_id: contactId,
      purpose: "next_best_action",
      model: MODEL,
      prompt_version: PROMPT_VERSION,
      input_tokens: input.tokens.input,
      output_tokens: input.tokens.output,
      total_tokens: input.tokens.total,
      estimated_cost_usd: total > 0 ? Number(((total / 1_000_000) * 0.4).toFixed(6)) : null,
      status: input.status,
      error_message: input.error ?? null,
      duration_ms: input.duration,
    });
  } catch (error) {
    console.error("nba_usage_log_failed", error);
  }
}
