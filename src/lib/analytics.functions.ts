import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type {
  AnalyticsExportDataset,
  AnalyticsPeriod,
  AnalyticsReport,
  OperationalHealth,
} from "@/lib/analytics/types";

export const getAnalytics = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: AnalyticsPeriod) => input)
  .handler(async ({ data, context }): Promise<AnalyticsReport> => {
    const { getAnalyticsReport } = await import("@/lib/analytics/report.server");
    return getAnalyticsReport(context.supabase, data);
  });

export const getOperationalHealth = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<OperationalHealth> => {
    const { getHealth } = await import("@/lib/analytics/report.server");
    return getHealth(context.supabase);
  });

export const exportAnalyticsCsv = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: { dataset: AnalyticsExportDataset; from: string; to: string }) => input,
  )
  .handler(async ({ data, context }): Promise<{ filename: string; csv: string; rows: number }> => {
    const { exportDataset } = await import("@/lib/analytics/export.server");
    return exportDataset(context.supabase, data.dataset, { from: data.from, to: data.to });
  });
