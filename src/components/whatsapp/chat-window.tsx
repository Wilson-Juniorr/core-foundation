import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Paperclip, Send } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { LoadingState } from "@/components/states";
import { formatPhone } from "@/lib/domain/phone";
import { MAX_MEDIA_BYTES } from "@/lib/whatsapp.schemas";
import { sendWhatsAppMedia, sendWhatsAppText } from "@/lib/whatsapp.functions";
import { whatsappKeys } from "@/lib/whatsapp.queries";
import type { ConversationDetail } from "@/lib/whatsapp/types";
import { ContactLinkDialog } from "./contact-link-dialog";
import { conversationTitle } from "./conversation-list";
import { IntelligenceStrip } from "@/components/intelligence/intelligence-strip";
import { MessageBubble } from "./message-bubble";

function mediaTypeFor(file: File): "audio" | "image" | "document" | "video" {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("audio/")) return "audio";
  if (file.type.startsWith("video/")) return "video";
  return "document";
}

async function fileToBase64(file: File): Promise<string> {
  const buffer = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (const byte of buffer) binary += String.fromCharCode(byte);
  return btoa(binary);
}

type Props = {
  detail: ConversationDetail | undefined;
  isLoading: boolean;
  canSend: boolean;
};

export function ChatWindow({ detail, isLoading, canSend }: Props) {
  const queryClient = useQueryClient();
  const [text, setText] = useState("");
  const [linkOpen, setLinkOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const conversationId = detail?.conversation.id ?? null;

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [detail?.messages.length, conversationId]);

  const invalidate = async () => {
    if (!conversationId) return;
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: whatsappKeys.conversation(conversationId) }),
      queryClient.invalidateQueries({ queryKey: whatsappKeys.conversationsRoot }),
    ]);
  };

  const textMutation = useMutation({
    mutationFn: (value: string) =>
      sendWhatsAppText({ data: { conversationId: conversationId!, text: value } }),
    onSuccess: async () => {
      setText("");
      await invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const mediaMutation = useMutation({
    mutationFn: async (file: File) => {
      const base64 = await fileToBase64(file);
      return sendWhatsAppMedia({
        data: {
          conversationId: conversationId!,
          type: mediaTypeFor(file),
          base64,
          mimeType: file.type || "application/octet-stream",
          filename: file.name,
          caption: text.trim() || undefined,
        },
      });
    },
    onSuccess: async () => {
      setText("");
      await invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (!detail) {
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center p-8 text-sm">
        {isLoading ? <LoadingState /> : "Selecione uma conversa."}
      </div>
    );
  }

  const { conversation, messages } = detail;
  const sending = textMutation.isPending || mediaMutation.isPending;

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b p-4">
        <div className="min-w-0">
          <h2 className="truncate font-medium">{conversationTitle(conversation)}</h2>
          <p className="text-muted-foreground text-xs">
            {formatPhone(conversation.phone_number) || "Número indisponível"}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {conversation.contact_id ? (
            <Button asChild variant="outline" size="sm">
              <Link to="/clientes/$contactId" params={{ contactId: conversation.contact_id }}>
                Ver cliente
              </Link>
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={() => setLinkOpen(true)}>
              Vincular cliente
            </Button>
          )}
        </div>
      </header>

      {conversation.contact_id ? <IntelligenceStrip contactId={conversation.contact_id} /> : null}

      {messages.length === 0 ? (
        <p className="text-muted-foreground flex-1 p-6 text-sm">
          Nenhuma mensagem nesta conversa ainda.
        </p>
      ) : (
        <ul className="flex-1 space-y-2 overflow-y-auto p-4">
          {messages.map((message) => (
            <MessageBubble key={message.id} message={message} />
          ))}
          <div ref={endRef} />
        </ul>
      )}

      <form
        className="flex items-end gap-2 border-t p-3"
        onSubmit={(event) => {
          event.preventDefault();
          const value = text.trim();
          if (!value) return;
          textMutation.mutate(value);
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) return;
            if (file.size > MAX_MEDIA_BYTES) {
              toast.error("Arquivo maior que 8 MB.");
              return;
            }
            mediaMutation.mutate(file);
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label="Anexar arquivo"
          disabled={!canSend || sending}
          onClick={() => fileInputRef.current?.click()}
        >
          <Paperclip className="size-4" aria-hidden />
        </Button>
        <Textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={canSend ? "Escreva uma mensagem" : "Conecte o WhatsApp para enviar"}
          aria-label="Mensagem"
          rows={1}
          disabled={!canSend || sending}
          className="max-h-32 min-h-10 resize-none"
        />
        <Button
          type="submit"
          size="icon"
          aria-label="Enviar mensagem"
          disabled={!canSend || sending}
        >
          {sending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <Send className="size-4" aria-hidden />
          )}
        </Button>
      </form>

      <ContactLinkDialog
        open={linkOpen}
        onOpenChange={setLinkOpen}
        conversationId={conversation.id}
      />
    </div>
  );
}
