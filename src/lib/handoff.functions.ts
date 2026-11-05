import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const conversationSchema = z.object({ conversationId: z.string().uuid() });

const interpretationSchema = z.object({
  kind: z.enum(["return", "hold", "context"]),
  mode: z.enum(["auto", "confirm"]).nullable(),
  returnAt: z.string().datetime({ offset: true }).nullable(),
  note: z.string().max(500),
  reply: z.string().max(800),
});

const instructionTextSchema = z.object({
  conversationId: z.string().uuid(),
  text: z.string().trim().min(3, "Escreva a instrução").max(500),
});

const saveInstructionSchema = instructionTextSchema.extend({
  interpretation: interpretationSchema,
});

const returnNowSchema = z.object({
  conversationId: z.string().uuid(),
  mode: z.enum(["auto", "confirm"]),
});

const instructionIdSchema = z.object({ instructionId: z.string().uuid() });

const alertSettingsSchema = z.object({
  alert_phone: z
    .string()
    .trim()
    .max(30)
    .nullable()
    .transform((value) => (value && value !== "" ? value : null)),
  alert_waiting_minutes: z.number().int().min(5).max(240),
});

/** Confirma que a conversa é do usuário (RLS) e devolve o contato vinculado. */
async function ownedConversation(
  supabase: import("@supabase/supabase-js").SupabaseClient<
    import("@/integrations/supabase/types").Database
  >,
  conversationId: string,
) {
  const { data, error } = await supabase
    .from("conversations")
    .select("id, contact_id")
    .eq("id", conversationId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Conversa não encontrada.");
  return data;
}

export const getAgentHandoffFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(conversationSchema.parse)
  .handler(async ({ context, data }) => {
    await ownedConversation(context.supabase, data.conversationId);
    const { getAgentHandoffView } = await import("./smart/handoff-view.server");
    return getAgentHandoffView(context.supabase, data.conversationId);
  });

export const interpretInstructionFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(instructionTextSchema.parse)
  .handler(async ({ context, data }) => {
    await ownedConversation(context.supabase, data.conversationId);
    const { interpretInstruction } = await import("./smart/return.server");
    try {
      return await interpretInstruction(data.text);
    } catch {
      throw new Error("Não consegui entender agora. Tente de novo em instantes.");
    }
  });

export const saveInstructionFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(saveInstructionSchema.parse)
  .handler(async ({ context, data }) => {
    const conversation = await ownedConversation(context.supabase, data.conversationId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { saveInstruction } = await import("./smart/return.server");
    await saveInstruction(supabaseAdmin, {
      userId: context.userId,
      conversationId: data.conversationId,
      contactId: conversation.contact_id,
      text: data.text,
      interpretation: data.interpretation,
    });
    return { ok: true };
  });

export const cancelInstructionFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(instructionIdSchema.parse)
  .handler(async ({ context, data }) => {
    const { data: row, error } = await context.supabase
      .from("agent_instructions")
      .select("id, conversation_id, kind, status")
      .eq("id", data.instructionId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Instrução não encontrada.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin
      .from("agent_instructions")
      .update({ status: "cancelled" })
      .eq("id", row.id);

    // Sem a instrução, o agente reanalisa a conversa para decidir a volta.
    if (row.status === "active" && (row.kind === "return" || row.kind === "hold")) {
      await supabaseAdmin
        .from("conversation_control")
        .update({
          return_mode: null,
          return_at: null,
          return_reason: null,
          return_source: null,
          return_check_at: new Date().toISOString(),
        })
        .eq("conversation_id", row.conversation_id)
        .eq("owner", "human");
    }
    return { ok: true };
  });

export const returnAgentNowFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(returnNowSchema.parse)
  .handler(async ({ context, data }) => {
    await ownedConversation(context.supabase, data.conversationId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { ensureControl } = await import("./smart/control.server");
    const { applyReturn } = await import("./smart/return.server");
    const control = await ensureControl(supabaseAdmin, context.userId, data.conversationId);
    await supabaseAdmin
      .from("agent_instructions")
      .update({ status: "superseded" })
      .eq("conversation_id", data.conversationId)
      .eq("status", "active")
      .eq("kind", "hold");
    const resumed = await applyReturn(supabaseAdmin, control, {
      mode: data.mode,
      source: "manual",
      waiveCooldown: true,
    });
    if (resumed === 0) {
      throw new Error("Este cliente não tem acompanhamento inteligente para retomar.");
    }
    return { ok: true };
  });

export const listWaitingForYouFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { listWaitingForYou } = await import("./smart/handoff-view.server");
    return listWaitingForYou(context.supabase);
  });

export const getAlertSettingsFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("user_settings")
      .select("alert_phone, alert_waiting_minutes")
      .eq("user_id", context.userId)
      .maybeSingle();
    return {
      alert_phone: data?.alert_phone ?? null,
      alert_waiting_minutes: data?.alert_waiting_minutes ?? 10,
    };
  });

export const saveAlertSettingsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(alertSettingsSchema.parse)
  .handler(async ({ context, data }) => {
    const { isSendablePhone, normalizePhone } = await import("./domain/phone");
    const phone = data.alert_phone ? normalizePhone(data.alert_phone) : null;
    if (phone && !isSendablePhone(phone)) throw new Error("Número inválido. Use DDD + número.");

    const { data: connection } = await context.supabase
      .from("whatsapp_connections")
      .select("phone_number")
      .eq("user_id", context.userId)
      .limit(1)
      .maybeSingle();
    if (phone && connection?.phone_number && normalizePhone(connection.phone_number) === phone) {
      throw new Error("Use um número diferente do WhatsApp da empresa.");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("user_settings").upsert(
      {
        user_id: context.userId,
        alert_phone: phone,
        alert_waiting_minutes: data.alert_waiting_minutes,
      },
      { onConflict: "user_id" },
    );
    if (error) throw new Error(error.message);
    return { ok: true, alert_phone: phone };
  });

export const sendTestAlertFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("user_settings")
      .select("alert_phone")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!data?.alert_phone) throw new Error("Cadastre seu número pessoal primeiro.");
    const { sendOwnerNotice } = await import("./whatsapp/service.server");
    await sendOwnerNotice(context.userId, {
      phoneNumber: data.alert_phone,
      text: "✅ Teste: é por aqui que você vai receber os avisos de clientes esperando resposta.",
    });
    return { ok: true };
  });
