export const TIMELINE_EVENT_TYPES = [
  "contact_created",
  "contact_updated",
  "contact_archived",
  "contact_restored",
  "opportunity_created",
  "opportunity_updated",
  "stage_changed",
  "next_action_updated",
  "opportunity_won",
  "opportunity_lost",
] as const;

export type TimelineEventType = (typeof TIMELINE_EVENT_TYPES)[number];

export const TIMELINE_EVENT_LABELS: Record<TimelineEventType, string> = {
  contact_created: "Cliente criado",
  contact_updated: "Cliente atualizado",
  contact_archived: "Cliente arquivado",
  contact_restored: "Cliente reativado",
  opportunity_created: "Oportunidade criada",
  opportunity_updated: "Oportunidade atualizada",
  stage_changed: "Etapa alterada",
  next_action_updated: "Próxima ação atualizada",
  opportunity_won: "Oportunidade ganha",
  opportunity_lost: "Oportunidade perdida",
};

export function timelineEventLabel(type: string): string {
  return TIMELINE_EVENT_LABELS[type as TimelineEventType] ?? "Evento";
}
