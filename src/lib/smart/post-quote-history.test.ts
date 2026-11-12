import { createClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/integrations/supabase/types";
import type { NormalizedWhatsAppMessage } from "@/lib/whatsapp/types";
import { hasPostQuoteHistory, recoverPostQuoteMessages } from "./post-quote-history.server";

const fake = vi.hoisted(() => ({ fetchHistory: vi.fn(), ingest: vi.fn(), requestOlder: vi.fn() }));
vi.mock("@/lib/whatsapp/provider.server", () => ({
  getWhatsAppProvider: async () => ({
    fetchChatHistory: fake.fetchHistory,
    requestOlderChatHistory: fake.requestOlder,
  }),
}));
vi.mock("@/lib/whatsapp/store.server", () => ({
  loadConnection: async () => ({ id: "instance", user_id: "user", status: "connected" }),
  loadCredentials: async () => ({ baseUrl: "https://whatsapp.example", token: "test" }),
  ingestMessage: fake.ingest,
}));

const scope = { userId: "user", contactId: "contact", conversationId: "chat" };
const phone = "+5511999999999";
const phoneJid = "5511999999999@s.whatsapp.net";
const message = {
  direction: "outbound",
  message_type: "text",
  media_mime_type: null,
  media_filename: null,
  text_content: "Segue a cotação da Porto.",
  metadata: null,
  status: "sent",
  sent_at: "2026-11-10T16:00:00Z",
  id: "message",
} as const;

function chatDb(externalChatId: string) {
  return createClient<Database>("https://supabase.example", "test", {
    global: {
      fetch: async (input) => {
        const url = new URL(input instanceof Request ? input.url : input);
        expect(url.searchParams.get("user_id")).toBe("eq.user");
        expect(url.searchParams.get("contact_id")).toBe("eq.contact");
        expect(url.searchParams.get("id")).toBe("eq.chat");
        return Response.json({
          external_chat_id: externalChatId,
          phone_number: phone,
          whatsapp_connection_id: "instance",
        });
      },
    },
  });
}

function remote(id: string, chatId = phoneJid): NormalizedWhatsAppMessage {
  return {
    externalMessageId: id,
    externalChatId: chatId,
    phoneNumber: phone,
    displayName: null,
    direction: "outbound",
    type: "text",
    status: "sent",
    media: null,
    timestamp: message.sent_at,
    text: message.text_content,
  };
}

describe("histórico necessário para pós-cotação", () => {
  beforeEach(() => vi.resetAllMocks());

  it("distingue cotação de saudação e mensagens geradas pelo fluxo", () => {
    expect(hasPostQuoteHistory([])).toBe(false);
    expect(hasPostQuoteHistory([{ ...message, text_content: "Bom dia, tudo bem?" }])).toBe(false);
    expect(hasPostQuoteHistory([{ ...message, metadata: { source: "automation" } }])).toBe(false);
    expect(hasPostQuoteHistory([message])).toBe(true);
  });

  it("tenta o identificador do telefone e importa somente mensagens do chat solicitado", async () => {
    const alternate = "5511999999999@lid";
    fake.fetchHistory
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([remote("selected"), remote("other", "5521999999999@s.whatsapp.net")]);
    expect(await recoverPostQuoteMessages(chatDb(alternate), scope)).toBe("imported");
    expect(fake.fetchHistory.mock.calls.map((call) => call[1].externalChatId)).toEqual([
      alternate,
      phoneJid,
    ]);
    expect(fake.ingest).toHaveBeenCalledTimes(1);
    expect(fake.ingest.mock.calls[0]?.[1]).toMatchObject({
      countUnread: false,
      message: { externalMessageId: "selected", externalChatId: alternate },
    });
  });

  it("solicita histórico ao celular só quando a consulta não trouxe contexto e foi autorizada a pedir", async () => {
    fake.fetchHistory.mockResolvedValue([]);
    fake.requestOlder.mockResolvedValue(true);
    expect(await recoverPostQuoteMessages(chatDb(phoneJid), scope, true)).toBe("requested");
    expect(fake.requestOlder.mock.calls[0]?.[1]).toEqual({ externalChatId: phoneJid, count: 60 });
    expect(await recoverPostQuoteMessages(chatDb(phoneJid), scope, false)).toBe("empty");
    expect(fake.requestOlder).toHaveBeenCalledTimes(1);
  });

  it("distingue o provedor indisponível de uma consulta vazia", async () => {
    fake.fetchHistory.mockResolvedValueOnce([]);
    expect(await recoverPostQuoteMessages(chatDb(phoneJid), scope)).toBe("empty");
    fake.fetchHistory.mockRejectedValueOnce(new Error("timeout"));
    expect(await recoverPostQuoteMessages(chatDb(phoneJid), scope)).toBe("unavailable");
    expect(fake.ingest).not.toHaveBeenCalled();
  });
});
