/**
 * Smart Flow — aprendizado por resultado.
 *
 * O sistema já registrava cada estratégia usada e se houve resposta
 * (`smart_strategy_usage`), mas não usava esse histórico para decidir. Aqui ele
 * passa a valer: estratégias que geram resposta sobem, estratégias que só geram
 * silêncio descem — sempre dentro do que o usuário permitiu no fluxo.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";

type Admin = SupabaseClient<Database>;

const DAY_MS = 86_400_000;

export interface StrategyPerformance {
  strategy: string;
  sent: number;
  replies: number;
  /** Taxa de resposta suavizada (Laplace), comparável com poucas amostras. */
  score: number;
}

/**
 * Desempenho histórico das estratégias deste usuário (últimos 120 dias).
 * Ordenado da mais eficaz para a menos eficaz.
 */
export async function strategyPerformance(
  db: Admin,
  userId: string,
): Promise<StrategyPerformance[]> {
  const since = new Date(Date.now() - 120 * DAY_MS).toISOString();
  const { data } = await db
    .from("smart_strategy_usage")
    .select("strategy, got_reply")
    .eq("user_id", userId)
    .gte("used_at", since)
    .limit(1000);

  const map = new Map<string, { sent: number; replies: number }>();
  for (const row of data ?? []) {
    const entry = map.get(row.strategy) ?? { sent: 0, replies: 0 };
    entry.sent += 1;
    if (row.got_reply) entry.replies += 1;
    map.set(row.strategy, entry);
  }

  return [...map.entries()]
    .map(([strategy, entry]) => ({
      strategy,
      sent: entry.sent,
      replies: entry.replies,
      score: (entry.replies + 1) / (entry.sent + 2),
    }))
    .sort((a, b) => b.score - a.score);
}

/**
 * Reordena as estratégias permitidas colocando primeiro as que historicamente
 * trouxeram resposta. Estratégias sem histórico ficam no meio: merecem chance,
 * mas não passam à frente de algo comprovadamente eficaz.
 */
export function rankStrategies(
  allowed: string[],
  performance: StrategyPerformance[],
): string[] {
  const scores = new Map(performance.map((item) => [item.strategy, item.score]));
  return allowed
    .slice()
    .sort((a, b) => (scores.get(b) ?? 0.4) - (scores.get(a) ?? 0.4));
}

/** Linhas legíveis para o prompt da IA. */
export function describePerformance(
  allowed: string[],
  performance: StrategyPerformance[],
): string | null {
  const relevant = performance.filter((item) => allowed.includes(item.strategy));
  if (relevant.length === 0) return null;
  return relevant
    .map(
      (item) =>
        `${item.strategy}: ${item.replies} resposta(s) em ${item.sent} envio(s)` +
        (item.sent >= 3 && item.replies === 0 ? " — não está funcionando" : ""),
    )
    .join("; ");
}
