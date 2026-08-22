import { queryOptions } from "@tanstack/react-query";

import { getIntelligence } from "./ai.functions";

export const aiKeys = {
  root: ["ai"] as const,
  intelligence: (contactId: string) => ["ai", "intelligence", contactId] as const,
};

export const intelligenceQuery = (contactId: string | null) =>
  queryOptions({
    queryKey: aiKeys.intelligence(contactId ?? "none"),
    queryFn: () => getIntelligence({ data: { contactId: contactId! } }),
    enabled: Boolean(contactId),
  });
