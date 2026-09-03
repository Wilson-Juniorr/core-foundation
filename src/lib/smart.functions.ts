import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  commitmentIdSchema,
  conversationSmartSchema,
  smartActionDecisionSchema,
  smartFlowIdSchema,
  smartFlowInputSchema,
  startSmartFlowSchema,
} from "./smart.schemas";
import type { ConversationSmartView, SmartFlowSummary } from "./smart/types";

export const listSmartFlowsFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SmartFlowSummary[]> => {
    const { listSmartFlows } = await import("./smart/view.server");
    return listSmartFlows(context.supabase, context.userId);
  });

export const getSmartFlowFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(smartFlowIdSchema.parse)
  .handler(async ({ context, data }) => {
    const { getSmartFlow } = await import("./smart/view.server");
    return getSmartFlow(context.supabase, context.userId, data.flowId);
  });

export const saveSmartFlowFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(smartFlowInputSchema.parse)
  .handler(async ({ context, data }) => {
    const { saveSmartFlow } = await import("./smart/flows.server");
    return saveSmartFlow(context.supabase, context.userId, data);
  });

export const setSmartFlowActiveFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(smartFlowIdSchema.parse)
  .handler(async ({ context, data }) => {
    const { setSmartFlowActive } = await import("./smart/flows.server");
    const { getSmartFlow } = await import("./smart/view.server");
    const current = await getSmartFlow(context.supabase, context.userId, data.flowId);
    await setSmartFlowActive(
      context.supabase,
      context.userId,
      data.flowId,
      !(current?.is_active ?? false),
    );
    return { ok: true };
  });

export const startSmartFlowFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(startSmartFlowSchema.parse)
  .handler(async ({ context, data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { startSmartFlow } = await import("./smart/engine.server");

    let conversationId = data.conversationId ?? null;
    if (!conversationId) {
      const { ensureConversationForContact } = await import("@/lib/whatsapp/link.server");
      const resolution = await ensureConversationForContact(context.userId, data.contactId);
      conversationId = resolution.conversationId;
    }

    return startSmartFlow(supabaseAdmin, context.userId, {
      flowId: data.flowId,
      contactId: data.contactId,
      conversationId,
      opportunityId: data.opportunityId ?? null,
    });
  });

export const getConversationSmart = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(conversationSmartSchema.parse)
  .handler(async ({ context, data }): Promise<ConversationSmartView> => {
    const { getConversationSmartView } = await import("./smart/view.server");
    return getConversationSmartView(context.supabase, context.userId, data.conversationId);
  });

export const listSmartApprovalsFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { listSmartApprovals } = await import("./smart/view.server");
    return listSmartApprovals(context.supabase, context.userId);
  });

export const approveSmartActionFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(smartActionDecisionSchema.parse)
  .handler(async ({ context, data }) => {
    const { approveSmartAction } = await import("./smart/approvals.server");
    await approveSmartAction(context.supabase, context.userId, {
      actionId: data.actionId,
      content: data.content,
    });
    return { ok: true };
  });

export const rejectSmartActionFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(smartActionDecisionSchema.parse)
  .handler(async ({ context, data }) => {
    const { rejectSmartAction } = await import("./smart/approvals.server");
    await rejectSmartAction(context.supabase, context.userId, { actionId: data.actionId });
    return { ok: true };
  });

export const completeCommitmentFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(commitmentIdSchema.parse)
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase
      .from("commitments")
      .update({ status: "fulfilled" })
      .eq("id", data.commitmentId)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
