import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import { mapInsight, mapMemory } from "./memory.server";
import type { IntelligenceView, MemoryItem } from "./types";
import { MEMORY_LIST_FIELDS } from "./types";

type Client = SupabaseClient<Database>;

export async function getIntelligenceView(
  client: Client,
  contactId: string,
): Promise<IntelligenceView> {
  const [memoryResult, insightsResult, jobResult, usageResult] = await Promise.all([
    client
      .from("customer_memory")
      .select("*")
      .eq("contact_id", contactId)
      .is("opportunity_id", null)
      .maybeSingle(),
    client
      .from("conversation_insights")
      .select("*")
      .eq("contact_id", contactId)
      .order("created_at", { ascending: false })
      .limit(40),
    client
      .from("ai_analysis_jobs")
      .select("id, status")
      .eq("contact_id", contactId)
      .in("status", ["pending", "processing"])
      .limit(1),
    client
      .from("ai_usage_events")
      .select("model, total_tokens, estimated_cost_usd, status")
      .eq("contact_id", contactId)
      .order("created_at", { ascending: false })
      .limit(100),
  ]);

  const memory = memoryResult.data ? mapMemory(memoryResult.data) : null;

  // Mensagens ainda não analisadas: só metadados, nada de conteúdo.
  let unanalyzed = 0;
  const lastId = memory?.last_analyzed_message_id ?? null;
  if (lastId) {
    const { data: last } = await client
      .from("messages")
      .select("sent_at")
      .eq("id", lastId)
      .maybeSingle();
    const { count } = await client
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("contact_id", contactId)
      .gt("sent_at", last?.sent_at ?? new Date(0).toISOString());
    unanalyzed = count ?? 0;
  } else {
    const { count } = await client
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("contact_id", contactId);
    unanalyzed = count ?? 0;
  }

  const usageRows = usageResult.data ?? [];
  const successful = usageRows.filter((row) => row.status === "success");

  return {
    memory,
    insights: (insightsResult.data ?? []).map(mapInsight),
    processing: (jobResult.data ?? []).length > 0,
    unanalyzedMessages: unanalyzed,
    usage: {
      analyses: successful.length,
      totalTokens: successful.reduce((sum, row) => sum + (row.total_tokens ?? 0), 0),
      estimatedCostUsd: Number(
        successful
          .reduce((sum, row) => sum + Number(row.estimated_cost_usd ?? 0), 0)
          .toFixed(6),
      ),
      lastModel: usageRows[0]?.model ?? null,
    },
  };
}

type PatchInput = Record<string, unknown>;

/**
 * Aplica correção humana. Cada campo enviado é marcado com origem `human` em
 * `field_sources`, o que impede a IA de sobrescrevê-lo silenciosamente.
 */
export async function applyHumanCorrection(
  client: Client,
  userId: string,
  contactId: string,
  patch: PatchInput,
): Promise<void> {
  const now = new Date().toISOString();

  const { data: existing } = await client
    .from("customer_memory")
    .select("id, field_sources")
    .eq("contact_id", contactId)
    .is("opportunity_id", null)
    .maybeSingle();

  const sources = {
    ...((existing?.field_sources ?? {}) as Record<string, unknown>),
  };

  const update: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    sources[field] = { source: "human", at: now };
    if (MEMORY_LIST_FIELDS.includes(field as never)) {
      const items = (value as { value: string; due?: string | null }[]).map<MemoryItem>((item) => ({
        value: item.value.trim(),
        confidence: 1,
        source: "human",
        at: now,
        due: item.due ?? null,
      }));
      update[field] = items;
    } else {
      update[field] = value;
    }
  }
  update["field_sources"] = sources;

  if (existing) {
    const { error } = await client
      .from("customer_memory")
      .update(update as never)
      .eq("id", existing.id);
    if (error) throw new Error(error.message);
    return;
  }

  const { error } = await client
    .from("customer_memory")
    .insert({ ...(update as object), user_id: userId, contact_id: contactId } as never);
  if (error) throw new Error(error.message);
}
