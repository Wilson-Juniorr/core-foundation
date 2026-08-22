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
  "whatsapp_conversation_linked",
  "whatsapp_conversation_unlinked",
  "whatsapp_message_received",
  "whatsapp_message_sent",
  "followup_started",
  "followup_paused",
  "followup_resumed",
  "followup_stopped",
  "followup_completed",
  "scheduled_message_created",
  "scheduled_message_cancelled",
  "scheduled_message_sent",
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
  whatsapp_conversation_linked: "Conversa do WhatsApp vinculada",
  whatsapp_conversation_unlinked: "Conversa do WhatsApp desvinculada",
  whatsapp_message_received: "Mensagem recebida no WhatsApp",
  whatsapp_message_sent: "Mensagem enviada no WhatsApp",
  followup_started: "Follow-up iniciado",
  followup_paused: "Follow-up pausado",
  followup_resumed: "Follow-up retomado",
  followup_stopped: "Follow-up interrompido",
  followup_completed: "Follow-up concluído",
  scheduled_message_created: "Mensagem agendada",
  scheduled_message_cancelled: "Agendamento cancelado",
  scheduled_message_sent: "Mensagem automática enviada",
};

export function timelineEventLabel(type: string): string {
  return TIMELINE_EVENT_LABELS[type as TimelineEventType] ?? "Evento";
}
