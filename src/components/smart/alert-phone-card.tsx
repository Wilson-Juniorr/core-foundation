import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatPhone } from "@/lib/domain/phone";
import { saveAlertSettingsFn, sendTestAlertFn } from "@/lib/handoff.functions";
import { alertSettingsQuery, handoffKeys } from "@/lib/handoff.queries";

/** Número pessoal que recebe os avisos de cliente esperando resposta. */
export function AlertPhoneCard({ className }: { className?: string }) {
  const queryClient = useQueryClient();
  const settings = useQuery(alertSettingsQuery());
  const [phone, setPhone] = useState("");
  const [minutes, setMinutes] = useState(10);

  useEffect(() => {
    if (!settings.data) return;
    setPhone(settings.data.alert_phone ? formatPhone(settings.data.alert_phone) : "");
    setMinutes(settings.data.alert_waiting_minutes);
  }, [settings.data]);

  const save = useMutation({
    mutationFn: () =>
      saveAlertSettingsFn({
        data: { alert_phone: phone.trim() || null, alert_waiting_minutes: minutes },
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: handoffKeys.alertSettings });
      toast.success("Avisos salvos.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const test = useMutation({
    mutationFn: () => sendTestAlertFn(),
    onSuccess: () => toast.success("Aviso de teste enviado para o seu celular."),
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BellRing className="size-4" /> Avisos no seu WhatsApp pessoal
        </CardTitle>
        <CardDescription>
          O número da empresa te avisa quando um cliente fica esperando resposta, quando alguém fica
          parado com você e quando o agente precisa do seu ok. Fora do horário útil (dia útil, 8h às
          20h), os avisos chegam juntos num resumo às 8h.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate();
          }}
        >
          <div className="min-w-56 flex-1 space-y-2">
            <Label htmlFor="alert_phone">Seu celular pessoal (diferente do da empresa)</Label>
            <Input
              id="alert_phone"
              inputMode="tel"
              placeholder="(11) 99999-9999"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
            />
          </div>
          <div className="w-40 space-y-2">
            <Label htmlFor="alert_minutes">Avisar depois de (min)</Label>
            <Input
              id="alert_minutes"
              type="number"
              min={5}
              max={240}
              value={minutes}
              onChange={(event) => setMinutes(Number(event.target.value) || 10)}
            />
          </div>
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? <Loader2 className="mr-1 size-4 animate-spin" /> : null}
            Salvar
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={test.isPending || !settings.data?.alert_phone}
            onClick={() => test.mutate()}
          >
            Enviar teste
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
