/**
 * Calendário comercial (pt-BR): dias úteis, feriados nacionais e datas
 * relativas ("daqui 3 dias"). Funções puras, testadas.
 */
import { DEFAULT_TIMEZONE, zonedParts } from "@/lib/followup/time";

const DAY_MS = 86_400_000;

function easter(year: number): { month: number; day: number } {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { month, day };
}

function key(y: number, m: number, d: number) {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

const cache = new Map<number, Set<string>>();

/** Feriados nacionais + Carnaval, Sexta-feira Santa e Corpus Christi. */
export function nationalHolidays(year: number): Set<string> {
  const hit = cache.get(year);
  if (hit) return hit;
  const set = new Set<string>(
    ["01-01", "04-21", "05-01", "09-07", "10-12", "11-02", "11-15", "11-20", "12-25"].map(
      (md) => `${year}-${md}`,
    ),
  );
  const e = easter(year);
  const base = Date.UTC(year, e.month - 1, e.day);
  for (const offset of [-48, -47, -2, 60]) {
    const dt = new Date(base + offset * DAY_MS);
    set.add(key(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate()));
  }
  cache.set(year, set);
  return set;
}

export function isBusinessDay(date: Date, timezone: string = DEFAULT_TIMEZONE): boolean {
  const p = zonedParts(date, timezone);
  const dow = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
  if (dow === 0 || dow === 6) return false;
  return !nationalHolidays(p.year).has(key(p.year, p.month, p.day));
}

/** Empurra a data para o próximo dia útil, mantendo o horário local. */
export function toBusinessDay(date: Date, timezone: string = DEFAULT_TIMEZONE): Date {
  let current = date;
  for (let i = 0; i < 10 && !isBusinessDay(current, timezone); i += 1) {
    current = new Date(current.getTime() + DAY_MS);
  }
  return current;
}

/** Soma N dias úteis (para esperas como "vou ver com minha esposa"). */
export function addBusinessDays(
  from: Date,
  days: number,
  timezone: string = DEFAULT_TIMEZONE,
): Date {
  let current = from;
  let added = 0;
  while (added < days) {
    current = new Date(current.getTime() + DAY_MS);
    if (isBusinessDay(current, timezone)) added += 1;
  }
  return current;
}

const NUMBER_WORDS: Record<string, number> = {
  um: 1, uma: 1, dois: 2, duas: 2, tres: 3, "três": 3, quatro: 4, cinco: 5,
  seis: 6, sete: 7, oito: 8, nove: 9, dez: 10, quinze: 15, vinte: 20, trinta: 30,
};

/** Lê "daqui 3 dias", "em dois dias", "daqui a uma semana", "daqui 15 dias". */
export function parseRelativeDays(text: string | null): number | null {
  const lower = (text ?? "").toLowerCase();
  const m =
    /\b(?:daqui\s+(?:a\s+)?|em\s+|dentro\s+de\s+)(\d{1,2}|[a-zçãê]+)\s+(dias?|semanas?)\b/i.exec(
      lower,
    );
  const qty = m?.[1];
  const unit = m?.[2];
  if (!qty || !unit) return null;
  const n = /^\d+$/.test(qty) ? Number(qty) : NUMBER_WORDS[qty];
  if (!n || n <= 0) return null;
  const days = unit.startsWith("semana") ? n * 7 : n;
  return days > 120 ? null : days;
}
