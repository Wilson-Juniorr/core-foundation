import { queryOptions } from "@tanstack/react-query";
import { listDuePostSale } from "./post-sale.functions";

export const postSaleDueKey = ["post-sale", "due"] as const;

export const postSaleDueQuery = () =>
  queryOptions({
    queryKey: postSaleDueKey,
    queryFn: () => listDuePostSale(),
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
