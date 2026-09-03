/**
 * Smart Flow — criação e edição da configuração do acompanhamento.
 *
 * O fluxo inteligente é um `followup_flows` com `kind = 'smart'`: reaproveita
 * ativação, janelas e histórico do motor clássico, mas não tem etapas fixas.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import type { smartFlowInputSchema } from "@/lib/smart.schemas";
import type { z } from "zod";

type Client = SupabaseClient<Database>;
export type SmartFlowInput = z.infer<typeof smartFlowInputSchema>;

export class SmartFlowSaveError extends Error {}

export async function saveSmartFlow(
  db: Client,
  userId: string,
  input: SmartFlowInput,
): Promise<{ flowId: string }> {
  const flowPayload = {
    user_id: userId,
    kind: "smart",
    name: input.name,
    description: input.description,
    is_active: input.is_active,
    // Smart Flow nunca deve seguir falando depois de uma resposta sem reavaliar.
    stop_on_reply: false,
    window_start: input.window_start,
    window_end: input.window_end,
  };

  let flowId = input.id ?? null;

  if (flowId) {
    const { error } = await db
      .from("followup_flows")
      .update(flowPayload)
      .eq("id", flowId)
      .eq("user_id", userId)
      .eq("kind", "smart");
    if (error) throw new SmartFlowSaveError(error.message);
  } else {
    const { data, error } = await db
      .from("followup_flows")
      .insert(flowPayload)
      .select("id")
      .single();
    if (error) throw new SmartFlowSaveError(error.message);
    flowId = data.id;
  }

  const { error: configError } = await db.from("smart_flow_configs").upsert(
    {
      flow_id: flowId,
      user_id: userId,
      goal: input.goal,
      max_duration_days: input.max_duration_days,
      autonomy: input.autonomy,
      allowed_strategies: input.allowed_strategies,
      allowed_media: input.allowed_media,
      max_pressure: input.max_pressure,
      min_hours_between_actions: input.min_hours_between_actions,
      max_actions_per_week: input.max_actions_per_week,
      handoff_situations: input.handoff_situations,
      completion_criteria: input.completion_criteria,
      confidence_min: input.confidence_min,
    },
    { onConflict: "flow_id" },
  );
  if (configError) throw new SmartFlowSaveError(configError.message);

  return { flowId };
}

export async function setSmartFlowActive(
  db: Client,
  userId: string,
  flowId: string,
  isActive: boolean,
): Promise<void> {
  const { error } = await db
    .from("followup_flows")
    .update({ is_active: isActive })
    .eq("id", flowId)
    .eq("user_id", userId)
    .eq("kind", "smart");
  if (error) throw new SmartFlowSaveError(error.message);
}
