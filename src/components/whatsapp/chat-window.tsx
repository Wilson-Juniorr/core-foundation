import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, Loader2, Mic, Paperclip, Send, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { LoadingState } from "@/components/states";
import { formatPhone } from "@/lib/domain/phone";
import { MAX_MEDIA_BYTES } from "@/lib/whatsapp.schemas";
import { listOlderMessages, sendWhatsAppMedia, sendWhatsAppText } from "@/lib/whatsapp.functions";
import { whatsappKeys } from "@/lib/whatsapp.queries";
import type { ConversationDetail, ConversationMessage } from "@/lib/whatsapp/types";
import { AudioRecorderDialog } from "@/components/audio/audio-recorder-dialog";
import { ContactLinkDialog } from "./contact-link-dialog";
import { conversationTitle } from "./conversation-list";
import { IntelligenceStrip } from "@/components/intelligence/intelligence-strip";
import { GenerateMessageDialog } from "@/components/library/generate-message-dialog";
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
  /** Volta para a lista de conversas no layout mobile. */
  onBack?: () => void;
};

export function ChatWindow({ detail, isLoading, canSend, onBack }: Props) {
  const queryClient = useQueryClient();
  const [text, setText] = useState("");
  const [linkOpen, setLinkOpen] = useState(false);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [recorderOpen, setRecorderOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const listRef = useRef<HTMLUListElement>(null);

  const conversationId = detail?.conversation.id ?? null;
  const [older, setOlder] = useState<ConversationMessage[]>([]);
  const [hasMore, setHasMore] = useState(false);

  // Cada conversa começa pelas mensagens recentes; o passado vem sob demanda.
  useEffect(() => {
    setOlder([]);
    setHasMore(detail?.hasMore ?? false);
  }, [conversationId, detail?.hasMore]);

  const olderMutation = useMutation({
    mutationFn: () => {
      const oldest = older[0] ?? detail?.messages[0];
      if (!conversationId || !oldest) throw new Error("Nada mais para carregar.");
      return listOlderMessages({ data: { conversationId, before: oldest.sent_at } });
    },
    onSuccess: (result) => {
      setOlder((previous) => [...result.messages, ...previous]);
      setHasMore(result.hasMore);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  useEffect(() => {
    // Rola apenas a lista de mensagens — não o documento inteiro.
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
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

  const { conversation } = detail;
  const messages = [...older, ...detail.messages];
  const sending = textMutation.isPending || mediaMutation.isPending;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 flex-wrap items-center gap-3 border-b p-3 sm:p-4">
        {onBack ? (
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            aria-label="Voltar para a lista de conversas"
            onClick={onBack}
          >
            <ChevronLeft className="size-5" aria-hidden />
          </Button>
        ) : null}
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-medium">{conversationTitle(conversation)}</h2>
          <p className="text-muted-foreground text-xs">
            {formatPhone(conversation.phone_number) || "Número indisponível"}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {conversation.contact_id ? (
            <Button variant="outline" size="sm" onClick={() => setGenerateOpen(true)}>
              <Sparkles className="mr-2 size-4" />
              Gerar mensagem
            </Button>
          ) : null}
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

      {conversation.contact_id ? (
        <GenerateMessageDialog
          open={generateOpen}
          onOpenChange={setGenerateOpen}
          contactId={conversation.contact_id}
          conversationId={conversation.id}
        />
      ) : null}

      {messages.length === 0 ? (
        <p className="text-muted-foreground flex-1 p-6 text-sm">
          Nenhuma mensagem nesta conversa ainda.
        </p>
      ) : (
        <ul
          ref={listRef}
          className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain p-4"
        >
          {hasMore ? (
            <li className="flex justify-center pb-2">
              <Button
                variant="ghost"
                size="sm"
                disabled={olderMutation.isPending}
                onClick={() => olderMutation.mutate()}
              >
                {olderMutation.isPending ? "Carregando…" : "Carregar mensagens anteriores"}
              </Button>
            </li>
          ) : null}
          {messages.map((message) => (
            <MessageBubble key={message.id} message={message} />
          ))}
        </ul>
      )}

      <form
        className="flex shrink-0 items-end gap-2 border-t p-3"
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
