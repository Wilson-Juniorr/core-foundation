import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Camera } from "lucide-react";
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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ReadContactDialog } from "@/components/read-contact-dialog";
import { createContact, updateContact } from "@/lib/crm.functions";
import type { Contact } from "@/lib/crm.types";

type FormState = {
  name: string;
  phone: string;
  email: string;
  source: string;
  notes: string;
  create_opportunity: boolean;
  opportunity_title: string;
};

const EMPTY_FORM: FormState = {
  name: "",
  phone: "",
  email: "",
  source: "",
  notes: "",
  create_opportunity: true,
  opportunity_title: "",
};

function toFormState(contact: Contact | null): FormState {
  if (!contact) return EMPTY_FORM;
  return {
    name: contact.name,
    phone: contact.phone ?? "",
    email: contact.email ?? "",
    source: contact.source ?? "",
    notes: contact.notes ?? "",
    create_opportunity: false,
    opportunity_title: "",
  };
}

export function ContactFormDialog({
  open,
  onOpenChange,
  contact = null,
  initialForm = null,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contact?: Contact | null;
  initialForm?: Partial<FormState> | null;
}) {
  const queryClient = useQueryClient();
  const create = useServerFn(createContact);
  const update = useServerFn(updateContact);
  const [form, setForm] = useState<FormState>(toFormState(contact));
  const [reading, setReading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm({ ...toFormState(contact), ...(initialForm ?? {}) });
  }, [open, contact, initialForm]);

  const mutation = useMutation({
    mutationFn: async (values: FormState) => {
      const payload = {
        name: values.name,
        phone: values.phone,
        email: values.email,
        source: values.source,
        notes: values.notes,
      };
      if (contact) return update({ data: { id: contact.id, ...payload } });

      return create({
        data: {
          ...payload,
          create_opportunity: values.create_opportunity,
          opportunity_title: values.opportunity_title,
        },
      });
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
            {contact
              ? "Atualize as informações do cliente."
              : "Nome e telefone são as informações mais importantes; o restante é opcional."}
          </DialogDescription>
          {!contact && (
            <Button
              type="button"
              variant="outline"
              className="mt-2 w-full"
              onClick={() => setReading(true)}
            >
              <Camera className="size-4" />
              Cadastrar por print
            </Button>
          )}
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

          {!contact && (
            <div className="space-y-3 rounded-lg border p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <Label htmlFor="create-opportunity" className="text-sm font-medium">
                    Criar no Pipeline
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Cadastra e já cria a oportunidade na primeira etapa.
                  </p>
                </div>
                <Switch
                  id="create-opportunity"
                  checked={form.create_opportunity}
                  onCheckedChange={(value) =>
                    setForm({ ...form, create_opportunity: value })
                  }
                />
              </div>
              {form.create_opportunity && (
                <div className="space-y-2">
                  <Label htmlFor="opportunity-title">Título da oportunidade</Label>
                  <Input
                    id="opportunity-title"
                    placeholder={form.name ? `${form.name} — Novo negócio` : "Novo negócio"}
                    value={form.opportunity_title}
                    onChange={(event) =>
                      setForm({ ...form, opportunity_title: event.target.value })
                    }
                  />
                </div>
              )}
            </div>
          )}

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
      <ReadContactDialog
        open={reading}
        onOpenChange={setReading}
        onExtracted={(result) => {
          setForm({
            ...form,
            name: result.name,
            phone: result.phone,
            email: result.email,
            source: result.source,
            notes: result.notes,
            opportunity_title: result.opportunity_title,
            create_opportunity: true,
          });
          toast.success("Print lido! Revise os dados antes de salvar.");
        }}
      />
    </Dialog>
  );
}
