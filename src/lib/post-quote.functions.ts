import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
const contactSchema = z.object({ contactId: z.string().uuid() });
export const postQuoteViewFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(contactSchema.parse)
  .handler(async ({ context, data }) => {
    const { data: run, error } = await context.supabase
      .from("followup_runs")
      .select("*")
      .eq("user_id", context.userId)
      .eq("contact_id", data.contactId)
      .eq("policy_key", "post_quote_v1")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const { data: actions } = run
      ? await context.supabase
          .from("scheduled_actions")
          .select(
            "id,status,scheduled_for,content,last_error,send_state,decision_reason,send_started_at",
          )
          .eq("flow_run_id", run.id)
          .in("status", ["scheduled", "blocked", "needs_approval", "processing"])
          .order("scheduled_for")
          .limit(1)
      : { data: [] };
    const { data: reviews } = run
      ? await context.supabase
          .from("commitments")
          .select("id,description,created_at")
          .eq("conversation_id", run.conversation_id)
          .eq("commitment_type", "date_review")
          .eq("status", "pending")
      : { data: [] };
    return { run, action: actions?.[0] ?? null, reviews: reviews ?? [] };
  });
export const activatePostQuoteFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(contactSchema.extend({ opportunityId: z.string().uuid() }).parse)
  .handler(async ({ context, data }) => {
    const { data: contact } = await context.supabase
      .from("contacts")
      .select("id")
      .eq("id", data.contactId)
      .eq("user_id", context.userId)
      .single();
    if (!contact) throw new Error("Cliente não encontrado.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { activatePostQuote } = await import("./smart/post-quote-runtime.server");
    return activatePostQuote(supabaseAdmin, context.userId, data.contactId, data.opportunityId);
  });
export const controlPostQuoteFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      runId: z.string().uuid(),
      command: z.enum(["pause", "resume", "reschedule", "end"]),
      at: z.string().datetime().optional(),
    }).parse,
  )
  .handler(async ({ context, data }) => {
    const { data: run } = await context.supabase
      .from("followup_runs")
      .select("id")
      .eq("id", data.runId)
      .eq("user_id", context.userId)
      .single();
    if (!run) throw new Error("Acompanhamento não encontrado.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { controlPostQuote } = await import("./smart/post-quote-runtime.server");
    await controlPostQuote(supabaseAdmin, context.userId, data);
    return { ok: true };
  });
export const resolvePostQuoteFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.discriminatedUnion("kind", [
      z.object({
        kind: z.literal("uncertain"),
        actionId: z.string().uuid(),
        outcome: z.enum(["delivered", "not_delivered"]),
        evidence: z.string().max(500),
      }),
      z.object({
        kind: z.literal("date_review"),
        commitmentId: z.string().uuid(),
        note: z.string().max(500),
      }),
    ]).parse,
  )
  .handler(async ({ context, data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const runtime = await import("./smart/post-quote-runtime.server");
    if (data.kind === "uncertain") {
      const { data: own } = await context.supabase
        .from("scheduled_actions")
        .select("id")
        .eq("id", data.actionId)
        .eq("user_id", context.userId)
        .single();
      if (!own) throw new Error("Tentativa não encontrada.");
      await runtime.resolveUncertainSend(supabaseAdmin, context.userId, data);
    } else {
      await runtime.resolveDateReview(supabaseAdmin, context.userId, data);
    }
    return { ok: true };
  });
