import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Pause, Play, CalendarClock, Square } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  activatePostQuoteFn,
  controlPostQuoteFn,
  postQuoteViewFn,
} from "@/lib/post-quote.functions";
import { formatDateTime } from "@/lib/domain/datetime";
import { localInstant } from "@/lib/smart/post-quote-cadence";
export function PostQuotePanel({
  contactId,
  opportunities,
}: {
  contactId: string;
  opportunities: { id: string; title: string; status: string }[];
}) {
  const client = useQueryClient();
  const view = useServerFn(postQuoteViewFn),
    activate = useServerFn(activatePostQuoteFn),
    control = useServerFn(controlPostQuoteFn);
  const query = useQuery({
    queryKey: ["post-quote", contactId],
    queryFn: () => view({ data: { contactId } }),
    refetchInterval: 30000,
  });
  const [opportunityId, setOpportunityId] = useState("");
  const [at, setAt] = useState("");
  const [rescheduling, setRescheduling] = useState(false);
  const run = query.data?.run,
    action = query.data?.action;
  const invalidate = () => {
    client.invalidateQueries({ queryKey: ["post-quote"] });
    client.invalidateQueries({ queryKey: ["contacts"] });
    client.invalidateQueries({ queryKey: ["followup"] });
    client.invalidateQueries({ queryKey: ["smart"] });
  };
  const start = useMutation({
    mutationFn: () =>
      activate({
        data: {
          contactId,
          opportunityId: opportunityId || opportunities.find((o) => o.status === "open")?.id || "",
        },
      }),
    onSuccess: () => {
      invalidate();
      toast.success("Pós-cotação ativado.");
    },
    onError: (e) => toast.error(e.message),
  });
  const change = useMutation({
    mutationFn: (command: "pause" | "resume" | "reschedule" | "end") => {
      const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(at);
      if (command === "reschedule" && !match) throw new Error("Informe data e hora.");
      const date = match
        ? localInstant(
            Number(match[1]),
            Number(match[2]),
            Number(match[3]),
            Number(match[4]),
            Number(match[5]),
          ).toISOString()
        : undefined;
      return control({
        data: { runId: run?.id ?? "", command, ...(command === "reschedule" ? { at: date } : {}) },
      });
    },
    onSuccess: () => {
      invalidate();
      setRescheduling(false);
      toast.success("Acompanhamento atualizado.");
    },
    onError: (e) => toast.error(e.message),
  });
  const live = run && ["active", "paused"].includes(run.status);
  const status =
    run?.status === "active"
      ? "Ativo"
      : run?.status === "paused"
        ? "Pausado"
        : run?.status === "completed"
          ? "Ciclo concluído"
          : run
            ? "Encerrado"
            : "Não ativado";
  return (
    <section className="space-y-4 border-y py-6" aria-label="Pós-cotação">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold">Pós-cotação</h2>
        <span className="text-sm text-muted-foreground">
          {status}
          {run ? ` · ${run.contacts_done} de 8` : ""}
        </span>
      </div>
      {query.isError && (
        <p className="text-sm text-destructive">Não foi possível consultar o acompanhamento.</p>
      )}
      {!live && (
        <div className="flex flex-wrap gap-3">
          <Select value={opportunityId} onValueChange={setOpportunityId}>
            <SelectTrigger className="w-full sm:w-72">
              <SelectValue placeholder="Oportunidade da cotação" />
            </SelectTrigger>
            <SelectContent>
              {opportunities
                .filter((o) => o.status === "open")
                .map((o) => (
                  <SelectItem key={o.id} value={o.id}>
                    {o.title}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
          <Button
            disabled={start.isPending || !opportunities.some((o) => o.status === "open")}
            onClick={() => start.mutate()}
          >
            <Play className="size-4" />
            Ativar pós-cotação
          </Button>
        </div>
      )}
      {run && (
        <div className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <p className="text-muted-foreground">Próxima ação · São Paulo</p>
            <p>
              {action?.scheduled_for
                ? formatDateTime(action.scheduled_for)
                : run.next_contact_at
                  ? formatDateTime(run.next_contact_at)
                  : "Sem envio programado"}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground">Quem precisa agir</p>
            <p>
              {action?.send_state === "uncertain"
                ? "Você · confirmação de envio pendente"
                : run.next_contact_responsible === "human"
                  ? "Você"
                  : run.next_contact_responsible === "none"
                    ? "Ninguém"
                    : "Agente"}
            </p>
          </div>
          <p className="sm:col-span-2">{action?.decision_reason ?? run.next_contact_reason}</p>
          {action?.content && (
            <p className="whitespace-pre-wrap border-l-2 pl-3 sm:col-span-2">{action.content}</p>
          )}
        </div>
      )}
      {live && (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={change.isPending}
            onClick={() => change.mutate(run.status === "paused" ? "resume" : "pause")}
          >
            {run.status === "paused" ? <Play className="size-4" /> : <Pause className="size-4" />}
            {run.status === "paused" ? "Retomar" : "Pausar"}
          </Button>
          <Button variant="outline" onClick={() => setRescheduling(!rescheduling)}>
            <CalendarClock className="size-4" />
            Reagendar
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              if (window.confirm("Encerrar este ciclo e preservar o histórico?"))
                change.mutate("end");
            }}
          >
            <Square className="size-4" />
            Encerrar
          </Button>
        </div>
      )}
      {rescheduling && (
        <div className="flex flex-wrap gap-2">
          <Input
            aria-label="Nova data e hora em São Paulo"
            type="datetime-local"
            className="w-auto"
            value={at}
            onChange={(e) => setAt(e.target.value)}
          />
          <Button disabled={change.isPending} onClick={() => change.mutate("reschedule")}>
            Confirmar horário
          </Button>
        </div>
      )}
    </section>
  );
}
