import { createFileRoute } from "@tanstack/react-router";

/**
 * Executor da fila de análise de IA.
 *
 * Fica fora do caminho crítico do webhook do WhatsApp: o webhook apenas
 * persiste a mensagem e enfileira; aqui a análise é executada com claim
 * atômico, retry limitado e sem duplicar processamento.
 *
 * Autenticação: somente o secret server-side `FOLLOWUP_CRON_SECRET`.
 */
export const Route = createFileRoute("/api/public/hooks/ai-tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { authorizeCronRequest } = await import("@/lib/cron-auth.server");
        const denied = authorizeCronRequest(request);
        if (denied) return denied;

        try {
          const { processAnalysisQueue } = await import("@/lib/ai/analysis.server");
          const result = await processAnalysisQueue(5);
          return Response.json({ ok: true, ...result });
        } catch (error) {
          console.error("ai_tick_failed", error);
          return Response.json({ ok: false, error: "tick_failed" }, { status: 500 });
        }
      },

      GET: async () => new Response("ok"),
    },
  },
});
