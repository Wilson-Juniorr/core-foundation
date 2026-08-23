/**
 * Modelo interno de WhatsApp.
 *
 * Nenhum componente da interface deve conhecer a estrutura bruta da UZAPI:
 * o provider converte o payload do fornecedor para estes tipos.
 */

export const MESSAGE_DIRECTIONS = ["inbound", "outbound"] as const;
export type MessageDirection = (typeof MESSAGE_DIRECTIONS)[number];

export const MESSAGE_TYPES = [
  "text",
  "audio",
  "image",
  "document",
  "video",
  "unsupported",
] as const;
export type MessageType = (typeof MESSAGE_TYPES)[number];

export const MESSAGE_STATUSES = [
  "pending",
  "sent",
  "delivered",
  "read",
  "failed",
  "received",
] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

export const CONNECTION_STATUSES = [
  "not_configured",
  "disconnected",
  "connecting",
  "connected",
  "error",
] as const;
export type ConnectionStatus = (typeof CONNECTION_STATUSES)[number];

export type NormalizedMedia = {
  url: string | null;
  mimeType: string | null;
  filename: string | null;
  durationSeconds: number | null;
};

export type NormalizedWhatsAppMessage = {
  externalMessageId: string | null;
  externalChatId: string;
  phoneNumber: string | null;
  displayName: string | null;
  direction: MessageDirection;
  type: MessageType;
  text: string | null;
  timestamp: string;
  status: MessageStatus;
  media: NormalizedMedia | null;
};

export type NormalizedStatusUpdate = {
  externalMessageId: string;
  status: MessageStatus;
  timestamp: string;
};

export type NormalizedConnectionUpdate = {
  status: ConnectionStatus;
  phoneNumber: string | null;
  displayName: string | null;
  instanceIdentifier: string | null;
};

/** Resultado da normalização de um webhook do provider. */
export type NormalizedWebhookEvent =
  | { kind: "message"; message: NormalizedWhatsAppMessage }
  | { kind: "status"; update: NormalizedStatusUpdate }
  | { kind: "connection"; update: NormalizedConnectionUpdate }
  | { kind: "ignored"; reason: string };

export type NormalizedChatSummary = {
  externalChatId: string;
  phoneNumber: string | null;
  displayName: string | null;
  lastMessageAt: string | null;
};

/* ---------- Tipos expostos para a interface ---------- */

export type WhatsAppConnection = {
  id: string;
  provider: string;
  instance_identifier: string | null;
  phone_number: string | null;
  display_name: string | null;
  status: ConnectionStatus;
  last_connected_at: string | null;
  last_event_at: string | null;
  last_synced_at: string | null;
  last_sync_status: string | null;
  last_error: string | null;
  webhook_url: string;
  has_credentials: boolean;
};

export type ConversationListItem = {
  id: string;
  contact_id: string | null;
  contact_name: string | null;
  external_chat_id: string;
  phone_number: string | null;
  display_name: string | null;
  last_message_at: string | null;
  last_message_preview: string | null;
  unread_count: number;
};

export type ConversationMessage = {
  id: string;
  external_message_id: string | null;
  direction: MessageDirection;
  message_type: MessageType;
  text_content: string | null;
  media_url: string | null;
  media_mime_type: string | null;
  media_filename: string | null;
  media_duration: number | null;
  status: MessageStatus;
  sent_at: string;
  delivered_at: string | null;
  read_at: string | null;
};

export type ConversationDetail = {
  conversation: ConversationListItem;
  messages: ConversationMessage[];
  /** Há mensagens mais antigas para carregar sob demanda. */
  hasMore: boolean;
};

export type SyncResult = {
  chats: number;
  messages: number;
  skipped: number;
  finishedAt: string;
};
