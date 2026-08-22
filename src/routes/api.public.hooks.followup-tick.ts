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
 * Executor do motor de follow-up.
 *
 * É chamado por um agendador no banco (pg_cron + pg_net) a cada minuto, ou seja,
 * roda no servidor mesmo sem nenhum browser aberto. Cada chamada apenas procura
 * ações vencidas (`status = scheduled` e `scheduled_for <= now`) e as processa
 * com claim atômico, portanto duas execuções simultâneas são seguras.
 */
export const Route = createFileRoute("/api/public/hooks/followup-tick")({
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
