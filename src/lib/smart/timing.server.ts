/**
 * Smart Flow — horário inteligente.
 *
 * Em vez de enviar em qualquer instante da janela permitida, aprendemos o
 * horário em que *aquele* cliente costuma interagir (mensagens dele e respostas
 * que nossas automações conseguiram) e alinhamos o envio a esse horário.
 *
 * Nada aqui relaxa a janela configurada: o resultado é sempre reconferido por
 * `nextAllowedInstant`, então a janela do usuário/fluxo continua soberana.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import {
  isWithinWindow,
  nextAllowedInstant,
  zonedParts,
  type SendWindow,
} from "@/lib/followup/time";

type Admin = SupabaseClient<Database>;

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;

export interface ContactTiming {
  /** Hora local (0-23) preferida do cliente, quando há sinal suficiente. */
  preferredHour: number | null;
  /** Quantas interações sustentam a preferência. */
  samples: number;
  /** Explicação curta para auditoria/UI. */
  reason: string;
}

/**
 * Descobre a hora local em que o cliente costuma responder.
 *
 * Usa as mensagens recebidas dos últimos 120 dias. Uma resposta pesa mais quando
 * é recente; horas vizinhas recebem peso parcial para evitar decidir por um
 * único horário exato.
 */
export async function learnContactTiming(
  db: Admin,
  conversationId: string,
  timezone: string,
): Promise<ContactTiming> {
  const since = new Date(Date.now() - 120 * DAY_MS).toISOString();
  const { data } = await db
    .from("messages")
    .select("sent_at")
    .eq("conversation_id", conversationId)
    .eq("direction", "inbound")
    .gte("sent_at", since)
    .order("sent_at", { ascending: false })
    .limit(200);

  const rows = data ?? [];
  if (rows.length < 3) {
    return {
      preferredHour: null,
      samples: rows.length,
      reason: "Histórico insuficiente para aprender o horário do cliente.",
    };
  }

  const now = Date.now();
  const weights = new Array<number>(24).fill(0);
  const bump = (hour: number, amount: number) => {
    const index = ((hour % 24) + 24) % 24;
    weights[index] = (weights[index] ?? 0) + amount;
  };
  for (const row of rows) {
    const at = new Date(row.sent_at);
    const ageDays = Math.max(0, (now - at.getTime()) / DAY_MS);
    // Recência: metade do peso a cada 45 dias.
    const weight = Math.pow(0.5, ageDays / 45);
    const hour = zonedParts(at, timezone).hour;
    bump(hour, weight);
    bump(hour - 1, weight * 0.35);
    bump(hour + 1, weight * 0.35);
  }

  let bestHour = 0;
  for (let hour = 1; hour < 24; hour += 1) {
    if ((weights[hour] ?? 0) > (weights[bestHour] ?? 0)) bestHour = hour;
  }

  const total = weights.reduce((sum, value) => sum + value, 0);
  const share = total > 0 ? (weights[bestHour] ?? 0) / total : 0;

  // Sinal fraco: preferimos não forçar horário nenhum.
  if (share < 0.12) {
    return {
      preferredHour: null,
      samples: rows.length,
      reason: "O cliente responde em horários muito variados.",
    };
  }

  return {
    preferredHour: bestHour,
    samples: rows.length,
    reason: `O cliente costuma interagir por volta das ${String(bestHour).padStart(2, "0")}h.`,
  };
}

/**
 * Alinha o instante alvo ao horário preferido do cliente, sem nunca antecipar
 * o alvo e sem sair da janela permitida.
 */
export function alignToPreferredHour(input: {
  target: Date;
  preferredHour: number | null;
  window: SendWindow | null;
  timezone: string;
}): Date {
  const base = nextAllowedInstant(input.target, input.window, input.timezone);
  if (input.preferredHour === null) return base;

  const parts = zonedParts(base, input.timezone);
  const currentMinutes = parts.hour * 60 + parts.minute;
  const wantedMinutes = input.preferredHour * 60;

  // Só empurramos para frente: nunca enviar antes do que a decisão pediu.
  const deltaMinutes =
    (((wantedMinutes - currentMinutes) % (24 * 60)) + 24 * 60) % (24 * 60);
  if (deltaMinutes === 0) return base;

  const candidate = new Date(base.getTime() + deltaMinutes * MINUTE_MS);
  if (!isWithinWindow(candidate, input.window, input.timezone)) return base;
  // Nunca adiar mais de um dia só por causa do horário preferido.
  if (candidate.getTime() - base.getTime() > DAY_MS) return base;
  return candidate;
}
