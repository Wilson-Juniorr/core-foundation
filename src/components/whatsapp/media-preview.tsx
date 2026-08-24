import { Download, FileText } from "lucide-react";

import type { ConversationMessage } from "@/lib/whatsapp/types";

export function MediaPreview({ message }: { message: ConversationMessage }) {
  const url = message.media_url;

  if (!url) {
    return (
      <p className="text-xs italic opacity-80">
        Mídia indisponível{message.media_filename ? ` (${message.media_filename})` : ""}
      </p>
    );
  }

  if (message.message_type === "image") {
    return (
      <a href={url} target="_blank" rel="noreferrer">
        <img
          src={url}
          alt={message.media_filename ?? "Imagem recebida no WhatsApp"}
          loading="lazy"
          className="max-h-64 w-full rounded-md object-contain"
        />
      </a>
    );
  }

  if (message.message_type === "video") {
    return <video src={url} controls className="max-h-64 w-full rounded-md" />;
  }

  if (message.message_type === "audio") {
    return <audio src={url} controls className="w-56 max-w-full" />;
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="flex items-center gap-2 rounded-md border border-current/20 px-3 py-2 text-sm hover:opacity-80"
    >
      <FileText className="size-4 shrink-0" aria-hidden />
      <span className="truncate">{message.media_filename ?? "Documento"}</span>
      <Download className="ml-auto size-4 shrink-0" aria-hidden />
    </a>
  );
}
