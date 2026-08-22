/**
 * Prompts do motor de mensagens — só existem no servidor.
 *
 * O usuário nunca escreve prompt: ele preenche campos amigáveis (objetivo,
 * tom, o que mencionar, o que evitar, quando usar) e aqui isso é convertido em
 * instrução. Mudanças de comportamento sobem MESSAGE_PROMPT_VERSION.
 */

import { forbiddenBehaviorLabel } from "./labels";
import type { GenerationContextSnapshot, MessageStrategy } from "./types";

export const MESSAGE_MODEL = "google/gemini-3.7-flash";
export const MESSAGE_PROMPT_VERSION = "strategic-message@1";

/** Regras que valem para qualquer estratégia — não podem ser desligadas na UI. */
export const HARD_RULES = [
  "Nunca invente preço, desconto, condição de pagamento, prazo, cobertura, disponibilidade ou qualquer informação comercial que não esteja no contexto.",
  "Se uma informação é necessária e não está no contexto, escreva a mensagem sem ela ou pergunte — nunca preencha por suposição.",
  "Não crie urgência, escassez ou pressão artificial.",
  "Não prometa nada em nome da empresa.",
  "Não finja que a mensagem foi digitada manualmente naquele instante; escreva de forma natural, sem teatro.",
  "Não negocie valores nem responda negociação sensível: nesses casos peça para o vendedor assumir a conversa.",
  "Se o cliente pediu para não receber mensagens, não escreva mensagem alguma.",
  "Não repita a estrutura das últimas mensagens enviadas (não comece com 'Olá, tudo bem?' ou 'Passando para saber' se já foi usado).",
  "Escreva em português do Brasil, no tom de uma pessoa real conversando no WhatsApp, sem emojis em excesso e sem parecer robô.",
];

/** Converte a estratégia (campos amigáveis) em instrução para o modelo. */
export function compileStrategyInstructions(strategy: MessageStrategy): string {
  const parts: string[] = [];
  parts.push(`ESTRATÉGIA: ${strategy.name} (versão ${strategy.version})`);
  parts.push(`OBJETIVO DESTA MENSAGEM: ${strategy.objective}`);
  parts.push(`TOM: ${strategy.tone}`);
  if (strategy.when_to_use) parts.push(`QUANDO ESTA ESTRATÉGIA É USADA: ${strategy.when_to_use}`);
  if (strategy.should_mention) parts.push(`DEVE MENCIONAR (se houver base no contexto): ${strategy.should_mention}`);
  if (strategy.should_avoid) parts.push(`DEVE EVITAR: ${strategy.should_avoid}`);
  if (strategy.forbidden_behaviors.length > 0) {
    parts.push(
      `PROIBIDO NESTA ESTRATÉGIA:\n${strategy.forbidden_behaviors
        .map((item) => `- ${forbiddenBehaviorLabel(item)}`)
        .join("\n")}`,
    );
  }
  parts.push(`TAMANHO MÁXIMO: cerca de ${strategy.max_length} caracteres.`);
  parts.push(
    strategy.allowed_asset_types.length > 0
      ? `PODE SUGERIR MATERIAL DA BIBLIOTECA dos tipos: ${strategy.allowed_asset_types.join(", ")}. Escolha apenas um item da lista fornecida e apenas se ele realmente ajudar. Nunca invente um material.`
      : "NÃO sugira material da biblioteca nesta estratégia (asset_id deve ficar vazio).",
  );
  return parts.join("\n");
}

export function buildSystemPrompt(strategy: MessageStrategy): string {
  return `Você é o assistente de comunicação comercial de um vendedor. Sua tarefa é PROPOR uma mensagem de follow-up para um cliente específico, com base apenas no contexto registrado no sistema.

Você não é um chatbot: você não conversa com o cliente, você escreve uma proposta de mensagem que o vendedor vai revisar.

REGRAS ABSOLUTAS
${HARD_RULES.map((rule) => `- ${rule}`).join("\n")}

${compileStrategyInstructions(strategy)}

SOBRE O CONTEXTO TEMPORAL
Considere quanto tempo passou desde o último contato, o horário e o dia da semana. Se o cliente prometeu algo ou pediu contato em determinado dia, use isso como motivo real do follow-up.

SE O CONTEXTO FOR INSUFICIENTE OU CONTRADITÓRIO
Escreva uma mensagem curta, honesta e sem suposições (ou marque blocked=true quando não houver motivo legítimo para falar com o cliente) e explique em "notes".

SAÍDA
Responda apenas com o JSON do schema. Em "used_context" liste, em português, quais informações do contexto você usou de fato.`;
}

/** Serializa o contexto de forma legível para o modelo (sem dados sensíveis extras). */
export function buildUserPrompt(
  snapshot: GenerationContextSnapshot,
  objective: string | null,
): string {
  const lines: string[] = [];
  lines.push(`CLIENTE: ${snapshot.contact.name} (primeiro nome: ${snapshot.contact.first_name})`);

  if (snapshot.opportunity) {
    lines.push(
      `OPORTUNIDADE: ${snapshot.opportunity.title} | etapa: ${snapshot.opportunity.stage} | situação: ${snapshot.opportunity.status}` +
        (snapshot.opportunity.next_action ? ` | próximo passo combinado: ${snapshot.opportunity.next_action}` : ""),
    );
  } else {
    lines.push("OPORTUNIDADE: nenhuma registrada.");
  }

  const memory = snapshot.memory;
  if (memory) {
    lines.push("");
    lines.push("MEMÓRIA DO CLIENTE");
    if (memory.summary) lines.push(`Resumo: ${memory.summary}`);
    lines.push(
      `Intenção: ${memory.intent} | Interesse: ${memory.interest} | Sentimento: ${memory.sentiment}`,
    );
    if (memory.next_step) lines.push(`Próximo passo percebido: ${memory.next_step}`);
    const blocks: [string, string[]][] = [
      ["Objeções", memory.objections],
      ["Pendências", memory.pending_information],
      ["Compromissos do cliente", memory.customer_commitments],
      ["Compromissos do vendedor", memory.seller_commitments],
      ["Datas importantes", memory.important_dates],
      ["Produtos/serviços", memory.products],
      ["Valores registrados", memory.values],
    ];
    for (const [label, items] of blocks) {
      if (items.length > 0) lines.push(`${label}: ${items.join("; ")}`);
    }
    if (memory.do_not_contact) lines.push("ATENÇÃO: cliente pediu para não receber mensagens.");
  } else {
    lines.push("");
    lines.push("MEMÓRIA DO CLIENTE: ainda não existe análise.");
  }

  lines.push("");
  lines.push("CONTEXTO TEMPORAL");
  lines.push(
    `Agora: ${snapshot.timing.now_local} (${snapshot.timing.weekday}, fuso ${snapshot.timing.timezone})`,
  );
  lines.push(
    snapshot.timing.hours_since_last_contact === null
      ? "Nunca houve mensagem nesta conversa."
      : `Horas desde a última mensagem: ${snapshot.timing.hours_since_last_contact} (última mensagem foi ${
          snapshot.timing.last_direction === "inbound" ? "do cliente" : "nossa"
        }).`,
  );
  if (snapshot.timing.hours_since_customer_reply !== null) {
    lines.push(`Horas desde a última resposta do cliente: ${snapshot.timing.hours_since_customer_reply}.`);
  }

  if (snapshot.recent_messages.length > 0) {
    lines.push("");
    lines.push("HISTÓRICO RECENTE (mais antigo primeiro)");
    for (const message of snapshot.recent_messages) {
      lines.push(`[${message.direction === "inbound" ? "cliente" : "nós"} · ${message.at}] ${message.text}`);
    }
  }

  if (snapshot.recent_outbound.length > 0) {
    lines.push("");
    lines.push("MENSAGENS QUE JÁ ENVIAMOS (não repita estrutura, abertura nem conteúdo)");
    for (const text of snapshot.recent_outbound) lines.push(`- ${text}`);
  }

  if (snapshot.assets.length > 0) {
    lines.push("");
    lines.push("MATERIAIS DISPONÍVEIS NA BIBLIOTECA (escolha no máximo um, pelo id)");
    for (const asset of snapshot.assets) {
      lines.push(
        `- id: ${asset.id} | ${asset.type} | ${asset.name}${asset.purpose ? ` | finalidade: ${asset.purpose}` : ""}`,
      );
    }
  }

  if (snapshot.gaps.length > 0) {
    lines.push("");
    lines.push(`LACUNAS DE CONTEXTO (não preencha por suposição): ${snapshot.gaps.join("; ")}`);
  }

  if (objective) {
    lines.push("");
    lines.push(`MOTIVO ESPECÍFICO DESTE FOLLOW-UP (informado pelo vendedor): ${objective}`);
  }

  return lines.join("\n");
}

export const MESSAGE_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["message", "asset_id", "asset_rationale", "used_context", "notes", "blocked", "blocked_reason"],
  properties: {
    message: { type: "string" },
    asset_id: { type: "string" },
    asset_rationale: { type: "string" },
    used_context: { type: "array", items: { type: "string" } },
    notes: { type: "string" },
    blocked: { type: "boolean" },
    blocked_reason: { type: "string" },
  },
} as const;

export interface MessageModelOutput {
  message: string;
  asset_id: string;
  asset_rationale: string;
  used_context: string[];
  notes: string;
  blocked: boolean;
  blocked_reason: string;
}
