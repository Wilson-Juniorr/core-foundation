import { Search } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { formatRelative } from "@/lib/domain/datetime";
import { formatPhone } from "@/lib/domain/phone";
import type { ConversationListItem } from "@/lib/whatsapp/types";

export function conversationTitle(conversation: ConversationListItem): string {
  return (
    conversation.contact_name ||
    conversation.display_name ||
    formatPhone(conversation.phone_number) ||
    "Contato sem número"
  );
}

type Props = {
  conversations: ConversationListItem[];
  selectedId: string | null;
  search: string;
  onSearchChange: (value: string) => void;
  onSelect: (conversation: ConversationListItem) => void;
};

export function ConversationList({
  conversations,
  selectedId,
  search,
  onSearchChange,
  onSelect,
}: Props) {
  return (
    <div className="flex h-full flex-col">
      <div className="relative border-b p-3">
        <Search
          className="text-muted-foreground pointer-events-none absolute top-1/2 left-6 size-4 -translate-y-1/2"
          aria-hidden
        />
        <Input
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Buscar conversa"
          aria-label="Buscar conversa"
          className="pl-9"
        />
      </div>

      {conversations.length === 0 ? (
        <p className="text-muted-foreground p-4 text-sm">Nenhuma conversa encontrada.</p>
      ) : (
        <ul className="flex-1 overflow-y-auto">
          {conversations.map((conversation) => (
            <li key={conversation.id}>
              <button
                type="button"
                onClick={() => onSelect(conversation)}
                aria-current={conversation.id === selectedId ? "true" : undefined}
                className={cn(
                  "hover:bg-muted/60 flex w-full flex-col gap-1 border-b px-4 py-3 text-left transition-colors",
                  conversation.id === selectedId && "bg-muted",
                )}
              >
                <span className="flex items-center gap-2">
                  <span className="truncate font-medium">{conversationTitle(conversation)}</span>
                  {conversation.unread_count > 0 && (
                    <Badge className="ml-auto shrink-0">{conversation.unread_count}</Badge>
                  )}
                </span>
                <span className="text-muted-foreground flex items-center gap-2 text-xs">
                  <span className="truncate">
                    {conversation.last_message_preview ?? "Sem mensagens"}
                  </span>
                  {conversation.last_message_at && (
                    <span className="ml-auto shrink-0">
                      {formatRelative(conversation.last_message_at)}
                    </span>
                  )}
                </span>
                {!conversation.contact_id && (
                  <span className="text-muted-foreground text-[11px]">Sem cliente vinculado</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
