import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  isPostSaleStage,
  nextPostSaleState,
  POST_SALE_STAGES,
  saoPauloDay,
} from "./domain/post-sale";

const postSaleInput = z.object({
  contactId: z.string().uuid(),
  opportunityId: z.string().uuid(),
  version: z.number().int().nonnegative(),
  stage: z.enum(POST_SALE_STAGES),
  day: z.string().optional(),
  note: z.string().trim().max(1500).optional(),
});

export const savePostSale = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(postSaleInput.parse)
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { data: current, error } = await supabase
      .from("opportunities")
      .select("post_sale_stage,post_sale_effective_on,post_sale_version,contacts!inner(id)")
      .eq("id", data.opportunityId)
      .eq("contact_id", data.contactId)
      .eq("user_id", userId)
      .eq("contacts.user_id", userId)
      .eq("contacts.is_archived", false)
      .eq("status", "won")
      .maybeSingle();
    if (error) throw new Error("Não foi possível consultar o pós-venda.");
    if (!current) throw new Error("Selecione uma venda ganha de um cliente ativo.");
    if (current.post_sale_version !== data.version) {
      throw new Error("O pós-venda mudou em outra tela. Atualize a ficha e confira a etapa.");
    }

    const stage = isPostSaleStage(current.post_sale_stage) ? current.post_sale_stage : null;
    const next = nextPostSaleState(stage, current.post_sale_effective_on, data);
    const { data: saved, error: saveError } = await supabase
      .from("opportunities")
      .update({
        post_sale_stage: next.stage,
        post_sale_due_on: next.dueOn,
        post_sale_effective_on: next.effectiveOn,
        post_sale_note: data.note || null,
        post_sale_version: data.version + 1,
      })
      .eq("id", data.opportunityId)
      .eq("contact_id", data.contactId)
      .eq("user_id", userId)
      .eq("status", "won")
      .eq("post_sale_version", data.version)
      .select("id")
      .maybeSingle();
    if (saveError) throw new Error("Não foi possível salvar o pós-venda.");
    if (!saved) throw new Error("O pós-venda mudou em outra tela. Atualize a ficha.");

    const { logEvent } = await import("./crm.server");
    await logEvent(supabase, userId, {
      event_type: "post_sale_updated",
      contact_id: data.contactId,
      opportunity_id: data.opportunityId,
      metadata: { stage: next.stage, due_on: next.dueOn, effective_on: next.effectiveOn },
    });
    return { ok: true };
  });

export const listDuePostSale = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const today = saoPauloDay();
    const { data, error, count } = await context.supabase
      .from("opportunities")
      .select("id,title,contact_id,post_sale_stage,post_sale_due_on,contacts!inner(name)", {
        count: "exact",
      })
      .eq("user_id", context.userId)
      .eq("contacts.user_id", context.userId)
      .eq("contacts.is_archived", false)
      .eq("status", "won")
      .lte("post_sale_due_on", today)
      .order("post_sale_due_on")
      .order("id")
      .limit(30);
    if (error) throw new Error("Não foi possível carregar os prazos de pós-venda.");
    const items = data.flatMap((row) =>
      row.post_sale_due_on && isPostSaleStage(row.post_sale_stage)
        ? [
            {
              id: row.id,
              title: row.title,
              contactId: row.contact_id,
              contactName: row.contacts.name,
              stage: row.post_sale_stage,
              dueOn: row.post_sale_due_on,
            },
          ]
        : [],
    );
    return { today, items, total: count ?? items.length };
  });
