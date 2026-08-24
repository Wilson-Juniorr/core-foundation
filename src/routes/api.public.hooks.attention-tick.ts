import { createFileRoute } from "@tanstack/react-router";

/**
 * Recalcula a Central de Atenção periodicamente: itens novos, snoozes vencidos
 * e fechamento automático do que já não se aplica.
 *
 * Autenticação: somente o secret server-side `FOLLOWUP_CRON_SECRET`.
 */
export const Route = createFileRoute("/api/public/hooks/attention-tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { authorizeCronRequest } = await import("@/lib/cron-auth.server");
        const denied = authorizeCronRequest(request);
        if (denied) return denied;

        try {
          const { syncAllUsers } = await import("@/lib/attention/store.server");
          const result = await syncAllUsers();
          return Response.json({ ok: true, ...result });
        } catch (error) {
          console.error("attention_tick_failed", error);
          return Response.json({ ok: false, error: "tick_failed" }, { status: 500 });
        }
      },

      GET: async () => new Response("ok"),
    },
  },
});
