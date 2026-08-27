import type { SupabaseClient } from "@supabase/supabase-js";
import { getRequestUrl } from "@tanstack/react-start/server";

import type { Database } from "@/integrations/supabase/types";
import { logEvent } from "@/lib/crm.server";
import { messagePreview } from "./labels";
import { ProviderError, userFacingProviderError, waLog } from "./log.server";
import { getWhatsAppProvider, type ProviderCredentials } from "./provider.server";
import {
  MEDIA_BUCKET,
  STORAGE_PREFIX,
  applyConnectionUpdate,
  loadCredentials,
  loadPrimaryConnection,
  refreshConversationAggregates,
  signMediaUrl,
  upsertConversation,
} from "./store.server";
import type {
  ConversationDetail,
  ConversationListItem,
  ConversationMessage,
  SyncResult,
  WhatsAppConnection,
} from "./types";

type Client = SupabaseClient<Database>;
type ConnectionRow = Database["public"]["Tables"]["whatsapp_connections"]["Row"];

type ConversationRow = Database["public"]["Tables"]["conversations"]["Row"] & {
  contacts: { name: string } | null;
};

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as unknown as Client;
}

function requestOrigin(): string {
  try {
    return new URL(getRequestUrl()).origin;
  } catch {
    return "";
  }
}

/**
 * O provedor entrega webhooks a partir da internet, então o endereço precisa ser
 * estável e público. A URL de preview (`id-preview--<id>.lovable.app`) exige
 * sessão e responde 302 — webhooks caem no vazio. Aqui trocamos por um endereço
 * fixo do projeto (ou pelo override explícito de ambiente).
 */
function webhookBaseUrl(): string {
  const override = process.env["WHATSAPP_WEBHOOK_BASE_URL"];
  if (override) return override.replace(/\/+$/, "");

  const origin = requestOrigin();
  const preview = /^https:\/\/id-preview--([0-9a-f-]+)\.lovable\.app$/i.exec(origin);
  if (preview) return `https://project--${preview[1]}-dev.lovable.app`;
  return origin;
}

export function webhookUrl(connection: ConnectionRow): string {
  return `${webhookBaseUrl()}/api/public/whatsapp/${connection.id}?secret=${connection.webhook_secret}`;
}


export function presentConnection(
  connection: ConnectionRow,
  hasCredentials = true,
): WhatsAppConnection {
  return {
    id: connection.id,
    provider: connection.provider,
    instance_identifier: connection.instance_identifier,
    phone_number: connection.phone_number,
    display_name: connection.display_name,
    status: connection.status,
    last_connected_at: connection.last_connected_at,
    last_event_at: connection.last_event_at,
    last_synced_at: connection.last_synced_at,
    last_sync_status: connection.last_sync_status,
    last_error: connection.last_error,
    webhook_url: webhookUrl(connection),
    has_credentials: hasCredentials,
  };
}

export function mapConversation(row: ConversationRow): ConversationListItem {
  return {
    id: row.id,
    contact_id: row.contact_id,
    contact_name: row.contacts?.name ?? null,
    external_chat_id: row.external_chat_id,
    phone_number: row.phone_number,
    display_name: row.display_name,
    last_message_at: row.last_message_at,
    last_message_preview: row.last_message_preview,
    unread_count: row.unread_count,
  };
}

/**
 * Garante que exista uma conexão para o usuário. Quando o servidor já traz
 * URL base e token de instância no ambiente, a conexão nasce pronta — o
 * usuário não precisa digitar credencial alguma.
 */
export async function ensureConnection(userId: string): Promise<ConnectionRow | null> {
  const db = await admin();
  const data = await loadPrimaryConnection(db, userId);
  if (data) return data;

  const { readUazapiEnv } = await import("./env.server");
  const env = readUazapiEnv();
  if (!env.baseUrl || !env.instanceToken) return null;

  const { data: created, error: insertError } = await db
    .from("whatsapp_connections")
    .insert({
      user_id: userId,
      provider: "uazapi",
      instance_identifier: env.instanceName,
      status: "disconnected",
    })
    .select("*")
    .single();
  if (insertError) throw new Error(insertError.message);

  await registerWebhook(db, created, {
    baseUrl: env.baseUrl,
    token: env.instanceToken,
    instanceIdentifier: created.instance_identifier,
    adminToken: env.adminToken,
  });

  waLog.info("connection_bootstrapped", { connection_id: created.id });
  return created;
}

async function requireConnection(userId: string) {
  const db = await admin();
  const data = await ensureConnection(userId);
  if (!data) throw new Error("WhatsApp ainda não configurado.");

  const creds = await loadCredentials(db, data);
  if (!creds) throw new Error("Credenciais da UAZAPI não configuradas.");

  return { db, connection: data, creds } as {
    db: Client;
    connection: ConnectionRow;
    creds: ProviderCredentials;
  };
}

async function recordError(db: Client, connectionId: string, message: string) {
  await db
    .from("whatsapp_connections")
    .update({ status: "error", last_error: message.slice(0, 300) })
    .eq("id", connectionId);
}

/* ------------------------- configuração ------------------------- */

export async function saveSettings(
  userId: string,
  input: { base_url: string; token: string; instance_identifier: string | null },
): Promise<WhatsAppConnection> {
  const db = await admin();

  const existing = await loadPrimaryConnection(db, userId);

  let connection = existing;

  if (connection) {
    const { data, error } = await db
      .from("whatsapp_connections")
      .update({
        instance_identifier: input.instance_identifier,
        status: connection.status === "connected" ? connection.status : "disconnected",
        last_error: null,
      })
      .eq("id", connection.id)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    connection = data;
  } else {
    const { data, error } = await db
      .from("whatsapp_connections")
      .insert({
        user_id: userId,
        provider: "uazapi",
        instance_identifier: input.instance_identifier,
        status: "disconnected",
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    connection = data;
  }

  // O token nunca sai do servidor: fica em tabela sem acesso via Data API.
  const { error: credError } = await db.from("whatsapp_credentials").upsert(
    {
      connection_id: connection.id,
      user_id: userId,
      base_url: input.base_url.replace(/\/+$/, ""),
      token: input.token,
    },
    { onConflict: "connection_id" },
  );
  if (credError) throw new Error(credError.message);

  waLog.info("settings_saved", { connection_id: connection.id, provider: connection.provider });

  await registerWebhook(db, connection, {
    baseUrl: input.base_url,
    token: input.token,
    instanceIdentifier: input.instance_identifier,
  });

  return presentConnection(connection);
}

/** Registrar o webhook é melhor-esforço: a página segue usável se o provedor cair. */
async function registerWebhook(db: Client, connection: ConnectionRow, creds: ProviderCredentials) {
  try {
    const provider = await getWhatsAppProvider(connection.provider);
    await provider.configureWebhook(creds, webhookUrl(connection));
    waLog.info("webhook_registered", { connection_id: connection.id });
  } catch (error) {
    waLog.warn("webhook_registration_failed", {
      connection_id: connection.id,
      reason: error instanceof Error ? error.name : "unknown",
    });
  }
  void db;
}

/**
 * Cria (ou reaproveita) uma instância no servidor UAZAPI configurado por
 * ambiente. O admin token só existe no servidor e nunca é devolvido.
 */
export async function provisionInstance(
  userId: string,
  instanceName: string,
): Promise<WhatsAppConnection> {
  const db = await admin();
  const { readUazapiEnv } = await import("./env.server");
  const env = readUazapiEnv();

  if (!env.baseUrl || !env.adminToken) {
    throw new Error(
      "Servidor UAZAPI não configurado no ambiente (URL base e admin token são obrigatórios).",
    );
  }

  const existing = await loadPrimaryConnection(db, userId);

  let connection = existing;
  if (!connection) {
    const { data, error } = await db
      .from("whatsapp_connections")
      .insert({
        user_id: userId,
        provider: "uazapi",
        instance_identifier: instanceName,
        status: "disconnected",
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    connection = data;
  }

  const provider = await getWhatsAppProvider(connection.provider);
  if (!provider.provisionInstance) {
    throw new Error("O provedor configurado não permite criar instâncias.");
  }

  let created: { token: string; instanceIdentifier: string | null };
  try {
    created = await provider.provisionInstance(
      {
        baseUrl: env.baseUrl,
        token: env.instanceToken ?? "",
        instanceIdentifier: instanceName,
        adminToken: env.adminToken,
      },
      instanceName,
    );
  } catch (error) {
    const message = userFacingProviderError(error);
    await recordError(db, connection.id, message);
    throw new Error(message);
  }

  const { error: credError } = await db.from("whatsapp_credentials").upsert(
    {
      connection_id: connection.id,
      user_id: userId,
      base_url: env.baseUrl,
      token: created.token,
    },
    { onConflict: "connection_id" },
  );
  if (credError) throw new Error(credError.message);

  const { data: updated } = await db
    .from("whatsapp_connections")
    .update({
      instance_identifier: created.instanceIdentifier ?? instanceName,
      status: "disconnected",
      last_error: null,
    })
    .eq("id", connection.id)
    .select("*")
    .single();

  const finalConnection = updated ?? connection;
  await registerWebhook(db, finalConnection, {
    baseUrl: env.baseUrl,
    token: created.token,
    instanceIdentifier: finalConnection.instance_identifier,
    adminToken: env.adminToken,
  });

  waLog.info("instance_provisioned", { connection_id: finalConnection.id });
  return presentConnection(finalConnection);
}

export async function startSession(userId: string) {
  const { db, connection, creds } = await requireConnection(userId);
  const provider = await getWhatsAppProvider(connection.provider);

  try {
    const { qrCode } = await provider.startSession(creds);
    const { data } = await db
      .from("whatsapp_connections")
      .update({ status: "connecting", last_error: null, last_event_at: new Date().toISOString() })
      .eq("id", connection.id)
      .select("*")
      .single();

    waLog.info("session_start", { connection_id: connection.id, qr: Boolean(qrCode) });
    // QR Code nunca é persistido: fica apenas na resposta desta chamada.
    return { qrCode, connection: presentConnection(data ?? connection) };
  } catch (error) {
    await recordError(db, connection.id, userFacingProviderError(error));
    throw new Error(userFacingProviderError(error));
  }
}

export async function refreshStatus(userId: string): Promise<WhatsAppConnection> {
  const { db, connection, creds } = await requireConnection(userId);
  const provider = await getWhatsAppProvider(connection.provider);

  try {
    const update = await provider.getSessionStatus(creds);
    await applyConnectionUpdate(db, connection.id, update);
  } catch (error) {
    await recordError(db, connection.id, userFacingProviderError(error));
    throw new Error(userFacingProviderError(error));
  }

  const { data } = await db
    .from("whatsapp_connections")
    .select("*")
    .eq("id", connection.id)
    .single();
  return presentConnection(data ?? connection);
}

export async function disconnect(userId: string): Promise<WhatsAppConnection> {
  const { db, connection, creds } = await requireConnection(userId);
  const provider = await getWhatsAppProvider(connection.provider);

  try {
    await provider.disconnectSession(creds);
  } catch (error) {
    waLog.warn("disconnect_failed", { connection_id: connection.id });
    throw new Error(userFacingProviderError(error));
  }

  const { data } = await db
    .from("whatsapp_connections")
    .update({ status: "disconnected", last_event_at: new Date().toISOString() })
    .eq("id", connection.id)
    .select("*")
    .single();
  return presentConnection(data ?? connection);
}

/* ------------------------- sincronização ------------------------- */

export async function syncHistory(
  userId: string,
  input: { chatLimit?: number | undefined; messageLimit?: number | undefined },
): Promise<SyncResult> {
  const { db, connection, creds } = await requireConnection(userId);
  const provider = await getWhatsAppProvider(connection.provider);
  const { ingestMessage } = await import("./store.server");

  const chatLimit = input.chatLimit ?? 15;
  const messageLimit = input.messageLimit ?? 30;

  let chats = 0;
  let messages = 0;
  let skipped = 0;
  /* Respostas descobertas pela sincronização (ex.: webhook fora do ar) também
     precisam interromper follow-ups — senão o cliente responde e o sistema
     continua enviando. */
  const repliedConversations = new Map<string, string>();

  try {
    const chatList = await provider.fetchChats(creds, { limit: chatLimit });

    for (const chat of chatList) {
      chats += 1;
      const conversation = await upsertConversation(db, {
        userId,
        connectionId: connection.id,
        externalChatId: chat.externalChatId,
        phoneNumber: chat.phoneNumber,
        displayName: chat.displayName,
      });

      const history = await provider.fetchChatHistory(creds, {
        externalChatId: chat.externalChatId,
        limit: messageLimit,
      });

      for (const message of history) {
        const outcome = await ingestMessage(db, {
          userId,
          connectionId: connection.id,
          message,
          // Histórico importado não gera contadores de não lidas.
          countUnread: false,
        });
        if (outcome === "created") {
          messages += 1;
          const conversationId =
            (conversation as { id?: string } | null | undefined)?.id ?? null;
          if (conversationId && message.direction === "inbound") {
            const previous = repliedConversations.get(conversationId);
            if (!previous || new Date(message.timestamp) > new Date(previous)) {
              repliedConversations.set(conversationId, message.timestamp);
            }
          }
        } else skipped += 1;
      }
    }
  } catch (error) {
    const message = userFacingProviderError(error);
    waLog.error("sync_failed", { connection_id: connection.id, chats, messages });
    await db
      .from("whatsapp_connections")
      .update({
        last_synced_at: new Date().toISOString(),
        last_sync_status: `Parcial: ${chats} conversas, ${messages} mensagens. ${message}`,
      })
      .eq("id", connection.id);
    throw new Error(message);
  }

  if (repliedConversations.size > 0) {
    const { stopRunsForReply } = await import("@/lib/followup/engine.server");
    for (const [conversationId, repliedAt] of repliedConversations) {
      try {
        await stopRunsForReply({ userId, conversationId, repliedAt });
      } catch (error) {
        waLog.warn("sync_stop_runs_failed", {
          conversation_id: conversationId,
          reason: error instanceof Error ? error.name : "unknown",
        });
      }
    }
  }

  const finishedAt = new Date().toISOString();

  await db
    .from("whatsapp_connections")
    .update({
      last_synced_at: finishedAt,
      last_sync_status: `Concluída: ${chats} conversas, ${messages} novas mensagens`,
    })
    .eq("id", connection.id);

  waLog.info("sync_finished", { connection_id: connection.id, chats, messages, skipped });
  return { chats, messages, skipped, finishedAt };
}

/* ------------------------- conversas ------------------------- */

const MESSAGE_PAGE_SIZE = 60;
const MESSAGE_COLUMNS =
  "id, external_message_id, direction, message_type, text_content, media_url, media_mime_type, media_filename, media_duration, status, sent_at, delivered_at, read_at";

export async function loadConversationDetail(
  supabase: Client,
  conversationId: string,
): Promise<ConversationDetail> {
  const [conversationResult, messagesResult] = await Promise.all([
    supabase
      .from("conversations")
      .select("*, contacts(name)")
      .eq("id", conversationId)
      .maybeSingle(),
    supabase
      .from("messages")
      .select(MESSAGE_COLUMNS)
      .eq("conversation_id", conversationId)
      .order("sent_at", { ascending: false })
      .limit(MESSAGE_PAGE_SIZE + 1),
  ]);

  if (conversationResult.error) throw new Error(conversationResult.error.message);
  if (!conversationResult.data) throw new Error("Conversa não encontrada");
  if (messagesResult.error) throw new Error(messagesResult.error.message);

  const hasMore = messagesResult.data.length > MESSAGE_PAGE_SIZE;
  const page = messagesResult.data.slice(0, MESSAGE_PAGE_SIZE).reverse();

  const db = await admin();
  const messages = await Promise.all(
    page.map(async (message) => ({
      ...message,
      media_url: await signMediaUrl(db, message.media_url),
    })),
  );

  return {
    conversation: mapConversation(conversationResult.data as ConversationRow),
    messages,
    hasMore,
  };
}

/**
 * Paginação do histórico: a conversa abre com as mensagens recentes e o
 * operador carrega o passado sob demanda, mantendo a tela leve.
 */
export async function loadOlderMessages(
  supabase: Client,
  conversationId: string,
  before: string,
): Promise<{ messages: ConversationMessage[]; hasMore: boolean }> {
  const { data, error } = await supabase
    .from("messages")
    .select(MESSAGE_COLUMNS)
    .eq("conversation_id", conversationId)
    .lt("sent_at", before)
    .order("sent_at", { ascending: false })
    .limit(MESSAGE_PAGE_SIZE + 1);
  if (error) throw new Error(error.message);

  const hasMore = (data ?? []).length > MESSAGE_PAGE_SIZE;
  const page = (data ?? []).slice(0, MESSAGE_PAGE_SIZE).reverse();
  const db = await admin();
  const messages = await Promise.all(
    page.map(async (message) => ({
      ...message,
      media_url: await signMediaUrl(db, message.media_url),
    })),
  );
  return { messages, hasMore };
}

async function conversationForSend(userId: string, conversationId: string) {
  const { db, connection, creds } = await requireConnection(userId);

  const { data: conversation, error } = await db
    .from("conversations")
    .select("*")
    .eq("id", conversationId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!conversation) throw new Error("Conversa não encontrada");
  if (!conversation.phone_number) {
    throw new Error("Esta conversa não possui um telefone válido para envio.");
  }
  if (connection.status !== "connected") {
    throw new Error("WhatsApp desconectado. Reconecte antes de enviar mensagens.");
  }

  return { db, connection, creds, conversation };
}

/** Origem do envio: distingue conversa do vendedor de mensagem automática. */
export type SendSource = "manual" | "automation";

/**
 * Credencial recusada pelo provedor: a conexão é marcada como `error` para que
 * o motor de follow-up reagende as ações em vez de queimar tentativas.
 */
async function noteSendFailure(db: Client, connectionId: string, error: unknown): Promise<void> {
  const status = error instanceof ProviderError ? error.statusCode : null;
  if (status !== 401 && status !== 403) return;
  await db
    .from("whatsapp_connections")
    .update({
      status: "error",
      last_error: "Credenciais da UAZAPI recusadas (401). Atualize o token da instância.",
    })
    .eq("id", connectionId);
}

export async function sendText(
  userId: string,
  input: { conversationId: string; text: string; source?: SendSource | undefined },
): Promise<{ messageId: string }> {
  const { db, connection, creds, conversation } = await conversationForSend(
    userId,
    input.conversationId,
  );
  const provider = await getWhatsAppProvider(connection.provider);
  const source: SendSource = input.source ?? "manual";

  const { data: pending, error: insertError } = await db
    .from("messages")
    .insert({
      user_id: userId,
      conversation_id: conversation.id,
      contact_id: conversation.contact_id,
      direction: "outbound",
      recipient_phone: conversation.phone_number,
      message_type: "text",
      text_content: input.text,
      status: "pending",
      metadata: { source },
    })
    .select("id")
    .single();
  if (insertError) throw new Error(insertError.message);

  try {
    const result = await provider.sendTextMessage(creds, {
      phoneNumber: conversation.phone_number!,
      text: input.text,
    });

    await db
      .from("messages")
      .update({ status: result.status, external_message_id: result.externalMessageId })
      .eq("id", pending.id);

    await refreshConversationAggregates(db, conversation.id, {
      lastMessageAt: new Date().toISOString(),
      preview: messagePreview("text", input.text, null),
      incrementUnread: false,
    });

    waLog.info("message_sent", { connection_id: connection.id, type: "text", source });
    return { messageId: pending.id };
  } catch (error) {
    await db.from("messages").update({ status: "failed" }).eq("id", pending.id);
    waLog.error("message_send_failed", { connection_id: connection.id, type: "text", source });
    await noteSendFailure(db, connection.id, error);
    throw new Error(userFacingProviderError(error));
  }
}

export async function sendMedia(
  userId: string,
  input: {
    conversationId: string;
    type: "audio" | "image" | "document" | "video";
    base64: string;
    mimeType: string;
    filename: string;
    caption: string | null;
    source?: SendSource | undefined;
  },
): Promise<{ messageId: string }> {
  const { db, connection, creds, conversation } = await conversationForSend(
    userId,
    input.conversationId,
  );
  const provider = await getWhatsAppProvider(connection.provider);
  const source: SendSource = input.source ?? "manual";

  const bytes = Uint8Array.from(atob(input.base64), (char) => char.charCodeAt(0));
  const path = `${userId}/${conversation.id}/${crypto.randomUUID()}-${input.filename}`;

  const { error: uploadError } = await db.storage
    .from(MEDIA_BUCKET)
    .upload(path, bytes, { contentType: input.mimeType, upsert: false });
  if (uploadError) {
    waLog.error("media_upload_failed", { connection_id: connection.id, type: input.type });
    throw new Error("Não foi possível preparar o arquivo para envio.");
  }

  const { data: pending, error: insertError } = await db
    .from("messages")
    .insert({
      user_id: userId,
      conversation_id: conversation.id,
      contact_id: conversation.contact_id,
      direction: "outbound",
      recipient_phone: conversation.phone_number,
      message_type: input.type,
      text_content: input.caption,
      media_url: `${STORAGE_PREFIX}${path}`,
      media_mime_type: input.mimeType,
      media_filename: input.filename,
      status: "pending",
      metadata: { source },
    })
    .select("id")
    .single();
  if (insertError) throw new Error(insertError.message);

  try {
    const result = await provider.sendMediaMessage(creds, {
      phoneNumber: conversation.phone_number!,
      caption: input.caption,
      media: {
        type: input.type,
        base64: input.base64,
        mimeType: input.mimeType,
        filename: input.filename,
      },
    });

    await db
      .from("messages")
      .update({ status: result.status, external_message_id: result.externalMessageId })
      .eq("id", pending.id);

    await refreshConversationAggregates(db, conversation.id, {
      lastMessageAt: new Date().toISOString(),
      preview: messagePreview(input.type, input.caption, input.filename),
      incrementUnread: false,
    });

    waLog.info("message_sent", { connection_id: connection.id, type: input.type, source });
    return { messageId: pending.id };
  } catch (error) {
    await db.from("messages").update({ status: "failed" }).eq("id", pending.id);
    waLog.error("message_send_failed", {
      connection_id: connection.id,
      type: input.type,
      source,
    });
    await noteSendFailure(db, connection.id, error);
    throw new Error(userFacingProviderError(error));
  }
}

/* ------------------------- vínculo com cliente ------------------------- */

export async function linkContact(
  supabase: Client,
  userId: string,
  input: { conversationId: string; contactId: string },
): Promise<{ ok: true }> {
  const { data, error } = await supabase
    .from("conversations")
    .update({ contact_id: input.contactId })
    .eq("id", input.conversationId)
    .select("id, phone_number")
    .single();
  if (error) throw new Error(error.message);

  await supabase
    .from("messages")
    .update({ contact_id: input.contactId })
    .eq("conversation_id", data.id);

  await logEvent(supabase, userId, {
    event_type: "whatsapp_conversation_linked",
    contact_id: input.contactId,
    metadata: { phone_number: data.phone_number },
  });

  return { ok: true };
}

export async function unlinkContact(
  supabase: Client,
  userId: string,
  conversationId: string,
): Promise<{ ok: true }> {
  const { data: before } = await supabase
    .from("conversations")
    .select("contact_id, phone_number")
    .eq("id", conversationId)
    .maybeSingle();

  const { error } = await supabase
    .from("conversations")
    .update({ contact_id: null })
    .eq("id", conversationId);
  if (error) throw new Error(error.message);

  if (before?.contact_id) {
    await supabase
      .from("messages")
      .update({ contact_id: null })
      .eq("conversation_id", conversationId);
    await logEvent(supabase, userId, {
      event_type: "whatsapp_conversation_unlinked",
      contact_id: before.contact_id,
      metadata: { phone_number: before.phone_number },
    });
  }

  return { ok: true };
}

export { ProviderError };
