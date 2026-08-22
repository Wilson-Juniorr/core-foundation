import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import { AiGatewayError, completeStructured, estimateCost } from "@/lib/ai/gateway.server";
import { adminClient } from "@/lib/followup/engine.server";
import { buildGenerationContext, similarity } from "./context.server";
import { mapDraft } from "./drafts.server";
import {
  buildSystemPrompt,
  buildUserPrompt,
  MESSAGE_JSON_SCHEMA,
  MESSAGE_MODEL,
  MESSAGE_PROMPT_VERSION,
  type MessageModelOutput,
} from "./prompts.server";
import { getStrategy } from "./strategies.server";
import type { GenerationResult } from "./types";

type Client = SupabaseClient<Database>;

/** Acima disso a mensagem é considerada repetição do que já enviamos. */
const REPETITION_THRESHOLD = 0.72;

export interface GenerateInput {
  contactId: string;
  strategyId: string;
  conversationId?: string | null;
  opportunityId?: string | null;
  objective?: string | null;
  /** Preview de estratégia: gera e guarda, mas não entra na fila de aprovação. */
  preview?: boolean;
}

export class MessageEngineError extends Error {
  constructor(
    message: string,
    public code: "do_not_contact" | "blocked" | "ai_unavailable",
  ) {
    super(message);
    this.name = "MessageEngineError";
  }
}

export async function generateDraft(
  client: Client,
  userId: string,
  input: GenerateInput,
): Promise<GenerationResult> {
  const strategy = await getStrategy(client, input.strategyId);
  const context = await buildGenerationContext(client, strategy, {
    contactId: input.contactId,
    conversationId: input.conversationId ?? null,
    opportunityId: input.opportunityId ?? null,
    objective: input.objective ?? null,
  });

  if (context.doNotContact) {
    throw new MessageEngineError(
      "Este cliente pediu para não receber mensagens. Nenhuma mensagem foi gerada.",
      "do_not_contact",
    );
  }

  const system = buildSystemPrompt(strategy);
  const started = Date.now();

  let output: MessageModelOutput;
  let model = MESSAGE_MODEL;
  let usage: { input: number | null; output: number | null; total: number | null } = {
    input: null,
    output: null,
    total: null,
  };

  const run = async (extraInstruction: string | null) => {
    const user = extraInstruction
      ? `${buildUserPrompt(context.snapshot, input.objective ?? null)}\n\n${extraInstruction}`
      : buildUserPrompt(context.snapshot, input.objective ?? null);
    return completeStructured<MessageModelOutput>({
      model: MESSAGE_MODEL,
      system,
      user,
      schemaName: "strategic_message",
      schema: MESSAGE_JSON_SCHEMA,
    });
  };

  try {
    const first = await run(null);
    output = first.data;
    model = first.model;
    usage = first.usage;

    // Anti-repetição: se ficou parecido com o que já enviamos, tenta uma vez mais.
    const tooSimilar = context.snapshot.recent_outbound.some(
      (previous) => similarity(previous, output.message) >= REPETITION_THRESHOLD,
    );
    if (!output.blocked && tooSimilar) {
      const second = await run(
        "A mensagem anterior ficou parecida demais com o que já enviamos. Reescreva com abertura, estrutura e caminho diferentes, mantendo a mesma estratégia e sem inventar informação.",
      );
      output = second.data;
      model = second.model;
      usage = {
        input: (usage.input ?? 0) + (second.usage.input ?? 0),
        output: (usage.output ?? 0) + (second.usage.output ?? 0),
        total: (usage.total ?? 0) + (second.usage.total ?? 0),
      };
    }
  } catch (error) {
    const admin = await adminClient();
    await admin.from("ai_usage_events").insert({
      user_id: userId,
      contact_id: input.contactId,
      purpose: "message_generation",
      model: MESSAGE_MODEL,
      prompt_version: MESSAGE_PROMPT_VERSION,
      status: "failed",
      error_message: error instanceof Error ? error.message.slice(0, 500) : "erro desconhecido",
      duration_ms: Date.now() - started,
    });
    if (error instanceof AiGatewayError) {
      throw new MessageEngineError(
        error.status === 402
          ? "Os créditos de IA do espaço de trabalho acabaram. Adicione créditos para voltar a gerar mensagens."
          : error.message,
        "ai_unavailable",
      );
    }
    throw error;
  }

  const admin = await adminClient();
  await admin.from("ai_usage_events").insert({
    user_id: userId,
    contact_id: input.contactId,
    purpose: "message_generation",
    model,
    prompt_version: MESSAGE_PROMPT_VERSION,
    input_tokens: usage.input,
    output_tokens: usage.output,
    total_tokens: usage.total,
    estimated_cost_usd: estimateCost(model, usage.total),
    status: "success",
    duration_ms: Date.now() - started,
  });

  if (output.blocked || !output.message.trim()) {
    throw new MessageEngineError(
      output.blocked_reason?.trim() ||
        "A IA não encontrou motivo legítimo para falar com este cliente agora.",
      "blocked",
    );
  }

  const suggestedAsset =
    output.asset_id && context.allowedAssets.some((asset) => asset.id === output.asset_id)
      ? output.asset_id
      : null;

  const snapshot = {
    ...context.snapshot,
    used_context: output.used_context ?? [],
    notes: output.notes ?? "",
  };

  const message = output.message.trim();

  const { data, error } = await client
    .from("message_drafts")
    .insert({
      user_id: userId,
      contact_id: input.contactId,
      opportunity_id: context.opportunityId,
      conversation_id: context.conversationId,
      strategy_id: strategy.id,
      strategy_version: strategy.version,
      strategy_name: strategy.name,
      generated_content: message,
      original_content: message,
      suggested_asset_id: suggestedAsset,
      asset_rationale: suggestedAsset ? output.asset_rationale?.trim() || null : null,
      status: "generated",
      is_preview: input.preview ?? false,
      model,
      prompt_version: MESSAGE_PROMPT_VERSION,
      context_snapshot: snapshot as never,
    })
    .select("*, contacts(name), content_assets(id, name, type)")
    .single();
  if (error) throw new Error(error.message);

  return {
    draft: mapDraft(data),
    warning:
      context.snapshot.gaps.length > 0
        ? `Contexto incompleto: ${context.snapshot.gaps.join("; ")}. Revise antes de enviar.`
        : null,
  };
}
