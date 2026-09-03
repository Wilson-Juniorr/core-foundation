import { queryOptions } from "@tanstack/react-query";

import {
  getConversationSmart,
  getSmartFlowFn,
  listSmartApprovalsFn,
  listSmartFlowsFn,
} from "./smart.functions";

export const smartKeys = {
  root: ["smart"] as const,
  flows: ["smart", "flows"] as const,
  flow: (flowId: string) => ["smart", "flow", flowId] as const,
  conversation: (conversationId: string) => ["smart", "conversation", conversationId] as const,
  approvals: ["smart", "approvals"] as const,
};

export const smartFlowsQuery = () =>
  queryOptions({ queryKey: smartKeys.flows, queryFn: () => listSmartFlowsFn() });

export const smartFlowQuery = (flowId: string | null) =>
  queryOptions({
    queryKey: smartKeys.flow(flowId ?? "none"),
    queryFn: () => getSmartFlowFn({ data: { flowId: flowId as string } }),
    enabled: Boolean(flowId),
  });

export const conversationSmartQuery = (conversationId: string | null) =>
  queryOptions({
    queryKey: smartKeys.conversation(conversationId ?? "none"),
    queryFn: () => getConversationSmart({ data: { conversationId: conversationId as string } }),
    enabled: Boolean(conversationId),
  });

export const smartApprovalsQuery = () =>
  queryOptions({ queryKey: smartKeys.approvals, queryFn: () => listSmartApprovalsFn() });
