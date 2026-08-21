import { queryOptions } from "@tanstack/react-query";

import {
  getContactDetail,
  getDashboardMetrics,
  listContacts,
  listOpportunities,
  listPipelineStages,
} from "./crm.functions";

export const crmKeys = {
  contacts: (search: string, includeArchived: boolean) =>
    ["contacts", { search, includeArchived }] as const,
  contact: (id: string) => ["contacts", id] as const,
  stages: ["pipeline-stages"] as const,
  opportunities: ["opportunities"] as const,
  dashboard: ["dashboard"] as const,
};

export const contactsQuery = (search = "", includeArchived = false) =>
  queryOptions({
    queryKey: crmKeys.contacts(search, includeArchived),
    queryFn: () => listContacts({ data: { search, includeArchived } }),
  });

export const contactDetailQuery = (id: string) =>
  queryOptions({
    queryKey: crmKeys.contact(id),
    queryFn: () => getContactDetail({ data: { id } }),
  });

export const pipelineStagesQuery = () =>
  queryOptions({
    queryKey: crmKeys.stages,
    queryFn: () => listPipelineStages(),
  });

export const opportunitiesQuery = () =>
  queryOptions({
    queryKey: crmKeys.opportunities,
    queryFn: () => listOpportunities(),
  });

export const dashboardQuery = () =>
  queryOptions({
    queryKey: crmKeys.dashboard,
    queryFn: () => getDashboardMetrics(),
  });
