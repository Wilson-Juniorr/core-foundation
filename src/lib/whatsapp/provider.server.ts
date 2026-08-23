import type {
  NormalizedChatSummary,
  NormalizedConnectionUpdate,
  NormalizedWhatsAppMessage,
  NormalizedWebhookEvent,
} from "./types";

export type ProviderCredentials = {
  baseUrl: string;
  /** Token da instância (usado em todas as chamadas de operação). */
  token: string;
  instanceIdentifier: string | null;
  /** Token administrativo do servidor — só para criar/gerenciar instâncias. */
  adminToken?: string | null;
};

export type OutboundMedia = {
  type: "audio" | "image" | "document" | "video";
  base64: string;
  mimeType: string;
  filename: string;
};

export type SendResult = {
  externalMessageId: string | null;
  status: "sent" | "pending";
};

/**
 * Contrato do provedor de WhatsApp. A aplicação conversa somente com esta
 * interface — trocar a UAZAPI por outro fornecedor significa apenas escrever
 * outra implementação.
 */
export type WhatsAppProvider = {
  readonly name: string;

  /** Cria uma instância no servidor usando credenciais administrativas. */
  provisionInstance?(
    creds: ProviderCredentials,
    name: string,
  ): Promise<{ token: string; instanceIdentifier: string | null }>;

  startSession(creds: ProviderCredentials): Promise<{ qrCode: string | null }>;
  getSessionStatus(creds: ProviderCredentials): Promise<NormalizedConnectionUpdate>;
  disconnectSession(creds: ProviderCredentials): Promise<void>;
  configureWebhook(creds: ProviderCredentials, webhookUrl: string): Promise<void>;

  sendTextMessage(
    creds: ProviderCredentials,
    input: { phoneNumber: string; text: string },
  ): Promise<SendResult>;

  sendMediaMessage(
    creds: ProviderCredentials,
    input: { phoneNumber: string; media: OutboundMedia; caption: string | null },
  ): Promise<SendResult>;

  fetchChats(
    creds: ProviderCredentials,
    input: { limit: number },
  ): Promise<NormalizedChatSummary[]>;

  fetchChatHistory(
    creds: ProviderCredentials,
    input: { externalChatId: string; limit: number },
  ): Promise<NormalizedWhatsAppMessage[]>;

  normalizeIncomingWebhook(payload: unknown): NormalizedWebhookEvent;
};

export async function getWhatsAppProvider(provider: string): Promise<WhatsAppProvider> {
  switch (provider) {
    // "uzapi" é mantido apenas para conexões antigas já gravadas no banco.
    case "uzapi":
    case "uazapi":
    default: {
      const { uazapiProvider } = await import("./uazapi.server");
      return uazapiProvider;
    }
  }
}
