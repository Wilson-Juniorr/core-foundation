import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import { normalizePhone, phoneFromChatId } from "@/lib/domain/phone";
import { messagePreview } from "./labels";
import { waLog } from "./log.server";
import type { ProviderCredentials } from "./provider.server";
import type {
  NormalizedConnectionUpdate,
  NormalizedStatusUpdate,
  NormalizedWhatsAppMessage,
} from "./types";

type Admin = SupabaseClient<Database>;
type ConnectionRow = Database["public"]["Tables"]["whatsapp_connections"]["Row"];

export const MEDIA_BUCKET = "whatsapp-media";
export const STORAGE_PREFIX = "storage:";

export async function loadConnection(admin: Admin, connectionId: string) {
  const { data, error } = await admin
    .from("whatsapp_connections")
    .select("*")
    .eq("id", connectionId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export async function loadCredentials(
  admin: Admin,
  connection: ConnectionRow,
): Promise<ProviderCredentials | null> {
  const { data, error } = await admin
    .from("whatsapp_credentials")
    .select("base_url, token")
    .eq("connection_id", connection.id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return {
    baseUrl: data.base_url,
    token: data.token,
    instanceIdentifier: connection.instance_identifier,
  };
}

/** Localiza um cliente do usuário pelo telefone normalizado. */
async function findContactByPhone(
  admin: Admin,
  userId: string,
  phone: string | null,
): Promise<string | null> {
  if (!phone) return null;
  const { data, error } = await admin
    .from("contacts")
    .select("id")
    .eq("user_id", userId)
    .eq("phone", phone)
    .limit(1)
    .maybeSingle();
  if (error) {
    waLog.warn("contact_lookup_failed", { reason: error.message });
    return null;
  }
  return data?.id ?? null;
}

export async function upsertConversation(
  admin: Admin,
  input: {
    userId: string;
    connectionId: string;
    externalChatId: string;
    phoneNumber: string | null;
    displayName: string | null;
  },
) {
  const { data: existing, error: findError } = await admin
    .from("conversations")
    .select("*")
    .eq("whatsapp_connection_id", input.connectionId)
    .eq("external_chat_id", input.externalChatId)
    .maybeSingle();
  if (findError) throw new Error(findError.message);

  const phone = input.phoneNumber ?? phoneFromChatId(input.externalChatId);

  if (existing) {
    // Vincula o cliente automaticamente apenas quando ainda não há vínculo.
    if (!existing.contact_id) {
      const contactId = await findContactByPhone(admin, input.userId, phone);
      if (contactId) {
        const { data: updated } = await admin
          .from("conversations")
          .update({ contact_id: contactId })
          .eq("id", existing.id)
          .select("*")
          .single();
        return updated ?? existing;
      }
    }
    return existing;
  }

  const contactId = await findContactByPhone(admin, input.userId, phone);

  const { data: created, error } = await admin
    .from("conversations")
    .insert({
      user_id: input.userId,
      whatsapp_connection_id: input.connectionId,
      external_chat_id: input.externalChatId,
      phone_number: phone,
      display_name: input.displayName,
      contact_id: contactId,
    })
    .select("*")
    .single();

  if (error) {
    // Corrida entre webhook e sincronização: relê a conversa existente.
    const { data: raced } = await admin
      .from("conversations")
      .select("*")
      .eq("whatsapp_connection_id", input.connectionId)
      .eq("external_chat_id", input.externalChatId)
      .maybeSingle();
    if (raced) return raced;
    throw new Error(error.message);
  }

  return created;
}

export type IngestOutcome = "created" | "duplicate" | "ignored";

/**
 * Persiste uma mensagem normalizada. Webhook e importação de histórico
 * convergem aqui, por isso a idempotência usa external_message_id.
 */
export async function ingestMessage(
  admin: Admin,
  input: {
    userId: string;
    connectionId: string;
    message: NormalizedWhatsAppMessage;
    countUnread?: boolean;
  },
): Promise<IngestOutcome> {
  const { message } = input;

  if (message.externalMessageId) {
    const { data: existing } = await admin
      .from("messages")
      .select("id")
      .eq("user_id", input.userId)
      .eq("external_message_id", message.externalMessageId)
      .maybeSingle();

    if (existing) {
      waLog.info("message_duplicate", {
        connection_id: input.connectionId,
        direction: message.direction,
      });
      return "duplicate";
    }
  }

  const conversation = await upsertConversation(admin, {
    userId: input.userId,
    connectionId: input.connectionId,
    externalChatId: message.externalChatId,
    phoneNumber: message.phoneNumber,
    displayName: message.displayName,
  });

  const { error } = await admin.from("messages").insert({
    user_id: input.userId,
    conversation_id: conversation.id,
    contact_id: conversation.contact_id,
    external_message_id: message.externalMessageId,
    direction: message.direction,
    sender_phone: message.direction === "inbound" ? message.phoneNumber : null,
    recipient_phone: message.direction === "outbound" ? message.phoneNumber : null,
    message_type: message.type,
    text_content: message.text,
    media_url: message.media?.url ?? null,
    media_mime_type: message.media?.mimeType ?? null,
    media_filename: message.media?.filename ?? null,
    media_duration: message.media?.durationSeconds ?? null,
    status: message.status,
    sent_at: message.timestamp,
  });

  if (error) {
    // Índice único: outro processo gravou o mesmo evento primeiro.
    if (error.code === "23505") {
      waLog.info("message_duplicate", { connection_id: input.connectionId });
      return "duplicate";
    }
    throw new Error(error.message);
  }

  await refreshConversationAggregates(admin, conversation.id, {
    lastMessageAt: message.timestamp,
    preview: messagePreview(message.type, message.text, message.media?.filename ?? null),
    incrementUnread: message.direction === "inbound" && input.countUnread !== false,
  });

  return "created";
}

export async function refreshConversationAggregates(
  admin: Admin,
  conversationId: string,
  input: { lastMessageAt: string; preview: string; incrementUnread: boolean },
): Promise<void> {
  const { data: conversation } = await admin
    .from("conversations")
    .select("last_message_at, unread_count")
    .eq("id", conversationId)
    .maybeSingle();

  const isNewer =
    !conversation?.last_message_at ||
    new Date(input.lastMessageAt) >= new Date(conversation.last_message_at);

  const patch: Database["public"]["Tables"]["conversations"]["Update"] = {
    unread_count: input.incrementUnread
      ? (conversation?.unread_count ?? 0) + 1
      : (conversation?.unread_count ?? 0),
  };

  // Eventos podem chegar fora de ordem: só sobrescrevemos a prévia se a
  // mensagem for a mais recente conhecida.
  if (isNewer) {
    patch.last_message_at = input.lastMessageAt;
    patch.last_message_preview = input.preview;
  }

  const { error } = await admin.from("conversations").update(patch).eq("id", conversationId);
  if (error) waLog.warn("conversation_aggregate_failed", { reason: error.message });
}

export async function applyStatusUpdate(
  admin: Admin,
  userId: string,
  update: NormalizedStatusUpdate,
): Promise<"updated" | "unknown"> {
  const { data: message } = await admin
    .from("messages")
    .select("id, status")
    .eq("user_id", userId)
    .eq("external_message_id", update.externalMessageId)
    .maybeSingle();

  if (!message) return "unknown";

  const rank: Record<string, number> = {
    pending: 0,
    failed: 0,
    received: 1,
    sent: 1,
    delivered: 2,
    read: 3,
  };

  const patch: Database["public"]["Tables"]["messages"]["Update"] = {};
  // Status podem chegar fora de ordem; nunca regredimos o estado.
  if (update.status === "failed" || (rank[update.status] ?? 0) > (rank[message.status] ?? 0)) {
    patch.status = update.status;
  }
  if (update.status === "delivered") patch.delivered_at = update.timestamp;
  if (update.status === "read") {
    patch.read_at = update.timestamp;
    patch.delivered_at = update.timestamp;
  }

  if (Object.keys(patch).length === 0) return "updated";

  const { error } = await admin.from("messages").update(patch).eq("id", message.id);
  if (error) throw new Error(error.message);
  return "updated";
}

export async function applyConnectionUpdate(
  admin: Admin,
  connectionId: string,
  update: NormalizedConnectionUpdate,
): Promise<void> {
  const patch: Database["public"]["Tables"]["whatsapp_connections"]["Update"] = {
    status: update.status,
    last_event_at: new Date().toISOString(),
  };
  if (update.phoneNumber) patch.phone_number = normalizePhone(update.phoneNumber);
  if (update.displayName) patch.display_name = update.displayName;
  if (update.instanceIdentifier) patch.instance_identifier = update.instanceIdentifier;
  if (update.status === "connected") {
    patch.last_connected_at = new Date().toISOString();
    patch.last_error = null;
  }

  const { error } = await admin
    .from("whatsapp_connections")
    .update(patch)
    .eq("id", connectionId);
  if (error) throw new Error(error.message);
}

export async function touchConnectionEvent(admin: Admin, connectionId: string): Promise<void> {
  await admin
    .from("whatsapp_connections")
    .update({ last_event_at: new Date().toISOString() })
    .eq("id", connectionId);
}

/** Converte caminhos internos de storage em URLs assinadas de curta duração. */
export async function signMediaUrl(admin: Admin, mediaUrl: string | null): Promise<string | null> {
  if (!mediaUrl) return null;
  if (!mediaUrl.startsWith(STORAGE_PREFIX)) return mediaUrl;

  const path = mediaUrl.slice(STORAGE_PREFIX.length);
  const { data, error } = await admin.storage.from(MEDIA_BUCKET).createSignedUrl(path, 60 * 30);
  if (error) {
    waLog.warn("media_sign_failed", { reason: error.message });
    return null;
  }
  return data.signedUrl;
}
