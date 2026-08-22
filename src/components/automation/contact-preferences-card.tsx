import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldAlert } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { getContactPreferences, saveContactPreferences } from "@/lib/automation.functions";
import type { ContactPreferences } from "@/lib/automation/types";

export function ContactPreferencesCard({ contactId }: { contactId: string }) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["contact-preferences", contactId],
    queryFn: () => getContactPreferences({ data: { contactId } }),
  });
  const [draft, setDraft] = useState<ContactPreferences | null>(null);
  const current = draft ?? query.data ?? null;

  const save = useMutation({
    mutationFn: (next: ContactPreferences) =>
      saveContactPreferences({
        data: {
          contact_id: contactId,
          automation_allowed: next.automation_allowed,
          whatsapp_allowed: next.whatsapp_allowed,
          do_not_contact: next.do_not_contact,
          do_not_contact_reason: next.do_not_contact_reason,
          contact_not_before: next.contact_not_before,
          max_automations_per_day: next.max_automations_per_day,
        },
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["contact-preferences", contactId] });
      setDraft(null);
      toast.success("Preferências do cliente atualizadas.");
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Não foi possível salvar."),
  });

  if (!current) return null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldAlert className="size-4 text-muted-foreground" />
          Preferências de contato
        </CardTitle>
        {current.do_not_contact ? (
          <Badge variant="destructive">Não contatar</Badge>
        ) : (
          <Badge variant="secondary">Automação liberada</Badge>
        )}
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="font-medium">Automações</p>
            <p className="text-xs text-muted-foreground">
              Desligue para que nenhum fluxo dispare para este cliente.
            </p>
          </div>
          <Switch
            checked={current.automation_allowed}
            onCheckedChange={(value) => setDraft({ ...current, automation_allowed: value })}
          />
        </div>

        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="font-medium">Envio por WhatsApp</p>
            <p className="text-xs text-muted-foreground">Bloqueia qualquer envio pelo canal.</p>
          </div>
          <Switch
            checked={current.whatsapp_allowed}
            onCheckedChange={(value) => setDraft({ ...current, whatsapp_allowed: value })}
          />
        </div>

        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="font-medium">Cliente pediu para não receber mensagens</p>
            <p className="text-xs text-muted-foreground">
              {current.do_not_contact_source === "customer"
                ? "Registrado automaticamente a partir da conversa."
                : "Registro manual."}
            </p>
          </div>
          <Switch
            checked={current.do_not_contact}
            onCheckedChange={(value) => setDraft({ ...current, do_not_contact: value })}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="dnc-reason">Motivo</Label>
            <Input
              id="dnc-reason"
              value={current.do_not_contact_reason ?? ""}
              placeholder="Ex.: pediu para não receber mensagens"
              onChange={(event) =>
                setDraft({ ...current, do_not_contact_reason: event.target.value || null })
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="not-before">Contatar apenas depois de</Label>
            <Input
              id="not-before"
              type="date"
              value={current.contact_not_before?.slice(0, 10) ?? ""}
              onChange={(event) =>
                setDraft({
                  ...current,
                  contact_not_before: event.target.value
                    ? new Date(`${event.target.value}T09:00:00`).toISOString()
                    : null,
                })
              }
            />
          </div>
        </div>

        <div className="space-y-1.5 sm:max-w-[220px]">
          <Label htmlFor="contact-cap">Limite diário de automações</Label>
          <Input
            id="contact-cap"
            type="number"
            min={1}
            max={50}
            value={current.max_automations_per_day ?? ""}
            placeholder="Usar o limite global"
            onChange={(event) =>
              setDraft({
                ...current,
                max_automations_per_day: event.target.value ? Number(event.target.value) : null,
              })
            }
          />
        </div>

        <Button
          size="sm"
          disabled={!draft || save.isPending}
          onClick={() => draft && save.mutate(draft)}
        >
          {save.isPending ? "Salvando..." : "Salvar preferências"}
        </Button>
      </CardContent>
    </Card>
  );
}
