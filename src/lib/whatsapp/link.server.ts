import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import { chatIdFromPhone, isSendablePhone, normalizePhone } from "@/lib/domain/phone";
import { waLog } from "./log.server";
import { getWhatsAppProvider } from "./provider.server";
import { loadCredentials, upsertConversation } from "./store.server";

type Admin = SupabaseClient<Database>;

export type ConversationSource =
  /** Já existia uma conversa vinculada ao cliente. */
  | "linked"
  /** Existia conversa local com o mesmo telefone — vinculada automaticamente. */
  | "matched_local"
  /** Conversa encontrada (e importada) no provedor. */
  | "imported"
  /** Nenhum histórico: conversa criada localmente para o primeiro envio. */
  | "created";

export type ConversationResolution = {
  conversationId: string;
  phoneNumber: string;
  source: ConversationSource;
};

export class ConversationResolutionError extends Error {
  constructor(
    message: string,
    public code: "no_phone" | "invalid_phone" | "not_configured" | "disconnected",
  ) {
    super(message);
    this.name = "ConversationResolutionError";
  }
}

async function adminClient(): Promise<Admin> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as unknown as Admin;
}

async function linkContact(db: Admin, conversationId: string, contactId: string): Promise<void> {
  await db.from("conversations").update({ contact_id: contactId }).eq("id", conversationId);
  await db.from("messages").update({ contact_id: contactId }).eq("conversation_id", conversationId);
}

/**
 * Garante que exista uma conversa de WhatsApp para um cliente, mesmo quando ele
 * foi cadastrado manualmente e nunca conversou.
 *
 * Ordem: conversa já vinculada → conversa local com o mesmo telefone → conversa
 * no provedor (importada) → conversa local nova, pronta para o primeiro envio.
 * A duplicidade é impedida pelo índice único (conexão + telefone) e pela
 * releitura em caso de corrida dentro de `upsertConversation`.
 */
export async function ensureConversationForContact(
  userId: string,
  contactId: string,
): Promise<ConversationResolution> {
  const db = await adminClient();

  const { data: contact, error } = await db
    .from("contacts")
    .select("id, name, phone")
    .eq("id", contactId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!contact) throw new ConversationResolutionError("Cliente não encontrado.", "no_phone");

  const phone = normalizePhone(contact.phone);
  if (!phone) {
    throw new ConversationResolutionError(
      "Este cliente não tem telefone cadastrado. Adicione o número para iniciar pelo WhatsApp.",
      "no_phone",
    );
  }
  if (!isSendablePhone(phone)) {
    throw new ConversationResolutionError(
      `O telefone ${contact.phone} não é válido para WhatsApp. Corrija o número com DDD.`,
      "invalid_phone",
    );
  }

  const { ensureConnection } = await import("./service.server");
  const connection = await ensureConnection(userId);
  if (!connection) {
    throw new ConversationResolutionError(
      "WhatsApp ainda não configurado. Conclua a conexão em Configurações.",
      "not_configured",
    );
  }

  // 1) Conversa já vinculada ao cliente.
  const { data: linked } = await db
    .from("conversations")
    .select("id, phone_number")
    .eq("whatsapp_connection_id", connection.id)
    .eq("contact_id", contactId)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  if (linked) {
    if (!linked.phone_number) {
      await db.from("conversations").update({ phone_number: phone }).eq("id", linked.id);
    }
    return { conversationId: linked.id, phoneNumber: phone, source: "linked" };
  }

  // 2) Conversa local com o mesmo telefone normalizado.
  const { data: byPhone } = await db
    .from("conversations")
    .select("id")
    .eq("whatsapp_connection_id", connection.id)
    .eq("phone_number", phone)
    .maybeSingle();
  if (byPhone) {
    await linkContact(db, byPhone.id, contactId);
    return { conversationId: byPhone.id, phoneNumber: phone, source: "matched_local" };
  }

  if (connection.status !== "connected") {
    throw new ConversationResolutionError(
      "WhatsApp desconectado. Reconecte em Configurações para iniciar uma conversa nova.",
      "disconnected",
    );
  }

  // 3) Histórico no provedor: importa sem duplicar.
  const creds = await loadCredentials(db, connection);
  const provider = await getWhatsAppProvider(connection.provider);

  if (creds && provider.findChatByPhone) {
    try {
      const chat = await provider.findChatByPhone(creds, { phoneNumber: phone });
      if (chat) {
        const conversation = await upsertConversation(db, {
          userId,
          connectionId: connection.id,
          externalChatId: chat.externalChatId,
          phoneNumber: phone,
          displayName: chat.displayName ?? contact.name,
        });
        if (conversation.contact_id !== contactId) {
          await linkContact(db, conversation.id, contactId);
        }

        // Importação do histórico é melhor-esforço: não bloqueia o follow-up.
        try {
          const { ingestMessage } = await import("./store.server");
          const history = await provider.fetchChatHistory(creds, {
            externalChatId: chat.externalChatId,
            limit: 30,
          });
          for (const message of history) {
            await ingestMessage(db, {
              userId,
              connectionId: connection.id,
              message,
              countUnread: false,
            });
          }
        } catch (historyError) {
          waLog.warn("history_import_failed", {
            reason: historyError instanceof Error ? historyError.name : "unknown",
          });
        }

        return { conversationId: conversation.id, phoneNumber: phone, source: "imported" };
      }
    } catch (lookupError) {
      waLog.warn("chat_lookup_failed", {
        reason: lookupError instanceof Error ? lookupError.name : "unknown",
      });
    }
  }

  // 4) Nenhuma conversa: cria localmente (outbound-first).
  const created = await upsertConversation(db, {
    userId,
    connectionId: connection.id,
    externalChatId: chatIdFromPhone(phone)!,
    phoneNumber: phone,
    displayName: contact.name,
  });
  if (created.contact_id !== contactId) {
    await linkContact(db, created.id, contactId);
  }

  waLog.info("conversation_created_outbound_first", { connection_id: connection.id });
  return { conversationId: created.id, phoneNumber: phone, source: "created" };
}
