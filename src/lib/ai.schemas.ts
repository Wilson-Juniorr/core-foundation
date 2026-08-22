import { z } from "zod";

import { CUSTOMER_INTENTS, INTEREST_LEVELS, MEMORY_LIST_FIELDS, SENTIMENTS } from "./ai/types";

export const contactIdSchema = z.object({ contactId: z.string().uuid() });

export const analyzeContactSchema = z.object({
  contactId: z.string().uuid(),
  conversationId: z.string().uuid().nullish(),
  force: z.boolean().optional(),
});

const listItemSchema = z.object({
  value: z.string().trim().min(1).max(300),
  due: z.string().trim().max(120).nullish(),
});

/** Correção humana: o campo enviado passa a ter origem `human` e fica travado. */
export const updateMemorySchema = z.object({
  contactId: z.string().uuid(),
  patch: z
    .object({
      current_summary: z.string().trim().max(2000).nullish(),
      customer_intent: z.enum(CUSTOMER_INTENTS).optional(),
      interest_level: z.enum(INTEREST_LEVELS).optional(),
      sentiment: z.enum(SENTIMENTS).optional(),
      next_step_detected: z.string().trim().max(500).nullish(),
      do_not_contact: z.boolean().optional(),
      main_objections: z.array(listItemSchema).max(20).optional(),
      pending_information: z.array(listItemSchema).max(20).optional(),
      customer_commitments: z.array(listItemSchema).max(20).optional(),
      seller_commitments: z.array(listItemSchema).max(20).optional(),
      important_dates: z.array(listItemSchema).max(20).optional(),
      products_or_services: z.array(listItemSchema).max(20).optional(),
      relevant_values: z.array(listItemSchema).max(20).optional(),
      decision_factors: z.array(listItemSchema).max(20).optional(),
      competitors: z.array(listItemSchema).max(20).optional(),
    })
    .refine((value) => Object.keys(value).length > 0, "Nada para atualizar."),
});

export const insightStatusSchema = z.object({
  insightId: z.string().uuid(),
  status: z.enum(["open", "accepted", "dismissed"]),
});

export const MEMORY_EDITABLE_LISTS = MEMORY_LIST_FIELDS;
