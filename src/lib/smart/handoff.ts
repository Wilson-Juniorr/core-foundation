/**
 * Saída e volta do agente na conversa (funções puras, testadas).
 *
 * Regra de ouro: cada conversa tem um dono. Quem decide QUANDO o agente volta
 * é uma análise do histórico (IA) ou a instrução do consultor — mas as travas
 * daqui são soberanas: a IA nunca consegue passar por cima delas.
 */
import { DEFAULT_TIMEZONE, makeWindow, nextAllowedInstant, zonedParts } from "@/lib/followup/time";
import { isBusinessDay, toBusinessDay } from "./business-calendar";

/* ------------------------------- motivos -------------------------------- */

export const HANDOFF_KINDS = [
  "manual",
  "price",
  "technical",
  "closing",
  "irritation",
  "human_promise",
  "audio_unknown",
  "low_confidence",
  "instruction",
] as const;
export type HandoffKind = (typeof HANDOFF_KINDS)[number];

export const HANDOFF_KIND_LABELS: Record<HandoffKind, string> = {
  manual: "Você mandou mensagem",
  price: "Cliente falou de preço",
  technical: "Pergunta técnica do cliente",
  closing: "Cliente quer fechar",
  irritation: "Cliente incomodado",
  human_promise: "Você prometeu um retorno",
  audio_unknown: "Áudio não entendido",
  low_confidence: "Agente ficou em dúvida",
  instruction: "Sua instrução",
};

/** Assuntos que, depois de passarem por você, nunca deixam o agente voltar sozinho. */
export const SENSITIVE_KINDS: ReadonlySet<HandoffKind> = new Set([
  "price",
  "technical",
  "closing",
  "irritation",
]);

export function isSensitiveKind(kind: string | null | undefined): boolean {
  return Boolean(kind) && SENSITIVE_KINDS.has(kind as HandoffKind);
}

const PRICE_RE =
  /\b(car[oa]s?|pre(ç|c)o|valor(es)?|desconto|mais\s+barat[oa]|abaix(a|ar)|negoci(a|ar)|condi(ç|c)(ã|a)o|parcel(a|ar)|mensalidade|quanto\s+(fica|custa|sai)|t(á|a)\s+puxad[oa]|fora\s+do\s+(meu\s+)?or(ç|c)amento)\b/i;

const TECHNICAL_RE =
  /\b(car(ê|e)ncia|rede\s+(credenciada|de\s+atendimento)|credenciad[oa]|coparticipa(ç|c)(ã|a)o|copart|reembolso|cobertura|cobre|hospita(l|is)|laborat(ó|o)rio|pronto[\s-]?socorro|maternidade|parto|doen(ç|c)a\s+pr(é|e)[\s-]?existente|cpt|abrang(ê|e)ncia|enfermaria|apartamento|portabilidade|dependente|rol\s+da\s+ans)\b/i;

/** Cliente falou de preço, desconto ou negociação. */
export function detectPriceTalk(text: string | null): boolean {
  return PRICE_RE.test(text ?? "");
}

/** Dúvida técnica de plano de saúde (carência, rede, coparticipação...). */
export function detectTechnicalQuestion(text: string | null): boolean {
  return TECHNICAL_RE.test(text ?? "");
}

/* --------------------------- janela de retorno --------------------------- */

export const RETURN_WINDOW_START = "09:00";
export const RETURN_WINDOW_END = "19:00";
/** Silêncio mínimo depois da sua última mensagem antes de o agente voltar. */
export const MIN_SILENCE_HOURS = 24;
/** Quando a análise falha, o agente espera este número de dias úteis. */
export const FALLBACK_BUSINESS_DAYS = 2;

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** Próximo instante em dia útil, entre 9h e 19h no fuso informado. */
export function alignToBusinessWindow(date: Date, timezone: string = DEFAULT_TIMEZONE): Date {
  const window = makeWindow(RETURN_WINDOW_START, RETURN_WINDOW_END);
  let current = date;
  for (let i = 0; i < 12; i += 1) {
    current = nextAllowedInstant(current, window, timezone);
    if (isBusinessDay(current, timezone)) return current;
    // Pula para o início do próximo dia útil.
    const next = toBusinessDay(new Date(current.getTime() + DAY_MS), timezone);
    const p = zonedParts(next, timezone);
    current = zonedDateTime(
      `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`,
      9,
      timezone,
    );
  }
  return current;
}

/** "2026-11-09" às 10h no fuso informado → instante UTC. */
export function zonedDateTime(
  date: string,
  hour: number,
  timezone: string = DEFAULT_TIMEZONE,
): Date {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const wanted = Date.UTC(y, m - 1, d, hour, 0);
  let guess = new Date(wanted + 3 * HOUR_MS);
  for (let i = 0; i < 3; i += 1) {
    const p = zonedParts(guess, timezone);
    const seen = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    const diff = wanted - seen;
    if (diff === 0) break;
    guess = new Date(guess.getTime() + diff);
  }
  return guess;
}

/** Soma dias úteis a partir de uma data e cai às `hour` horas locais. */
export function businessDaysAt(
  from: Date,
  days: number,
  hour: number,
  timezone: string = DEFAULT_TIMEZONE,
): Date {
  let current = from;
  let added = 0;
  while (added < days) {
    current = new Date(current.getTime() + DAY_MS);
    if (isBusinessDay(current, timezone)) added += 1;
  }
  const p = zonedParts(current, timezone);
  return zonedDateTime(
    `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`,
    hour,
    timezone,
  );
}

/* ----------------------------- decisão de volta --------------------------- */

export type ReturnMode = "auto" | "confirm" | "hold";

export const RETURN_MODE_LABELS: Record<ReturnMode, string> = {
  auto: "Volta direto",
  confirm: "Avisa e espera seu ok",
  hold: "Fica com você",
};

export interface ReturnProposal {
  mode: ReturnMode;
  at: Date | null;
  reason: string;
}

export interface ReturnInput {
  now: Date;
  timezone?: string;
  handoffKind: string | null;
  /** Algum assunto sensível passou por você desde a saída do agente. */
  sensitiveSinceHandoff: boolean;
  lastInboundAt: Date | null;
  lastHumanAt: Date | null;
  /** Promessa sua ainda pendente (com ou sem prazo). */
  pendingHumanPromise: { dueAt: Date | null; description: string } | null;
  /** Sua última instrução ativa de volta/espera — sempre vence a análise. */
  instruction: ReturnProposal | null;
  /** Proposta da IA depois de ler a conversa. `null` quando a análise falhou. */
  aiProposal: ReturnProposal | null;
}

export interface ReturnDecision extends ReturnProposal {
  source: "instruction" | "rule" | "ai" | "fallback";
}

/**
 * Decide se o agente volta, quando e de que jeito.
 * Ordem: sua instrução → travas → proposta da IA (limitada pelas travas).
 */
export function decideReturn(input: ReturnInput): ReturnDecision {
  const tz = input.timezone ?? DEFAULT_TIMEZONE;
  const sensitive = input.sensitiveSinceHandoff || isSensitiveKind(input.handoffKind);

  // 1. Sua instrução sempre vence.
  if (input.instruction) {
    const { mode, at, reason } = input.instruction;
    if (mode === "hold") return { mode, at: null, reason, source: "instruction" };
    return {
      mode,
      at: alignToBusinessWindow(at && at > input.now ? at : input.now, tz),
      reason,
      source: "instruction",
    };
  }

  // 2. Cliente esperando resposta sua: o agente nunca responde por você.
  if (input.lastInboundAt && (!input.lastHumanAt || input.lastInboundAt > input.lastHumanAt)) {
    return {
      mode: "hold",
      at: null,
      reason: "O cliente está esperando a sua resposta.",
      source: "rule",
    };
  }

  // 3. Promessa sua em aberto: fica com você.
  if (input.pendingHumanPromise) {
    return {
      mode: "hold",
      at: null,
      reason: `Você tem um retorno prometido: ${input.pendingHumanPromise.description}`,
      source: "rule",
    };
  }

  const earliest = new Date(
    Math.max(
      input.now.getTime(),
      (input.lastHumanAt?.getTime() ?? input.now.getTime()) + MIN_SILENCE_HOURS * HOUR_MS,
    ),
  );

  // 4. Proposta da IA, limitada pelas travas.
  if (input.aiProposal) {
    const { reason } = input.aiProposal;
    if (input.aiProposal.mode === "hold") {
      return { mode: "hold", at: null, reason, source: "ai" };
    }
    const mode: ReturnMode = sensitive ? "confirm" : input.aiProposal.mode;
    const wanted = input.aiProposal.at && input.aiProposal.at > earliest ? input.aiProposal.at : earliest;
    return {
      mode,
      at: alignToBusinessWindow(wanted, tz),
      reason:
        sensitive && input.aiProposal.mode === "auto"
          ? `${reason} (assunto sensível: precisa do seu ok)`
          : reason,
      source: "ai",
    };
  }

  // 5. Análise indisponível: espera padrão, nunca volta direto em assunto sensível.
  const fallbackAt = businessDaysAt(input.lastHumanAt ?? input.now, FALLBACK_BUSINESS_DAYS, 10, tz);
  return {
    mode: sensitive ? "confirm" : "auto",
    at: alignToBusinessWindow(fallbackAt > earliest ? fallbackAt : earliest, tz),
    reason: "Cliente em silêncio depois da sua conversa.",
    source: "fallback",
  };
}

/* ------------------------------ alertas --------------------------------- */

export const ALERT_WINDOW_START_HOUR = 8;
export const ALERT_WINDOW_END_HOUR = 20;

/** Alertas saem na hora em dia útil, das 8h às 20h; senão vão pro resumo das 8h. */
export function alertSendAfter(now: Date, timezone: string = DEFAULT_TIMEZONE): Date {
  const window = makeWindow("08:00", "20:00");
  let current = now;
  for (let i = 0; i < 12; i += 1) {
    current = nextAllowedInstant(current, window, timezone);
    if (isBusinessDay(current, timezone)) return current;
    const next = toBusinessDay(new Date(current.getTime() + DAY_MS), timezone);
    const p = zonedParts(next, timezone);
    current = zonedDateTime(
      `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`,
      ALERT_WINDOW_START_HOUR,
      timezone,
    );
  }
  return current;
}

/**
 * Cliente esperando: respondeu, ninguém falou depois e já passou o limite.
 * Um alerta por resposta do cliente.
 */
export function customerWaitingTooLong(input: {
  now: Date;
  lastInboundAt: Date | null;
  lastOutboundAt: Date | null;
  lastAlertedInboundAt: Date | null;
  thresholdMinutes: number;
}): boolean {
  const { now, lastInboundAt, lastOutboundAt, lastAlertedInboundAt } = input;
  if (!lastInboundAt) return false;
  if (lastOutboundAt && lastOutboundAt >= lastInboundAt) return false;
  if (lastAlertedInboundAt && lastAlertedInboundAt >= lastInboundAt) return false;
  const waited = now.getTime() - lastInboundAt.getTime();
  // Respostas muito antigas (mais de 24h) não geram alerta de urgência.
  return waited >= input.thresholdMinutes * 60_000 && waited <= DAY_MS;
}

/**
 * Mensagem que chegou pelo webhook é eco do próprio envio automático?
 * Casa com uma automação recente (até 3 min) na mesma conversa, mesmo tipo e texto.
 */
export function isAutomationEcho(
  incoming: { type: string; text: string | null; at: Date },
  recentAutomation: { type: string; text: string | null; at: Date }[],
): boolean {
  const norm = (value: string | null) => (value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  return recentAutomation.some((item) => {
    if (Math.abs(incoming.at.getTime() - item.at.getTime()) > 3 * 60_000) return false;
    if (item.type !== incoming.type) return false;
    if (incoming.type === "text") return norm(item.text) === norm(incoming.text);
    return true;
  });
}
