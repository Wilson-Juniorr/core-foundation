import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import { loadAssetFile } from "./assets.server";
import type { ContentAssetType, DraftStatus, GenerationContextSnapshot, MessageDraft } from "./types";

type Client = SupabaseClient<Database>;

type DraftRow = Database["public"]["Tables"]["message_drafts"]["Row"] & {
  contacts?: { name: string } | null;
  content_assets?: { id: string; name: string; type: ContentAssetType } | null;
};

export function mapDraft(row: DraftRow): MessageDraft {
  return {
    id: row.id,
    contact_id: row.contact_id,
    contact_name: row.contacts?.name ?? null,
    opportunity_id: row.opportunity_id,
    conversation_id: row.conversation_id,
    strategy_id: row.strategy_id,
    strategy_name: row.strategy_name,
    strategy_version: row.strategy_version,
    generated_content: row.generated_content,
    original_content: row.original_content,
    edited_content: row.edited_content,
    suggested_asset_id: row.suggested_asset_id,
    suggested_asset: row.content_assets ?? null,
    asset_rationale: row.asset_rationale,
    status: row.status,
    is_preview: row.is_preview,
    model: row.model,
    prompt_version: row.prompt_version,
    context_snapshot: (row.context_snapshot as GenerationContextSnapshot | null) ?? null,
    rejection_reason: row.rejection_reason,
    created_at: row.created_at,
    approved_at: row.approved_at,
    sent_at: row.sent_at,
  };
}

const DRAFT_SELECT = "*, contacts(name), content_assets(id, name, type)";

export async function listDrafts(
  client: Client,
  filter: { status?: DraftStatus | null; contactId?: string | null } = {},
): Promise<MessageDraft[]> {
  let query = client
    .from("message_drafts")
    .select(DRAFT_SELECT)
    .eq("is_preview", false)
    .order("created_at", { ascending: false })
    .limit(200);
  if (filter.status) query = query.eq("status", filter.status);
  if (filter.contactId) query = query.eq("contact_id", filter.contactId);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => mapDraft(row as DraftRow));
}

async function loadDraft(client: Client, draftId: string): Promise<MessageDraft> {
  const { data, error } = await client
    .from("message_drafts")
    .select(DRAFT_SELECT)
    .eq("id", draftId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Rascunho não encontrado.");
  return mapDraft(data as DraftRow);
}

/** A edição humana nunca sobrescreve `original_content`: o texto da IA fica auditável. */
export async function editDraft(
  client: Client,
  input: { draftId: string; content: string; assetId?: string | null },
): Promise<MessageDraft> {
  const draft = await loadDraft(client, input.draftId);
  if (draft.status === "sent") throw new Error("Esta mensagem já foi enviada.");

  const patch: Database["public"]["Tables"]["message_drafts"]["Update"] = {
    edited_content: input.content,
    status: draft.status === "approved" ? "approved" : "edited",
  };
  if (input.assetId !== undefined) patch.suggested_asset_id = input.assetId;

  const { error } = await client.from("message_drafts").update(patch).eq("id", input.draftId);
  if (error) throw new Error(error.message);
  return loadDraft(client, input.draftId);
}

export async function rejectDraft(
  client: Client,
  input: { draftId: string; reason: string | null },
): Promise<MessageDraft> {
  const { error } = await client
    .from("message_drafts")
    .update({ status: "rejected", rejection_reason: input.reason })
    .eq("id", input.draftId);
  if (error) throw new Error(error.message);
  return loadDraft(client, input.draftId);
}

export function draftContent(draft: MessageDraft): string {
  return (draft.edited_content ?? draft.generated_content).trim();
}

/**
 * Aprovar e enviar. O envio usa exatamente o texto exibido ao usuário e marca o
 * rascunho como enviado com o id da mensagem real, sem duplicar se repetido.
 */
export async function approveAndSendDraft(
  client: Client,
  userId: string,
  draftId: string,
): Promise<MessageDraft> {
  const draft = await loadDraft(client, draftId);
  if (draft.status === "sent") throw new Error("Esta mensagem já foi enviada.");
  if (!draft.conversation_id) {
    throw new Error("Este cliente não tem conversa de WhatsApp vinculada.");
  }

  const content = draftContent(draft);
  if (!content) throw new Error("A mensagem está vazia.");

  const { sendText, sendMedia } = await import("@/lib/whatsapp/service.server");

  const { error: approveError } = await client
    .from("message_drafts")
    .update({ status: "approved", approved_at: new Date().toISOString() })
    .eq("id", draftId);
  if (approveError) throw new Error(approveError.message);

  const sent = await sendText(userId, { conversationId: draft.conversation_id, text: content });

  // Material estratégico anexado é enviado logo após o texto.
  if (draft.suggested_asset_id) {
    const { data: asset } = await client
      .from("content_assets")
      .select("type, storage_reference, mime_type, filename")
      .eq("id", draft.suggested_asset_id)
      .maybeSingle();
    if (asset?.storage_reference && asset.type !== "text") {
      const file = await loadAssetFile(asset.storage_reference);
      if (file) {
        await sendMedia(userId, {
          conversationId: draft.conversation_id,
          type: asset.type as "audio" | "image" | "document",
          base64: file.base64,
          mimeType: asset.mime_type ?? "application/octet-stream",
          filename: asset.filename ?? "material",
          caption: null,
        });
      }
    }
  }

  const { error } = await client
    .from("message_drafts")
    .update({ status: "sent", sent_at: new Date().toISOString(), message_id: sent.messageId })
    .eq("id", draftId);
  if (error) throw new Error(error.message);

  return loadDraft(client, draftId);
}
