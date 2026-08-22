import { queryOptions } from "@tanstack/react-query";

import { getAnalytics } from "./analytics.functions";
import type { AnalyticsPeriod, AnalyticsRange } from "./analytics/types";

export const analyticsKeys = {
  root: ["analytics"] as const,
  report: (from: string, to: string) => ["analytics", "report", from, to] as const,
};

export const analyticsQuery = (period: AnalyticsPeriod) =>
  queryOptions({
    queryKey: analyticsKeys.report(period.from, period.to),
    queryFn: () => getAnalytics({ data: period }),
    staleTime: 60_000,
  });

export function resolvePeriod(
  range: AnalyticsRange,
  custom?: { from: string; to: string },
): AnalyticsPeriod {
  const now = new Date();
  const to = new Date(now.getTime() + 60_000);

  if (range === "custom" && custom?.from && custom?.to) {
    return {
      from: new Date(`${custom.from}T00:00:00`).toISOString(),
      to: new Date(`${custom.to}T23:59:59`).toISOString(),
    };
  }

  if (range === "today") {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    return { from: start.toISOString(), to: to.toISOString() };
  }

  const days = range === "7d" ? 7 : 30;
  const start = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  return { from: start.toISOString(), to: to.toISOString() };
}

export const RANGE_LABELS: Record<AnalyticsRange, string> = {
  today: "Hoje",
  "7d": "7 dias",
  "30d": "30 dias",
  custom: "Personalizado",
};
