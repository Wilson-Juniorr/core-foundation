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
              waLog.info("webhook_message", {
                connection_id: connection.id,
                direction: event.message.direction,
                type: event.message.type,
                outcome,
              });
              break;
            }
            case "status": {
              await applyStatusUpdate(supabaseAdmin, connection.user_id, event.status);
              break;
            }
            case "connection": {
              await applyConnectionUpdate(supabaseAdmin, connection.id, event.connection);
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
