import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Json } from "@/integrations/supabase/types";
import { adminClient } from "@/lib/followup/engine.server";
import { messageContextText } from "@/lib/whatsapp/message-context";
import { AiGatewayError, completeStructured, estimateCost } from "./gateway.server";
import { describeDealSheet, mergeDealSheet, toDealSheet } from "./deal-sheet";
import { clamp01, ensureMemory, isHumanLocked, loadMemory, mergeLists } from "./memory.server";
import {
  ANALYSIS_JSON_SCHEMA,
  ANALYSIS_MODEL,
  ANALYSIS_PROMPT_VERSION,
  ANALYSIS_SYSTEM_PROMPT,
} from "./prompts.server";
import {
  CUSTOMER_INTENTS,
  INTEREST_LEVELS,
  MEMORY_LIST_FIELDS,
  SENTIMENTS,
  type CustomerMemory,
  type MemoryItem,
  type MemoryListField,
} from "./types";

type Admin = SupabaseClient<Database>;

/** Mensagens novas analisadas por execução. */
const NEW_MESSAGE_LIMIT = 60;
/** Mensagens antigas enviadas apenas como contexto recente. */
const CONTEXT_MESSAGE_LIMIT = 8;
const MAX_ATTEMPTS = 3;
const CONTEXT_COLUMNS =
  "id,direction,message_type,text_content,sent_at,metadata,media_mime_type,media_filename";

interface AiPayload {
  current_summary: string;
  customer_intent: string;
  interest_level: string;
  sentiment: string;
  next_step_detected: string;
  do_not_contact: boolean;
  confidence: number;
  lists: Record<string, { value: string; confidence: number; due: string }[]>;
  sheet?: Record<string, unknown>;
  insights: { type: string; content: string; confidence: number; due_date: string }[];
}

function aiLog(level: "info" | "warn" | "error", event: string, fields: Record<string, unknown>) {
  const payload = JSON.stringify({ scope: "ai", event, at: new Date().toISOString(), ...fields });
  if (level === "error") console.error(payload);
  else if (level === "warn") console.warn(payload);
  else console.log(payload);
}

/**
 * Enfileira a análise. Chamado pelo webhook do WhatsApp — é uma única inserção
 * e nunca bloqueia a resposta ao provedor. O índice único garante no máximo um
 * job pendente por contato (proteção contra processamento duplicado).
 */
export async function enqueueAnalysis(
  admin: Admin,
  input: { userId: string; contactId: string; conversationId?: string | null; reason?: string },
): Promise<void> {
  const { error } = await admin.from("ai_analysis_jobs").insert({
    user_id: input.userId,
    contact_id: input.contactId,
    conversation_id: input.conversationId ?? null,
    reason: input.reason ?? "inbound_message",
  });
  // 23505 = job pendente já existe: nada a fazer.
  if (error && error.code !== "23505") aiLog("warn", "enqueue_failed", { code: error.code });

  await admin
    .from("customer_memory")
    .update({ analysis_status: "pending" })
    .eq("contact_id", input.contactId)
    .is("opportunity_id", null);
}

export async function loadMessages(
  admin: Admin,
  userId: string,
  contactId: string,
  afterId: string | null,
) {
  const { data: memory } = await admin
    .from("customer_memory")
    .select("message_cursor_at,message_cursor_id")
    .eq("user_id", userId)
    .eq("contact_id", contactId)
    .is("opportunity_id", null)
    .maybeSingle();
  const oldCursor = afterId
    ? (
        await admin
          .from("messages")
          .select("id,sent_at")
          .eq("id", afterId)
          .eq("user_id", userId)
          .maybeSingle()
      ).data
    : null;
  const cursorAt = memory?.message_cursor_at ?? oldCursor?.sent_at;
  const cursorId = memory?.message_cursor_id ?? oldCursor?.id;
  let query = admin
    .from("messages")
    .select(CONTEXT_COLUMNS)
    .eq("user_id", userId)
    .eq("contact_id", contactId)
    .order("sent_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(NEW_MESSAGE_LIMIT + 1);
  if (cursorAt && cursorId)
    query = query.or(`sent_at.gt.${cursorAt},and(sent_at.eq.${cursorAt},id.gt.${cursorId})`);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const fresh = (data ?? []).slice(0, NEW_MESSAGE_LIMIT);
  const { data: context } =
    cursorAt && cursorId
      ? await admin
          .from("messages")
          .select(CONTEXT_COLUMNS)
          .eq("user_id", userId)
          .eq("contact_id", contactId)
          .or(`sent_at.lt.${cursorAt},and(sent_at.eq.${cursorAt},id.lte.${cursorId})`)
          .order("sent_at", { ascending: false })
          .order("id", { ascending: false })
          .limit(CONTEXT_MESSAGE_LIMIT)
      : { data: [] };
  return {
    fresh,
    context: (context ?? []).reverse(),
    total: fresh.length + (context?.length ?? 0),
    hasMore: (data?.length ?? 0) > NEW_MESSAGE_LIMIT,
  };
}

type MessageLine = {
  id: string;
  direction: string;
  message_type: string;
  text_content: string | null;
  sent_at: string;
  metadata: Json;
  media_mime_type: string | null;
  media_filename: string | null;
};

function renderMessages(rows: MessageLine[]): string {
  return rows
    .map((row) => {
      const who = row.direction === "inbound" ? "Cliente" : "Vendedor";
      const body =
        messageContextText(row) ||
        (row.message_type === "audio"
          ? "[áudio sem transcrição disponível]"
          : `[${row.message_type}]`);
      return `${row.sent_at} ${who}: ${body}`;
    })
    .join("\n");
}

function renderPreviousMemory(memory: CustomerMemory | null): string {
  if (!memory) return "Nenhuma memória anterior. Cliente novo.";
  const confirmed = Object.entries(memory.field_sources)
    .filter(([, meta]) => meta.source === "human")
    .map(([field]) => field);

  const lists = MEMORY_LIST_FIELDS.map((field) => {
    const items = memory[field];
    if (items.length === 0) return null;
    return `${field}: ${items
      .map(
        (item) =>
          `${item.value} (confiança ${item.confidence}${item.source === "human" ? ", confirmado pelo usuário" : ""})`,
      )
      .join("; ")}`;
  }).filter(Boolean);

  return [
    `resumo: ${memory.current_summary ?? "—"}`,
    `customer_intent: ${memory.customer_intent}`,
    `interest_level: ${memory.interest_level}`,
    `sentiment: ${memory.sentiment}`,
    `next_step_detected: ${memory.next_step_detected ?? "—"}`,
    `do_not_contact: ${memory.do_not_contact}`,
    ...describeDealSheet(memory.sheet),
    ...lists,
    confirmed.length
      ? `campos confirmados pelo usuário (não contestar): ${confirmed.join(", ")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function toIncomingItems(
  raw: { value: string; confidence: number; due: string }[] | undefined,
  now: string,
): MemoryItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item) => typeof item?.value === "string" && item.value.trim().length > 0)
    .map((item) => ({
      value: item.value.trim().slice(0, 300),
      confidence: clamp01(Number(item.confidence ?? 0)),
      source: "ai" as const,
      at: now,
      due: item.due?.trim() ? item.due.trim() : null,
    }));
}

export interface AnalysisOutcome {
  status: "updated" | "skipped" | "failed";
  reason?: string;
}

/**
 * Analisa as mensagens ainda não processadas de um contato e atualiza a memória.
 *
 * Nunca lança para o chamador de UI: falhas marcam a memória como
 * "temporariamente desatualizada" e permitem retry.
 */
export async function analyzeContact(
  userId: string,
  contactId: string,
  options: { force?: boolean; conversationId?: string | null } = {},
): Promise<AnalysisOutcome> {
  const admin = await adminClient();
  const started = Date.now();

  const { data: contact } = await admin
    .from("contacts")
    .select("id, name")
    .eq("id", contactId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!contact) return { status: "skipped", reason: "not_found" };

  const memory = await ensureMemory(admin, userId, contactId);
  const { readContactMedia, markMediaAnalyzed } =
    await import("@/lib/whatsapp/media-context.server");
  let media;
  try {
    media = await readContactMedia(admin, { userId, contactId });
  } catch (error) {
    aiLog("warn", "media_processing_failed", { contact_id: contactId });
    return {
      status: "failed",
      reason: error instanceof Error ? error.message : "Falha na leitura de mídia.",
    };
  }
  const { fresh, context, total, hasMore } = await loadMessages(
    admin,
    userId,
    contactId,
    memory.last_analyzed_message_id,
  );

  if (total === 0 && media.messages.length === 0)
    return { status: "skipped", reason: "no_messages" };
  if (fresh.length === 0 && media.messages.length === 0 && !options.force) {
    return { status: "skipped", reason: media.hasMore ? "more_messages" : "up_to_date" };
  }

  const lastMessage = fresh.at(-1);
  const recentIds = new Set([...fresh, ...context].map((message) => message.id));
  const olderMedia = media.messages.filter((message) => !recentIds.has(message.id));

  await admin.from("customer_memory").update({ analysis_status: "processing" }).eq("id", memory.id);

  const now = new Date().toISOString();
  const userPrompt = [
    `Cliente: ${contact.name}`,
    `Data/hora atual: ${now}`,
    "",
    "MEMÓRIA ANTERIOR:",
    renderPreviousMemory(memory),
    "",
    fresh.length > 0 ? "CONTEXTO RECENTE (já analisado):" : "CONVERSA (reprocessamento):",
    renderMessages(context) || "—",
    "",
    fresh.length > 0 ? "MENSAGENS NOVAS (analisar):" : "",
    fresh.length > 0 ? renderMessages(fresh) : "",
    olderMedia.length > 0 ? "MÍDIAS DO HISTÓRICO LIDAS NESTE CICLO:" : "",
    renderMessages(olderMedia),
  ].join("\n");

  try {
    const result = await completeStructured<AiPayload>({
      model: ANALYSIS_MODEL,
      system: ANALYSIS_SYSTEM_PROMPT,
      user: userPrompt,
      schemaName: "customer_memory",
      schema: ANALYSIS_JSON_SCHEMA,
      timeoutMs: 30_000,
    });

    const payload = result.data;
    const patch: Database["public"]["Tables"]["customer_memory"]["Update"] = {
      analysis_status: hasMore || media.hasMore ? "pending" : "ready",
      ...(lastMessage
        ? { message_cursor_at: lastMessage.sent_at, message_cursor_id: lastMessage.id }
        : {}),
      last_error: null,
      last_analyzed_message_id: lastMessage?.id ?? memory.last_analyzed_message_id,
      last_analyzed_at: now,
      model: result.model,
      prompt_version: ANALYSIS_PROMPT_VERSION,
      confidence: clamp01(Number(payload.confidence ?? 0)),
    };

    if (!isHumanLocked(memory, "current_summary") && payload.current_summary?.trim()) {
      patch["current_summary"] = payload.current_summary.trim().slice(0, 2000);
    }
    if (!isHumanLocked(memory, "customer_intent")) {
      patch["customer_intent"] = CUSTOMER_INTENTS.includes(payload.customer_intent as never)
        ? payload.customer_intent
        : "unknown";
    }
    if (!isHumanLocked(memory, "interest_level")) {
      patch["interest_level"] = INTEREST_LEVELS.includes(payload.interest_level as never)
        ? payload.interest_level
        : "unknown";
    }
    if (!isHumanLocked(memory, "sentiment")) {
      patch["sentiment"] = SENTIMENTS.includes(payload.sentiment as never)
        ? payload.sentiment
        : "unknown";
    }
    if (!isHumanLocked(memory, "next_step_detected")) {
      patch["next_step_detected"] = payload.next_step_detected?.trim()
        ? payload.next_step_detected.trim().slice(0, 500)
        : memory.next_step_detected;
    }
    // Pedido de não contato só liga, nunca desliga automaticamente.
    if (payload.do_not_contact === true) patch["do_not_contact"] = true;

    if (payload.sheet) {
      Object.assign(
        patch,
        mergeDealSheet(memory.sheet, toDealSheet(payload.sheet), (field) =>
          isHumanLocked(memory, field),
        ),
      );
    }

    for (const field of MEMORY_LIST_FIELDS) {
      if (isHumanLocked(memory, field)) continue;
      patch[field] = mergeLists(
        memory[field],
        toIncomingItems(payload.lists?.[field], now),
        now,
      ) as unknown as NonNullable<
        Database["public"]["Tables"]["customer_memory"]["Update"][MemoryListField]
      >;
    }

    const { error: updateError } = await admin
      .from("customer_memory")
      .update(patch)
      .eq("id", memory.id);
    if (updateError) throw new Error(updateError.message);
    await markMediaAnalyzed(admin, userId, media.messages);

    // Insights: upsert idempotente (índice único por tipo + conteúdo + mensagem).
    const insights = (payload.insights ?? [])
      .filter((item) => item?.content?.trim())
      .slice(0, 25)
      .map((item) => {
        const insightType = (item.type || "other").slice(0, 60);
        const content = item.content.trim().slice(0, 600);
        return {
          user_id: userId,
          contact_id: contactId,
          conversation_id: options.conversationId ?? null,
          insight_type: insightType,
          content,
          confidence: clamp01(Number(item.confidence ?? 0)),
          source_message_id: lastMessage?.id ?? null,
          metadata: item.due_date?.trim() ? { due_date: item.due_date.trim() } : {},
          // Idempotência: o mesmo sinal, da mesma mensagem, nunca é gravado duas vezes.
          dedupe_key: `${insightType}|${lastMessage?.id ?? "none"}|${content
            .slice(0, 200)
            .toLowerCase()}`,
        };
      });
    if (insights.length > 0) {
      const { error: insightError } = await admin.from("conversation_insights").upsert(insights, {
        onConflict: "user_id,contact_id,dedupe_key",
        ignoreDuplicates: true,
      });
      if (insightError) aiLog("warn", "insights_partial", { code: insightError.code });
    }

    const total = result.usage.total;
    await admin.from("ai_usage_events").insert({
      user_id: userId,
      contact_id: contactId,
      purpose: "conversation_analysis",
      model: result.model,
      prompt_version: ANALYSIS_PROMPT_VERSION,
      input_tokens: result.usage.input,
      output_tokens: result.usage.output,
      total_tokens: total,
      estimated_cost_usd: estimateCost(result.model, total),
      status: "success",
      duration_ms: Date.now() - started,
    });

    aiLog("info", "analysis_done", {
      contact_id: contactId,
      analyzed: fresh.length,
      tokens: total,
    });
    return { status: "updated", ...(hasMore || media.hasMore ? { reason: "more_messages" } : {}) };
  } catch (error) {
    const gateway = error instanceof AiGatewayError ? error : null;
    const message =
      gateway?.message ?? (error instanceof Error ? error.message : "Falha desconhecida.");

    await admin
      .from("customer_memory")
      .update({ analysis_status: "stale", last_error: message.slice(0, 500) })
      .eq("id", memory.id);

    await admin.from("ai_usage_events").insert({
      user_id: userId,
      contact_id: contactId,
      purpose: "conversation_analysis",
      model: ANALYSIS_MODEL,
      prompt_version: ANALYSIS_PROMPT_VERSION,
      status: "error",
      error_message: message.slice(0, 500),
      duration_ms: Date.now() - started,
    });

    aiLog("error", "analysis_failed", { contact_id: contactId, status: gateway?.status ?? 0 });
    return { status: "failed", reason: message };
  }
}

/**
 * Processa a fila de análise. Chamado por um agendador (pg_cron + pg_net), o
 * que mantém a IA fora do caminho crítico do webhook.
 */
export async function processAnalysisQueue(limit = 5): Promise<{
  processed: number;
  failed: number;
}> {
  const admin = await adminClient();
  const { error: recoveryError } = await admin
    .from("ai_analysis_jobs")
    .update({ status: "pending", claimed_at: null })
    .eq("status", "processing")
    .lt("claimed_at", new Date(Date.now() - 5 * 60_000).toISOString());
  if (recoveryError) throw new Error(recoveryError.message);
  const { data: jobs, error } = await admin
    .from("ai_analysis_jobs")
    .select("*")
    .eq("status", "pending")
    .order("requested_at", { ascending: true })
    .limit(limit);
  if (error) throw new Error(error.message);

  let processed = 0;
  let failed = 0;

  for (const job of jobs ?? []) {
    // Claim atômico: duas execuções simultâneas nunca pegam o mesmo job.
    const claimedAt = new Date().toISOString();
    const { data: claimed } = await admin
      .from("ai_analysis_jobs")
      .update({
        status: "processing",
        claimed_at: claimedAt,
        attempts: job.attempts + 1,
      })
      .eq("id", job.id)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();
    if (!claimed) continue;

    const outcome = await analyzeContact(job.user_id, job.contact_id, {
      conversationId: job.conversation_id,
      force: job.reason === "manual",
    }).catch((error): AnalysisOutcome => ({
      status: "failed",
      reason: error instanceof Error ? error.message : "Falha ao analisar a conversa.",
    }));

    if (outcome.reason === "more_messages") {
      await admin
        .from("ai_analysis_jobs")
        .update({ status: "pending", claimed_at: null, attempts: 0 })
        .eq("id", job.id)
        .eq("claimed_at", claimedAt);
      processed += 1;
      continue;
    }
    if (outcome.status === "failed" && job.attempts + 1 < MAX_ATTEMPTS) {
      await admin
        .from("ai_analysis_jobs")
        .update({ status: "pending", last_error: outcome.reason ?? null, claimed_at: null })
        .eq("id", job.id)
        .eq("claimed_at", claimedAt);
      failed += 1;
      continue;
    }

    await admin
      .from("ai_analysis_jobs")
      .update({
        status: outcome.status === "failed" ? "failed" : "done",
        last_error: outcome.reason ?? null,
        finished_at: new Date().toISOString(),
      })
      .eq("id", job.id)
      .eq("claimed_at", claimedAt);

    if (outcome.status === "failed") failed += 1;
    else processed += 1;
  }

  return { processed, failed };
}

export { loadMemory };
