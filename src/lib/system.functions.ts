import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  auditListSchema,
  notificationSettingsSchema,
  profileSettingsSchema,
  recoveryTargetSchema,
} from "./system.schemas";
import type { AuditLogEntry } from "./audit/types";
import type { SystemStatus } from "./system/types";

export interface WorkspaceProfile {
  display_name: string | null;
  email: string | null;
}

export interface NotificationSettings {
  notify_failures: boolean;
  notify_approvals: boolean;
  notify_attention: boolean;
}

export const getSystemStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SystemStatus> => {
    const { loadSystemStatus } = await import("./system/status.server");
    return loadSystemStatus(context.supabase, context.userId);
  });

export const listAuditLogs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => auditListSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ items: AuditLogEntry[]; nextCursor: string | null }> => {
    const { AUDIT_FILTER_ACTIONS } = await import("./audit/types");
    let query = context.supabase
      .from("audit_logs")
      .select("id, created_at, action, severity, entity_type, entity_id, summary, actor, metadata")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(data.limit);

    if (data.filter !== "all") {
      query = query.in("action", AUDIT_FILTER_ACTIONS[data.filter]);
    }
    if (data.cursor) query = query.lt("created_at", data.cursor);

    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);

    const items = (rows ?? []).map((row) => ({
      ...row,
      severity: row.severity as AuditLogEntry["severity"],
      metadata: (row.metadata ?? {}) as Record<string, unknown>,
    }));
    return {
      items,
      nextCursor: items.length === data.limit ? (items.at(-1)?.created_at ?? null) : null,
    };
  });

export const retryFailedMessageAction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => recoveryTargetSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { retryFailedMessage } = await import("./system/recovery.server");
    return retryFailedMessage(context.supabase, context.userId, data.id);
  });

export const retryScheduledActionAction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => recoveryTargetSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { retryScheduledAction } = await import("./system/recovery.server");
    return retryScheduledAction(context.supabase, context.userId, data.id);
  });

export const cancelScheduledActionAction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => recoveryTargetSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { cancelScheduledAction } = await import("./system/recovery.server");
    return cancelScheduledAction(context.supabase, context.userId, data.id);
  });

export const retryAnalysisJobAction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => recoveryTargetSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { retryAnalysisJob } = await import("./system/recovery.server");
    return retryAnalysisJob(context.supabase, context.userId, data.id);
  });

export const getWorkspaceProfile = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<WorkspaceProfile> => {
    const { data } = await context.supabase
      .from("profiles")
      .select("display_name, email")
      .eq("id", context.userId)
      .maybeSingle();
    return { display_name: data?.display_name ?? null, email: data?.email ?? null };
  });

export const saveWorkspaceProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => profileSettingsSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { error } = await context.supabase
      .from("profiles")
      .update({ display_name: data.display_name })
      .eq("id", context.userId);
    if (error) throw new Error(error.message);

    const { writeAudit } = await import("./audit/log.server");
    await writeAudit(context.supabase, context.userId, {
      action: "profile_updated",
      summary: "Nome de exibição atualizado.",
      entityType: "profile",
      entityId: context.userId,
    });
    return { ok: true };
  });

export const getNotificationSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<NotificationSettings> => {
    const { data } = await context.supabase
      .from("user_settings")
      .select("notify_failures, notify_approvals, notify_attention")
      .eq("user_id", context.userId)
      .maybeSingle();
    return {
      notify_failures: data?.notify_failures ?? true,
      notify_approvals: data?.notify_approvals ?? true,
      notify_attention: data?.notify_attention ?? true,
    };
  });

export const saveNotificationSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => notificationSettingsSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { error } = await context.supabase
      .from("user_settings")
      .upsert({ user_id: context.userId, ...data }, { onConflict: "user_id" });
    if (error) throw new Error(error.message);

    const { writeAudit } = await import("./audit/log.server");
    await writeAudit(context.supabase, context.userId, {
      action: "notification_settings_updated",
      summary: "Preferências de aviso atualizadas.",
      entityType: "user_settings",
      entityId: context.userId,
      metadata: data,
    });
    return { ok: true };
  });
