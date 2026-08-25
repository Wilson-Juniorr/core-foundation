import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  flowIdSchema,
  flowInputSchema,
  followupListSchema,
  previewFlowSchema,
  runIdSchema,
  scheduleMessageSchema,
  scheduledActionIdSchema,
  startFlowSchema,
  uploadFollowupMediaSchema,
  userSettingsSchema,
} from "./followup.schemas";
import type {
  Flow,
  FlowDetail,
  FollowupRunView,
  FollowupSummary,
  ScheduledActionView,
  StartFlowPreview,
  UserSettings,
} from "./followup/types";

export const listFollowupFlows = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<Flow[]> => {
    const { listFlows } = await import("./followup/flows.server");
    return listFlows(context.supabase);
  });

export const getFollowupFlow = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => flowIdSchema.parse(input))
  .handler(async ({ data, context }): Promise<FlowDetail> => {
    const { getFlow } = await import("./followup/flows.server");
    return getFlow(context.supabase, data.flowId);
  });

export const saveFollowupFlow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => flowInputSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ flowId: string }> => {
    const { saveFlow } = await import("./followup/flows.server");
    return saveFlow(context.supabase, context.userId, data);
  });

export const duplicateFollowupFlow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => flowIdSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ flowId: string }> => {
    const { duplicateFlow } = await import("./followup/flows.server");
    return duplicateFlow(context.supabase, context.userId, data.flowId);
  });

export const deleteFollowupFlow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => flowIdSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { deleteFlow } = await import("./followup/flows.server");
    return deleteFlow(context.supabase, data.flowId);
  });

export const setFollowupFlowActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    flowIdSchema.extend({ isActive: flowInputSchema.shape.is_active }).parse(input),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { error } = await context.supabase
      .from("followup_flows")
      .update({ is_active: data.isActive })
      .eq("id", data.flowId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const previewFollowupFlow = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => previewFlowSchema.parse(input))
  .handler(async ({ data, context }): Promise<StartFlowPreview> => {
    const { previewFlow } = await import("./followup/engine.server");
    return previewFlow(context.userId, data.flowId);
  });

export const startFollowupFlow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => startFlowSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ runId: string }> => {
    const { startFlow } = await import("./followup/engine.server");
    return startFlow(context.userId, data);
  });

export const pauseFollowupRun = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => runIdSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { pauseRun } = await import("./followup/engine.server");
    await pauseRun(context.userId, data.runId);
    return { ok: true };
  });

export const resumeFollowupRun = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => runIdSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { resumeRun } = await import("./followup/engine.server");
    await resumeRun(context.userId, data.runId);
    return { ok: true };
  });

export const cancelFollowupRun = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => runIdSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { cancelRun } = await import("./followup/engine.server");
    await cancelRun(context.userId, data.runId, "manually_cancelled");
    return { ok: true };
  });

export const listFollowupRuns = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => followupListSchema.parse(input ?? {}))
  .handler(async ({ data, context }): Promise<FollowupRunView[]> => {
    const { listRuns } = await import("./followup/flows.server");
    if (data.status === "active") return listRuns(context.supabase, ["active"]);
    if (data.status === "paused") return listRuns(context.supabase, ["paused"]);
    if (data.status === "history")
      return listRuns(context.supabase, ["stopped", "completed", "cancelled", "failed"]);
    return [];
  });

export const listScheduledMessages = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ScheduledActionView[]> => {
    const { listScheduledActions } = await import("./followup/flows.server");
    return listScheduledActions(context.supabase, { onlyManual: true });
  });

export const listFailedActions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ScheduledActionView[]> => {
    const { listScheduledActions } = await import("./followup/flows.server");
    return listScheduledActions(context.supabase, { statuses: ["failed"] });
  });

export const getFollowupSummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    scheduleMessageSchema
      .pick({ conversationId: true, contactId: true })
      .partial()
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }): Promise<FollowupSummary> => {
    const { loadFollowupSummary } = await import("./followup/flows.server");
    return loadFollowupSummary(context.supabase, {
      conversationId: data.conversationId ?? null,
      contactId: data.contactId ?? null,
    });
  });

export const scheduleMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => scheduleMessageSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ actionId: string; scheduledFor: string }> => {
    const { scheduleManualMessage } = await import("./followup/engine.server");
    return scheduleManualMessage(context.userId, data);
  });

export const cancelScheduledMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => scheduledActionIdSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { cancelScheduledAction } = await import("./followup/engine.server");
    await cancelScheduledAction(context.userId, data.actionId);
    return { ok: true };
  });

export const uploadFollowupMedia = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => uploadFollowupMediaSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ reference: string }> => {
    const { storeFollowupMedia } = await import("./followup/media.server");
    return storeFollowupMedia(context.userId, data);
  });

export const getUserSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<UserSettings> => {
    const { data } = await context.supabase
      .from("user_settings")
      .select("timezone, send_window_start, send_window_end, pause_automation_on_handoff")
      .eq("user_id", context.userId)
      .maybeSingle();
    return {
      timezone: data?.timezone ?? "America/Sao_Paulo",
      send_window_start: (data?.send_window_start ?? "08:00").slice(0, 5),
      send_window_end: (data?.send_window_end ?? "20:00").slice(0, 5),
      pause_automation_on_handoff: data?.pause_automation_on_handoff ?? true,
    };
  });

export const saveUserSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => userSettingsSchema.parse(input))
  .handler(async ({ data, context }): Promise<UserSettings> => {
    const { isValidTimezone } = await import("./followup/time");
    if (!isValidTimezone(data.timezone)) throw new Error("Fuso horário inválido.");
    if (data.send_window_end <= data.send_window_start) {
      throw new Error("O fim da janela deve ser depois do início.");
    }
    const { error } = await context.supabase
      .from("user_settings")
      .upsert({ user_id: context.userId, ...data }, { onConflict: "user_id" });
    if (error) throw new Error(error.message);

    const { writeAudit } = await import("./audit/log.server");
    await writeAudit(context.supabase, context.userId, {
      action: "settings_updated",
      summary: `Operação: fuso ${data.timezone}, janela ${data.send_window_start}–${data.send_window_end}.`,
      entityType: "user_settings",
      entityId: context.userId,
      metadata: {
        timezone: data.timezone,
        send_window_start: data.send_window_start,
        send_window_end: data.send_window_end,
        pause_automation_on_handoff: data.pause_automation_on_handoff,
      },
    });
    return data;
  });

export const reevaluateFollowupsAfterReconnect = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ rescheduled: number }> => {
    const { reevaluateAfterReconnect } = await import("./followup/engine.server");
    return reevaluateAfterReconnect(context.userId);
  });
