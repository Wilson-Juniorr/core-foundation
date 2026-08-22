import { queryOptions } from "@tanstack/react-query";

import {
  getFollowupFlow,
  getFollowupSummary,
  getUserSettings,
  listFailedActions,
  listFollowupFlows,
  listFollowupRuns,
  listScheduledMessages,
  previewFollowupFlow,
} from "./followup.functions";

export const followupKeys = {
  root: ["followup"] as const,
  flows: ["followup", "flows"] as const,
  flow: (id: string) => ["followup", "flow", id] as const,
  preview: (id: string) => ["followup", "preview", id] as const,
  runs: (status: string) => ["followup", "runs", status] as const,
  scheduled: ["followup", "scheduled"] as const,
  failed: ["followup", "failed"] as const,
  summary: (key: string) => ["followup", "summary", key] as const,
  settings: ["followup", "settings"] as const,
};

export const flowsQuery = () =>
  queryOptions({ queryKey: followupKeys.flows, queryFn: () => listFollowupFlows() });

export const flowQuery = (flowId: string | null) =>
  queryOptions({
    queryKey: followupKeys.flow(flowId ?? "new"),
    queryFn: () => getFollowupFlow({ data: { flowId: flowId! } }),
    enabled: Boolean(flowId),
  });

export const flowPreviewQuery = (flowId: string | null) =>
  queryOptions({
    queryKey: followupKeys.preview(flowId ?? "none"),
    queryFn: () => previewFollowupFlow({ data: { flowId: flowId! } }),
    enabled: Boolean(flowId),
  });

export const runsQuery = (status: "active" | "paused" | "history") =>
  queryOptions({
    queryKey: followupKeys.runs(status),
    queryFn: () => listFollowupRuns({ data: { status } }),
  });

export const scheduledMessagesQuery = () =>
  queryOptions({ queryKey: followupKeys.scheduled, queryFn: () => listScheduledMessages() });

export const failedActionsQuery = () =>
  queryOptions({ queryKey: followupKeys.failed, queryFn: () => listFailedActions() });

export const followupSummaryQuery = (filter: {
  contactId?: string | null;
  conversationId?: string | null;
}) =>
  queryOptions({
    queryKey: followupKeys.summary(filter.conversationId ?? filter.contactId ?? "none"),
    queryFn: () =>
      getFollowupSummary({
        data: {
          ...(filter.conversationId ? { conversationId: filter.conversationId } : {}),
          ...(filter.contactId ? { contactId: filter.contactId } : {}),
        },
      }),
    enabled: Boolean(filter.conversationId ?? filter.contactId),
  });

export const userSettingsQuery = () =>
  queryOptions({ queryKey: followupKeys.settings, queryFn: () => getUserSettings() });
