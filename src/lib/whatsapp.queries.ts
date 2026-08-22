import { queryOptions } from "@tanstack/react-query";

import {
  getContactConversation,
  getConversation,
  getWhatsAppConnection,
  listConversations,
} from "./whatsapp.functions";

export const whatsappKeys = {
  connection: ["whatsapp", "connection"] as const,
  conversations: (search: string) => ["whatsapp", "conversations", search] as const,
  conversationsRoot: ["whatsapp", "conversations"] as const,
  conversation: (id: string) => ["whatsapp", "conversation", id] as const,
  contactConversation: (contactId: string) =>
    ["whatsapp", "contact-conversation", contactId] as const,
};

export const whatsappConnectionQuery = () =>
  queryOptions({
    queryKey: whatsappKeys.connection,
    queryFn: () => getWhatsAppConnection(),
  });

export const conversationsQuery = (search: string) =>
  queryOptions({
    queryKey: whatsappKeys.conversations(search),
    queryFn: () => listConversations({ data: { search } }),
  });

export const conversationQuery = (conversationId: string | null) =>
  queryOptions({
    queryKey: whatsappKeys.conversation(conversationId ?? "none"),
    queryFn: () => getConversation({ data: { conversationId: conversationId! } }),
    enabled: Boolean(conversationId),
  });

export const contactConversationQuery = (contactId: string) =>
  queryOptions({
    queryKey: whatsappKeys.contactConversation(contactId),
    queryFn: () => getContactConversation({ data: { contactId } }),
  });
