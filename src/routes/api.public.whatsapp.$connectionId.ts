import { createFileRoute } from "@tanstack/react-router";

/** Comparação em tempo constante para o segredo do webhook. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export const Route = createFileRoute("/api/public/whatsapp/$connectionId")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const { waLog } = await import("@/lib/whatsapp/log.server");
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const {
          applyConnectionUpdate,
          applyStatusUpdate,
          ingestMessage,
          loadConnection,
          touchConnectionEvent,
        } = await import("@/lib/whatsapp/store.server");
        const { getWhatsAppProvider } = await import("@/lib/whatsapp/provider.server");

        const connectionId = params.connectionId;
        const url = new URL(request.url);
        const provided =
          url.searchParams.get("secret") ?? request.headers.get("x-webhook-secret") ?? "";

        const connection = await loadConnection(supabaseAdmin, connectionId);
        // Resposta idêntica para conexão inexistente e segredo inválido.
        if (!connection || !provided || !safeEqual(provided, connection.webhook_secret)) {
          waLog.warn("webhook_rejected", { connection_id: connectionId });
          return new Response("Unauthorized", { status: 401 });
        }

        let payload: unknown;
        try {
          payload = await request.json();
        } catch {
          return new Response("Invalid payload", { status: 400 });
        }

        try {
          const providerImpl = await getWhatsAppProvider(connection.provider);
          const event = providerImpl.normalizeIncomingWebhook(payload);
          await touchConnectionEvent(supabaseAdmin, connection.id);

          switch (event.kind) {
            case "message": {
              const outcome = await ingestMessage(supabaseAdmin, {
                userId: connection.user_id,
                connectionId: connection.id,
                message: event.message,
              });

              /* Resposta real do cliente interrompe follow-ups server-side.
                 Só mensagens novas (não duplicadas) disparam a interrupção,
                 então um webhook reentregue é inofensivo. */
              const isRealInbound =
                event.message.direction === "inbound" &&
                ["text", "audio", "image", "document", "video"].includes(event.message.type);

              if (outcome === "created" && isRealInbound) {
                const { stopRunsForReply } = await import("@/lib/followup/engine.server");
                const { data: conversation } = await supabaseAdmin
                  .from("conversations")
                  .select("id, contact_id")
                  .eq("whatsapp_connection_id", connection.id)
                  .eq("external_chat_id", event.message.externalChatId)
                  .maybeSingle();
                if (conversation) {
                  /* Módulo 07: pedido explícito de parada tem prioridade sobre
                     qualquer automação e vale para sempre. */
                  const { detectOptOut, applyCustomerOptOut } = await import(
                    "@/lib/automation/optout.server"
                  );
                  if (conversation.contact_id && detectOptOut(event.message.text ?? null)) {
                    await applyCustomerOptOut(supabaseAdmin, {
                      userId: connection.user_id,
                      contactId: conversation.contact_id,
                      conversationId: conversation.id,
                      quote: event.message.text ?? "",
                    });
                  }
                  await stopRunsForReply({
                    userId: connection.user_id,
                    conversationId: conversation.id,
                    repliedAt: event.message.timestamp,
                  });
                  /* Análise de IA é apenas enfileirada: o webhook responde
                     rápido e nunca depende do modelo. */
                  if (conversation.contact_id) {
                    const { enqueueAnalysis } = await import("@/lib/ai/analysis.server");
                    await enqueueAnalysis(supabaseAdmin, {
                      userId: connection.user_id,
                      contactId: conversation.contact_id,
                      conversationId: conversation.id,
                    });
                  }
                }
              }
              waLog.info("webhook_message", {
                connection_id: connection.id,
                direction: event.message.direction,
                type: event.message.type,
                outcome,
              });
              break;
            }
            case "status": {
              await applyStatusUpdate(supabaseAdmin, connection.user_id, event.update);
              break;
            }
            case "connection": {
              const wasConnected = connection.status === "connected";
              await applyConnectionUpdate(supabaseAdmin, connection.id, event.update);
              // Reconexão: ações vencidas são recalculadas, nunca disparadas
              // todas de uma vez.
              if (!wasConnected && event.update.status === "connected") {
                const { reevaluateAfterReconnect } = await import("@/lib/followup/engine.server");
                await reevaluateAfterReconnect(connection.user_id);
              }
              break;
            }
            default:
              waLog.info("webhook_ignored", { connection_id: connection.id });
          }
        } catch (error) {
          waLog.error("webhook_failed", {
            connection_id: connection.id,
            reason: error instanceof Error ? error.name : "unknown",
          });
          // 200 evita reentregas infinitas do provedor por erro nosso.
          return Response.json({ received: true, processed: false });
        }

        return Response.json({ received: true });
      },

      GET: async () => new Response("ok"),
    },
  },
});
