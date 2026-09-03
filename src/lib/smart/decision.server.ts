/**
 * Smart Flow — decisão de acompanhamento.
 *
 * A IA não escreve regra: ela escolhe entre estratégias que o usuário permitiu,
 * dentro do prazo, dos limites e da janela configurados. Quando não há confiança
 * suficiente, o item vai para você — nunca para o cliente.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import { callAiGateway } from "@/lib/ai/gateway.server";
import { fatiguedStrategies, pickAllowedStrategy } from "./rules";
import type { SmartDecision, SmartStrategy } from "./types";
import { SMART_STRATEGIES, SMART_STRATEGY_LABELS } from "./types";

type Admin = SupabaseClient<Database>;
type ConfigRow = Database["public"]["Tables"]["smart_flow_configs"]["Row"];
type ControlRow = Database["public"]["Tables"]["conversation_control"]["Row"];

export const SMART_DECISION_MODEL = "google/gemini-3.7-flash";
export const SMART_DECISION_PROMPT_VERSION = "smart-flow-decision@1";

export interface SmartDecisionInput {
  config: ConfigRow;
  control: ControlRow;
  contactName: string | null;
  objective: string;
  deadlineAt: string | null;
  recentMessages: { direction: string; type: string; text: string | null; at: string }[];
  memorySummary: string | null;
  pendingCommitments: { responsible: string; description: string; due_at: string | null }[];
  recentStrategies: { strategy: string; at: string; got_reply: boolean | null }[];
  attemptsThisWeek: number;
}

const decisionSchema = {
  type: "object",
  additionalProperties: false,
  required: ["action", "strategy", "reason", "confidence", "wait_hours", "next_responsible"],
  properties: {
    action: { type: "string", enum: ["send", "wait", "handoff", "complete"] },
    strategy: { type: "string", enum: [...SMART_STRATEGIES, "none"] },
    reason: { type: "string" },
    confidence: { type: "number" },
    wait_hours: { type: "number" },
    next_responsible: { type: "string", enum: ["customer", "human", "system", "third_party", "none"] },
    message: { type: "string" },
  },
} as const;

function buildPrompt(input: SmartDecisionInput): string {
  const allowed = (input.config.allowed_strategies as string[]).filter((item) =>
    (SMART_STRATEGIES as readonly string[]).includes(item),
  );

  const lines = [
    `Objetivo comercial: ${input.objective}`,
    `Prazo máximo do acompanhamento: ${input.deadlineAt ?? "sem prazo definido"}`,
    `Autonomia configurada: ${input.config.autonomy_mode}`,
    `Estratégias permitidas: ${allowed.map((item) => `${item} (${SMART_STRATEGY_LABELS[item as SmartStrategy] ?? item})`).join(", ")}`,
    `Tentativas nesta semana: ${input.attemptsThisWeek} de ${input.config.max_attempts_per_week}`,
    `Pressão acumulada na conversa: ${input.control.pressure_score}/100 (limite ${input.config.max_pressure_score})`,
    `Estágio de compra estimado: ${input.control.buying_stage}`,
    `Quem está com a bola agora: ${input.control.next_responsible}`,
    `Controle da conversa: ${input.control.owner} / ${input.control.state}`,
    input.control.audio_context_unknown
      ? "ATENÇÃO: existe áudio na conversa que não foi possível transcrever."
      : "",
    input.memorySummary ? `Memória do cliente: ${input.memorySummary}` : "",
    input.pendingCommitments.length > 0
      ? `Compromissos pendentes:\n${input.pendingCommitments
          .map(
            (item) =>
              `- ${item.responsible === "human" ? "consultor" : item.responsible}: ${item.description}${item.due_at ? ` (até ${item.due_at})` : ""}`,
          )
          .join("\n")}`
      : "Sem compromissos pendentes.",
    input.recentStrategies.length > 0
      ? `Estratégias já usadas recentemente: ${input.recentStrategies
          .map((item) => `${item.strategy}${item.got_reply ? " (teve resposta)" : ""}`)
          .join(", ")}`
      : "Nenhuma estratégia usada ainda.",
    "",
    "Últimas mensagens (mais antiga primeiro):",
    ...input.recentMessages.map(
      (item) =>
        `[${item.at}] ${item.direction === "inbound" ? "CLIENTE" : "CONSULTOR"} (${item.type}): ${item.text ?? "(sem texto)"}`,
    ),
  ];

  return lines.filter(Boolean).join("\n");
}

const SYSTEM_PROMPT = `Você é o orquestrador de acompanhamento comercial de um consultor brasileiro.

Sua função é decidir o PRÓXIMO PASSO do acompanhamento, não conversar.

REGRAS ABSOLUTAS:
- Nunca invente preço, prazo, condição, desconto, cobertura ou qualquer dado comercial que não esteja explícito na conversa.
- Nunca assuma no lugar do consultor um compromisso que ele prometeu cumprir. Nesse caso use action="handoff".
- Se o cliente prometeu retorno e o prazo não venceu, use action="wait".
- Se o cliente demonstrou irritação, pediu para parar, ou sinalizou fechamento/negociação concreta, use action="handoff".
- Se o objetivo já foi alcançado ou o cliente recusou definitivamente, use action="complete".
- Só use action="send" quando houver silêncio do cliente sem compromisso pendente e a mensagem fizer sentido no contexto atual.
- A estratégia escolhida deve estar na lista de estratégias permitidas e não deve repetir uma estratégia recém-usada.
- Se a conversa tem áudio não transcrito e a decisão é de risco, prefira handoff.
- confidence entre 0 e 1 reflete o quanto o contexto sustenta a decisão. Seja conservador.
- "message" é uma mensagem curta em português do Brasil, tom humano, sem emoji excessivo, sem prometer nada. Preencha apenas quando action="send".
- wait_hours é quantas horas esperar antes de reavaliar (use 0 quando não se aplica).

Responda apenas o JSON pedido.`;

export async function decideNextStep(
  db: Admin,
  input: SmartDecisionInput,
): Promise<SmartDecision> {
  const allowed = (input.config.allowed_strategies as string[]).filter((item) =>
    (SMART_STRATEGIES as readonly string[]).includes(item),
  ) as SmartStrategy[];

  const fatigued = fatiguedStrategies(input.recentStrategies, new Date());

  try {
    const raw = await callAiGateway<{
      action: "send" | "wait" | "handoff" | "complete";
      strategy: string;
      reason: string;
      confidence: number;
      wait_hours: number;
      next_responsible: string;
      message?: string;
    }>({
      model: SMART_DECISION_MODEL,
      system: SYSTEM_PROMPT,
      user: buildPrompt(input),
      schemaName: "smart_flow_decision",
      schema: decisionSchema as unknown as Record<string, unknown>,
    });

    const confidence = Math.max(0, Math.min(1, Number(raw.confidence ?? 0)));
    let action = raw.action;
    let strategy = pickAllowedStrategy(raw.strategy, allowed, fatigued);

    if (action === "send" && (!strategy || !(raw.message ?? "").trim())) {
      // IA sugeriu envio sem estratégia válida ou sem texto: nunca improvisamos.
      action = "handoff";
      strategy = null;
    }

    return {
      action,
      strategy,
      reason: raw.reason || "Decisão do orquestrador.",
      confidence,
      waitHours: Math.max(0, Math.min(24 * 30, Number(raw.wait_hours ?? 0))),
      nextResponsible: (["customer", "human", "system", "third_party", "none"].includes(
        raw.next_responsible,
      )
        ? raw.next_responsible
        : "system") as SmartDecision["nextResponsible"],
      message: (raw.message ?? "").trim() || null,
      model: SMART_DECISION_MODEL,
      promptVersion: SMART_DECISION_PROMPT_VERSION,
    };
  } catch (error) {
    void db;
    return {
      action: "handoff",
      strategy: null,
      reason: `Não foi possível decidir automaticamente (${error instanceof Error ? error.message : "erro"}). Item entregue a você.`,
      confidence: 0,
      waitHours: 0,
      nextResponsible: "human",
      message: null,
      model: SMART_DECISION_MODEL,
      promptVersion: SMART_DECISION_PROMPT_VERSION,
    };
  }
}
