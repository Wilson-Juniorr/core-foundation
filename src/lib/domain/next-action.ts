import { isToday, parseTimestamp } from "./datetime";

/**
 * "Próxima ação" é o conceito central do produto: nenhuma negociação aberta
 * deve ficar sem próximo passo. A classificação aqui é determinística.
 */
export type NextActionState = "missing" | "overdue" | "today" | "upcoming";

export function classifyNextAction(nextActionAt: string | null | undefined): NextActionState {
  const date = parseTimestamp(nextActionAt);
  if (!date) return "missing";
  if (isToday(nextActionAt)) return "today";
  return date.getTime() < Date.now() ? "overdue" : "upcoming";
}

export const NEXT_ACTION_LABELS: Record<NextActionState, string> = {
  missing: "Sem próxima ação",
  overdue: "Atrasada",
  today: "Hoje",
  upcoming: "Agendada",
};

export function needsAttention(nextActionAt: string | null | undefined): boolean {
  const state = classifyNextAction(nextActionAt);
  return state === "missing" || state === "overdue";
}
