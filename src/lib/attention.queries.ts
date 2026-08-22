import { queryOptions } from "@tanstack/react-query";

import { getOperationalDashboard, listAttentionItems } from "./attention.functions";
import type { AttentionStatus } from "./attention/types";

export const attentionKeys = {
  root: ["attention"] as const,
  list: (status: string, bucket: string, contactId: string) =>
    ["attention", "list", status, bucket, contactId] as const,
  operational: ["attention", "operational"] as const,
};

export const attentionQuery = (
  filter: {
    status?: AttentionStatus | null;
    bucket?: string | null;
    contactId?: string | null;
    sync?: boolean;
  } = {},
) =>
  queryOptions({
    queryKey: attentionKeys.list(
      filter.status ?? "open",
      filter.bucket ?? "all",
      filter.contactId ?? "all",
    ),
    queryFn: () =>
      listAttentionItems({
        data: {
          status: filter.status ?? null,
          bucket: filter.bucket ?? null,
          contactId: filter.contactId ?? null,
          sync: filter.sync ?? true,
        },
      }),
  });

export const operationalDashboardQuery = () =>
  queryOptions({
    queryKey: attentionKeys.operational,
    queryFn: () => getOperationalDashboard(),
  });
