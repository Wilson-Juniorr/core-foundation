import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createContact, updateContact } from "@/lib/crm.functions";
import type { Contact } from "@/lib/crm.types";

type FormState = {
  name: string;
  phone: string;
  email: string;
  source: string;
  notes: string;
};

const EMPTY_FORM: FormState = { name: "", phone: "", email: "", source: "", notes: "" };

function toFormState(contact: Contact | null): FormState {
  if (!contact) return EMPTY_FORM;
  return {
    name: contact.name,
    phone: contact.phone ?? "",
    email: contact.email ?? "",
    source: contact.source ?? "",
    notes: contact.notes ?? "",
  };
}

export function ContactFormDialog({
  open,
  onOpenChange,
  contact = null,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contact?: Contact | null;
}) {
  const queryClient = useQueryClient();
  const create = useServerFn(createContact);
  const update = useServerFn(updateContact);
  const [form, setForm] = useState<FormState>(toFormState(contact));

  useEffect(() => {
    if (open) setForm(toFormState(contact));
  }, [open, contact]);

  const mutation = useMutation({
    mutationFn: async (values: FormState) => {
      const payload = {
        name: values.name,
        phone: values.phone,
        email: values.email,
        source: values.source,
        notes: values.notes,
      };
      return contact
        ? update({ data: { id: contact.id, ...payload } })
        : create({ data: payload });
    },
    onSuccess: (saved) => {
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["opportunities"] });
      toast.success(contact ? "Cliente atualizado" : "Cliente criado");
      onOpenChange(false);
      return saved;
    },
    onError: () => {
      toast.error("Não foi possível salvar o cliente. Tente novamente.");
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{contact ? "Editar cliente" : "Novo cliente"}</DialogTitle>
          <DialogDescription>
            Nome e telefone são as informações mais importantes; o restante é opcional.
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            mutation.mutate(form);
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="contact-name">Nome</Label>
            <Input
              id="contact-name"
              required
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="contact-phone">Telefone</Label>
              <Input
                id="contact-phone"
                inputMode="tel"
                placeholder="(11) 99999-9999"
                value={form.phone}
                onChange={(event) => setForm({ ...form, phone: event.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="contact-email">E-mail</Label>
              <Input
                id="contact-email"
                type="email"
                value={form.email}
                onChange={(event) => setForm({ ...form, email: event.target.value })}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="contact-source">Origem</Label>
            <Input
              id="contact-source"
              placeholder="Indicação, site, evento…"
              value={form.source}
              onChange={(event) => setForm({ ...form, source: event.target.value })}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="contact-notes">Observações</Label>
            <Textarea
              id="contact-notes"
              rows={3}
              value={form.notes}
              onChange={(event) => setForm({ ...form, notes: event.target.value })}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? "Salvando…" : "Salvar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
