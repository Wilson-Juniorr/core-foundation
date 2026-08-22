import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { crmKeys, contactsQuery } from "@/lib/crm.queries";
import { linkConversationContact } from "@/lib/whatsapp.functions";
import { whatsappKeys } from "@/lib/whatsapp.queries";
import { formatPhone } from "@/lib/domain/phone";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversationId: string;
};

export function ContactLinkDialog({ open, onOpenChange, conversationId }: Props) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const contacts = useQuery({ ...contactsQuery(search), enabled: open });

  const mutation = useMutation({
    mutationFn: (contactId: string) =>
      linkConversationContact({ data: { conversationId, contactId } }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: whatsappKeys.conversationsRoot }),
        queryClient.invalidateQueries({ queryKey: whatsappKeys.conversation(conversationId) }),
        queryClient.invalidateQueries({ queryKey: crmKeys.contacts(search, false) }),
      ]);
      toast.success("Conversa vinculada ao cliente");
      onOpenChange(false);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Vincular conversa a um cliente</DialogTitle>
          <DialogDescription>
            As mensagens desta conversa passam a aparecer no histórico do cliente.
          </DialogDescription>
        </DialogHeader>

        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Buscar cliente por nome, telefone ou e-mail"
          aria-label="Buscar cliente"
        />

        <div className="max-h-64 overflow-y-auto rounded-md border">
          {contacts.isLoading ? (
            <p className="text-muted-foreground p-3 text-sm">Carregando…</p>
          ) : (contacts.data?.length ?? 0) === 0 ? (
            <p className="text-muted-foreground p-3 text-sm">Nenhum cliente encontrado.</p>
          ) : (
            <ul>
              {contacts.data?.map((contact) => (
                <li key={contact.id}>
                  <button
                    type="button"
                    disabled={mutation.isPending}
                    onClick={() => mutation.mutate(contact.id)}
                    className="hover:bg-muted flex w-full flex-col items-start border-b px-3 py-2 text-left text-sm last:border-b-0"
                  >
                    <span className="font-medium">{contact.name}</span>
                    <span className="text-muted-foreground text-xs">
                      {formatPhone(contact.phone) || "Sem telefone"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
