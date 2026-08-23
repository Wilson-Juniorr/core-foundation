import { queryOptions } from "@tanstack/react-query";

import {
  getNotificationSettings,
  getSystemStatus,
  getWorkspaceProfile,
  listAuditLogs,
} from "./system.functions";
import type { AuditFilter } from "./audit/types";

export const systemKeys = {
  status: ["system", "status"] as const,
  audit: (filter: AuditFilter) => ["system", "audit", filter] as const,
  auditRoot: ["system", "audit"] as const,
  profile: ["system", "profile"] as const,
  notifications: ["system", "notifications"] as const,
};

export const systemStatusQuery = () =>
  queryOptions({
    queryKey: systemKeys.status,
    queryFn: () => getSystemStatus(),
    refetchInterval: 60_000,
  });

export const auditLogsQuery = (filter: AuditFilter) =>
  queryOptions({
    queryKey: systemKeys.audit(filter),
    queryFn: () => listAuditLogs({ data: { filter } }),
  });

export const workspaceProfileQuery = () =>
  queryOptions({
    queryKey: systemKeys.profile,
    queryFn: () => getWorkspaceProfile(),
  });

export const notificationSettingsQuery = () =>
  queryOptions({
    queryKey: systemKeys.notifications,
    queryFn: () => getNotificationSettings(),
  });
