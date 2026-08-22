import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  contactIdSchema,
  conversationIdSchema,
  linkContactSchema,
  listConversationsSchema,
  sendMediaSchema,
  sendTextSchema,
  syncSchema,
  whatsappSettingsSchema,
} from "./whatsapp.schemas";
import type {
  ConversationDetail,
  ConversationListItem,
  SyncResult,
  WhatsAppConnection,
} from "./whatsapp/types";

export const getWhatsAppConnection = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<WhatsAppConnection | null> => {
    const { presentConnection } = await import("./whatsapp/service.server");
    const { data, error } = await context.supabase
      .from("whatsapp_connections")
      .select("*")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    return presentConnection(data);
  });

export const saveWhatsAppSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => whatsappSettingsSchema.parse(input))
  .handler(async ({ data, context }): Promise<WhatsAppConnection> => {
    const { saveSettings } = await import("./whatsapp/service.server");
    return saveSettings(context.userId, data);
  });

export const startWhatsAppSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(
    async ({ context }): Promise<{ qrCode: string | null; connection: WhatsAppConnection }> => {
      const { startSession } = await import("./whatsapp/service.server");
      return startSession(context.userId);
    },
  );

export const refreshWhatsAppStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<WhatsAppConnection> => {
    const { refreshStatus } = await import("./whatsapp/service.server");
    return refreshStatus(context.userId);
  });

export const disconnectWhatsApp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<WhatsAppConnection> => {
    const { disconnect } = await import("./whatsapp/service.server");
    return disconnect(context.userId);
  });

export const syncWhatsAppHistory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => syncSchema.parse(input ?? {}))
  .handler(async ({ data, context }): Promise<SyncResult> => {
    const { syncHistory } = await import("./whatsapp/service.server");
    return syncHistory(context.userId, data);
  });

export const listConversations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => listConversationsSchema.parse(input ?? {}))
  .handler(async ({ data, context }): Promise<ConversationListItem[]> => {
    const { mapConversation } = await import("./whatsapp/service.server");

    let query = context.supabase
      .from("conversations")
      .select("*, contacts(name)")
      .eq("is_archived", false)
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(200);

    if (data.search) {
      const term = `%${data.search}%`;
      query = query.or(`display_name.ilike.${term},phone_number.ilike.${term}`);
    }

    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);
    return rows.map(mapConversation);
  });

export const getConversation = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => conversationIdSchema.parse(input))
  .handler(async ({ data, context }): Promise<ConversationDetail> => {
    const { loadConversationDetail } = await import("./whatsapp/service.server");
    return loadConversationDetail(context.supabase, data.conversationId);
  });

export const markConversationRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => conversationIdSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    // "Lida no nosso sistema" — não emite read receipt no WhatsApp.
    const { error } = await context.supabase
      .from("conversations")
      .update({ unread_count: 0 })
      .eq("id", data.conversationId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const sendWhatsAppText = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => sendTextSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ messageId: string }> => {
    const { sendText } = await import("./whatsapp/service.server");
    return sendText(context.userId, data);
  });

export const sendWhatsAppMedia = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => sendMediaSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ messageId: string }> => {
    const { sendMedia } = await import("./whatsapp/service.server");
    return sendMedia(context.userId, data);
  });

export const linkConversationContact = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => linkContactSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { linkContact } = await import("./whatsapp/service.server");
    return linkContact(context.supabase, context.userId, data);
  });

export const unlinkConversationContact = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => conversationIdSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { unlinkContact } = await import("./whatsapp/service.server");
    return unlinkContact(context.supabase, context.userId, data.conversationId);
  });

export const getContactConversation = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => contactIdSchema.parse(input))
  .handler(async ({ data, context }): Promise<ConversationListItem | null> => {
    const { mapConversation } = await import("./whatsapp/service.server");
    const { data: row, error } = await context.supabase
      .from("conversations")
      .select("*, contacts(name)")
      .eq("contact_id", data.contactId)
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return row ? mapConversation(row) : null;
  });
