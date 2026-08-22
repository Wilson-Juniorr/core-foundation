import { z } from "zod";

const timeOfDay = z
  .string()
  .trim()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use o formato HH:MM");

const optionalTime = timeOfDay
  .optional()
  .nullable()
  .transform((value) => value ?? null);

export const flowStepInputSchema = z
  .object({
    id: z.string().uuid().optional(),
    delay_value: z.number().int().min(0).max(10000),
    delay_unit: z.enum(["minutes", "hours", "days"]),
    action_type: z.enum(["text_message", "audio", "image", "document"]),
    content: z
      .string()
      .trim()
      .max(4000)
      .optional()
      .transform((value) => (value && value !== "" ? value : null)),
    media_reference: z
      .string()
      .trim()
      .max(500)
      .optional()
      .nullable()
      .transform((value) => (value && value !== "" ? value : null)),
    media_mime_type: z
      .string()
      .trim()
      .max(150)
      .optional()
      .nullable()
      .transform((value) => (value && value !== "" ? value : null)),
    media_filename: z
      .string()
      .trim()
      .max(200)
      .optional()
      .nullable()
      .transform((value) => (value && value !== "" ? value : null)),
    preferred_time_start: optionalTime,
    preferred_time_end: optionalTime,
  })
  .superRefine((step, ctx) => {
    if (step.action_type === "text_message" && !step.content) {
      ctx.addIssue({ code: "custom", message: "Escreva o texto da etapa", path: ["content"] });
    }
    if (step.action_type !== "text_message" && !step.media_reference) {
      ctx.addIssue({
        code: "custom",
        message: "Selecione o arquivo desta etapa",
        path: ["media_reference"],
      });
    }
    if (step.preferred_time_start && step.preferred_time_end) {
      if (step.preferred_time_end <= step.preferred_time_start) {
        ctx.addIssue({
          code: "custom",
          message: "O fim da janela deve ser depois do início",
          path: ["preferred_time_end"],
        });
      }
    }
  });

/** Proteção básica contra automação excessiva (frequência mínima entre etapas). */
const MIN_GAP_MINUTES = 5;

function stepGapMinutes(step: { delay_value: number; delay_unit: string }): number {
  if (step.delay_unit === "minutes") return step.delay_value;
  if (step.delay_unit === "hours") return step.delay_value * 60;
  return step.delay_value * 60 * 24;
}

export const flowInputSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(2, "Informe um nome").max(120),
  description: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((value) => (value && value !== "" ? value : null)),
  is_active: z.boolean().default(true),
  stop_on_reply: z.boolean().default(true),
  window_start: optionalTime,
  window_end: optionalTime,
  steps: z
    .array(flowStepInputSchema)
    .min(1, "Adicione pelo menos uma etapa")
    .max(30)
    .superRefine((steps, ctx) => {
      steps.forEach((step, index) => {
        if (index > 0 && stepGapMinutes(step) < MIN_GAP_MINUTES) {
          ctx.addIssue({
            code: "custom",
            message: `A partir da segunda etapa o intervalo mínimo é de ${MIN_GAP_MINUTES} minutos`,
            path: [index, "delay_value"],
          });
        }
      });
    }),
});

export const flowIdSchema = z.object({ flowId: z.string().uuid() });

export const startFlowSchema = z.object({
  flowId: z.string().uuid(),
  contactId: z.string().uuid(),
  conversationId: z.string().uuid(),
  opportunityId: z.string().uuid().optional().nullable(),
  replaceExisting: z.boolean().optional().default(false),
});

export const previewFlowSchema = z.object({
  flowId: z.string().uuid(),
});

export const runIdSchema = z.object({ runId: z.string().uuid() });

export const scheduledActionIdSchema = z.object({ actionId: z.string().uuid() });

export const scheduleMessageSchema = z.object({
  conversationId: z.string().uuid(),
  contactId: z.string().uuid().optional().nullable(),
  opportunityId: z.string().uuid().optional().nullable(),
  scheduledFor: z.string().datetime({ offset: true }),
  actionType: z.enum(["text_message", "audio", "image", "document"]),
  content: z
    .string()
    .trim()
    .max(4000)
    .optional()
    .transform((value) => (value && value !== "" ? value : null)),
  mediaReference: z
    .string()
    .trim()
    .max(500)
    .optional()
    .nullable()
    .transform((value) => (value && value !== "" ? value : null)),
  mediaMimeType: z
    .string()
    .trim()
    .max(150)
    .optional()
    .nullable()
    .transform((value) => (value && value !== "" ? value : null)),
  mediaFilename: z
    .string()
    .trim()
    .max(200)
    .optional()
    .nullable()
    .transform((value) => (value && value !== "" ? value : null)),
  cancelOnReply: z.boolean().optional().default(true),
});

export const uploadFollowupMediaSchema = z.object({
  base64: z.string().min(16).max(12_000_000),
  mimeType: z.string().trim().min(3).max(150),
  filename: z.string().trim().min(1).max(200),
});

export const userSettingsSchema = z.object({
  timezone: z.string().trim().min(3).max(80),
  send_window_start: timeOfDay,
  send_window_end: timeOfDay,
  pause_automation_on_handoff: z.boolean().optional().default(true),
});

export const followupListSchema = z.object({
  status: z.enum(["active", "paused", "scheduled", "history"]).optional().default("active"),
});
