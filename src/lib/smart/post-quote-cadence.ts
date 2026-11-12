/**
 * Política de cadência pós-cotação (post_quote_v1). Funções puras, testadas.
 * Instantes em UTC; regras calculadas na data local do fuso comercial.
 */
import { DEFAULT_TIMEZONE, zonedParts } from "@/lib/followup/time";
import { isBusinessDay } from "./business-calendar";

export const POST_QUOTE_POLICY = "post_quote_v1";
export const POST_QUOTE_FLOW_NAME = "Pós-cotação · política v1";
export const POST_QUOTE_MANUAL_PAUSE = "post_quote_manual_pause";
export const POST_QUOTE_MANUAL_PAUSE_LABEL = "Pausado por você.";

export function isPostQuoteManuallyPaused(run: {
  policy_key: string | null;
  status: string;
  stop_reason: string | null;
  next_contact_reason: string | null;
}): boolean {
  return (
    run.policy_key === POST_QUOTE_POLICY &&
    run.status === "paused" &&
    (run.stop_reason === POST_QUOTE_MANUAL_PAUSE ||
      run.next_contact_reason === POST_QUOTE_MANUAL_PAUSE_LABEL)
  );
}
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

export type CadenceStep = { contact: number; days: number; hour: number; goal: string };

/** Contato 1 usa a regra inicial (24h + 10h); os demais somam dias à data local do último contato aceito. */
export const POST_QUOTE_CADENCE: CadenceStep[] = [
  { contact: 1, days: 0, hour: 10, goal: "Entender em que ponto ficou a análise" },
  { contact: 2, days: 3, hour: 15, goal: "Descobrir uma dúvida concreta" },
  { contact: 3, days: 3, hour: 10, goal: "Ajudar a comparar opções" },
  { contact: 4, days: 4, hour: 15, goal: "Entender a principal barreira" },
  { contact: 5, days: 5, hour: 10, goal: "Retomar uma prioridade real" },
  { contact: 6, days: 5, hour: 15, goal: "Oferecer ajuda prática para decidir" },
  { contact: 7, days: 7, hour: 15, goal: "Saber se a contratação segue nos planos" },
  { contact: 8, days: 7, hour: 15, goal: "Encerrar de forma respeitosa" },
];
export const POST_QUOTE_MAX_CONTACTS = POST_QUOTE_CADENCE.length;

/** Instante UTC de uma data/hora local no fuso informado. */
export function localInstant(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute = 0,
  timezone: string = DEFAULT_TIMEZONE,
): Date {
  let guess = Date.UTC(year, month - 1, day, hour, minute);
  for (let i = 0; i < 3; i += 1) {
    const p = zonedParts(new Date(guess), timezone);
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    const target = Date.UTC(year, month - 1, day, hour, minute);
    if (asUtc === target) break;
    guess += target - asUtc;
  }
  return new Date(guess);
}

function atLocalHour(date: Date, hour: number, timezone: string): Date {
  const p = zonedParts(date, timezone);
  return localInstant(p.year, p.month, p.day, hour, 0, timezone);
}

/** Avança dia a dia (mantendo a hora local) até um dia permitido. */
export function nextAllowedDayAt(date: Date, hour: number, timezone = DEFAULT_TIMEZONE): Date {
  let current = atLocalHour(date, hour, timezone);
  for (let i = 0; i < 15 && !isBusinessDay(current, timezone); i += 1) {
    current = atLocalHour(new Date(current.getTime() + DAY_MS), hour, timezone);
  }
  return current;
}

/** Primeiro contato: primeiro dia permitido às 10h com instante >= ativação + 24h. */
export function firstContactAt(activatedAt: Date, timezone = DEFAULT_TIMEZONE): Date {
  const min = activatedAt.getTime() + 24 * HOUR_MS;
  let candidate = nextAllowedDayAt(activatedAt, 10, timezone);
  for (let i = 0; i < 20 && candidate.getTime() < min; i += 1) {
    candidate = nextAllowedDayAt(new Date(candidate.getTime() + DAY_MS), 10, timezone);
  }
  return candidate;
}

/**
 * Próximo contato por silêncio. `doneContacts` = contatos lógicos já aceitos.
 * Retorna null quando o ciclo terminou (8 contatos).
 */
export function nextSilenceContact(input: {
  doneContacts: number;
  activatedAt: Date;
  lastContactAt: Date | null;
  timezone?: string;
}): { contact: number; at: Date; goal: string } | null {
  const tz = input.timezone ?? DEFAULT_TIMEZONE;
  const step = POST_QUOTE_CADENCE[input.doneContacts];
  if (!step) return null;
  if (step.contact === 1 || !input.lastContactAt) {
    return { contact: step.contact, at: firstContactAt(input.activatedAt, tz), goal: step.goal };
  }
  const p = zonedParts(input.lastContactAt, tz);
  const base = localInstant(p.year, p.month, p.day, step.hour, 0, tz);
  const shifted = new Date(base.getTime() + step.days * DAY_MS);
  return { contact: step.contact, at: nextAllowedDayAt(shifted, step.hour, tz), goal: step.goal };
}
