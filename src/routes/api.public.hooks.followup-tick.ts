import { createFileRoute } from "@tanstack/react-router";

/**
 * Executor do motor de follow-up.
 *
 * É chamado por um agendador no banco (pg_cron + pg_net) a cada minuto, ou seja,
 * roda no servidor mesmo sem nenhum browser aberto. Cada chamada apenas procura
 * ações vencidas (`status = scheduled` e `scheduled_for <= now`) e as processa
 * com claim atômico, portanto duas execuções simultâneas são seguras.
 *
 * Autenticação: somente o secret server-side `FOLLOWUP_CRON_SECRET`.
 */
export const Route = createFileRoute("/api/public/hooks/followup-tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { authorizeCronRequest } = await import("@/lib/cron-auth.server");
        const denied = authorizeCronRequest(request);
        if (denied) return denied;

        try {
          const { runDueActions } = await import("@/lib/followup/engine.server");
          const result = await runDueActions(25);
          return Response.json({ ok: true, ...result });
        } catch (error) {
          console.error("followup_tick_failed", error);
          return Response.json({ ok: false, error: "tick_failed" }, { status: 500 });
        }
      },

      GET: async () => new Response("ok"),
    },
  },
});
