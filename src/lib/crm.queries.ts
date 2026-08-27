import { queryOptions } from "@tanstack/react-query";

import {
  findDuplicateContacts,
  getContactDetail,
  getContactSignals,
  getDashboardMetrics,
  listContacts,
  listOpportunities,
  listPipelineStages,
} from "./crm.functions";

export const crmKeys = {
  contacts: (search: string, includeArchived: boolean) =>
    ["contacts", { search, includeArchived }] as const,
  contact: (id: string) => ["contacts", id] as const,
  duplicates: (phone: string, email: string, excludeId: string | null) =>
    ["contacts", "duplicates", { phone, email, excludeId }] as const,
  signals: (contactIds: string[]) => ["contacts", "signals", contactIds] as const,
  stages: ["pipeline-stages"] as const,
  opportunities: ["opportunities"] as const,
  dashboard: ["dashboard"] as const,
};

/** Aviso de cliente já cadastrado com o mesmo telefone/e-mail. */
export const duplicateContactsQuery = (
  phone: string,
  email: string,
  excludeId: string | null = null,
) =>
  queryOptions({
    queryKey: crmKeys.duplicates(phone, email, excludeId),
    queryFn: () =>
      findDuplicateContacts({
        data: {
          phone: phone || undefined,
          email: email || undefined,
          excludeId: excludeId ?? undefined,
        },
      }),
    staleTime: 15_000,
  });

export const contactSignalsQuery = (contactIds: string[]) =>
  queryOptions({
    queryKey: crmKeys.signals(contactIds),
    queryFn: () => getContactSignals({ data: { contactIds } }),
    enabled: contactIds.length > 0,
    staleTime: 30_000,
  });


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
