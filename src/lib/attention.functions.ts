import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type {
  AttentionItem,
  AttentionStatus,
  AttentionView,
  OperationalDashboard,
} from "@/lib/attention/types";

export const listAttentionItems = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      status?: AttentionStatus | null;
      bucket?: string | null;
      contactId?: string | null;
      sync?: boolean;
    }) => input,
  )
  .handler(async ({ data, context }): Promise<AttentionView> => {
    const { listAttention, syncAttention } = await import("@/lib/attention/store.server");
    if (data.sync !== false) await syncAttention(context.supabase, context.userId);
    return listAttention(context.supabase, {
      status: data.status ?? null,
      bucket: data.bucket ?? null,
      contactId: data.contactId ?? null,
    });
  });

export const syncAttentionNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(
    async ({
      context,
    }): Promise<{ created: number; updated: number; autoResolved: number; pausedRuns: number }> => {
      const { syncAttention } = await import("@/lib/attention/store.server");
      return syncAttention(context.supabase, context.userId);
    },
  );

export const snoozeAttentionItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { itemId: string; until: string }) => input)
  .handler(async ({ data, context }): Promise<AttentionItem> => {
    const { snoozeItem } = await import("@/lib/attention/store.server");
    return snoozeItem(context.supabase, context.userId, data);
  });

export const closeAttentionItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: { itemId: string; status: "resolved" | "dismissed"; note?: string | null }) => input,
  )
  .handler(async ({ data, context }): Promise<AttentionItem> => {
    const { closeItem } = await import("@/lib/attention/store.server");
    return closeItem(context.supabase, context.userId, data);
  });

export const suggestAttentionAction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { itemId: string }) => input)
  .handler(async ({ data, context }): Promise<AttentionItem> => {
    const { suggestNextBestAction } = await import("@/lib/attention/nba.server");
    return suggestNextBestAction(context.supabase, context.userId, data.itemId);
  });

export const getOperationalDashboard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<OperationalDashboard> => {
    const { operationalDashboard, syncAttention } = await import("@/lib/attention/store.server");
    await syncAttention(context.supabase, context.userId);
    return operationalDashboard(context.supabase, context.userId);
  });

export const setHandoffPolicy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { pauseAutomation: boolean }) => input)
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { error } = await context.supabase
      .from("user_settings")
      .upsert(
        { user_id: context.userId, pause_automation_on_handoff: data.pauseAutomation },
        { onConflict: "user_id" },
      );
    if (error) throw new Error(error.message);
    return { ok: true };
  });
