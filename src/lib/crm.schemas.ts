import { z } from "zod";

import { OPPORTUNITY_STATUSES } from "./domain/opportunity-status";

const optionalText = z
  .string()
  .trim()
  .max(2000)
  .optional()
  .transform((value) => (value && value !== "" ? value : null));

export const contactInputSchema = z.object({
  name: z.string().trim().min(1, "Informe o nome do cliente").max(200),
  phone: optionalText,
  email: optionalText,
  source: optionalText,
  notes: optionalText,
  /** Cria automaticamente uma oportunidade na primeira etapa do pipeline. */
  create_opportunity: z.boolean().optional(),
  opportunity_title: z.string().trim().max(200).optional(),
});

/** Prints enviados para leitura automática do cadastro (data URLs de imagem). */
export const contactVisionSchema = z.object({
  images: z
    .array(
      z
        .string()
        .max(8_000_000, "Imagem muito grande. Envie um print menor.")
        .refine((value) => /^data:image\/(png|jpeg|jpg|webp|gif);base64,/.test(value), {
          message: "Formato de imagem não suportado.",
        }),
    )
    .min(1, "Envie pelo menos um print.")
    .max(3, "Envie no máximo 3 imagens."),
});

export const contactUpdateSchema = contactInputSchema.extend({
  id: z.string().uuid(),
});

export const contactArchiveSchema = z.object({
  id: z.string().uuid(),
  is_archived: z.boolean(),
});

export const listContactsSchema = z.object({
  search: z.string().trim().max(200).optional(),
  includeArchived: z.boolean().optional(),
});

export const idSchema = z.object({ id: z.string().uuid() });

export const opportunityInputSchema = z.object({
  contact_id: z.string().uuid(),
  pipeline_stage_id: z.string().uuid(),
  title: z.string().trim().min(1, "Informe o título da oportunidade").max(200),
  estimated_value: z.number().nonnegative().nullable().optional(),
  next_action_description: optionalText,
  next_action_at: z.string().datetime().nullable().optional(),
  notes: optionalText,
});

export const opportunityUpdateSchema = z.object({
  id: z.string().uuid(),
  title: z.string().trim().min(1).max(200).optional(),
  pipeline_stage_id: z.string().uuid().optional(),
  status: z.enum(OPPORTUNITY_STATUSES).optional(),
  estimated_value: z.number().nonnegative().nullable().optional(),
  next_action_description: z.string().trim().max(2000).nullable().optional(),
  next_action_at: z.string().datetime().nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});

export type ContactInput = z.infer<typeof contactInputSchema>;
export type OpportunityInput = z.infer<typeof opportunityInputSchema>;
export type OpportunityUpdateInput = z.infer<typeof opportunityUpdateSchema>;
