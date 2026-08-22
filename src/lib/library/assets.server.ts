import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import { MEDIA_BUCKET, STORAGE_PREFIX } from "@/lib/whatsapp/store.server";
import type { AssetInput } from "./api-types";
import type { ContentAsset, ContentAssetType } from "./types";

export type { AssetInput };

type Client = SupabaseClient<Database>;
type Row = Database["public"]["Tables"]["content_assets"]["Row"];

export function mapAsset(row: Row): ContentAsset {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    purpose: row.purpose,
    description: row.description,
    body: row.body,
    storage_reference: row.storage_reference,
    mime_type: row.mime_type,
    filename: row.filename,
    duration_seconds: row.duration_seconds,
    transcript: row.transcript,
    tags: row.tags ?? [],
    is_active: row.is_active,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function listAssets(
  client: Client,
  filter: { type?: ContentAssetType | null; search?: string | null } = {},
): Promise<ContentAsset[]> {
  let query = client
    .from("content_assets")
    .select("*")
    .order("updated_at", { ascending: false })
    .limit(300);
  if (filter.type) query = query.eq("type", filter.type);
  if (filter.search) {
    const term = `%${filter.search}%`;
    query = query.or(`name.ilike.${term},purpose.ilike.${term},description.ilike.${term}`);
  }
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []).map(mapAsset);
}

export async function saveAsset(
  client: Client,
  userId: string,
  input: AssetInput,
): Promise<{ assetId: string }> {
  const payload = {
    user_id: userId,
    name: input.name,
    type: input.type,
    purpose: input.purpose,
    description: input.description,
    body: input.body,
    transcript: input.transcript,
    tags: input.tags,
    is_active: input.is_active,
    ...(input.storage_reference !== undefined ? { storage_reference: input.storage_reference } : {}),
    ...(input.mime_type !== undefined ? { mime_type: input.mime_type } : {}),
    ...(input.filename !== undefined ? { filename: input.filename } : {}),
    ...(input.duration_seconds !== undefined ? { duration_seconds: input.duration_seconds } : {}),
  };

  if (input.id) {
    const { error } = await client.from("content_assets").update(payload).eq("id", input.id);
    if (error) throw new Error(error.message);
    return { assetId: input.id };
  }

  const { data, error } = await client
    .from("content_assets")
    .insert(payload)
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return { assetId: data.id };
}

export async function deleteAsset(client: Client, assetId: string): Promise<void> {
  const { error } = await client.from("content_assets").delete().eq("id", assetId);
  if (error) throw new Error(error.message);
}

/** Upload do arquivo do material no bucket privado; só a referência é persistida. */
export async function storeAssetFile(
  userId: string,
  input: { base64: string; mimeType: string; filename: string },
): Promise<{ reference: string }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const bytes = Uint8Array.from(atob(input.base64), (char) => char.charCodeAt(0));
  const safeName = input.filename.replace(/[^\w.-]+/g, "_").slice(0, 120);
  const path = `${userId}/library/${crypto.randomUUID()}-${safeName}`;

  const { error } = await supabaseAdmin.storage
    .from(MEDIA_BUCKET)
    .upload(path, bytes, { contentType: input.mimeType, upsert: false });
  if (error) throw new Error("Não foi possível salvar o arquivo.");
  return { reference: `${STORAGE_PREFIX}${path}` };
}

/** URL assinada temporária para pré-visualizar/ouvir o material na interface. */
export async function signedAssetUrl(reference: string): Promise<string | null> {
  if (!reference.startsWith(STORAGE_PREFIX)) return null;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const path = reference.slice(STORAGE_PREFIX.length);
  const { data, error } = await supabaseAdmin.storage.from(MEDIA_BUCKET).createSignedUrl(path, 600);
  if (error) return null;
  return data.signedUrl;
}

/** Baixa o arquivo do material para envio pelo WhatsApp. */
export async function loadAssetFile(
  reference: string,
): Promise<{ base64: string; bytes: number } | null> {
  if (!reference.startsWith(STORAGE_PREFIX)) return null;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const path = reference.slice(STORAGE_PREFIX.length);
  const { data, error } = await supabaseAdmin.storage.from(MEDIA_BUCKET).download(path);
  if (error || !data) return null;
  const buffer = new Uint8Array(await data.arrayBuffer());
  let binary = "";
  for (let index = 0; index < buffer.length; index += 1) {
    binary += String.fromCharCode(buffer[index]!);
  }
  return { base64: btoa(binary), bytes: buffer.length };
}
