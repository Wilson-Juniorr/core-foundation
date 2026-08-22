import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  analyzeContactSchema,
  contactIdSchema,
  insightStatusSchema,
  updateMemorySchema,
} from "./ai.schemas";
import type { IntelligenceView } from "./ai/types";

export const getIntelligence = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => contactIdSchema.parse(input))
  .handler(async ({ data, context }): Promise<IntelligenceView> => {
    const { getIntelligenceView } = await import("./ai/view.server");
    return getIntelligenceView(context.supabase, data.contactId);
  });

/**
 * "Atualizar inteligência": enfileira o reprocessamento. A execução acontece no
 * agendador server-side, portanto a UI não fica presa esperando o modelo.
 */
export const requestAnalysis = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => analyzeContactSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ status: string; reason?: string }> => {
    const { analyzeContact } = await import("./ai/analysis.server");
    const outcome = await analyzeContact(context.userId, data.contactId, {
      force: data.force ?? true,
      conversationId: data.conversationId ?? null,
    });
    return { status: outcome.status, ...(outcome.reason ? { reason: outcome.reason } : {}) };
  });

/** Correção humana — o campo enviado passa a ter origem `human` e não é sobrescrito pela IA. */
export const updateMemory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => updateMemorySchema.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { applyHumanCorrection } = await import("./ai/view.server");
    await applyHumanCorrection(context.supabase, context.userId, data.contactId, data.patch);
    return { ok: true };
  });

export const setInsightStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => insightStatusSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { error } = await context.supabase
      .from("conversation_insights")
      .update({ status: data.status })
      .eq("id", data.insightId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
