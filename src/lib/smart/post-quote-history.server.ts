import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { chatIdFromPhone } from "@/lib/domain/phone";
import { detectOptOut } from "@/lib/automation/optout.server";
import {
  getMediaContext,
  mediaKind,
  messageMediaStatus,
  messageMetadata,
} from "@/lib/whatsapp/message-context";
import { getWhatsAppProvider } from "@/lib/whatsapp/provider.server";
import { ingestMessage, loadConnection, loadCredentials } from "@/lib/whatsapp/store.server";
import { waLog } from "@/lib/whatsapp/log.server";
import { POST_QUOTE_HISTORY_LIMIT } from "./post-quote-history";

type Db = SupabaseClient<Database>;
type Scope = { userId: string; contactId: string; conversationId: string };
const QUOTE_TERMS =
  /\b(cota[çc][aã]o|proposta|simula[çc][aã]o|or[çc]amento|planos?|operadoras?|coparticipa[çc][aã]o|car[eê]ncias?|op[çc][õo]es)\b|https?:\/\/(?:app\.)?cotaco\.es\//i;

export async function loadPostQuoteMessages(
  db: Db,
  scope: Pick<Scope, "userId" | "conversationId">,
) {
  const { data, error } = await db
    .from("messages")
    .select(
      "id,direction,message_type,text_content,sent_at,metadata,media_mime_type,media_filename,status",
    )
    .eq("user_id", scope.userId)
    .eq("conversation_id", scope.conversationId)
    .in("status", ["sent", "delivered", "read", "received"])
    .order("sent_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(POST_QUOTE_HISTORY_LIMIT);
  if (error) throw new Error(error.message);
  return data ?? [];
}

type Message = Awaited<ReturnType<typeof loadPostQuoteMessages>>[number];

export function hasPostQuoteHistory(messages: Message[]) {
  return messages.some((message) => {
    if (
      message.direction !== "outbound" ||
      messageMetadata(message.metadata)["source"] === "automation"
    )
      return false;
    const media = mediaKind(message);
    const status = messageMediaStatus(message);
    const context = getMediaContext(message.metadata);
    if (
      QUOTE_TERMS.test(message.text_content ?? "") ||
      QUOTE_TERMS.test(context?.text ?? "") ||
      QUOTE_TERMS.test(message.media_filename ?? "")
    )
      return true;
    return media !== null && (status === "pending" || status === "processing");
  });
}

export function optOutInHistory(messages: Message[]) {
  return messages.find(
    (message) =>
      message.direction === "inbound" &&
      (detectOptOut(message.text_content) ||
        (mediaKind(message) === "audio" && detectOptOut(getMediaContext(message.metadata)?.text))),
  );
}

/** Imports only the chosen contact's chat. An empty result and a provider failure are distinct. */
export async function recoverPostQuoteMessages(db: Db, scope: Scope, requestOlder = false) {
  const { data: chat, error } = await db
    .from("conversations")
    .select("external_chat_id,phone_number,whatsapp_connection_id")
    .eq("id", scope.conversationId)
    .eq("user_id", scope.userId)
    .eq("contact_id", scope.contactId)
    .single();
  if (error) throw new Error(error.message);
  if (!chat) return "unavailable" as const;
  try {
    const connection = await loadConnection(db, chat.whatsapp_connection_id);
    if (!connection || connection.user_id !== scope.userId || connection.status !== "connected")
      return "unavailable" as const;
    const creds = await loadCredentials(db, connection);
    if (!creds) return "unavailable" as const;
    const provider = await getWhatsAppProvider(connection.provider);
    const phoneJid = chatIdFromPhone(chat.phone_number ?? "");
    const ids = new Set([chat.external_chat_id, ...(phoneJid ? [phoneJid] : [])]);
    let unavailable = false;
    let imported = false;
    for (const id of ids) {
      const history = await provider
        .fetchChatHistory(creds, {
          externalChatId: id,
          limit: POST_QUOTE_HISTORY_LIMIT,
        })
        .catch(() => null);
      if (!history) {
        unavailable = true;
        continue;
      }
      const exact = history.filter(
        (message) => message.externalChatId === id && message.externalMessageId,
      );
      for (const message of exact) {
        await ingestMessage(db, {
          userId: scope.userId,
          connectionId: connection.id,
          message: {
            ...message,
            externalChatId: chat.external_chat_id,
            phoneNumber: chat.phone_number,
          },
          countUnread: false,
        });
      }
      if (exact.length > 0) {
        imported = true;
        break;
      }
    }
    if (
      requestOlder &&
      provider.requestOlderChatHistory &&
      (!imported || !hasPostQuoteHistory(await loadPostQuoteMessages(db, scope)))
    ) {
      const requested = await provider
        .requestOlderChatHistory(creds, {
          externalChatId: phoneJid ?? chat.external_chat_id,
          count: POST_QUOTE_HISTORY_LIMIT,
        })
        .catch(() => false);
      if (requested) return "requested" as const;
    }
    if (imported) return "imported" as const;
    return unavailable ? ("unavailable" as const) : ("empty" as const);
  } catch (error) {
    waLog.warn("post_quote_history_unavailable", {
      conversation_id: scope.conversationId,
      reason: error instanceof Error ? error.name : "unknown",
    });
    return "unavailable" as const;
  }
}
