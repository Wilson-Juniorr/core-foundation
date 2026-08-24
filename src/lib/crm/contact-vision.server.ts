/**
 * Cadastro por print: lê uma imagem (screenshot de conversa, cartão, lista de
 * contatos) e devolve os campos do cliente já normalizados, sem gravar nada.
 * A decisão final é sempre humana — a UI mostra os campos para revisão.
 */
import { completeStructured, estimateCost } from "@/lib/ai/gateway.server";
import { normalizePhone } from "@/lib/domain/phone";

export const VISION_MODEL = "google/gemini-3.7-flash";
export const VISION_PROMPT_VERSION = "contact-from-image@1";

export type ExtractedContact = {
  name: string | null;
  phone: string | null;
  email: string | null;
  source: string | null;
  notes: string | null;
  opportunity_title: string | null;
  confidence: number;
};

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["name", "phone", "email", "source", "notes", "opportunity_title", "confidence"],
  properties: {
    name: { type: ["string", "null"], description: "Nome da pessoa ou empresa" },
    phone: { type: ["string", "null"], description: "Telefone com DDD, apenas dígitos ou +55..." },
    email: { type: ["string", "null"] },
    source: {
      type: ["string", "null"],
      description: "Origem provável (WhatsApp, indicação, site)",
    },
    notes: {
      type: ["string", "null"],
      description: "Resumo curto do que a imagem mostra e do interesse do cliente",
    },
    opportunity_title: {
      type: ["string", "null"],
      description: "Título curto para a oportunidade comercial, se houver pedido/interesse claro",
    },
    confidence: { type: "number", minimum: 0, maximum: 1 },
  },
} as const;

const SYSTEM = [
  "Você extrai dados de cadastro de clientes a partir de imagens (prints de WhatsApp,",
  "cartões de visita, listas de contatos, fichas em papel).",
  "Responda somente com os dados visíveis na imagem; nunca invente telefone, nome ou e-mail.",
  "Se um campo não estiver legível, devolva null.",
  "Telefones brasileiros devem manter DDD. Nomes em Title Case, sem emojis.",
  "notes deve ser em português do Brasil, no máximo 2 frases.",
].join(" ");

function cleanText(value: unknown, max = 500): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === "" || trimmed.toLowerCase() === "null") return null;
  return trimmed.slice(0, max);
}

export async function extractContactFromImages(
  userId: string,
  images: string[],
): Promise<ExtractedContact> {
  const started = Date.now();

  const result = await completeStructured<Record<string, unknown>>({
    model: VISION_MODEL,
    system: SYSTEM,
    user: "Extraia os dados de cadastro do cliente presentes nesta(s) imagem(ns).",
    schemaName: "contact_extraction",
    schema: SCHEMA,
    images,
  });

  const raw = result.data;
  const extracted: ExtractedContact = {
    name: cleanText(raw["name"], 200),
    phone: normalizePhone(cleanText(raw["phone"], 40)),
    email: cleanText(raw["email"], 200),
    source: cleanText(raw["source"], 120),
    notes: cleanText(raw["notes"], 1000),
    opportunity_title: cleanText(raw["opportunity_title"], 200),
    confidence: Math.max(0, Math.min(1, Number(raw["confidence"] ?? 0))),
  };

  const total = result.usage.total;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { error } = await supabaseAdmin.from("ai_usage_events").insert({
    user_id: userId,
    purpose: "contact_from_image",
    model: result.model,
    prompt_version: VISION_PROMPT_VERSION,
    input_tokens: result.usage.input,
    output_tokens: result.usage.output,
    total_tokens: total,
    estimated_cost_usd: estimateCost(result.model, total),
    status: "success",
    duration_ms: Date.now() - started,
  });
  if (error) console.error("Falha ao registrar uso de IA (contact_from_image)", error.code);

  return extracted;
}
