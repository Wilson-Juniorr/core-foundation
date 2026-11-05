import { queryOptions } from "@tanstack/react-query";

import { getAgentHandoffFn, getAlertSettingsFn, listWaitingForYouFn } from "./handoff.functions";

export const handoffKeys = {
  root: ["handoff"] as const,
  conversation: (conversationId: string) => ["handoff", "conversation", conversationId] as const,
  waiting: ["handoff", "waiting"] as const,
  alertSettings: ["handoff", "alert-settings"] as const,
};

export const agentHandoffQuery = (conversationId: string | null) =>
  queryOptions({
    queryKey: handoffKeys.conversation(conversationId ?? "none"),
    queryFn: () => getAgentHandoffFn({ data: { conversationId: conversationId as string } }),
    enabled: Boolean(conversationId),
    refetchInterval: 30_000,
  });

export const waitingForYouQuery = () =>
  queryOptions({
    queryKey: handoffKeys.waiting,
    queryFn: () => listWaitingForYouFn(),
    refetchInterval: 60_000,
  });

export const alertSettingsQuery = () =>
  queryOptions({ queryKey: handoffKeys.alertSettings, queryFn: () => getAlertSettingsFn() });
