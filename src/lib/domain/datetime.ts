import { format, formatDistanceToNow, isToday as isTodayFns, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";

/**
 * Toda conversão de data/hora da aplicação passa por aqui.
 * Timestamps são persistidos em UTC (timestamptz) e exibidos no fuso local.
 */

export function parseTimestamp(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = parseISO(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDateTime(value: string | null | undefined): string {
  const date = parseTimestamp(value);
  if (!date) return "—";
  return format(date, "dd/MM/yyyy 'às' HH:mm", { locale: ptBR });
}

export function formatDate(value: string | null | undefined): string {
  const date = parseTimestamp(value);
  if (!date) return "—";
  return format(date, "dd/MM/yyyy", { locale: ptBR });
}

export function formatRelative(value: string | null | undefined): string {
  const date = parseTimestamp(value);
  if (!date) return "—";
  return formatDistanceToNow(date, { locale: ptBR, addSuffix: true });
}

export function isToday(value: string | null | undefined): boolean {
  const date = parseTimestamp(value);
  return date ? isTodayFns(date) : false;
}

/** Converte um timestamp ISO para o valor aceito por <input type="datetime-local">. */
export function toDateTimeInputValue(value: string | null | undefined): string {
  const date = parseTimestamp(value);
  if (!date) return "";
  return format(date, "yyyy-MM-dd'T'HH:mm");
}

/** Converte o valor de <input type="datetime-local"> para ISO (UTC). */
export function fromDateTimeInputValue(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
