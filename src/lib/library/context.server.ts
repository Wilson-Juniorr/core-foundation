import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import { intentLabels, interestLabels, sentimentLabels } from "@/lib/ai/labels";
import { mapMemory } from "@/lib/ai/memory.server";
import { DEFAULT_TIMEZONE } from "@/lib/followup/time";
import type { ContentAsset, GenerationContextSnapshot, MessageStrategy } from "./types";

type Client = SupabaseClient<Database>;

const WEEKDAYS = [
  "domingo",
  "segunda-feira",
  "terça-feira",
  "quarta-feira",
  "quinta-feira",
  "sexta-feira",
  "sábado",
];

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

function localParts(timezone: string, at: Date) {
  const formatter = new Intl.DateTimeFormat("pt-BR", {
    timeZone: timezone,
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  const formatted = formatter.format(at);
  const weekdayIndex = Number(
    new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short" })
      .format(at)
      .replace(/(Sun|Mon|Tue|Wed|Thu|Fri|Sat)/, (match) =>
        String(["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(match)),
      ),
  );
  return { formatted, weekday: WEEKDAYS[weekdayIndex] ?? "" };
}

function hoursBetween(from: string | null, to: Date): number | null {
  if (!from) return null;
  const diff = to.getTime() - new Date(from).getTime();
  return Math.max(0, Math.round(diff / 3_600_000));
}

function itemValues(items: { value: string }[] | undefined): string[] {
  return (items ?? []).map((item) => item.value).filter(Boolean).slice(0, 8);
}

function truncate(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

export interface ContextRequest {
  contactId: string;
  conversationId?: string | null;
  opportunityId?: string | null;
  objective?: string | null;
}

export interface BuiltContext {
  snapshot: GenerationContextSnapshot;
  conversationId: string | null;
  opportunityId: string | null;
  allowedAssets: ContentAsset[];
  doNotContact: boolean;
}

/**
 * Monta o contexto real de geração. Nada aqui é inventado: se um bloco não
 * existe, ele entra em `gaps` para a IA saber que a informação não está
 * registrada (em vez de supor).
 */
export async function buildGenerationContext(
  client: Client,
  strategy: MessageStrategy,
  request: ContextRequest,
): Promise<BuiltContext> {
  const now = new Date();

  const { data: contact, error: contactError } = await client
    .from("contacts")
    .select("id, name, phone")
    .eq("id", request.contactId)
    .maybeSingle();
  if (contactError) throw new Error(contactError.message);
  if (!contact) throw new Error("Cliente não encontrado.");

  const [{ data: settings }, { data: opportunities }, { data: memoryRow }] = await Promise.all([
    client.from("user_settings").select("timezone").maybeSingle(),
    client
      .from("opportunities")
      .select("id, title, status, estimated_value, next_action_description, pipeline_stages(name)")
      .eq("contact_id", contact.id)
      .order("updated_at", { ascending: false })
      .limit(5),
    client
      .from("customer_memory")
      .select("*")
      .eq("contact_id", contact.id)
      .is("opportunity_id", null)
      .maybeSingle(),
  ]);

  const timezone = settings?.timezone ?? DEFAULT_TIMEZONE;

  const opportunityRow =
    (request.opportunityId
      ? (opportunities ?? []).find((item) => item.id === request.opportunityId)
      : (opportunities ?? []).find((item) => item.status === "open")) ??
    (opportunities ?? [])[0] ??
    null;

  let conversationId = request.conversationId ?? null;
  if (!conversationId) {
    const { data: conversation } = await client
      .from("conversations")
      .select("id")
      .eq("contact_id", contact.id)
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    conversationId = conversation?.id ?? null;
  }

  let messages: { direction: "inbound" | "outbound"; sent_at: string; text: string }[] = [];
  if (conversationId) {
    const { data: rows } = await client
      .from("messages")
      .select("direction, sent_at, text_content, message_type, media_filename")
      .eq("conversation_id", conversationId)
      .order("sent_at", { ascending: false })
      .limit(14);
    messages = (rows ?? [])
      .reverse()
      .map((row) => ({
        direction: row.direction,
        sent_at: row.sent_at,
        text:
          row.text_content?.trim() ||
          `[${row.message_type}${row.media_filename ? `: ${row.media_filename}` : ""}]`,
      }));
  }

  const memory = memoryRow ? mapMemory(memoryRow) : null;
  const last = messages[messages.length - 1] ?? null;
  const lastInbound = [...messages].reverse().find((item) => item.direction === "inbound") ?? null;

  const assetFilterTypes = strategy.allowed_asset_types;
  let allowedAssets: ContentAsset[] = [];
  if (assetFilterTypes.length > 0) {
    let assetQuery = client
      .from("content_assets")
      .select("*")
      .eq("is_active", true)
      .in("type", assetFilterTypes)
      .limit(40);
    if (strategy.allowed_assets.length > 0) {
      assetQuery = assetQuery.in("id", strategy.allowed_assets);
    }
    const { data: assetRows } = await assetQuery;
    const { mapAsset } = await import("./assets.server");
    allowedAssets = (assetRows ?? []).map(mapAsset);
  }

  const gaps: string[] = [];
  if (!memory) gaps.push("sem memória analisada do cliente");
  if (!opportunityRow) gaps.push("sem oportunidade registrada");
  if (messages.length === 0) gaps.push("sem histórico de conversa");
  if (memory && !memory.current_summary) gaps.push("memória sem resumo");
  if (memory && (memory.relevant_values ?? []).length === 0) {
    gaps.push("nenhum valor ou condição comercial registrada");
  }

  const { formatted, weekday } = localParts(timezone, now);

  const snapshot: GenerationContextSnapshot = {
    contact: { id: contact.id, name: contact.name, first_name: firstName(contact.name) },
    opportunity: opportunityRow
      ? {
          id: opportunityRow.id,
          title: opportunityRow.title,
          stage:
            (opportunityRow.pipeline_stages as { name?: string } | null)?.name ?? "sem etapa",
          status: opportunityRow.status,
          estimated_value: opportunityRow.estimated_value
            ? Number(opportunityRow.estimated_value)
            : null,
          next_action: opportunityRow.next_action_description,
        }
      : null,
    memory: memory
      ? {
          summary: memory.current_summary,
          intent: intentLabels[memory.customer_intent] ?? memory.customer_intent,
          interest: interestLabels[memory.interest_level] ?? memory.interest_level,
          sentiment: sentimentLabels[memory.sentiment] ?? memory.sentiment,
          next_step: memory.next_step_detected,
          objections: itemValues(memory.main_objections),
          pending_information: itemValues(memory.pending_information),
          customer_commitments: itemValues(memory.customer_commitments),
          seller_commitments: itemValues(memory.seller_commitments),
          important_dates: itemValues(memory.important_dates),
          products: itemValues(memory.products_or_services),
          values: itemValues(memory.relevant_values),
          do_not_contact: memory.do_not_contact,
        }
      : null,
    timing: {
      now_local: formatted,
      weekday,
      timezone,
      hours_since_last_contact: hoursBetween(last?.sent_at ?? null, now),
      hours_since_customer_reply: hoursBetween(lastInbound?.sent_at ?? null, now),
      last_direction: last?.direction ?? null,
    },
    recent_messages: messages.map((item) => ({
      direction: item.direction,
      at: new Intl.DateTimeFormat("pt-BR", {
        timeZone: timezone,
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(item.sent_at)),
      text: truncate(item.text, 400),
    })),
    recent_outbound: messages
      .filter((item) => item.direction === "outbound")
      .slice(-5)
      .map((item) => truncate(item.text, 240)),
    assets: allowedAssets.map((asset) => ({
      id: asset.id,
      name: asset.name,
      type: asset.type,
      purpose: asset.purpose,
    })),
    strategy: {
      id: strategy.id,
      name: strategy.name,
      version: strategy.version,
      objective: strategy.objective,
      tone: strategy.tone,
      autonomy_mode: strategy.autonomy_mode,
      when_to_use: strategy.when_to_use,
      should_mention: strategy.should_mention,
      should_avoid: strategy.should_avoid,
      forbidden_behaviors: strategy.forbidden_behaviors,
    },
    objective_override: request.objective?.trim() || null,
    gaps,
  };

  return {
    snapshot,
    conversationId,
    opportunityId: opportunityRow?.id ?? null,
    allowedAssets,
    doNotContact: memory?.do_not_contact ?? false,
  };
}

/** Similaridade simples por tokens — usada no controle anti-repetição. */
export function similarity(a: string, b: string): number {
  const tokens = (text: string) =>
    new Set(
      text
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((token) => token.length > 2),
    );
  const setA = tokens(a);
  const setB = tokens(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let shared = 0;
  for (const token of setA) if (setB.has(token)) shared += 1;
  return shared / Math.min(setA.size, setB.size);
}
