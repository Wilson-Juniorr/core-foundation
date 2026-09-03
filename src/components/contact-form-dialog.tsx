import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, Camera, Zap } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ReadContactDialog } from "@/components/read-contact-dialog";
import { createContact, updateContact } from "@/lib/crm.functions";
import { duplicateContactsQuery } from "@/lib/crm.queries";
import type { Contact } from "@/lib/crm.types";
import { startFollowupFlow } from "@/lib/followup.functions";
import { flowsQuery, followupKeys } from "@/lib/followup.queries";
import { startSmartFlowFn } from "@/lib/smart.functions";
import { smartFlowsQuery, smartKeys } from "@/lib/smart.queries";
import { AUTONOMY_LABELS } from "@/lib/smart/types";
import { formatPhone, isSendablePhone } from "@/lib/domain/phone";

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

const NO_FLOW = "none";

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
  const startFlow = useServerFn(startFollowupFlow);
  const [form, setForm] = useState<FormState>(toFormState(contact));
  const [reading, setReading] = useState(false);
  const [flowId, setFlowId] = useState<string>(NO_FLOW);
  const [allowDuplicate, setAllowDuplicate] = useState(false);
  const [lookup, setLookup] = useState({ phone: "", email: "" });

  const flows = useQuery({ ...flowsQuery(), enabled: open && !contact });
  const activeFlows = (flows.data ?? []).filter((flow) => flow.is_active);
  const phoneUsable = isSendablePhone(form.phone);

  useEffect(() => {
    if (!open) return;
    setForm({ ...toFormState(contact), ...(initialForm ?? {}) });
    setFlowId(NO_FLOW);
    setAllowDuplicate(false);
  }, [open, contact, initialForm]);

  // Só consultamos duplicidade depois que o usuário para de digitar.
  useEffect(() => {
    const timer = setTimeout(() => {
      const digits = form.phone.replace(/\D/g, "");
      setLookup({
        phone: digits.length >= 10 ? form.phone : "",
        email: form.email.includes("@") ? form.email : "",
      });
    }, 400);
    return () => clearTimeout(timer);
  }, [form.phone, form.email]);

  const hasLookup = Boolean(lookup.phone || lookup.email);
  const duplicates = useQuery({
    ...duplicateContactsQuery(lookup.phone, lookup.email, contact?.id ?? null),
    enabled: open && hasLookup,
  });
  const duplicateList = hasLookup ? (duplicates.data ?? []) : [];
  const blockedByDuplicate = duplicateList.length > 0 && !allowDuplicate;

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

      const saved = await create({
        data: {
          ...payload,
          create_opportunity: values.create_opportunity,
          opportunity_title: values.opportunity_title,
          allow_duplicate: allowDuplicate || duplicateList.length === 0,
        },
      });

      if (flowId !== NO_FLOW && isSendablePhone(saved.phone)) {
        try {
          await startFlow({
            data: {
              flowId,
              contactId: saved.id,
              conversationId: null,
              opportunityId: null,
              replaceExisting: false,
            },
          });
          toast.success("Follow-up iniciado para o novo cliente.");
        } catch (error) {
          toast.error(
            error instanceof Error
              ? `Cliente criado, mas o follow-up não iniciou: ${error.message}`
              : "Cliente criado, mas o follow-up não iniciou.",
          );
        }
      }

      return saved;
    },
    onSuccess: (saved) => {
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["opportunities"] });
      queryClient.invalidateQueries({ queryKey: followupKeys.root });
      toast.success(contact ? "Cliente atualizado" : "Cliente criado");
      onOpenChange(false);
      return saved;
    },
    onError: (error) => {
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : "Não foi possível salvar o cliente. Tente novamente.",
      );
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

          {duplicateList.length > 0 && (
            <div className="space-y-3 rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/40">
              <div className="flex items-start gap-2">
                <AlertTriangle
                  className="mt-0.5 size-4 shrink-0 text-amber-700 dark:text-amber-400"
                  aria-hidden
                />
                <div className="min-w-0 space-y-2 text-sm">
                  <p className="font-medium text-amber-900 dark:text-amber-200">
                    {duplicateList.length === 1
                      ? "Já existe um cliente com este contato"
                      : "Já existem clientes com este contato"}
                  </p>
                  <ul className="space-y-2">
                    {duplicateList.map((item) => (
                      <li key={item.id} className="flex flex-wrap items-center gap-2">
                        <span className="truncate font-medium">{item.name}</span>
                        <span className="text-muted-foreground text-xs">
                          {formatPhone(item.phone) || item.email || "sem contato"}
                        </span>
                        <Button asChild size="sm" variant="outline">
                          <Link
                            to="/clientes/$contactId"
                            params={{ contactId: item.id }}
                            onClick={() => onOpenChange(false)}
                          >
                            Ver cliente
                          </Link>
                        </Button>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
              {!contact && (
                <div className="flex items-center justify-between gap-3">
                  <Label htmlFor="allow-duplicate" className="text-xs font-normal">
                    Cadastrar mesmo assim
                  </Label>
                  <Switch
                    id="allow-duplicate"
                    checked={allowDuplicate}
                    onCheckedChange={setAllowDuplicate}
                  />
                </div>
              )}
            </div>
          )}

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
                  onCheckedChange={(value) => setForm({ ...form, create_opportunity: value })}
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

          {!contact && (
            <div className="space-y-2 rounded-lg border p-3">
              <div className="flex items-center gap-2">
                <Zap className="size-4 text-primary" />
                <Label htmlFor="start-flow" className="text-sm font-medium">
                  Iniciar follow-up no cadastro
                </Label>
              </div>
              <Select value={flowId} onValueChange={setFlowId}>
                <SelectTrigger id="start-flow">
                  <SelectValue placeholder="Não iniciar agora" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_FLOW}>Não iniciar agora</SelectItem>
                  {activeSmartFlows.length > 0 && (
                    <SelectGroup>
                      <SelectLabel>Inteligentes</SelectLabel>
                      {activeSmartFlows.map((flow) => (
                        <SelectItem key={flow.id} value={`smart:${flow.id}`}>
                          {flow.name} · {AUTONOMY_LABELS[flow.config.autonomy]}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  )}
                  {activeFlows.length > 0 && (
                    <SelectGroup>
                      <SelectLabel>Clássicos</SelectLabel>
                      {activeFlows.map((flow) => (
                        <SelectItem key={flow.id} value={`classic:${flow.id}`}>
                          {flow.name} · {flow.step_count} etapa(s)
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  )}
                </SelectContent>
              </Select>
              {activeFlows.length === 0 && activeSmartFlows.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Nenhum fluxo ativo. Ative um fluxo em Follow-ups para usar aqui.
                </p>
              ) : flowId !== NO_FLOW && !phoneUsable ? (
                <p className="text-xs text-destructive">
                  Informe o telefone com DDD para o follow-up poder iniciar.
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  As mensagens seguem as regras do fluxo (janela de envio, atrasos, aprovação e
                  parada na resposta do cliente).
                </p>
              )}
            </div>
          )}


          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={
                mutation.isPending ||
                (!contact && blockedByDuplicate) ||
                (flowId !== NO_FLOW && !phoneUsable)
              }
            >
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
