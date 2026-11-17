import type { Json } from "@/integrations/supabase/types";

export type MessageMediaContext = {
  status: "processing" | "ready" | "partial" | "failed";
  text?: string;
  reason?: string;
  claim?: string;
  claimed_at?: string;
  in_memory?: boolean;
};

type MessageWithMedia = {
  message_type: string;
  media_mime_type: string | null;
  media_filename: string | null;
};

export function mediaKind(message: MessageWithMedia): "audio" | "image" | "pdf" | null {
  if (message.message_type === "audio" || message.message_type === "image")
    return message.message_type;
  if (
    message.message_type === "document" &&
    (message.media_mime_type?.toLowerCase().split(";")[0] === "application/pdf" ||
      /\.pdf$/i.test(message.media_filename ?? ""))
  )
    return "pdf";
  return null;
}

export function messageMetadata(
  metadata: Json | null | undefined,
): Record<string, Json | undefined> {
  return metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata : {};
}

export function getMediaContext(metadata: Json | null | undefined): MessageMediaContext | null {
  const state = messageMetadata(messageMetadata(metadata)["media_context"]);
  const status = state["status"];
  if (
    status !== "processing" &&
    status !== "ready" &&
    status !== "partial" &&
    status !== "failed"
  ) {
    return null;
  }
  return {
    status,
    ...(typeof state["text"] === "string" ? { text: state["text"] } : {}),
    ...(typeof state["reason"] === "string" ? { reason: state["reason"] } : {}),
    ...(typeof state["claim"] === "string" ? { claim: state["claim"] } : {}),
    ...(typeof state["claimed_at"] === "string" ? { claimed_at: state["claimed_at"] } : {}),
    ...(state["in_memory"] === true ? { in_memory: true } : {}),
  };
}

export function messageContextText(
  message: MessageWithMedia & {
    text_content: string | null;
    metadata: Json | null;
  },
): string | null {
  const kind = mediaKind(message);
  const caption = message.text_content?.trim();
  if (!kind) return caption || null;
  const metadata = messageMetadata(message.metadata);
  const context = getMediaContext(metadata);
  if (!context && kind === "audio" && caption && metadata["transcript_source"] === "ai")
    return caption;
  const parts = [caption];
  if (context?.text && context.text !== caption) {
    parts.push(
      `[Conteúdo extraído de ${kind === "audio" ? "áudio" : kind === "image" ? "imagem" : "PDF"}]\n${context.text}`,
    );
  }
  if (!context || context.status !== "ready") {
    parts.push(
      context?.status === "partial"
        ? "[Leitura parcial da mídia]"
        : context?.status === "failed"
          ? "[Mídia não compreendida]"
          : "[Leitura de mídia pendente]",
    );
  }
  return parts.filter(Boolean).join("\n");
}

export function messageMediaStatus(
  message: MessageWithMedia & { metadata: Json | null; text_content: string | null },
) {
  const kind = mediaKind(message);
  if (!kind) return null;
  if (
    kind === "audio" &&
    message.text_content?.trim() &&
    messageMetadata(message.metadata)["transcript_source"] === "ai"
  ) {
    return "ready";
  }
  return getMediaContext(message.metadata)?.status ?? "pending";
}
