/**
 * Prompts centralizados server-side.
 *
 * Nenhum prompt vive no frontend. O comportamento é versionado em
 * `ANALYSIS_PROMPT_VERSION` — mudanças de comportamento devem subir a versão
 * para permitir auditoria do que gerou cada memória.
 */

import { CUSTOMER_INTENTS, INSIGHT_TYPES, INTEREST_LEVELS, SENTIMENTS } from "./types";

export const ANALYSIS_MODEL = "google/gemini-3.7-flash";
export const ANALYSIS_PROMPT_VERSION = "conversation-memory@1";

export const ANALYSIS_SYSTEM_PROMPT = `Você é um analista comercial que mantém a memória estruturada de um cliente a partir de conversas de WhatsApp.

REGRAS ABSOLUTAS
- Nunca invente informação. Se algo não foi dito, deixe de fora.
- Você recebe a MEMÓRIA ANTERIOR e apenas as MENSAGENS NOVAS. Retorne o estado COMPLETO e atualizado.
- Preserve fatos anteriores que continuam válidos, mesmo que as mensagens novas não os mencionem.
- Só remova ou altere um fato anterior se as mensagens novas o contradisserem explicitamente.
- Campos marcados como "confirmado pelo usuário" na memória anterior não devem ser contestados: repita-os como estão.
- Toda inferência importante recebe confiança entre 0 e 1. Use valores baixos quando o sinal for fraco.
- Responda somente com o JSON do schema, em português do Brasil.

RESUMO (current_summary)
Texto curto e objetivo (máximo 6 linhas, orientado a vendas) respondendo: quem é o cliente, o que ele quer, onde estamos, o que impede o avanço, o que ficou combinado e qual parece ser o próximo passo.

CLASSIFICAÇÕES
- interest_level: ${INTEREST_LEVELS.join(" | ")}
- sentiment: ${SENTIMENTS.join(" | ")}
- customer_intent: ${CUSTOMER_INTENTS.join(" | ")}

INSIGHTS
Registre em "insights" cada informação identificada individualmente, com tipo entre: ${INSIGHT_TYPES.join(", ")}.
Inclua datas e promessas ("me chama sexta", "falo semana que vem", "mando o documento amanhã") como insights com o texto original citado e a data interpretada em due_date (ISO ou vazio quando incerto). Não agende nada.
Se o cliente pedir para não receber mensagens, marque do_not_contact = true e crie o insight do_not_contact.`;

/** Schema estrito enviado ao modelo (structured output). */
export const ANALYSIS_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "current_summary",
    "customer_intent",
    "interest_level",
    "sentiment",
    "next_step_detected",
    "do_not_contact",
    "confidence",
    "lists",
    "insights",
  ],
  properties: {
    current_summary: { type: "string" },
    customer_intent: { type: "string", enum: [...CUSTOMER_INTENTS] },
    interest_level: { type: "string", enum: [...INTEREST_LEVELS] },
    sentiment: { type: "string", enum: [...SENTIMENTS] },
    next_step_detected: { type: "string" },
    do_not_contact: { type: "boolean" },
    confidence: { type: "number" },
    lists: {
      type: "object",
      additionalProperties: false,
      required: [
        "main_objections",
        "pending_information",
        "customer_commitments",
        "seller_commitments",
        "important_dates",
        "products_or_services",
        "relevant_values",
        "decision_factors",
        "competitors",
      ],
      properties: Object.fromEntries(
        [
          "main_objections",
          "pending_information",
          "customer_commitments",
          "seller_commitments",
          "important_dates",
          "products_or_services",
          "relevant_values",
          "decision_factors",
          "competitors",
        ].map((field) => [
          field,
          {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["value", "confidence", "due"],
              properties: {
                value: { type: "string" },
                confidence: { type: "number" },
                due: { type: "string" },
              },
            },
          },
        ]),
      ),
    },
    insights: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["type", "content", "confidence", "due_date"],
        properties: {
          type: { type: "string" },
          content: { type: "string" },
          confidence: { type: "number" },
          due_date: { type: "string" },
        },
      },
    },
  },
} as const;
