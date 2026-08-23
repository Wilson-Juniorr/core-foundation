import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import type { AutomationPolicySettings } from "./types";

type Admin = SupabaseClient<Database>;
type ActionRow = Database["public"]["Tables"]["scheduled_actions"]["Row"];
type ContentMode = Database["public"]["Enums"]["followup_content_mode"];

export type AdaptiveOutcome =
  | {
      kind: "send";
      text: string | null;
      media: {
        reference: string;
        mimeType: string | null;
        filename: string | null;
        actionType: Database["public"]["Enums"]["followup_action_type"];
      } | null;
      draftId: string | null;
      confidence: number | null;
      model: string | null;
      promptVersion: string | null;
      strategyName: string | null;
    }
  | {
      kind: "approval_required" | "handoff" | "blocked";
      reason: string;
      draftId: string | null;
      confidence: number | null;
      strategyName: string | null;
    };

/**
 * Confiança da automação: usamos a confiança da memória do cliente como sinal,
 * porque ela reflete quanto o sistema realmente sabe sobre a conversa.
 */
async function contextConfidence(db: Admin, userId: string, contactId: string | null) {
  if (!contactId) return 0.4;
  const { data } = await db
    .from("customer_memory")
    .select("confidence")
    .eq("user_id", userId)
    .eq("contact_id", contactId)
    .maybeSingle();
  return data?.confidence != null ? Number(data.confidence) : 0.4;
}

/**
 * Resolve o conteúdo de uma etapa no momento do envio. Etapas fixas seguem
 * inalteradas; etapas adaptativas usam a Biblioteca Estratégica (Módulo 05) e
 * respeitam os limiares de confiança configurados.
 */
async function resolveContentMode(
  db: Admin,
  action: ActionRow,
  settings: AutomationPolicySettings,
  fixedText: string | null,
): Promise<AdaptiveOutcome> {
  const mode = (action.content_mode ?? "fixed_content") as ContentMode;

  if (mode === "fixed_content") {
    return {
      kind: "send",
      text: fixedText,
      media: action.media_reference
        ? {
            reference: action.media_reference,
            mimeType: action.media_mime_type,
            filename: action.media_filename,
            actionType: action.action_type,
          }
        : null,
      draftId: null,
      confidence: null,
      model: null,
      promptVersion: null,
      strategyName: null,
    };
  }

  if (mode === "human_required") {
    return {
      kind: "handoff",
      reason: "Esta etapa foi marcada como exclusiva para envio humano.",
      draftId: null,
      confidence: null,
      strategyName: null,
    };
  }

  if (mode === "asset_selection") {
    const { data: material } = await db
      .from("content_assets")
      .select("id, name, type, body, storage_reference, mime_type, filename, is_active")
      .eq("user_id", action.user_id)
      .eq("id", action.media_reference ?? "")
      .maybeSingle();

    if (!material || !material.is_active) {
      return {
        kind: "blocked",
        reason: "O material desta etapa não está mais disponível.",
        draftId: null,
        confidence: null,
        strategyName: null,
      };
    }

    if (material.type === "text") {
      return {
        kind: "send",
        text: material.body ?? fixedText,
        media: null,
        draftId: null,
        confidence: null,
        model: null,
        promptVersion: null,
        strategyName: null,
      };
    }

    if (!material.storage_reference) {
      return {
        kind: "blocked",
        reason: "O material desta etapa não tem arquivo anexado.",
        draftId: null,
        confidence: null,
        strategyName: null,
      };
    }

    return {
      kind: "send",
      text: fixedText,
      media: {
        reference: material.storage_reference,
        mimeType: material.mime_type,
        filename: material.filename ?? material.name,
        actionType:
          material.type === "audio" ? "audio" : material.type === "image" ? "image" : "document",
      },
      draftId: null,
      confidence: null,
      model: null,
      promptVersion: null,
      strategyName: null,
    };
  }

  // mode === "ai_generated"
  if (!action.strategy_id || !action.contact_id) {
    return {
      kind: "blocked",
      reason: "Etapa com IA sem estratégia ou cliente vinculado.",
      draftId: null,
      confidence: null,
      strategyName: null,
    };
  }

  const { generateDraft, MessageEngineError } = await import("@/lib/library/generate.server");
  const confidence = await contextConfidence(db, action.user_id, action.contact_id);

  try {
    const result = await generateDraft(db as never, action.user_id, {
      contactId: action.contact_id,
      strategyId: action.strategy_id,
      conversationId: action.conversation_id,
      opportunityId: action.opportunity_id,
    });

    const draft = result.draft;
    const strategyName = draft.strategy_name;

    if (confidence < settings.confidence_approval_min) {
      return {
        kind: "handoff",
        reason: `Confiança do contexto (${confidence.toFixed(2)}) abaixo do mínimo para automação.`,
        draftId: draft.id,
        confidence,
        strategyName,
      };
    }

    if (confidence < settings.confidence_auto_min) {
      return {
        kind: "approval_required",
        reason: `Rascunho gerado e enviado para sua aprovação (confiança ${confidence.toFixed(2)}).`,
        draftId: draft.id,
        confidence,
        strategyName,
      };
    }

    return {
      kind: "send",
      text: draft.edited_content ?? draft.generated_content,
      media: null,
      draftId: draft.id,
      confidence,
      model: draft.model,
      promptVersion: draft.prompt_version,
      strategyName,
    };
  } catch (error) {
    if (error instanceof MessageEngineError) {
      return {
        kind: error.code === "do_not_contact" ? "blocked" : "handoff",
        reason: error.message,
        draftId: null,
        confidence,
        strategyName: null,
      };
    }
    throw error;
  }
}

/**
 * Camada final do Módulo 09: no modo "aprovação obrigatória" nenhuma mensagem
 * sai sem revisão humana, mesmo quando a política e a confiança permitiriam.
 */
export async function resolveAdaptiveContent(
  db: Admin,
  action: ActionRow,
  settings: AutomationPolicySettings,
  fixedText: string | null,
): Promise<AdaptiveOutcome> {
  const outcome = await resolveContentMode(db, action, settings, fixedText);
  if (outcome.kind === "send" && settings.require_approval_all) {
    return {
      kind: "approval_required",
      reason: "Modo de aprovação obrigatória ativo: revise antes do envio.",
      draftId: outcome.draftId,
      confidence: outcome.confidence,
      strategyName: outcome.strategyName,
    };
  }
  return outcome;
}
