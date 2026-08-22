import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import { AppShell } from "@/components/app-shell";
import { ChatWindow } from "@/components/whatsapp/chat-window";
import { ConversationList } from "@/components/whatsapp/conversation-list";
import { EmptyState, ErrorState, LoadingState } from "@/components/states";
import { useWhatsAppRealtime } from "@/hooks/use-whatsapp-realtime";
import { markConversationRead } from "@/lib/whatsapp.functions";
import {
  conversationQuery,
  conversationsQuery,
  whatsappConnectionQuery,
  whatsappKeys,
} from "@/lib/whatsapp.queries";

const searchSchema = z.object({
  conversa: z.string().uuid().optional(),
});

export const Route = createFileRoute("/_authenticated/conversas")({
  validateSearch: searchSchema,
  head: () => ({
    meta: [
      { title: "Conversas do WhatsApp | Próximo Passo" },
      {
        name: "description",
        content:
          "Central de conversas do WhatsApp com histórico, envio de mensagens e vínculo com clientes.",
      },
      { property: "og:title", content: "Conversas do WhatsApp | Próximo Passo" },
      {
        property: "og:description",
        content: "Atenda no WhatsApp e mantenha o histórico do cliente organizado.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ConversasPage,
});

function ConversasPage() {
  const { conversa } = Route.useSearch();
  const navigate = Route.useNavigate();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");

  const connection = useQuery(whatsappConnectionQuery());
  const conversations = useQuery(conversationsQuery(search));
  const selectedId = conversa ?? null;
  const detail = useQuery(conversationQuery(selectedId));

  useWhatsAppRealtime(selectedId);

  const readMutation = useMutation({
    mutationFn: (conversationId: string) =>
      markConversationRead({ data: { conversationId } }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: whatsappKeys.conversationsRoot }),
  });

  const unread = conversations.data?.find((item) => item.id === selectedId)?.unread_count ?? 0;

  useEffect(() => {
    if (selectedId && unread > 0) readMutation.mutate(selectedId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, unread]);

  return (
    <AppShell
      title="Conversas"
      description="Atendimento no WhatsApp com histórico ligado aos clientes."
    >
      <div className="space-y-4">
        {connection.data && connection.data.status !== "connected" && (
          <p className="bg-muted text-muted-foreground rounded-md border px-4 py-3 text-sm">
            WhatsApp não conectado. Você pode ler o histórico, mas o envio fica indisponível até
            reconectar em Configurações.
          </p>
        )}

        {conversations.isLoading ? (
          <LoadingState />
        ) : conversations.isError ? (
          <ErrorState
            title="Não foi possível carregar as conversas."
            onRetry={() => void conversations.refetch()}
          />
        ) : (conversations.data?.length ?? 0) === 0 ? (
          <EmptyState
            title="Nenhuma conversa ainda"
            description="Conecte o WhatsApp em Configurações e importe o histórico recente para começar."
          />
        ) : (
          <div className="grid h-[calc(100vh-16rem)] min-h-[28rem] grid-cols-1 overflow-hidden rounded-lg border md:grid-cols-[20rem_1fr]">
            <div className={selectedId ? "hidden border-r md:block" : "border-r"}>
              <ConversationList
                conversations={conversations.data ?? []}
                selectedId={selectedId}
                search={search}
                onSearchChange={setSearch}
                onSelect={(conversation) =>
                  void navigate({ search: { conversa: conversation.id } })
                }
              />
            </div>
            <div className={selectedId ? "" : "hidden md:block"}>
              <ChatWindow
                detail={detail.data}
                isLoading={detail.isLoading}
                canSend={connection.data?.status === "connected"}
              />
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
