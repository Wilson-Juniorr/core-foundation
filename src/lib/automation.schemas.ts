import { z } from "zod";

export const automationPolicySchema = z.object({
  test_mode: z.boolean(),
  test_mode_phone: z
    .string()
    .trim()
    .max(30)
    .optional()
    .nullable()
    .transform((value) => (value && value !== "" ? value : null)),
  test_mode_allowlist: z
    .array(z.string().trim().min(8).max(30))
    .max(20)
    .optional()
    .default([]),
  require_approval_all: z.boolean().optional().default(false),
  conversation_cooldown_minutes: z.number().int().min(0).max(20_160),
  manual_message_cooldown_minutes: z.number().int().min(0).max(20_160),
  active_conversation_minutes: z.number().int().min(0).max(1440),
  max_automations_per_day: z.number().int().min(1).max(50),
  max_flow_automations_per_day: z.number().int().min(1).max(50),
  confidence_auto_min: z.number().min(0).max(1),
  confidence_approval_min: z.number().min(0).max(1),
});

export const emergencyStopSchema = z.object({ paused: z.boolean() });

export const contactPreferencesSchema = z.object({
  contact_id: z.string().uuid(),
  automation_allowed: z.boolean(),
  whatsapp_allowed: z.boolean(),
  do_not_contact: z.boolean(),
  do_not_contact_reason: z
    .string()
    .trim()
    .max(300)
    .optional()
    .nullable()
    .transform((value) => (value && value !== "" ? value : null)),
  contact_not_before: z
    .string()
    .trim()
    .optional()
    .nullable()
    .transform((value) => (value && value !== "" ? value : null)),
  max_automations_per_day: z
    .number()
    .int()
    .min(1)
    .max(50)
    .optional()
    .nullable()
    .transform((value) => value ?? null),
});

export const decisionListSchema = z.object({
  contactId: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(100).optional().default(30),
});
