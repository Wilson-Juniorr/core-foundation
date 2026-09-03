/**
 * Smart Flow — regras puras e auditáveis.
 *
 * Nada aqui toca banco, rede ou IA: são funções determinísticas usadas pelo
 * decisor, pelo pré-check de envio e pelos testes automatizados.
 */

import { DEFAULT_TIMEZONE, zonedParts } from "@/lib/followup/time";
import type { CommitmentResponsible, SmartStrategy, LossReason } from "./types";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/* ------------------------- calendário no fuso local ------------------------ */

/**
 * Instante UTC correspondente a um horário de parede no fuso informado.
 * Convergimos por aproximação (duas passagens cobrem horário de verão).
 */
export function zonedInstant(
  parts: { year: number; month: number; day: number; hour: number; minute: number },
  timezone: string = DEFAULT_TIMEZONE,
): Date {
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0, 0);
  let guess = new Date(asUtc);
  for (let pass = 0; pass < 2; pass += 1) {
    const local = zonedParts(guess, timezone);
    const localAsUtc = Date.UTC(
      local.year,
      local.month - 1,
      local.day,
      local.hour,
      local.minute,
      0,
      0,
    );
    guess = new Date(guess.getTime() + (asUtc - localAsUtc));
  }
  return guess;
}

/** Próxima ocorrência de um dia da semana (0=domingo) no fuso, às HH:MM. */
export function nextWeekday(
  from: Date,
  weekday: number,
  hour: number,
  timezone: string = DEFAULT_TIMEZONE,
): Date {
  for (let offset = 1; offset <= 7; offset += 1) {
    const candidate = new Date(from.getTime() + offset * DAY_MS);
    const parts = zonedParts(candidate, timezone);
    const dow = new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
    if (dow === weekday) {
      return zonedInstant({ ...parts, hour, minute: 0 }, timezone);
    }
  }
  return new Date(from.getTime() + 7 * DAY_MS);
}

export function atLocalHour(
  from: Date,
  dayOffset: number,
  hour: number,
  timezone: string = DEFAULT_TIMEZONE,
): Date {
  const target = new Date(from.getTime() + dayOffset * DAY_MS);
  const parts = zonedParts(target, timezone);
  return zonedInstant({ ...parts, hour, minute: 0 }, timezone);
}

/* --------------------------- extrator de promessas -------------------------- */

export interface ExtractedCommitment {
  commitment_type: string;
  responsible: CommitmentResponsible;
  description: string;
  due_at: string | null;
  due_window_end: string | null;
  is_ambiguous: boolean;
  confidence: number;
  dedupe_key: string;
}

const WEEKDAYS: Array<{ re: RegExp; day: number; label: string }> = [
  { re: /\b(domingo)\b/i, day: 0, label: "domingo" },
  { re: /\b(segunda(-|\s)?feira|segunda)\b/i, day: 1, label: "segunda" },
  { re: /\b(ter(ç|c)a(-|\s)?feira|ter(ç|c)a)\b/i, day: 2, label: "terça" },
  { re: /\b(quarta(-|\s)?feira|quarta)\b/i, day: 3, label: "quarta" },
  { re: /\b(quinta(-|\s)?feira|quinta)\b/i, day: 4, label: "quinta" },
  { re: /\b(sexta(-|\s)?feira|sexta)\b/i, day: 5, label: "sexta" },
  { re: /\b(s(á|a)bado)\b/i, day: 6, label: "sábado" },
];

const THIRD_PARTY_RE =
  /\b(meu|minha)\s+(marido|esposa|esposo|mulher|s(ó|o)cio|s(ó|o)cia|patr(ã|a)o|chefe|contador|filho|filha|pai|m(ã|a)e|fam(í|i)lia)\b/i;

const PART_OF_DAY: Array<{ re: RegExp; hour: number; label: string }> = [
  { re: /\bde\s+manh(ã|a)\b|\bpela\s+manh(ã|a)\b/i, hour: 9, label: "de manhã" },
  { re: /\b(de|à|a)\s+tarde\b/i, hour: 15, label: "à tarde" },
  { re: /\b(de|à|a)\s+noite\b/i, hour: 19, label: "à noite" },
];

function hashKey(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) hash = (hash * 31 + input.charCodeAt(i)) | 0;
  return Math.abs(hash).toString(36);
}

/**
 * Detecta compromissos em linguagem natural (pt-BR). Heurística conservadora:
 * quando a data é ambígua, devolvemos janela em vez de inventar horário.
 */
export function extractCommitments(input: {
  text: string | null;
  direction: "inbound" | "outbound";
  now: Date;
  timezone?: string;
}): ExtractedCommitment[] {
  const text = (input.text ?? "").trim();
  if (text.length < 3) return [];
  const timezone = input.timezone ?? DEFAULT_TIMEZONE;
  const lower = text.toLowerCase();
  const now = input.now;

  const baseResponsible: CommitmentResponsible =
    input.direction === "inbound" ? "customer" : "human";
  const results: ExtractedCommitment[] = [];

  const push = (item: Omit<ExtractedCommitment, "dedupe_key">) => {
    const key = hashKey(
      `${item.commitment_type}|${item.responsible}|${item.due_at ?? item.due_window_end ?? "open"}`,
    );
    if (results.some((existing) => existing.dedupe_key === key)) return;
    results.push({ ...item, dedupe_key: key });
  };

  /* 1. Consulta a terceiro: "vou falar com meu marido". */
  const thirdParty = THIRD_PARTY_RE.exec(text);
  if (
    thirdParty &&
    /\b(vou|preciso|tenho que|quero)\s+(falar|conversar|ver|consultar)/i.test(lower)
  ) {
    push({
      commitment_type: "consult_third_party",
      responsible: "third_party",
      description: `Vai conversar com ${thirdParty[0]} antes de decidir`,
      due_at: null,
      due_window_end: atLocalHour(now, 2, 18, timezone).toISOString(),
      is_ambiguous: true,
      confidence: 0.7,
    });
  }

  /* 2. Dia da semana: "me chama sexta". */
  for (const weekday of WEEKDAYS) {
    if (!weekday.re.test(lower)) continue;
    const partOfDay = PART_OF_DAY.find((part) => part.re.test(lower));
    const responsible: CommitmentResponsible =
      /\b(me\s+chama|me\s+liga|me\s+manda|me\s+avisa)\b/i.test(lower)
        ? input.direction === "inbound"
          ? "human"
          : "human"
        : baseResponsible;
    push({
      commitment_type: "callback_on_weekday",
      responsible,
      description: `Retomar o contato na ${weekday.label}${partOfDay ? ` ${partOfDay.label}` : ""}`,
      due_at: nextWeekday(now, weekday.day, partOfDay?.hour ?? 10, timezone).toISOString(),
      due_window_end: null,
      is_ambiguous: false,
      confidence: 0.75,
    });
    break;
  }

  /* 3. Amanhã / hoje mais tarde. */
  if (/\bamanh(ã|a)\b/i.test(lower)) {
    const partOfDay = PART_OF_DAY.find((part) => part.re.test(lower));
    const responsible: CommitmentResponsible =
      /\b(te\s+(retorno|respondo|falo|chamo|aviso)|volto\s+a\s+falar)\b/i.test(lower)
        ? baseResponsible
        : baseResponsible;
    push({
      commitment_type: "callback_tomorrow",
      responsible,
      description: "Retorno combinado para amanhã",
      due_at: atLocalHour(now, 1, partOfDay?.hour ?? 10, timezone).toISOString(),
      due_window_end: null,
      is_ambiguous: false,
      confidence: 0.8,
    });
  } else if (
    /\b(mais\s+tarde|ainda\s+hoje)\b/i.test(lower) ||
    (PART_OF_DAY.some((part) => part.re.test(lower)) &&
      /\b(me\s+chama|te\s+chamo|te\s+falo|te\s+retorno)\b/i.test(lower))
  ) {
    const partOfDay = PART_OF_DAY.find((part) => part.re.test(lower));
    push({
      commitment_type: "callback_today",
      responsible: baseResponsible,
      description: `Retorno combinado para hoje${partOfDay ? ` ${partOfDay.label}` : " mais tarde"}`,
      due_at: atLocalHour(now, 0, partOfDay?.hour ?? 18, timezone).toISOString(),
      due_window_end: null,
      is_ambiguous: !partOfDay,
      confidence: 0.65,
    });
  }

  /* 4. Dia do mês: "recebo dia 5". */
  const dayOfMonth = /\bdia\s+(\d{1,2})\b/i.exec(lower);
  if (dayOfMonth) {
    const day = Number(dayOfMonth[1]);
    if (day >= 1 && day <= 31) {
      const parts = zonedParts(now, timezone);
      let target = zonedInstant({ ...parts, day, hour: 10, minute: 0 }, timezone);
      if (target.getTime() < now.getTime()) {
        const nextMonth = parts.month === 12 ? 1 : parts.month + 1;
        const year = parts.month === 12 ? parts.year + 1 : parts.year;
        target = zonedInstant({ year, month: nextMonth, day, hour: 10, minute: 0 }, timezone);
      }
      push({
        commitment_type: "date_reference",
        responsible: baseResponsible,
        description: `Data citada na conversa: dia ${day}`,
        due_at: target.toISOString(),
        due_window_end: null,
        is_ambiguous: false,
        confidence: 0.6,
      });
    }
  }

  /* 5. Janelas vagas — nunca viram horário exato. */
  const vague: Array<{ re: RegExp; days: number; label: string }> = [
    { re: /\bsemana\s+que\s+vem|pr(ó|o)xima\s+semana\b/i, days: 7, label: "semana que vem" },
    { re: /\bm(ê|e)s\s+que\s+vem|pr(ó|o)ximo\s+m(ê|e)s\b/i, days: 30, label: "mês que vem" },
    { re: /\bfinal\s+do\s+m(ê|e)s\b/i, days: 15, label: "final do mês" },
    { re: /\bdepois\s+das?\s+f(é|e)rias\b/i, days: 30, label: "depois das férias" },
    { re: /\bmais\s+para\s+frente|mais\s+pra\s+frente\b/i, days: 21, label: "mais para frente" },
  ];
  for (const item of vague) {
    if (!item.re.test(lower)) continue;
    push({
      commitment_type: "vague_window",
      responsible: baseResponsible,
      description: `Cliente pediu para retomar ${item.label}`,
      due_at: null,
      due_window_end: atLocalHour(now, item.days, 10, timezone).toISOString(),
      is_ambiguous: true,
      confidence: 0.55,
    });
    break;
  }

  /* 6. Compromisso explícito do consultor. */
  if (
    input.direction === "outbound" &&
    /\b(vou\s+(verificar|checar|ver|confirmar|consultar|cotar|simular)|j(á|a)\s+te\s+(retorno|falo|aviso)|te\s+(retorno|aviso|falo|mando))\b/i.test(
      lower,
    )
  ) {
    push({
      commitment_type: "seller_will_return",
      responsible: "human",
      description: "Você assumiu que retornaria com uma informação",
      due_at: /\bamanh(ã|a)\b/i.test(lower)
        ? atLocalHour(now, 1, 10, timezone).toISOString()
        : atLocalHour(now, 1, 10, timezone).toISOString(),
      due_window_end: null,
      is_ambiguous: false,
      confidence: 0.7,
    });
  }

  return results;
}

/* ------------------------------ sinais críticos ---------------------------- */

const CLOSING_RE =
  /\b(vamos\s+fazer|pode\s+emitir|quero\s+ess[ae]|quero\s+fechar|fechado|manda\s+(a\s+)?documenta(ç|c)(ã|a)o|como\s+(eu\s+)?pago|onde\s+(eu\s+)?assino|me\s+manda\s+(o\s+)?contrato|vamos\s+prosseguir)\b/i;

const IRRITATION_RE =
  /\b(j(á|a)\s+falei|cansei|chato|est(á|a)\s+insistindo|para\s+de\s+insistir|absurdo|ridiculo|rid(í|i)culo|n(ã|a)o\s+enche|me\s+deixa\s+em\s+paz)\b/i;

export function detectClosingSignal(text: string | null): boolean {
  return CLOSING_RE.test(text ?? "");
}

const REFUSAL_RE =
  /\b(n(ã|a)o\s+(tenho|tem)\s+(mais\s+)?interesse|sem\s+interesse|n(ã|a)o\s+quero\s+mais|desisti|desistimos|n(ã|a)o\s+vou\s+(mais\s+)?(fazer|fechar|seguir)|j(á|a)\s+(fechei|contratei|assinei)\s+(com|outro|outra)|escolhi\s+outr[ao]|fiquei\s+com\s+outr[ao]|deixa\s+pra\s+(depois|outra\s+hora)|n(ã|a)o\s+precis[oa]\s+mais|pode\s+(cancelar|encerrar)|me\s+(descadastr|remov)|para\s+de\s+me\s+mandar|n(ã|a)o\s+me\s+mande?\s+mais)\b/i;

/** Recusa explícita do cliente — dispara a fase de recuperação de objeção. */
export function detectExplicitRefusal(text: string | null): boolean {
  return REFUSAL_RE.test(text ?? "");
}

/** Classificação determinística do motivo da recusa (sem custo de IA). */
export function classifyLossReason(text: string | null): LossReason {
  const value = (text ?? "").toLowerCase();
  if (!value.trim()) return "unknown";
  if (
    /(car[oa]|pre(ç|c)o|valor|or(ç|c)amento|caro\s+demais|fora\s+do\s+meu\s+bolso|apertad)/.test(
      value,
    )
  )
    return "price";
  if (
    /(atendimento|demorou|demora|resposta|mal\s+atendid|grosseir|n(ã|a)o\s+me\s+respond)/.test(
      value,
    )
  )
    return "service";
  if (
    /(outr[ao]\s+(corretor|empresa|plano|seguradora|proposta)|j(á|a)\s+(fechei|contratei|assinei)|escolhi\s+outr|fiquei\s+com\s+outr)/.test(
      value,
    )
  )
    return "competitor";
  if (
    /(agora\s+n(ã|a)o|depois|mais\s+pra\s+frente|ano\s+que\s+vem|momento|adiar|deixa\s+pra)/.test(
      value,
    )
  )
    return "timing";
  if (
    /(n(ã|a)o\s+precis|desnecess|resolvi\s+de\s+outr|mudei\s+de\s+planos|sem\s+necessidade)/.test(
      value,
    )
  )
    return "no_need";
  return "unknown";
}

export function detectIrritation(text: string | null): boolean {
  return IRRITATION_RE.test(text ?? "");
}

/* ------------------------------ pressão acumulada ------------------------- */

export interface PressureInput {
  /** Automações e mensagens do consultor nos últimos 7 dias. */
  outboundLast7d: number;
  /** Tentativas consecutivas sem resposta do cliente. */
  unansweredAttempts: number;
  /** Áudios enviados nos últimos 7 dias. */
  audioLast7d: number;
  /** Horas desde o último contato de saída. */
  hoursSinceLastOutbound: number | null;
  /** Cliente pediu prazo / retorno futuro. */
  hasPendingCustomerCommitment: boolean;
  /** Respostas curtas ou negativas recentes. */
  negativeSignals: number;
}

export interface PressureResult {
  score: number;
  factors: Record<string, number>;
}

/** Heurística auditável: 0 = sem pressão, 100 = saturado. */
export function computePressure(input: PressureInput): PressureResult {
  const factors: Record<string, number> = {};

  factors["outbound_volume"] = Math.min(40, input.outboundLast7d * 10);
  factors["unanswered"] = Math.min(30, input.unansweredAttempts * 12);
  factors["audio_volume"] = Math.min(10, input.audioLast7d * 5);
  factors["negative_signals"] = Math.min(15, input.negativeSignals * 8);
  factors["pending_commitment"] = input.hasPendingCustomerCommitment ? 10 : 0;

  // Tempo dilui a pressão.
  const hours = input.hoursSinceLastOutbound;
  factors["recency"] = hours === null ? 0 : hours < 6 ? 15 : hours < 24 ? 8 : hours < 72 ? 0 : -10;

  const score = Object.values(factors).reduce((total, value) => total + value, 0);
  return { score: Math.max(0, Math.min(100, Math.round(score))), factors };
}

/* --------------------------- repetição de estratégia ---------------------- */

export interface StrategyUsage {
  strategy: string;
  used_at: string;
  got_reply: boolean;
}

/**
 * Estratégias que não devem ser reutilizadas agora: usadas duas vezes ou mais
 * sem resposta, ou usadas nos últimos 3 dias.
 */
export function fatiguedStrategies(usage: StrategyUsage[], now: Date): string[] {
  const counts = new Map<string, { total: number; replies: number; last: number }>();
  for (const item of usage) {
    const entry = counts.get(item.strategy) ?? { total: 0, replies: 0, last: 0 };
    entry.total += 1;
    if (item.got_reply) entry.replies += 1;
    entry.last = Math.max(entry.last, new Date(item.used_at).getTime());
    counts.set(item.strategy, entry);
  }

  const fatigued: string[] = [];
  for (const [strategy, entry] of counts) {
    const withoutReply = entry.total - entry.replies;
    if (withoutReply >= 2) fatigued.push(strategy);
    else if (now.getTime() - entry.last < 3 * DAY_MS) fatigued.push(strategy);
  }
  return fatigued;
}

export function pickAllowedStrategy(input: {
  preferred: string | null;
  allowed: string[];
  fatigued: string[];
}): SmartStrategy | null {
  const allowed = input.allowed.filter((item) => item !== "HUMAN_HANDOFF");
  if (input.preferred && allowed.includes(input.preferred)) {
    return input.preferred as SmartStrategy;
  }
  const fresh = allowed.find((item) => !input.fatigued.includes(item));
  return (fresh ?? null) as SmartStrategy | null;
}

/* ----------------------------- pré-check de envio -------------------------- */

export type PreSendVerdict = "send" | "cancel" | "defer" | "stale" | "approval";

export interface PreSendSnapshot {
  now: Date;
  /** Momento em que a mensagem foi gerada pela IA. */
  generatedAt: Date | null;
  /** Versão do contexto usada na geração. */
  actionContextVersion: number | null;
  currentContextVersion: number;
  controlOwner: "ai" | "human" | "none";
  lastHumanMessageAt: Date | null;
  lastInboundAt: Date | null;
  /** Fim do cooldown após intervenção humana. */
  humanCooldownUntil: Date | null;
  pressureScore: number;
  maxPressure: number;
  audioContextUnknown: boolean;
  opportunityClosed: boolean;
  pendingCommitmentDueAt: Date | null;
  conflictingRun: boolean;
  requiresApproval: boolean;
  confidence: number | null;
  confidenceMin: number;
}

export interface PreSendDecision {
  verdict: PreSendVerdict;
  reason: string;
  /** Quando adiar, novo instante mínimo. */
  deferUntil: Date | null;
}

/**
 * Última barreira antes do provider: nenhuma ação inteligente sai só porque
 * chegou o horário. Ordem = prioridade (intervenção humana vence tudo).
 */
export function evaluatePreSend(snapshot: PreSendSnapshot): PreSendDecision {
  const deny = (verdict: PreSendVerdict, reason: string, deferUntil: Date | null = null) => ({
    verdict,
    reason,
    deferUntil,
  });

  if (snapshot.opportunityClosed) {
    return deny("cancel", "A oportunidade foi encerrada antes do envio.");
  }

  if (snapshot.conflictingRun) {
    return deny("cancel", "Existe outro acompanhamento ativo para esta conversa.");
  }

  const generatedAt = snapshot.generatedAt;

  if (snapshot.lastHumanMessageAt && (!generatedAt || snapshot.lastHumanMessageAt > generatedAt)) {
    return deny("cancel", "Você enviou uma mensagem manual depois que esta ação foi preparada.");
  }

  if (snapshot.controlOwner === "human") {
    return deny("cancel", "A conversa está sendo conduzida por você agora.");
  }

  if (snapshot.humanCooldownUntil && snapshot.now < snapshot.humanCooldownUntil) {
    return deny(
      "defer",
      "Intervalo de segurança após intervenção humana ainda em curso.",
      snapshot.humanCooldownUntil,
    );
  }

  if (snapshot.lastInboundAt && (!generatedAt || snapshot.lastInboundAt > generatedAt)) {
    return deny("cancel", "O cliente respondeu depois que esta ação foi preparada.");
  }

  if (
    snapshot.actionContextVersion !== null &&
    snapshot.actionContextVersion !== snapshot.currentContextVersion
  ) {
    return deny("stale", "O contexto da conversa mudou depois da geração desta mensagem.");
  }

  if (snapshot.audioContextUnknown) {
    return deny("approval", "Existe um áudio sem transcrição: revise antes de enviar.");
  }

  if (snapshot.pendingCommitmentDueAt && snapshot.now < snapshot.pendingCommitmentDueAt) {
    return deny(
      "defer",
      "Existe um compromisso pendente com prazo futuro.",
      snapshot.pendingCommitmentDueAt,
    );
  }

  if (snapshot.pressureScore > snapshot.maxPressure) {
    return deny(
      "defer",
      `Pressão acumulada (${snapshot.pressureScore}) acima do limite do fluxo (${snapshot.maxPressure}).`,
      new Date(snapshot.now.getTime() + 2 * DAY_MS),
    );
  }

  if (snapshot.confidence !== null && snapshot.confidence < snapshot.confidenceMin) {
    return deny(
      "approval",
      `Confiança da decisão (${Math.round(snapshot.confidence * 100)}%) abaixo do mínimo do fluxo.`,
    );
  }

  if (snapshot.requiresApproval) {
    return deny("approval", "Este fluxo exige aprovação humana antes do envio.");
  }

  return {
    verdict: "send",
    reason: "Contexto conferido imediatamente antes do envio.",
    deferUntil: null,
  };
}

/** Intervalo de silêncio após uma mensagem manual do consultor. */
export const HUMAN_INTERVENTION_COOLDOWN_HOURS = 24;

export function humanCooldownUntil(
  lastHumanMessageAt: Date,
  hours = HUMAN_INTERVENTION_COOLDOWN_HOURS,
): Date {
  return new Date(lastHumanMessageAt.getTime() + hours * HOUR_MS);
}
