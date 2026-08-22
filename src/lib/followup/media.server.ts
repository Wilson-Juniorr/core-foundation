import { MEDIA_BUCKET, STORAGE_PREFIX } from "@/lib/whatsapp/store.server";
import { adminClient } from "./engine.server";

/**
 * Guarda o arquivo usado por uma etapa/agendamento no bucket privado já
 * existente. Só a referência interna (`storage:<path>`) é persistida.
 */
export async function storeFollowupMedia(
  userId: string,
  input: { base64: string; mimeType: string; filename: string },
): Promise<{ reference: string }> {
  const db = await adminClient();
  const bytes = Uint8Array.from(atob(input.base64), (char) => char.charCodeAt(0));
  const safeName = input.filename.replace(/[^\w.-]+/g, "_").slice(0, 120);
  const path = `${userId}/followup/${crypto.randomUUID()}-${safeName}`;

  const { error } = await db.storage
    .from(MEDIA_BUCKET)
    .upload(path, bytes, { contentType: input.mimeType, upsert: false });
  if (error) throw new Error("Não foi possível salvar o arquivo.");

  return { reference: `${STORAGE_PREFIX}${path}` };
}
