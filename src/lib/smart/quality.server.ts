/**
 * Smart Flow — controle de qualidade da mensagem.
 *
 * Última defesa contra a queixa mais comum: mensagem genérica, repetida ou
 * "nada a ver" com a conversa. Roda antes de agendar. Nada aqui envia nem
 * chama IA: são checagens determinísticas, portanto rápidas e auditáveis.
 */

const PLACEHOLDER_PATTERNS = [
  /\[[^\]]{0,40}\]/, // [nome do cliente]
  /\{\{?[^}]{0,40}\}?\}/, // {{produto}}
  /\bxxx+\b/i,
  /\b(lorem ipsum|placeholder|preencher)\b/i,
  /\bnome do cliente\b/i,
];

/** Aberturas vazias que, sozinhas, não sustentam um follow-up. */
const GENERIC_ONLY = [
  "tudo bem",
  "tudo bem?",
  "bom dia",
  "boa tarde",
  "boa noite",
  "oi",
  "olá",
  "e ai",
  "e aí",
  "alguma novidade",
  "conseguiu ver",
  "conseguiu analisar",
  "podemos seguir",
];

export type QualityVerdict = "ok" | "review" | "reject";

export interface QualityResult {
  verdict: QualityVerdict;
  reason: string;
  similarity: number;
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(text: string): Set<string> {
  return new Set(
    normalize(text)
      .split(" ")
      .filter((word) => word.length > 3),
  );
}

/** Similaridade de Jaccard entre duas mensagens. */
export function similarity(a: string, b: string): number {
  const left = tokens(a);
  const right = tokens(b);
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const word of left) if (right.has(word)) shared += 1;
  return shared / (left.size + right.size - shared);
}

export interface QualityInput {
  message: string;
  /** Nome do cliente, quando registrado. */
  contactName: string | null;
  /** Textos que já enviamos nesta conversa (mais recentes primeiro). */
  previousOutbound: string[];
  /** Textos que o cliente enviou, usados para conferir se citamos algo real. */
  inboundTexts: string[];
  /** Resumo da memória do cliente, quando existir. */
  memorySummary: string | null;
  /** Fases sensíveis (recusa/encerramento) têm régua própria. */
  sensitivePhase: boolean;
}

/**
 * Avalia a mensagem gerada:
 * - `reject`: não deve ir para o cliente de jeito nenhum (placeholder, cópia);
 * - `review`: pode ser boa, mas precisa da leitura do usuário;
 * - `ok`: segue o caminho normal.
 */
export function reviewMessage(input: QualityInput): QualityResult {
  const message = input.message.trim();

  if (message.length < 15) {
    return { verdict: "reject", reason: "Mensagem muito curta para um follow-up.", similarity: 0 };
  }
  if (message.length > 900) {
    return { verdict: "review", reason: "Mensagem longa demais para WhatsApp.", similarity: 0 };
  }
  for (const pattern of PLACEHOLDER_PATTERNS) {
    if (pattern.test(message)) {
      return {
        verdict: "reject",
        reason: "A mensagem ficou com campo não preenchido (parece modelo).",
        similarity: 0,
      };
    }
  }

  // Repetição do que já enviamos.
  let worst = 0;
  for (const previous of input.previousOutbound.slice(0, 8)) {
    worst = Math.max(worst, similarity(message, previous));
  }
  if (worst >= 0.6) {
    return {
      verdict: "reject",
      reason: "A mensagem repete algo que já enviamos nesta conversa.",
      similarity: worst,
    };
  }
  if (worst >= 0.42) {
    return {
      verdict: "review",
      reason: "A mensagem está parecida com um envio anterior.",
      similarity: worst,
    };
  }

  if (input.sensitivePhase) {
    return { verdict: "ok", reason: "Fase sensível: segue para sua leitura.", similarity: worst };
  }

  // Genérica: nada além de saudação/cobrança padrão.
  const plain = normalize(message);
  const strippedName = input.contactName
    ? plain.replace(normalize(input.contactName), " ").replace(/\s+/g, " ").trim()
    : plain;
  const looksGeneric =
    strippedName.split(" ").length <= 12 &&
    GENERIC_ONLY.some((phrase) => strippedName.includes(normalize(phrase)));

  // Cita algo concreto do histórico?
  const context = [...input.inboundTexts, input.memorySummary ?? ""].join(" ");
  const contextWords = new Set(
    normalize(context)
      .split(" ")
      .filter((word) => word.length > 4),
  );
  const messageWords = normalize(message)
    .split(" ")
    .filter((word) => word.length > 4);
  const anchors = messageWords.filter((word) => contextWords.has(word)).length;

  if (contextWords.size >= 12 && anchors === 0) {
    return {
      verdict: "review",
      reason: "A mensagem não cita nada concreto da conversa.",
      similarity: worst,
    };
  }
  if (looksGeneric && anchors < 2) {
    return {
      verdict: "review",
      reason: "A mensagem ficou genérica (só saudação/cobrança).",
      similarity: worst,
    };
  }

  return { verdict: "ok", reason: "Mensagem coerente com o histórico.", similarity: worst };
}
