import { createFileRoute } from "@tanstack/react-router";

/** Comparação em tempo constante. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function authorized(request: Request): boolean {
  const provided =
    request.headers.get("apikey") ??
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    "";
  if (!provided) return false;

  const expected = [
    process.env["SUPABASE_ANON_KEY"],
    process.env["SUPABASE_PUBLISHABLE_KEY"],
    process.env["VITE_SUPABASE_PUBLISHABLE_KEY"],
  ].filter((value): value is string => Boolean(value));

  return expected.some((value) => safeEqual(provided, value));
}

/**
 * Executor da fila de análise de IA.
 *
 * Fica fora do caminho crítico do webhook do WhatsApp: o webhook apenas
 * persiste a mensagem e enfileira; aqui a análise é executada com claim
 * atômico, retry limitado e sem duplicar processamento.
 */
export const Route = createFileRoute("/api/public/hooks/ai-tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!authorized(request)) {
          return new Response(JSON.stringify({ error: "unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }

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
