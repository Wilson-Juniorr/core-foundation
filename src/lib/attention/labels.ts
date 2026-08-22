import type {
  AttentionBucket,
  AttentionKind,
  AttentionPriority,
  AttentionStatus,
  NextActionKind,
} from "./types";

export const KIND_LABELS: Record<AttentionKind, string> = {
  customer_replied: "Cliente respondeu",
  high_interest: "Alto interesse",
  ready_to_close: "Quer fechar",
  objection_needs_human: "Objeção precisa de você",
  discount_requested: "Pediu desconto",
  call_requested: "Pediu ligação",
  document_received: "Documento recebido",
  low_ai_confidence: "Leitura da IA incerta",
  flow_failed: "Fluxo falhou",
  message_failed: "Mensagem falhou",
  missing_next_action: "Sem próxima ação",
  overdue_next_action: "Próxima ação atrasada",
  unlinked_conversation: "Conversa sem cliente",
  whatsapp_disconnected: "WhatsApp desconectado",
  own_promise_overdue: "Sua promessa venceu",
};

export function kindLabel(kind: string): string {
  return KIND_LABELS[kind as AttentionKind] ?? "Atenção";
}

export const PRIORITY_LABELS: Record<AttentionPriority, string> = {
  critical: "Crítico",
  high: "Alta",
  medium: "Média",
  low: "Baixa",
};

export const PRIORITY_CLASSES: Record<AttentionPriority, string> = {
  critical: "border-destructive/40 bg-destructive/10 text-destructive",
  high: "border-primary/40 bg-primary/10 text-primary",
  medium: "border-border bg-secondary text-secondary-foreground",
  low: "border-border bg-muted text-muted-foreground",
};

export const BUCKET_LABELS: Record<AttentionBucket, string> = {
  now: "Agora",
  today: "Hoje",
  overdue: "Atrasados",
  automatic: "Automático",
  waiting: "Aguardando cliente",
};

export const STATUS_LABELS: Record<AttentionStatus, string> = {
  open: "Aberto",
  snoozed: "Adiado",
  resolved: "Resolvido",
  dismissed: "Descartado",
};

export const NEXT_ACTION_LABELS: Record<NextActionKind, string> = {
  reply_now: "Responder agora",
  call: "Ligar",
  send_information: "Enviar informação",
  wait: "Aguardar",
  schedule_contact: "Agendar contato",
  start_flow: "Iniciar fluxo",
  review_proposal: "Revisar proposta",
  fix_operational: "Resolver falha operacional",
};

export function nextActionLabel(kind: string | null): string | null {
  if (!kind) return null;
  return NEXT_ACTION_LABELS[kind as NextActionKind] ?? null;
}
