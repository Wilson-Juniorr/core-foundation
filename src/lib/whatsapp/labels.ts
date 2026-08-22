import type { ConnectionStatus, MessageStatus, MessageType } from "./types";

export const CONNECTION_STATUS_LABELS: Record<ConnectionStatus, string> = {
  not_configured: "Não configurado",
  disconnected: "Desconectado",
  connecting: "Conectando",
  connected: "Conectado",
  error: "Erro",
};

export const MESSAGE_STATUS_LABELS: Record<MessageStatus, string> = {
  pending: "Enviando",
  sent: "Enviada",
  delivered: "Entregue",
  read: "Lida",
  failed: "Falhou",
  received: "Recebida",
};

export const MESSAGE_TYPE_LABELS: Record<MessageType, string> = {
  text: "Texto",
  audio: "Áudio",
  image: "Imagem",
  document: "Documento",
  video: "Vídeo",
  unsupported: "Tipo de mensagem não suportado.",
};

export function messagePreview(
  type: MessageType,
  text: string | null,
  filename: string | null,
): string {
  if (type === "text") return text?.slice(0, 160) ?? "";
  if (type === "unsupported") return MESSAGE_TYPE_LABELS.unsupported;
  const label = MESSAGE_TYPE_LABELS[type];
  const suffix = filename ? `: ${filename}` : text ? `: ${text.slice(0, 80)}` : "";
  return `${label}${suffix}`;
}
