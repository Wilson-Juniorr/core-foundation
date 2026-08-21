export const OPPORTUNITY_STATUSES = ["open", "won", "lost", "archived"] as const;

export type OpportunityStatus = (typeof OPPORTUNITY_STATUSES)[number];

export const OPPORTUNITY_STATUS_LABELS: Record<OpportunityStatus, string> = {
  open: "Aberta",
  won: "Ganha",
  lost: "Perdida",
  archived: "Arquivada",
};

export function formatCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
