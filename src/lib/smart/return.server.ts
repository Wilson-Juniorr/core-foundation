/**
 * Saída e volta do agente: registro do motivo, análise de quando voltar,
 * aplicação da volta e instruções do consultor.
 *
 * As decisões passam sempre por `decideReturn` (handoff.ts, testado): a IA
 * propõe, as travas limitam, e a sua instrução vence.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import { completeStructured } from "@/lib/ai/gateway.server";
import { writeAudit } from "@/lib/audit/log.server";
import { logEvent } from "@/lib/crm.server";
import { DEFAULT_TIMEZONE, zonedParts } from "@/lib/followup/time";
import {
  alignToBusinessWindow,
  businessDaysAt,
  decideReturn,
  isSensitiveKind,
  RETURN_MODE_LABELS,
  zonedDateTime,
  type HandoffKind,
  type ReturnMode,
  type ReturnProposal,
} from "./handoff";

type Admin = SupabaseClient<Database>;
type ControlRow = Database["public"]["Tables"]["conversation_control"]["Row"];

const RETURN_MODEL = "google/gemini-3.7-flash";
/** Espera depois da sua última mensagem antes de analisar (você pode mandar várias). */
const RETURN_CHECK_DEBOUNCE_MIN = 30;
/** Estados de acompanhamento que podem ser retomados pela volta do agente. */
export const RESUMABLE_SMART_STATES = ["human_active", "needs_human", "closing"];

const WEEKDAYS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

export function describeWhen(at: Date, timezone = DEFAULT_TIMEZONE): string {
  const p = zonedParts(at, timezone);
  const dow = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
  const hh = String(p.hour).padStart(2, "0");
  const mm = p.minute ? `:${String(p.minute).padStart(2, "0")}` : "h";
  return `${WEEKDAYS[dow]} ${String(p.day).padStart(2, "0")}/${String(p.month).padStart(2, "0")} às ${hh}${mm}`;
}

/* ------------------------------- saída ---------------------------------- */

/**
 * O agente sai da conversa. Mantém o motivo mais sensível e a data da primeira
 * saída; agenda a análise de volta depois de um intervalo curto.
 */
export async function markHandoff(
  db: Admin,
  input: { conversationId: string; kind: HandoffKind; reason: string; at?: string },
): Promise<void> {
  const at = input.at ?? new Date().toISOString();
  const { data: control } = await db
    .from("conversation_control")
    .select("owner, handoff_at, handoff_kind, sensitive_since_handoff")
    .eq("conversation_id", input.conversationId)
    .maybeSingle();

  const already = control?.owner === "human" && Boolean(control?.handoff_at);
  const keepKind =
    already && isSensitiveKind(control?.handoff_kind) && !isSensitiveKind(input.kind);

  await db
    .from("conversation_control")
    .update({
      owner: "human",
      handoff_kind: keepKind ? control!.handoff_kind : input.kind,
      handoff_at: already ? control!.handoff_at : at,
      handoff_reason: keepKind ? undefined : input.reason,
      sensitive_since_handoff:
        (already && Boolean(control?.sensitive_since_handoff)) || isSensitiveKind(input.kind),
      return_check_at: new Date(Date.now() + RETURN_CHECK_DEBOUNCE_MIN * 60_000).toISOString(),
      return_mode: null,
      return_at: null,
      return_reason: null,
      return_source: null,
      force_approval_next: false,
    })
    .eq("conversation_id", input.conversationId);
}

/** Cliente escreveu enquanto a conversa está com você: nada volta até você responder. */
export async function holdForCustomer(db: Admin, conversationId: string): Promise<void> {
  await db
    .from("conversation_control")
    .update({
      return_mode: "hold",
      return_at: null,
      return_reason: "O cliente está esperando a sua resposta.",
      return_source: "rule",
      return_check_at: null,
    })
    .eq("conversation_id", conversationId)
    .eq("owner", "human");
}

/** Pausa os acompanhamentos inteligentes ativos e invalida o que estava preparado. */
export async function pauseSmartRuns(
  db: Admin,
  conversationId: string,
  reason: string,
): Promise<number> {
  const { data: runs } = await db
    .from("followup_runs")
    .select("id, followup_flows!inner(kind)")
    .eq("conversation_id", conversationId)
    .eq("status", "active")
    .eq("followup_flows.kind", "smart");

  for (const run of runs ?? []) {
    await db
      .from("followup_runs")
      .update({ status: "paused", smart_state: "needs_human", paused_at: new Date().toISOString() })
      .eq("id", run.id);
  }

  await db
    .from("scheduled_actions")
    .update({ status: "stale", decision_reason: reason, last_error: "handoff" })
    .eq("conversation_id", conversationId)
    .in("status", ["scheduled", "needs_approval"])
    .not("smart_strategy", "is", null);

  return (runs ?? []).length;
}

async function resumableRuns(db: Admin, conversationId: string) {
  const { data } = await db
    .from("followup_runs")
    .select("id, user_id, contact_id, opportunity_id, status, smart_state, followup_flows!inner(kind)")
    .eq("conversation_id", conversationId)
    .in("status", ["active", "paused"])
    .in("smart_state", RESUMABLE_SMART_STATES)
    .eq("followup_flows.kind", "smart");
  return data ?? [];
}

/* --------------------------- análise da volta ---------------------------- */

const returnSchema = {
  type: "object",
  additionalProperties: false,
  required: ["mode", "business_days", "hour", "reason"],
  properties: {
    mode: { type: "string", enum: ["auto", "confirm", "hold"] },
    business_days: { type: "number" },
    hour: { type: "number" },
    reason: { type: "string" },
  },
} as const;

const RETURN_SYSTEM = `Você ajuda um corretor de planos de saúde a decidir QUANDO o agente de follow-up pós-cotação deve voltar a acompanhar um cliente, depois que o corretor conversou pessoalmente.

O agente só faz follow-up: ele cobra e reage, mas preço, negociação, dúvidas técnicas e fechamento são sempre do corretor.

Escolha:
- "auto": a conversa do corretor terminou e o cliente só ficou de pensar/ver (ex.: "vou ver com minha esposa", "vou analisar"). O agente pode voltar sozinho.
- "confirm": teve assunto delicado (preço, condição, objeção forte, fechamento encaminhado) e o agente só deve voltar com a mensagem aprovada pelo corretor.
- "hold": o corretor ainda está no meio da negociação, prometeu algo, combinou ligação/visita, ou não faz sentido o agente voltar.

business_days: quantos dias úteis esperar (1 a 10). Use o que foi combinado na conversa ("semana que vem" = até segunda; "vou ver com a esposa" = 2 a 3 dias úteis; sem combinação = 2).
hour: hora local (9 a 18) mais adequada; use 10 se não houver pista.
reason: uma frase curta em português explicando a decisão citando algo concreto da conversa.

Responda apenas o JSON pedido.`;

async function aiReturnProposal(
  db: Admin,
  control: ControlRow,
  contactId: string | null,
  now: Date,
): Promise<ReturnProposal | null> {
  try {
    const { data: messages } = await db
      .from("messages")
      .select("direction, message_type, text_content, sent_at, metadata")
      .eq("conversation_id", control.conversation_id)
      .order("sent_at", { ascending: false })
      .limit(25);

    const lines = (messages ?? [])
      .slice()
      .reverse()
      .map((item) => {
        const source = (item.metadata as { source?: string } | null)?.source;
        const who =
          item.direction === "inbound"
            ? "CLIENTE"
            : source === "automation"
              ? "AGENTE"
              : "CORRETOR";
        return `[${item.sent_at}] ${who}: ${item.text_content?.trim() || `(${item.message_type})`}`;
      });

    let memoryLine = "";
    if (contactId) {
      const { data: memory } = await db
        .from("customer_memory")
        .select("current_summary, deal_stage, decision_maker, temperature")
        .eq("contact_id", contactId)
        .is("opportunity_id", null)
        .maybeSingle();
      if (memory) {
        memoryLine = [
          memory.current_summary ? `Resumo: ${memory.current_summary}` : "",
          memory.deal_stage ? `Etapa: ${memory.deal_stage}` : "",
          memory.decision_maker ? `Quem decide: ${memory.decision_maker}` : "",
          memory.temperature ? `Temperatura: ${memory.temperature}` : "",
        ]
          .filter(Boolean)
          .join("\n");
      }
    }

    const { data: notes } = await db
      .from("agent_instructions")
      .select("text, created_at")
      .eq("conversation_id", control.conversation_id)
      .in("status", ["active", "applied"])
      .order("created_at", { ascending: false })
      .limit(5);

    const today = describeWhen(now).split(" às ")[0];
    const user = [
      `Hoje é ${today}.`,
      `Motivo da saída do agente: ${control.handoff_reason ?? control.handoff_kind ?? "corretor assumiu"}`,
      control.sensitive_since_handoff ? "Houve assunto sensível (preço/técnico/fechamento)." : "",
      memoryLine,
      (notes ?? []).length > 0
        ? `Anotações do corretor:\n${(notes ?? []).map((n) => `- ${n.text}`).join("\n")}`
        : "",
      "",
      "Conversa (mais antiga primeiro):",
      ...lines,
    ]
      .filter(Boolean)
      .join("\n");

    const { data } = await completeStructured<{
      mode: ReturnMode;
      business_days: number;
      hour: number;
      reason: string;
    }>({
      model: RETURN_MODEL,
      system: RETURN_SYSTEM,
      user,
      schemaName: "agent_return",
      schema: returnSchema,
    });

    const days = Math.max(1, Math.min(10, Math.round(Number(data.business_days) || 2)));
    const hour = Math.max(9, Math.min(18, Math.round(Number(data.hour) || 10)));
    return {
      mode: data.mode,
      at: data.mode === "hold" ? null : businessDaysAt(now, days, hour),
      reason: data.reason?.trim() || "Análise da conversa.",
    };
  } catch {
    return null;
  }
}

async function latestReturnInstruction(db: Admin, conversationId: string) {
  const { data } = await db
    .from("agent_instructions")
    .select("id, kind, return_mode, return_at, note, text")
    .eq("conversation_id", conversationId)
    .eq("status", "active")
    .in("kind", ["return", "hold"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

/** Analisa uma conversa que está com você e grava o plano de volta. */
export async function computeReturnPlan(db: Admin, control: ControlRow, now = new Date()) {
  const runs = await resumableRuns(db, control.conversation_id);
  if (runs.length === 0) {
    await db
      .from("conversation_control")
      .update({ return_check_at: null })
      .eq("conversation_id", control.conversation_id);
    return "no_run";
  }

  const instruction = await latestReturnInstruction(db, control.conversation_id);
  const { data: promise } = await db
    .from("commitments")
    .select("description, due_at")
    .eq("conversation_id", control.conversation_id)
    .eq("responsible", "human")
    .eq("status", "pending")
    .limit(1)
    .maybeSingle();

  const input = {
    now,
    handoffKind: control.handoff_kind,
    sensitiveSinceHandoff: control.sensitive_since_handoff,
    lastInboundAt: control.last_inbound_at ? new Date(control.last_inbound_at) : null,
    lastHumanAt: control.last_human_message_at ? new Date(control.last_human_message_at) : null,
    pendingHumanPromise: promise
      ? { description: promise.description, dueAt: promise.due_at ? new Date(promise.due_at) : null }
      : null,
    instruction: instruction
      ? {
          mode: (instruction.kind === "hold" ? "hold" : instruction.return_mode) as ReturnMode,
          at: instruction.return_at ? new Date(instruction.return_at) : null,
          reason: instruction.note || instruction.text,
        }
      : null,
    aiProposal: null,
  };

  let decision = decideReturn(input);
  if (decision.source === "fallback") {
    const contactId = runs[0]?.contact_id ?? null;
    const ai = await aiReturnProposal(db, control, contactId, now);
    decision = decideReturn({ ...input, aiProposal: ai });
  }

  await db
    .from("conversation_control")
    .update({
      return_mode: decision.mode,
      return_at: decision.at?.toISOString() ?? null,
      return_reason: decision.reason,
      return_source: decision.source,
      return_check_at: null,
    })
    .eq("conversation_id", control.conversation_id);

  await writeAudit(db, control.user_id, {
    action: "smart_return_planned",
    summary: `Volta do agente: ${RETURN_MODE_LABELS[decision.mode]}${decision.at ? ` — ${describeWhen(decision.at)}` : ""}. ${decision.reason}`,
    entityType: "conversation",
    entityId: control.conversation_id,
    actor: "system",
    metadata: { mode: decision.mode, at: decision.at?.toISOString() ?? null, source: decision.source },
  });

  return `planned_${decision.mode}`;
}

/* ---------------------------- aplicar a volta ---------------------------- */

export async function applyReturn(
  db: Admin,
  control: ControlRow,
  options: { mode: "auto" | "confirm"; source: string; waiveCooldown: boolean },
): Promise<number> {
  const runs = await resumableRuns(db, control.conversation_id);
  const now = new Date().toISOString();

  await db
    .from("conversation_control")
    .update({
      owner: "ai",
      state: "ai_controlled",
      next_responsible: "system",
      next_responsible_reason: "O agente voltou a acompanhar.",
      decision_reason:
        options.mode === "confirm"
          ? "Agente voltou: a próxima mensagem espera o seu ok."
          : "Agente voltou a acompanhar.",
      force_approval_next: options.mode === "confirm",
      cooldown_waived_at: options.waiveCooldown ? now : control.cooldown_waived_at,
      handoff_kind: null,
      handoff_at: null,
      handoff_reason: null,
      sensitive_since_handoff: false,
      return_mode: null,
      return_at: null,
      return_reason: null,
      return_source: null,
      return_check_at: null,
      context_version: control.context_version + 1,
      context_updated_at: now,
    })
    .eq("conversation_id", control.conversation_id);

  for (const run of runs) {
    await db
      .from("followup_runs")
      .update({
        status: "active",
        paused_at: null,
        smart_state: "evaluating",
        next_evaluation_at: now,
      })
      .eq("id", run.id);
  }

  await db
    .from("agent_instructions")
    .update({ status: "applied", applied_at: now })
    .eq("conversation_id", control.conversation_id)
    .eq("status", "active")
    .eq("kind", "return");

  await writeAudit(db, control.user_id, {
    action: "smart_agent_returned",
    summary:
      options.mode === "confirm"
        ? "Agente voltou à conversa; a próxima mensagem precisa do seu ok."
        : "Agente voltou a acompanhar a conversa.",
    entityType: "conversation",
    entityId: control.conversation_id,
    actor: options.source === "manual" ? "user" : "system",
    metadata: { mode: options.mode, source: options.source, runs: runs.length },
  });
  if (runs[0]) {
    await logEvent(db, control.user_id, {
      event_type: "smart_agent_returned",
      contact_id: runs[0].contact_id,
      opportunity_id: runs[0].opportunity_id,
      metadata: { mode: options.mode, source: options.source },
    });
  }
  return runs.length;
}

/** Ciclo do minuto: analisa quem precisa de plano e aplica as voltas vencidas. */
export async function processReturns(
  db: Admin,
  limit = 20,
): Promise<{ planned: number; returned: number }> {
  const now = new Date();
  let planned = 0;
  let returned = 0;

  const { data: toPlan } = await db
    .from("conversation_control")
    .select("*")
    .eq("owner", "human")
    .not("return_check_at", "is", null)
    .lte("return_check_at", now.toISOString())
    .order("return_check_at", { ascending: true })
    .limit(limit);

  for (const control of toPlan ?? []) {
    try {
      const result = await computeReturnPlan(db, control, now);
      if (result.startsWith("planned")) planned += 1;
    } catch (error) {
      console.error("return_plan_failed", control.conversation_id, error);
      // Tenta de novo em 10 minutos, sem travar a fila.
      await db
        .from("conversation_control")
        .update({ return_check_at: new Date(now.getTime() + 10 * 60_000).toISOString() })
        .eq("conversation_id", control.conversation_id);
    }
  }

  const { data: due } = await db
    .from("conversation_control")
    .select("*")
    .eq("owner", "human")
    .in("return_mode", ["auto", "confirm"])
    .not("return_at", "is", null)
    .lte("return_at", now.toISOString())
    .limit(limit);

  for (const control of due ?? []) {
    // Conferência final: cliente escreveu e ninguém respondeu → fica com você.
    const inbound = control.last_inbound_at ? new Date(control.last_inbound_at) : null;
    const human = control.last_human_message_at ? new Date(control.last_human_message_at) : null;
    if (inbound && (!human || inbound > human) && control.return_source !== "instruction") {
      await holdForCustomer(db, control.conversation_id);
      continue;
    }
    const count = await applyReturn(db, control, {
      mode: control.return_mode as "auto" | "confirm",
      source: control.return_source ?? "ai",
      waiveCooldown: control.return_source === "instruction",
    });
    if (count > 0) returned += 1;
  }

  return { planned, returned };
}

/* ------------------------------ instruções ------------------------------- */

export interface InstructionInterpretation {
  kind: "return" | "hold" | "context";
  mode: "auto" | "confirm" | null;
  returnAt: string | null;
  note: string;
  reply: string;
}

const instructionSchema = {
  type: "object",
  additionalProperties: false,
  required: ["kind", "mode", "date", "hour", "note"],
  properties: {
    kind: { type: "string", enum: ["return", "hold", "context"] },
    mode: { type: "string", enum: ["auto", "confirm", "none"] },
    date: { type: "string" },
    hour: { type: "number" },
    note: { type: "string" },
  },
} as const;

const INSTRUCTION_SYSTEM = `Você interpreta instruções de um corretor de planos de saúde para o agente de follow-up de UM cliente.

Classifique:
- "return": o corretor quer que o agente volte a acompanhar (agora ou numa data). Ex.: "volta segunda", "pode voltar, já resolvi o preço", "chama ela daqui 3 dias".
- "hold": o corretor quer que o agente NÃO fale até nova ordem. Ex.: "não fala nada até eu mandar", "deixa comigo".
- "context": é só uma informação para o agente usar. Ex.: "ela já aceitou, só falta o RG", "o marido é quem decide".

mode (só para "return"): "auto" se o corretor liberou o agente a mandar sozinho; "confirm" se pediu para ver antes ("me mostra antes", "manda pra eu aprovar"); padrão "auto". Use "none" para hold/context.
date: data no formato AAAA-MM-DD quando houver data ("segunda", "dia 12", "daqui 3 dias"); vazio "" para agora ou sem data. Use o calendário fornecido.
hour: hora local pedida (9 a 18); 10 se não informada.
note: a informação útil para o agente lembrar, em uma frase curta (ex.: "ela está vendo com o marido"). Vazio se não houver.

Responda apenas o JSON pedido.`;

export async function interpretInstruction(
  text: string,
  now = new Date(),
): Promise<InstructionInterpretation> {
  const calendar: string[] = [];
  for (let i = 0; i < 21; i += 1) {
    const day = new Date(now.getTime() + i * 86_400_000);
    const p = zonedParts(day, DEFAULT_TIMEZONE);
    const iso = `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
    const dow = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
    calendar.push(`${iso} = ${WEEKDAYS[dow]}${i === 0 ? " (hoje)" : i === 1 ? " (amanhã)" : ""}`);
  }

  const { data } = await completeStructured<{
    kind: "return" | "hold" | "context";
    mode: "auto" | "confirm" | "none";
    date: string;
    hour: number;
    note: string;
  }>({
    model: RETURN_MODEL,
    system: INSTRUCTION_SYSTEM,
    user: `Calendário:\n${calendar.join("\n")}\n\nInstrução do corretor: "${text}"`,
    schemaName: "agent_instruction",
    schema: instructionSchema,
  });

  const note = data.note?.trim() ?? "";
  if (data.kind === "hold") {
    return {
      kind: "hold",
      mode: null,
      returnAt: null,
      note,
      reply: `Entendi: não falo nada com esse cliente até você mandar.${note ? ` Vou lembrar: ${note}.` : ""}`,
    };
  }
  if (data.kind === "context") {
    return {
      kind: "context",
      mode: null,
      returnAt: null,
      note: note || text,
      reply: `Anotado. Vou levar isso em conta nas próximas mensagens: ${note || text}.`,
    };
  }

  const mode: "auto" | "confirm" = data.mode === "confirm" ? "confirm" : "auto";
  const hour = Math.max(9, Math.min(18, Math.round(Number(data.hour) || 10)));
  const target =
    /^\d{4}-\d{2}-\d{2}$/.test(data.date ?? "") ? zonedDateTime(data.date, hour) : now;
  const at = alignToBusinessWindow(target > now ? target : now);
  const soon = at.getTime() - now.getTime() < 10 * 60_000;
  return {
    kind: "return",
    mode,
    returnAt: at.toISOString(),
    note,
    reply: `Entendi: volto ${soon ? "agora" : describeWhen(at)}${mode === "confirm" ? ", mas te mostro a mensagem antes de mandar" : ""}.${note ? ` Vou lembrar: ${note}.` : ""}`,
  };
}

export async function saveInstruction(
  db: Admin,
  input: {
    userId: string;
    conversationId: string;
    contactId: string | null;
    text: string;
    interpretation: InstructionInterpretation;
  },
): Promise<void> {
  const { interpretation: it } = input;

  if (it.kind !== "context") {
    await db
      .from("agent_instructions")
      .update({ status: "superseded" })
      .eq("conversation_id", input.conversationId)
      .eq("status", "active")
      .in("kind", ["return", "hold"]);
  }

  const { error } = await db.from("agent_instructions").insert({
    user_id: input.userId,
    conversation_id: input.conversationId,
    contact_id: input.contactId,
    text: input.text,
    kind: it.kind,
    return_mode: it.mode,
    return_at: it.returnAt,
    note: it.note || null,
    agent_reply: it.reply,
  });
  if (error) throw new Error(error.message);

  const { ensureControl } = await import("./control.server");
  await ensureControl(db, input.userId, input.conversationId);

  if (it.kind === "hold") {
    await pauseSmartRuns(db, input.conversationId, "Cancelada pela sua instrução.");
    await db
      .from("conversation_control")
      .update({
        owner: "human",
        state: "human_controlled",
        handoff_kind: "instruction",
        handoff_at: new Date().toISOString(),
        handoff_reason: input.text,
        return_mode: "hold",
        return_at: null,
        return_reason: it.note || "Sua instrução: não falar até você mandar.",
        return_source: "instruction",
        return_check_at: null,
      })
      .eq("conversation_id", input.conversationId);
  } else if (it.kind === "return") {
    const { data: control } = await db
      .from("conversation_control")
      .select("owner")
      .eq("conversation_id", input.conversationId)
      .maybeSingle();
    const future = it.returnAt && new Date(it.returnAt).getTime() > Date.now() + 10 * 60_000;
    if (control?.owner === "ai" && future) {
      // Agente estava ativo e você pediu para ele esperar até a data.
      await pauseSmartRuns(db, input.conversationId, "Reagendada pela sua instrução.");
    }
    await db
      .from("conversation_control")
      .update({
        owner: "human",
        state: "human_controlled",
        handoff_kind: "instruction",
        handoff_at: new Date().toISOString(),
        handoff_reason: input.text,
        return_mode: it.mode,
        return_at: it.returnAt,
        return_reason: it.note || input.text,
        return_source: "instruction",
        return_check_at: null,
      })
      .eq("conversation_id", input.conversationId);
  }

  await writeAudit(db, input.userId, {
    action: "smart_instruction_saved",
    summary: `Instrução para o agente: "${input.text}" → ${it.reply}`,
    entityType: "conversation",
    entityId: input.conversationId,
    metadata: { kind: it.kind, mode: it.mode, return_at: it.returnAt },
  });
}

/** Instruções recentes para o agente levar em conta em cada decisão. */
export async function consultantNotes(db: Admin, conversationId: string): Promise<string[]> {
  const { data } = await db
    .from("agent_instructions")
    .select("text, note, created_at")
    .eq("conversation_id", conversationId)
    .in("status", ["active", "applied"])
    .order("created_at", { ascending: false })
    .limit(8);
  return (data ?? []).map(
    (row) => `${row.created_at.slice(0, 10)}: ${row.note ? `${row.note} (“${row.text}”)` : row.text}`,
  );
}
