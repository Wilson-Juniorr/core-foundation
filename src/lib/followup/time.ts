/**
 * Toda a matemática de calendário do motor de follow-up vive aqui.
 *
 * Regras centrais:
 * - timestamps são sempre persistidos em UTC (timestamptz);
 * - a janela permitida de envio é interpretada no fuso do usuário;
 * - a janela mais restritiva (global do usuário ∩ fluxo ∩ etapa) vence.
 *
 * Funções puras: nada aqui toca banco, rede ou `Date.now()` implícito.
 */

export type DelayUnit = "minutes" | "hours" | "days";

/**
 * Janela permitida em minutos desde a meia-noite local.
 * `endMinutes` pode passar de 1440 quando a janela cruza a meia-noite
 * (ex.: 20:45 → 00:50 vira 1245 → 1490).
 */
export type SendWindow = { startMinutes: number; endMinutes: number };

export const DEFAULT_TIMEZONE = "America/Sao_Paulo";
export const DEFAULT_WINDOW_START = "08:00";
export const DEFAULT_WINDOW_END = "20:00";

const MINUTE_MS = 60_000;
const DAY_MINUTES = 24 * 60;

/** "HH:MM" ou "HH:MM:SS" → minutos desde a meia-noite. */
export function parseTimeOfDay(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = /^(\d{1,2}):(\d{2})/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

export function formatTimeOfDay(minutes: number): string {
  const safe = ((minutes % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
  const hours = Math.floor(safe / 60);
  return `${String(hours).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}

export function makeWindow(
  start: string | null | undefined,
  end: string | null | undefined,
): SendWindow | null {
  const startMinutes = parseTimeOfDay(start);
  const endMinutes = parseTimeOfDay(end);
  if (startMinutes === null || endMinutes === null) return null;
  // Início igual ao fim significa "sem restrição" (dia inteiro).
  if (endMinutes === startMinutes) return null;
  // Fim menor que o início: a janela cruza a meia-noite (20:45 → 00:50).
  return {
    startMinutes,
    endMinutes: endMinutes > startMinutes ? endMinutes : endMinutes + DAY_MINUTES,
  };
}

function overlap(a: SendWindow, b: SendWindow): SendWindow | null {
  // Compara a janela `b` deslocada em ±1 dia para tratar janelas que cruzam
  // a meia-noite sem depender de qual delas "começa antes".
  for (const shift of [-DAY_MINUTES, 0, DAY_MINUTES]) {
    const start = Math.max(a.startMinutes, b.startMinutes + shift);
    const end = Math.min(a.endMinutes, b.endMinutes + shift);
    if (end > start) return { startMinutes: start, endMinutes: end };
  }
  return null;
}

/**
 * Interseção das janelas informadas, da mais genérica para a mais específica
 * (global → fluxo → etapa); a mais restritiva vence.
 *
 * Quando as configurações não têm nenhuma hora em comum, a janela mais
 * específica prevalece em vez de colapsar em um instante único — colapsar
 * gerava saltos de quase 24 horas no agendamento.
 */
export function mergeWindows(...windows: Array<SendWindow | null>): SendWindow | null {
  let result: SendWindow | null = null;
  for (const window of windows) {
    if (!window) continue;
    if (!result) {
      result = { ...window };
      continue;
    }
    result = overlap(result, window) ?? { ...window };
  }
  return result;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timezone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timezone);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  formatterCache.set(timezone, formatter);
  return formatter;
}

export function isValidTimezone(timezone: string): boolean {
  try {
    formatterFor(timezone).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function safeTimezone(timezone: string | null | undefined): string {
  if (timezone && isValidTimezone(timezone)) return timezone;
  return DEFAULT_TIMEZONE;
}

type Parts = { year: number; month: number; day: number; hour: number; minute: number };

/** Componentes de parede (wall clock) do instante no fuso informado. */
export function zonedParts(date: Date, timezone: string): Parts {
  const parts = formatterFor(safeTimezone(timezone)).formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");
  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: read("hour"),
    minute: read("minute"),
  };
}

export function zonedMinutesOfDay(date: Date, timezone: string): number {
  const parts = zonedParts(date, timezone);
  return parts.hour * 60 + parts.minute;
}

/**
 * Move o instante para o próximo horário permitido pela janela, no fuso do
 * usuário. Se já estiver dentro da janela, devolve o próprio instante.
 */
export function nextAllowedInstant(date: Date, window: SendWindow | null, timezone: string): Date {
  if (!window) return date;
  const zone = safeTimezone(timezone);

  let current = date;
  // Duas passagens bastam: a primeira alinha o horário, a segunda corrige
  // eventual mudança de offset (horário de verão) causada pelo salto.
  for (let pass = 0; pass < 3; pass += 1) {
    const minutes = zonedMinutesOfDay(current, zone);
    if (minutes < window.startMinutes) {
      current = new Date(current.getTime() + (window.startMinutes - minutes) * MINUTE_MS);
      continue;
    }
    if (minutes >= window.endMinutes) {
      const delta = DAY_MINUTES - minutes + window.startMinutes;
      current = new Date(current.getTime() + delta * MINUTE_MS);
      continue;
    }
    return current;
  }
  return current;
}

export function isWithinWindow(date: Date, window: SendWindow | null, timezone: string): boolean {
  if (!window) return true;
  const minutes = zonedMinutesOfDay(date, safeTimezone(timezone));
  return minutes >= window.startMinutes && minutes < window.endMinutes;
}

export function delayToMinutes(value: number, unit: DelayUnit): number {
  if (unit === "minutes") return value;
  if (unit === "hours") return value * 60;
  return value * 60 * 24;
}

export function addDelay(from: Date, value: number, unit: DelayUnit): Date {
  return new Date(from.getTime() + delayToMinutes(value, unit) * MINUTE_MS);
}

/**
 * Calcula o instante de execução de uma ação: aplica o intervalo, respeita a
 * janela permitida e nunca devolve um horário no passado.
 */
export function computeScheduledFor(input: {
  from: Date;
  now: Date;
  delayValue: number;
  delayUnit: DelayUnit;
  window: SendWindow | null;
  timezone: string;
}): Date {
  const target = addDelay(input.from, input.delayValue, input.delayUnit);
  const notInPast = target.getTime() < input.now.getTime() ? input.now : target;
  return nextAllowedInstant(notInPast, input.window, input.timezone);
}

export function describeDelay(value: number, unit: DelayUnit): string {
  if (value === 0) return "imediatamente";
  const labels: Record<DelayUnit, [string, string]> = {
    minutes: ["minuto", "minutos"],
    hours: ["hora", "horas"],
    days: ["dia", "dias"],
  };
  const [singular, plural] = labels[unit];
  return `após ${value} ${value === 1 ? singular : plural}`;
}
