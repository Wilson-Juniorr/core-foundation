import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import { adminClient } from "@/lib/followup/engine.server";
import { AiGatewayError, completeStructured, estimateCost } from "./gateway.server";
import {
  clamp01,
  ensureMemory,
  isHumanLocked,
  loadMemory,
  mergeLists,
} from "./memory.server";
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

interface AiPayload {
  current_summary: string;
  customer_intent: string;
  interest_level: string;
  sentiment: string;
  next_step_detected: string;
  do_not_contact: boolean;
  confidence: number;
  lists: Record<string, { value: string; confidence: number; due: string }[]>;
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

async function loadMessages(admin: Admin, userId: string, contactId: string, afterId: string | null) {
  const { data: all, error } = await admin
    .from("messages")
    .select("id, direction, message_type, text_content, sent_at")
    .eq("user_id", userId)
    .eq("contact_id", contactId)
    .order("sent_at", { ascending: true })
    .limit(400);
  if (error) throw new Error(error.message);

  const rows = all ?? [];
  const cut = afterId ? rows.findIndex((row) => row.id === afterId) : -1;
  const fresh = rows.slice(cut + 1);
  const context = rows.slice(Math.max(0, cut + 1 - CONTEXT_MESSAGE_LIMIT), cut + 1);
  return { fresh: fresh.slice(-NEW_MESSAGE_LIMIT), context, total: rows.length };
}

type MessageLine = {
  id: string;
  direction: string;
  message_type: string;
  text_content: string | null;
  sent_at: string;
};

function renderMessages(rows: MessageLine[]): string {
  return rows
    .map((row) => {
      const who = row.direction === "inbound" ? "Cliente" : "Vendedor";
      const body =
        row.text_content?.trim() ||
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
    ...lists,
    confirmed.length ? `campos confirmados pelo usuário (não contestar): ${confirmed.join(", ")}` : "",
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
  const { fresh, context, total } = await loadMessages(
    admin,
    userId,
    contactId,
    memory.last_analyzed_message_id,
  );

  if (total === 0) return { status: "skipped", reason: "no_messages" };
  if (fresh.length === 0 && !options.force) return { status: "skipped", reason: "up_to_date" };

  const target = fresh.length > 0 ? fresh : context;
  const lastMessage = target[target.length - 1];

  await admin
    .from("customer_memory")
    .update({ analysis_status: "processing" })
    .eq("id", memory.id);

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
  ].join("\n");

  try {
    const result = await completeStructured<AiPayload>({
      model: ANALYSIS_MODEL,
      system: ANALYSIS_SYSTEM_PROMPT,
      user: userPrompt,
      schemaName: "customer_memory",
      schema: ANALYSIS_JSON_SCHEMA,
    });

    const payload = result.data;
    const patch: Database["public"]["Tables"]["customer_memory"]["Update"] = {
      analysis_status: "ready",
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

    for (const field of MEMORY_LIST_FIELDS) {
      if (isHumanLocked(memory, field)) continue;
      patch[field] = mergeLists(
        memory[field],
        toIncomingItems(payload.lists?.[field], now),
        now,
      ) as unknown as Database["public"]["Tables"]["customer_memory"]["Update"][MemoryListField];
    }

    const { error: updateError } = await admin
      .from("customer_memory")
      .update(patch)
      .eq("id", memory.id);
    if (updateError) throw new Error(updateError.message);

    // Insights: upsert idempotente (índice único por tipo + conteúdo + mensagem).
    const insights = (payload.insights ?? [])
      .filter((item) => item?.content?.trim())
      .slice(0, 25)
      .map((item) => ({
        user_id: userId,
        contact_id: contactId,
        conversation_id: options.conversationId ?? null,
        insight_type: (item.type || "other").slice(0, 60),
        content: item.content.trim().slice(0, 600),
        confidence: clamp01(Number(item.confidence ?? 0)),
        source_message_id: lastMessage?.id ?? null,
        metadata: item.due_date?.trim() ? { due_date: item.due_date.trim() } : {},
      }));
    if (insights.length > 0) {
      const { error: insightError } = await admin
        .from("conversation_insights")
        .upsert(insights, {
          onConflict: "user_id,contact_id,insight_type,md5(content),source_message_id",
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
    return { status: "updated" };
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
    const { data: claimed } = await admin
      .from("ai_analysis_jobs")
      .update({
        status: "processing",
        claimed_at: new Date().toISOString(),
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
    });

    if (outcome.status === "failed" && job.attempts + 1 < MAX_ATTEMPTS) {
      await admin
        .from("ai_analysis_jobs")
        .update({ status: "pending", last_error: outcome.reason ?? null, claimed_at: null })
        .eq("id", job.id);
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
      .eq("id", job.id);

    if (outcome.status === "failed") failed += 1;
    else processed += 1;
  }

  return { processed, failed };
}

export { loadMemory };
