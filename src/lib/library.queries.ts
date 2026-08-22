import { queryOptions } from "@tanstack/react-query";

import { listContentAssets, listMessageDrafts, listMessageStrategies } from "./library.functions";
import type { ContentAssetType, DraftStatus } from "./library/api-types";

export const libraryKeys = {
  root: ["library"] as const,
  assets: (type: string, search: string) => ["library", "assets", type, search] as const,
  strategies: ["library", "strategies"] as const,
  drafts: (status: string, contactId: string) => ["library", "drafts", status, contactId] as const,
};

export const assetsQuery = (filter: { type?: ContentAssetType | null; search?: string } = {}) =>
  queryOptions({
    queryKey: libraryKeys.assets(filter.type ?? "all", filter.search ?? ""),
    queryFn: () =>
      listContentAssets({
        data: { type: filter.type ?? null, search: filter.search?.trim() || null },
      }),
  });

export const strategiesQuery = () =>
  queryOptions({ queryKey: libraryKeys.strategies, queryFn: () => listMessageStrategies() });

export const draftsQuery = (
  filter: { status?: DraftStatus | null; contactId?: string | null } = {},
) =>
  queryOptions({
    queryKey: libraryKeys.drafts(filter.status ?? "all", filter.contactId ?? "all"),
    queryFn: () =>
      listMessageDrafts({
        data: { status: filter.status ?? null, contactId: filter.contactId ?? null },
      }),
  });
