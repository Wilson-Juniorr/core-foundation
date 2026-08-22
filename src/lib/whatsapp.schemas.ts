import { z } from "zod";

export const MAX_MEDIA_BYTES = 8 * 1024 * 1024; // 8 MB

export const whatsappSettingsSchema = z.object({
  base_url: z
    .string()
    .trim()
    .url("Informe a URL base completa da UZAPI")
    .max(300)
    .refine((value) => value.startsWith("https://"), "A URL base deve usar https"),
  token: z.string().trim().min(8, "Token inválido").max(500),
  instance_identifier: z
    .string()
    .trim()
    .max(200)
    .optional()
    .transform((value) => (value && value !== "" ? value : null)),
});

export const listConversationsSchema = z.object({
  search: z.string().trim().max(200).optional(),
});

export const conversationIdSchema = z.object({ conversationId: z.string().uuid() });

export const sendTextSchema = z.object({
  conversationId: z.string().uuid(),
  text: z.string().trim().min(1, "Escreva uma mensagem").max(4000),
});

export const sendMediaSchema = z.object({
  conversationId: z.string().uuid(),
  type: z.enum(["audio", "image", "document", "video"]),
  base64: z
    .string()
    .min(16)
    .max(Math.ceil((MAX_MEDIA_BYTES * 4) / 3) + 1024),
  mimeType: z.string().trim().min(3).max(150),
  filename: z.string().trim().min(1).max(200),
  caption: z
    .string()
    .trim()
    .max(1000)
    .optional()
    .transform((value) => (value && value !== "" ? value : null)),
});

export const linkContactSchema = z.object({
  conversationId: z.string().uuid(),
  contactId: z.string().uuid(),
});

export const syncSchema = z.object({
  chatLimit: z.number().int().min(1).max(50).optional(),
  messageLimit: z.number().int().min(1).max(100).optional(),
});

export const contactIdSchema = z.object({ contactId: z.string().uuid() });
