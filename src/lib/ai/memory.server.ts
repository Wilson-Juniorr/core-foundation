import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import {
  CUSTOMER_INTENTS,
  INTEREST_LEVELS,
  MEMORY_LIST_FIELDS,
  SENTIMENTS,
  type AnalysisStatus,
  type ConversationInsight,
  type CustomerMemory,
  type MemoryItem,
  type MemoryListField,
  type MemorySource,
} from "./types";

type Client = SupabaseClient<Database>;
type MemoryRow = Database["public"]["Tables"]["customer_memory"]["Row"];
type InsightRow = Database["public"]["Tables"]["conversation_insights"]["Row"];

function toItems(value: unknown): MemoryItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const item = raw as Record<string, unknown>;
    const text = typeof item["value"] === "string" ? item["value"].trim() : "";
    if (!text) return [];
    return [
      {
        value: text,
        confidence:
          typeof item["confidence"] === "number" ? clamp01(item["confidence"] as number) : 0,
        source: isSource(item["source"]) ? item["source"] : "ai",
        at: typeof item["at"] === "string" ? item["at"] : new Date().toISOString(),
        due: typeof item["due"] === "string" && item["due"] ? item["due"] : null,
      },
    ];
  });
}

function isSource(value: unknown): value is MemorySource {
  return value === "ai" || value === "human" || value === "system";
}

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, Number(value.toFixed(2))));
}

function oneOf<T extends string>(options: readonly T[], value: unknown, fallback: T): T {
  return options.includes(value as T) ? (value as T) : fallback;
}

export function mapMemory(row: MemoryRow): CustomerMemory {
  const sources = (row.field_sources ?? {}) as CustomerMemory["field_sources"];
  const lists = Object.fromEntries(
    MEMORY_LIST_FIELDS.map((field) => [field, toItems(row[field])]),
  ) as Record<MemoryListField, MemoryItem[]>;

  return {
    id: row.id,
    contact_id: row.contact_id,
    opportunity_id: row.opportunity_id,
    current_summary: row.current_summary,
    customer_intent: oneOf(CUSTOMER_INTENTS, row.customer_intent, "unknown"),
    interest_level: oneOf(INTEREST_LEVELS, row.interest_level, "unknown"),
    sentiment: oneOf(SENTIMENTS, row.sentiment, "unknown"),
    ...lists,
    next_step_detected: row.next_step_detected,
    do_not_contact: row.do_not_contact,
    confidence: Number(row.confidence ?? 0),
    last_analyzed_message_id: row.last_analyzed_message_id,
    last_analyzed_at: row.last_analyzed_at,
    analysis_status: (row.analysis_status ?? "idle") as AnalysisStatus,
    last_error: row.last_error,
    model: row.model,
    prompt_version: row.prompt_version,
    field_sources: typeof sources === "object" && sources !== null ? sources : {},
    updated_at: row.updated_at,
  };
}

export function mapInsight(row: InsightRow): ConversationInsight {
  return {
    id: row.id,
    insight_type: row.insight_type,
    content: row.content,
    confidence: Number(row.confidence ?? 0),
    source: row.source,
    status: row.status,
    source_message_id: row.source_message_id,
    created_at: row.created_at,
  };
}

export async function loadMemory(
  client: Client,
  contactId: string,
): Promise<CustomerMemory | null> {
  const { data, error } = await client
    .from("customer_memory")
    .select("*")
    .eq("contact_id", contactId)
    .is("opportunity_id", null)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapMemory(data) : null;
}

export async function ensureMemory(
  admin: Client,
  userId: string,
  contactId: string,
): Promise<CustomerMemory> {
  const existing = await loadMemory(admin, contactId);
  if (existing) return existing;

  const { data, error } = await admin
    .from("customer_memory")
    .insert({ user_id: userId, contact_id: contactId, analysis_status: "pending" })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return mapMemory(data);
}

export function isHumanLocked(memory: CustomerMemory | null, field: string): boolean {
  return memory?.field_sources?.[field]?.source === "human";
}

/**
 * Mescla a saída da IA com a memória existente.
 *
 * - Campos confirmados manualmente (`field_sources[field].source === "human"`)
 *   nunca são sobrescritos.
 * - Itens de lista marcados como `human` são sempre preservados.
 * - Itens de IA anteriores que a nova análise não repetiu são mantidos apenas
 *   quando a IA não devolveu nada para aquele campo (evita perder fatos por
 *   omissão), caso contrário a nova lista prevalece.
 */
export function mergeLists(
  previous: MemoryItem[],
  incoming: MemoryItem[],
  now: string,
): MemoryItem[] {
  const humans = previous.filter((item) => item.source === "human");
  if (incoming.length === 0) return previous;

  const seen = new Set(humans.map((item) => item.value.toLowerCase()));
  const merged = [...humans];
  for (const item of incoming) {
    const key = item.value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const before = previous.find((old) => old.value.toLowerCase() === key);
    merged.push({ ...item, source: "ai", at: before?.at ?? now });
  }
  return merged.slice(0, 20);
}
