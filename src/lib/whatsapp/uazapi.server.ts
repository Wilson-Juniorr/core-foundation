import { normalizePhone, phoneFromChatId, toProviderNumber } from "@/lib/domain/phone";
import { ProviderError, waLog } from "./log.server";
import type {
  OutboundMedia,
  ProviderCredentials,
  SendResult,
  WhatsAppProvider,
} from "./provider.server";
import type {
  ConnectionStatus,
  MessageStatus,
  MessageType,
  NormalizedChatSummary,
  NormalizedConnectionUpdate,
  NormalizedWebhookEvent,
  NormalizedWhatsAppMessage,
} from "./types";

/**
 * Implementação UAZAPI do WhatsAppProvider.
 *
 * Todos os endpoints e nomes de campos específicos da UAZAPI ficam confinados
 * neste arquivo. Se a rota real do seu painel divergir, basta ajustar ENDPOINTS.
 */
const ENDPOINTS = {
  /** Criação de instância (exige admintoken). */
  instanceInit: "/instance/init",
  /** Inicia pareamento e devolve o QR Code. */
  sessionStart: "/instance/connect",
  sessionStatus: "/instance/status",
  sessionDisconnect: "/instance/disconnect",
  webhook: "/webhook",
  sendText: "/send/text",
  sendMedia: "/send/media",
  chats: "/chat/find",
  chatHistory: "/message/find",
} as const;

const REQUEST_TIMEOUT_MS = 20_000;

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}${path}`;
}

async function request<T>(
  creds: ProviderCredentials,
  path: string,
  init: { method: "GET" | "POST"; body?: unknown },
): Promise<T> {
  const url = joinUrl(creds.baseUrl, path);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: init.method,
      headers: {
        "content-type": "application/json",
        // A UAZAPI autentica por header de token da instância.
        token: creds.token,
        ...(creds.instanceIdentifier ? { instance: creds.instanceIdentifier } : {}),
      },
      body: init.body === undefined ? null : JSON.stringify(init.body),
      signal: controller.signal,
    });

    const text = await response.text();
    const parsed: unknown = text === "" ? {} : safeJson(text);

    if (!response.ok) {
      waLog.error("provider_request_failed", { path, status: response.status });
      throw new ProviderError(
        `UAZAPI ${path} respondeu ${response.status}`,
        response.status === 401 || response.status === 403
          ? "Credenciais da UAZAPI recusadas. Revise a URL base e o token."
          : "O provedor de WhatsApp respondeu com erro. Tente novamente em instantes.",
        response.status,
      );
    }

    return parsed as T;
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    const aborted = error instanceof Error && error.name === "AbortError";
    waLog.error("provider_unreachable", { path, aborted });
    throw new ProviderError(
      `Falha de rede ao chamar UAZAPI ${path}`,
      aborted
        ? "O provedor de WhatsApp não respondeu no tempo esperado."
        : "Provedor de WhatsApp indisponível no momento.",
      null,
    );
  } finally {
    clearTimeout(timeout);
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

/* ------------------------- normalização ------------------------- */

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function pickString(source: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim() !== "") return value;
    if (typeof value === "number") return String(value);
  }
  return null;
}

function pickNumber(source: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
      return Number(value);
    }
  }
  return null;
}

function toIsoTimestamp(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    // Provedores alternam entre segundos e milissegundos.
    const ms = value > 1e12 ? value : value * 1000;
    const date = new Date(ms);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  if (typeof value === "string" && value.trim() !== "") {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return toIsoTimestamp(numeric);
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  return new Date().toISOString();
}

/** Mapeia o tipo bruto da UAZAPI para o domínio interno. */
export function mapMessageType(raw: string | null): MessageType {
  const value = (raw ?? "").toLowerCase();
  if (value.includes("audio") || value.includes("ptt") || value.includes("voice")) return "audio";
  if (value.includes("image") || value.includes("sticker") || value === "photo") return "image";
  if (value.includes("video")) return "video";
  if (value.includes("document") || value.includes("file")) return "document";
  if (value.includes("text") || value.includes("chat") || value.includes("conversation")) {
    return "text";
  }
  return "unsupported";
}

/** Mapeia o status bruto da UAZAPI para o domínio interno. */
export function mapMessageStatus(raw: string | null, fallback: MessageStatus): MessageStatus {
  const value = (raw ?? "").toLowerCase();
  if (value.includes("read") || value.includes("viewed")) return "read";
  if (value.includes("deliver") || value === "received_server") return "delivered";
  if (value.includes("fail") || value.includes("error")) return "failed";
  if (value.includes("pending") || value.includes("queue")) return "pending";
  if (value.includes("sent") || value.includes("server_ack")) return "sent";
  if (value.includes("received")) return "received";
  return fallback;
}

function mapConnectionStatus(raw: string | null): ConnectionStatus {
  const value = (raw ?? "").toLowerCase();
  if (value.includes("connected") || value.includes("open") || value.includes("authenticated")) {
    return "connected";
  }
  if (value.includes("qr") || value.includes("connecting") || value.includes("pairing")) {
    return "connecting";
  }
  if (value.includes("error") || value.includes("banned")) return "error";
  if (value.includes("disconnect") || value.includes("close") || value.includes("logout")) {
    return "disconnected";
  }
  return "disconnected";
}

function normalizeMessagePayload(raw: unknown): NormalizedWhatsAppMessage | null {
  const message = asRecord(raw);
  const key = asRecord(message["key"]);
  const content = asRecord(message["message"] ?? message["content"]);

  const externalChatId =
    pickString(message, ["chatid", "chatId", "remoteJid", "from", "jid"]) ??
    pickString(key, ["remoteJid", "chatid"]);
  if (!externalChatId) return null;

  const fromMe =
    message["fromMe"] === true ||
    key["fromMe"] === true ||
    pickString(message, ["direction"]) === "outbound";

  const mediaRecord = asRecord(message["media"] ?? content["media"]);
  const type = mapMessageType(
    pickString(message, ["messageType", "type", "msgType"]) ??
      pickString(content, ["type"]) ??
      Object.keys(content).find((entry) => entry.toLowerCase().includes("message")) ??
      null,
  );

  const text =
    pickString(message, ["text", "body", "caption", "conversation"]) ??
    pickString(content, ["text", "conversation", "caption"]);

  const phoneNumber =
    phoneFromChatId(externalChatId) ??
    normalizePhone(pickString(message, ["sender", "senderPhone", "phone", "number"]));

  return {
    externalMessageId:
      pickString(message, ["messageid", "messageId", "id"]) ?? pickString(key, ["id"]),
    externalChatId,
    phoneNumber,
    displayName: pickString(message, ["senderName", "pushName", "notifyName", "chatName"]),
    direction: fromMe ? "outbound" : "inbound",
    type,
    text,
    timestamp: toIsoTimestamp(
      message["messageTimestamp"] ?? message["timestamp"] ?? message["t"] ?? message["date"],
    ),
    status: mapMessageStatus(pickString(message, ["status", "ack"]), fromMe ? "sent" : "received"),
    media:
      type === "text" || type === "unsupported"
        ? null
        : {
            url:
              pickString(mediaRecord, ["url", "link", "downloadUrl"]) ??
              pickString(message, ["mediaUrl", "fileUrl", "url"]),
            mimeType:
              pickString(mediaRecord, ["mimetype", "mimeType"]) ??
              pickString(message, ["mimetype", "mimeType"]),
            filename:
              pickString(mediaRecord, ["filename", "fileName", "docName"]) ??
              pickString(message, ["filename", "fileName", "docName"]),
            durationSeconds:
              pickNumber(mediaRecord, ["seconds", "duration"]) ??
              pickNumber(message, ["seconds", "duration"]),
          },
  };
}

/* ------------------------- provider ------------------------- */

export const uazapiProvider: WhatsAppProvider = {
  name: "uazapi",

  async startSession(creds) {
    const response = asRecord(
      await request<unknown>(creds, ENDPOINTS.sessionStart, {
        method: "POST",
        body: { instance: creds.instanceIdentifier },
      }),
    );

    const instance = asRecord(response["instance"] ?? response);
    return {
      qrCode:
        pickString(response, ["qrcode", "qrCode", "base64", "qr"]) ??
        pickString(instance, ["qrcode", "qrCode", "base64"]),
    };
  },

  async getSessionStatus(creds): Promise<NormalizedConnectionUpdate> {
    const response = asRecord(
      await request<unknown>(creds, ENDPOINTS.sessionStatus, { method: "GET" }),
    );
    const instance = asRecord(response["instance"] ?? response);

    return {
      status: mapConnectionStatus(
        pickString(instance, ["status", "state", "connectionStatus"]) ??
          pickString(response, ["status", "state"]),
      ),
      phoneNumber: normalizePhone(
        pickString(instance, ["owner", "phone", "number", "wid"]) ??
          pickString(response, ["owner", "phone", "number"]),
      ),
      displayName: pickString(instance, ["profileName", "name", "pushName"]),
      instanceIdentifier:
        pickString(instance, ["id", "instance", "name"]) ?? creds.instanceIdentifier,
    };
  },

  async disconnectSession(creds) {
    await request<unknown>(creds, ENDPOINTS.sessionDisconnect, { method: "POST", body: {} });
  },

  async configureWebhook(creds, webhookUrl) {
    await request<unknown>(creds, ENDPOINTS.webhook, {
      method: "POST",
      body: {
        url: webhookUrl,
        enabled: true,
        events: ["messages", "message_status", "connection"],
      },
    });
  },

  async sendTextMessage(creds, input): Promise<SendResult> {
    const number = toProviderNumber(input.phoneNumber);
    if (!number) {
      throw new ProviderError("Telefone inválido", "Telefone do destinatário inválido.");
    }

    const response = asRecord(
      await request<unknown>(creds, ENDPOINTS.sendText, {
        method: "POST",
        body: { number, text: input.text },
      }),
    );

    return {
      externalMessageId:
        pickString(response, ["messageid", "messageId", "id"]) ??
        pickString(asRecord(response["key"]), ["id"]),
      status: "sent",
    };
  },

  async sendMediaMessage(creds, input): Promise<SendResult> {
    const number = toProviderNumber(input.phoneNumber);
    if (!number) {
      throw new ProviderError("Telefone inválido", "Telefone do destinatário inválido.");
    }

    const media: OutboundMedia = input.media;
    const response = asRecord(
      await request<unknown>(creds, ENDPOINTS.sendMedia, {
        method: "POST",
        body: {
          number,
          type: media.type,
          file: media.base64,
          mimetype: media.mimeType,
          docName: media.filename,
          text: input.caption ?? "",
        },
      }),
    );

    return {
      externalMessageId:
        pickString(response, ["messageid", "messageId", "id"]) ??
        pickString(asRecord(response["key"]), ["id"]),
      status: "sent",
    };
  },

  async fetchChats(creds, input): Promise<NormalizedChatSummary[]> {
    const response = await request<unknown>(creds, ENDPOINTS.chats, {
      method: "POST",
      body: { limit: input.limit },
    });

    const record = asRecord(response);
    const list = Array.isArray(response)
      ? response
      : Array.isArray(record["chats"])
        ? (record["chats"] as unknown[])
        : Array.isArray(record["data"])
          ? (record["data"] as unknown[])
          : [];

    return list
      .map((entry) => {
        const chat = asRecord(entry);
        const externalChatId = pickString(chat, ["chatid", "chatId", "id", "jid", "remoteJid"]);
        if (!externalChatId) return null;
        return {
          externalChatId,
          phoneNumber: phoneFromChatId(externalChatId),
          displayName: pickString(chat, ["name", "pushName", "contactName", "subject"]),
          lastMessageAt: chat["lastMessageTime"] ? toIsoTimestamp(chat["lastMessageTime"]) : null,
        } satisfies NormalizedChatSummary;
      })
      .filter((chat): chat is NormalizedChatSummary => chat !== null);
  },

  async fetchChatHistory(creds, input): Promise<NormalizedWhatsAppMessage[]> {
    const response = await request<unknown>(creds, ENDPOINTS.chatHistory, {
      method: "POST",
      body: { chatid: input.externalChatId, limit: input.limit },
    });

    const record = asRecord(response);
    const list = Array.isArray(response)
      ? response
      : Array.isArray(record["messages"])
        ? (record["messages"] as unknown[])
        : Array.isArray(record["data"])
          ? (record["data"] as unknown[])
          : [];

    return list
      .map((entry) => normalizeMessagePayload(entry))
      .filter((message): message is NormalizedWhatsAppMessage => message !== null);
  },

  normalizeIncomingWebhook(payload): NormalizedWebhookEvent {
    const root = asRecord(payload);
    const eventName = (
      pickString(root, ["event", "type", "EventType", "eventType"]) ?? ""
    ).toLowerCase();
    const data = asRecord(root["data"] ?? root["message"] ?? root["payload"] ?? root);

    if (eventName.includes("connection") || eventName.includes("status_instance")) {
      return {
        kind: "connection",
        update: {
          status: mapConnectionStatus(pickString(data, ["status", "state"])),
          phoneNumber: normalizePhone(pickString(data, ["owner", "phone", "number"])),
          displayName: pickString(data, ["profileName", "name"]),
          instanceIdentifier: pickString(data, ["instance", "id", "name"]),
        },
      };
    }

    const isStatusEvent =
      eventName.includes("ack") ||
      eventName.includes("message_status") ||
      eventName.includes("messages_update") ||
      (!("message" in data) && "status" in data && !("chatid" in data) && !("remoteJid" in data));

    if (isStatusEvent) {
      const externalMessageId =
        pickString(data, ["messageid", "messageId", "id"]) ??
        pickString(asRecord(data["key"]), ["id"]);
      if (!externalMessageId) return { kind: "ignored", reason: "status sem identificador" };

      return {
        kind: "status",
        update: {
          externalMessageId,
          status: mapMessageStatus(pickString(data, ["status", "ack"]), "sent"),
          timestamp: toIsoTimestamp(data["timestamp"] ?? data["t"]),
        },
      };
    }

    const message = normalizeMessagePayload(data);
    if (!message) return { kind: "ignored", reason: "payload sem chat identificável" };
    return { kind: "message", message };
  },
};
