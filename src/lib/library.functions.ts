import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type {
  AssetInput,
  ContentAsset,
  ContentAssetType,
  DraftStatus,
  GenerationResult,
  MessageDraft,
  MessageStrategy,
  StrategyInput,
} from "@/lib/library/api-types";

export const listContentAssets = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { type?: ContentAssetType | null; search?: string | null }) => input)
  .handler(async ({ data, context }): Promise<ContentAsset[]> => {
    const { listAssets } = await import("@/lib/library/assets.server");
    return listAssets(context.supabase, data);
  });

export const saveContentAsset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (
      input: AssetInput & { file?: { base64: string; mimeType: string; filename: string } | null },
    ) => input,
  )
  .handler(async ({ data, context }): Promise<{ assetId: string }> => {
    const { saveAsset, storeAssetFile } = await import("@/lib/library/assets.server");
    const { file, ...rest } = data;
    const payload: AssetInput = { ...rest };
    if (file) {
      const stored = await storeAssetFile(context.userId, file);
      payload.storage_reference = stored.reference;
      payload.mime_type = file.mimeType;
      payload.filename = file.filename;
    }
    return saveAsset(context.supabase, context.userId, payload);
  });

export const deleteContentAsset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { assetId: string }) => input)
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { deleteAsset } = await import("@/lib/library/assets.server");
    await deleteAsset(context.supabase, data.assetId);
    const { writeAudit } = await import("@/lib/audit/log.server");
    await writeAudit(context.supabase, context.userId, {
      action: "asset_archived",
      summary: "Material arquivado (histórico preservado).",
      entityType: "content_asset",
      entityId: data.assetId,
    });
    return { ok: true };
  });

export const getAssetPreviewUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { assetId: string }) => input)
  .handler(async ({ data, context }): Promise<{ url: string | null }> => {
    const { signedAssetUrl } = await import("@/lib/library/assets.server");
    const { data: asset, error } = await context.supabase
      .from("content_assets")
      .select("storage_reference")
      .eq("id", data.assetId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!asset?.storage_reference) return { url: null };
    return { url: await signedAssetUrl(asset.storage_reference) };
  });

export const listMessageStrategies = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<MessageStrategy[]> => {
    const { listStrategies } = await import("@/lib/library/strategies.server");
    return listStrategies(context.supabase);
  });

export const saveMessageStrategy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: StrategyInput) => input)
  .handler(async ({ data, context }): Promise<{ strategyId: string; version: number }> => {
    const { saveStrategy } = await import("@/lib/library/strategies.server");
    return saveStrategy(context.supabase, context.userId, data);
  });

export const deleteMessageStrategy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { strategyId: string }) => input)
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { deleteStrategy } = await import("@/lib/library/strategies.server");
    await deleteStrategy(context.supabase, data.strategyId);
    const { writeAudit } = await import("@/lib/audit/log.server");
    await writeAudit(context.supabase, context.userId, {
      action: "strategy_archived",
      summary: "Estratégia arquivada (histórico preservado).",
      entityType: "message_strategy",
      entityId: data.strategyId,
    });
    return { ok: true };
  });

export const seedStrategies = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ created: number }> => {
    const { seedDefaultStrategies } = await import("@/lib/library/strategies.server");
    return seedDefaultStrategies(context.supabase, context.userId);
  });

export const generateStrategicMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      contactId: string;
      strategyId: string;
      conversationId?: string | null;
      objective?: string | null;
      opportunityId?: string | null;
      preview?: boolean;
    }) => input,
  )
  .handler(async ({ data, context }): Promise<GenerationResult> => {
    const { generateDraft } = await import("@/lib/library/generate.server");
    return generateDraft(context.supabase, context.userId, data);
  });

export const listMessageDrafts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { status?: DraftStatus | null; contactId?: string | null }) => input)
  .handler(async ({ data, context }): Promise<MessageDraft[]> => {
    const { listDrafts } = await import("@/lib/library/drafts.server");
    return listDrafts(context.supabase, data);
  });

export const editMessageDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { draftId: string; content: string; assetId?: string | null }) => input)
  .handler(async ({ data, context }): Promise<MessageDraft> => {
    const { editDraft } = await import("@/lib/library/drafts.server");
    return editDraft(context.supabase, data);
  });

export const rejectMessageDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { draftId: string; reason?: string | null }) => input)
  .handler(async ({ data, context }): Promise<MessageDraft> => {
    const { rejectDraft } = await import("@/lib/library/drafts.server");
    return rejectDraft(context.supabase, { draftId: data.draftId, reason: data.reason ?? null });
  });

export const approveMessageDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { draftId: string }) => input)
  .handler(async ({ data, context }): Promise<MessageDraft> => {
    const { approveAndSendDraft } = await import("@/lib/library/drafts.server");
    return approveAndSendDraft(context.supabase, context.userId, data.draftId);
  });
