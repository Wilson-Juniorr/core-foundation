import { z } from "zod";

export const auditListSchema = z.object({
  filter: z.enum(["all", "settings", "automation", "recovery"]).optional().default("all"),
  limit: z.number().int().min(1).max(100).optional().default(40),
  cursor: z.string().optional().nullable(),
});

export const recoveryTargetSchema = z.object({ id: z.string().uuid() });

export const profileSettingsSchema = z.object({
  display_name: z
    .string()
    .trim()
    .min(2, "Informe pelo menos 2 caracteres.")
    .max(120)
    .optional()
    .nullable()
    .transform((value) => (value && value !== "" ? value : null)),
});

export const notificationSettingsSchema = z.object({
  notify_failures: z.boolean(),
  notify_approvals: z.boolean(),
  notify_attention: z.boolean(),
});
