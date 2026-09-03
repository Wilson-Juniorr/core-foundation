import { z } from "zod";

import { SMART_STRATEGIES } from "@/lib/smart/types";

const timeOfDay = z
  .string()
  .trim()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use o formato HH:MM")
  .optional()
  .nullable()
  .transform((value) => value ?? null);

export const smartFlowInputSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(2, "Informe um nome").max(120),
  description: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((value) => (value && value !== "" ? value : null)),
  is_active: z.boolean().default(true),
  window_start: timeOfDay,
  window_end: timeOfDay,
  goal: z.string().trim().min(5, "Descreva o objetivo comercial").max(500),
  max_duration_days: z.number().int().min(1).max(180),
  autonomy: z.enum(["observe", "assist", "autonomous"]),
  allowed_strategies: z
    .array(z.enum(SMART_STRATEGIES))
    .min(1, "Escolha pelo menos uma estratégia permitida"),
  allowed_media: z.array(z.enum(["text", "audio", "image", "document"])).default(["text"]),
  max_pressure: z.number().int().min(10).max(100),
  min_hours_between_actions: z.number().int().min(1).max(720),
  max_actions_per_week: z.number().int().min(1).max(14),
  handoff_situations: z.array(z.string().trim().max(200)).max(20).default([]),
  completion_criteria: z
    .string()
    .trim()
    .max(500)
    .optional()
    .nullable()
    .transform((value) => (value && value !== "" ? value : null)),
  confidence_min: z.number().min(0).max(1),
});

export const smartFlowIdSchema = z.object({ flowId: z.string().uuid() });

export const startSmartFlowSchema = z.object({
  flowId: z.string().uuid(),
  contactId: z.string().uuid(),
  conversationId: z.string().uuid().optional().nullable(),
  opportunityId: z.string().uuid().optional().nullable(),
});

export const conversationSmartSchema = z.object({ conversationId: z.string().uuid() });

export const smartActionDecisionSchema = z.object({
  actionId: z.string().uuid(),
  /** Texto revisado pelo usuário antes de aprovar. */
  content: z
    .string()
    .trim()
    .max(4000)
    .optional()
    .nullable()
    .transform((value) => (value && value !== "" ? value : null)),
});

export const commitmentIdSchema = z.object({ commitmentId: z.string().uuid() });
