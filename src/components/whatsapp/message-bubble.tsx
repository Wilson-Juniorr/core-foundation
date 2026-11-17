import { cn } from "@/lib/utils";
import { formatDateTime } from "@/lib/domain/datetime";
import { MESSAGE_STATUS_LABELS } from "@/lib/whatsapp/labels";
import { getMediaContext, mediaKind, messageMetadata } from "@/lib/whatsapp/message-context";
import type { ConversationMessage } from "@/lib/whatsapp/types";
import { MediaPreview } from "./media-preview";

export function MessageBubble({ message }: { message: ConversationMessage }) {
  const outbound = message.direction === "outbound";
  const hasMedia = message.message_type !== "text" && message.message_type !== "unsupported";
  const kind = mediaKind(message);
  const media = getMediaContext(message.metadata);
  const legacyTranscript =
    kind === "audio" && messageMetadata(message.metadata)["transcript_source"] === "ai";

  return (
    <li className={cn("flex", outbound ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[85%] space-y-2 rounded-2xl px-3 py-2 text-sm shadow-sm sm:max-w-[70%]",
          outbound
            ? "bg-primary text-primary-foreground rounded-br-sm"
            : "bg-muted text-foreground rounded-bl-sm",
        )}
      >
        {hasMedia && <MediaPreview message={message} />}

        {message.message_type === "unsupported" && !message.text_content && (
          <p className="text-xs italic opacity-80">Mensagem não suportada</p>
        )}

        {message.text_content && !legacyTranscript && (
          <p className="whitespace-pre-wrap break-words">{message.text_content}</p>
        )}
        {kind &&
          (media?.text || legacyTranscript ? (
            <details className="rounded border border-current/20 p-2">
              <summary className="cursor-pointer text-xs">
                {kind === "audio" ? "Transcrição" : "Conteúdo lido"}
                {media?.status === "partial" ? " · parcial" : ""}
              </summary>
              <p className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs">
                {media?.text ?? message.text_content}
              </p>
            </details>
          ) : (
            <p className="text-xs opacity-80">
              {media?.status === "failed"
                ? (media.reason ?? "Não foi possível ler a mídia.")
                : "Leitura de mídia pendente"}
            </p>
          ))}

        <p
          className={cn(
            "flex items-center justify-end gap-2 text-[11px]",
            outbound ? "text-primary-foreground/80" : "text-muted-foreground",
          )}
        >
          <time dateTime={message.sent_at}>{formatDateTime(message.sent_at)}</time>
          {outbound && <span>{MESSAGE_STATUS_LABELS[message.status]}</span>}
        </p>
      </div>
    </li>
  );
}
