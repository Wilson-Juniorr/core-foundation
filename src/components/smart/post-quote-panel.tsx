import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Pause, Play, CalendarClock, Plus, Square } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  POST_QUOTE_HISTORY_REQUIRED,
  POST_QUOTE_NOTE_MAX,
  POST_QUOTE_NOTE_MIN,
} from "@/lib/smart/post-quote-history";
import { postQuoteOpportunitySelection } from "@/lib/smart/post-quote-opportunity";
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
  resolvePostQuoteFn,
} from "@/lib/post-quote.functions";
// Times are labelled "São Paulo", so render them in that zone regardless of the device.
const spFormat = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});
const formatDateTime = (value: string) => spFormat.format(new Date(value)).replace(", ", " às ");
import { localInstant } from "@/lib/smart/post-quote-cadence";
export function PostQuotePanel({
  contactId,
  opportunities,
  onCreateOpportunity,
}: {
  contactId: string;
  opportunities: { id: string; title: string; status: string }[];
  onCreateOpportunity: () => void;
}) {
  const client = useQueryClient();
  const view = useServerFn(postQuoteViewFn),
    activate = useServerFn(activatePostQuoteFn),
    control = useServerFn(controlPostQuoteFn),
    resolve = useServerFn(resolvePostQuoteFn);
  const [evidence, setEvidence] = useState("");
  const query = useQuery({
    queryKey: ["post-quote", contactId],
    queryFn: () => view({ data: { contactId } }),
    refetchInterval: 30000,
  });
  const [opportunityId, setOpportunityId] = useState("");
  const [contextNote, setContextNote] = useState("");
  const [historyIssue, setHistoryIssue] = useState<{
    opportunityId: string;
    unavailable: boolean;
    requestedAt?: number;
  }>();
  const { openOpportunities, selectedOpportunity } = postQuoteOpportunitySelection(
    opportunities,
    opportunityId,
  );
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
    mutationFn: (data: {
      opportunityId: string;
      contextNote?: string;
      recoverRunId?: string;
      lookupOnly?: boolean;
    }) => activate({ data: { contactId, ...data } }),
    onSuccess: (result, input) => {
      invalidate();
      if (result.status === "history_required") {
        setHistoryIssue({
          opportunityId: input.opportunityId,
          unavailable: result.sync === "unavailable",
          ...(result.sync === "requested"
            ? { requestedAt: Date.now() }
            : input.lookupOnly && historyIssue?.requestedAt
              ? { requestedAt: historyIssue.requestedAt }
              : {}),
        });
        return;
      }
      setHistoryIssue(undefined);
      setContextNote("");
      toast.success(
        result.contextNote
          ? "Resumo salvo. Confira a próxima mensagem em Follow-ups → Aprovações."
          : result.imported
            ? "Histórico recuperado. O próximo envio exige sua aprovação."
            : result.status === "recovered"
              ? "Histórico recuperado."
              : "Pós-cotação ativado.",
      );
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
  const settle = useMutation({
    mutationFn: (
      input:
        | { kind: "uncertain"; actionId: string; outcome: "delivered" | "not_delivered" }
        | { kind: "date_review"; commitmentId: string },
    ) =>
      resolve({
        data:
          input.kind === "uncertain"
            ? { ...input, evidence }
            : { ...input, note: evidence || "Revisado" },
      }),
    onSuccess: () => {
      invalidate();
      setEvidence("");
      toast.success("Resolução registrada.");
    },
    onError: (e) => toast.error(e.message),
  });
  const reviews = query.data?.reviews ?? [];
  const live = run && ["active", "paused"].includes(run.status);
  const needsRecovery =
    run?.status === "active" && run.next_contact_reason === POST_QUOTE_HISTORY_REQUIRED;
  const historyOpportunityId = needsRecovery
    ? run.opportunity_id
    : !live && selectedOpportunity?.id === historyIssue?.opportunityId
      ? selectedOpportunity?.id
      : null;
  const historyRequested =
    historyIssue?.opportunityId === historyOpportunityId &&
    Date.now() - (historyIssue?.requestedAt ?? 0) < 2 * 60_000;
  const historyInput = historyOpportunityId
    ? { opportunityId: historyOpportunityId, ...(needsRecovery ? { recoverRunId: run.id } : {}) }
    : null;
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
      {!live && openOpportunities.length === 0 && (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {opportunities.length === 0
              ? "Este cliente ainda não tem uma oportunidade. Cadastre a cotação para ativar o acompanhamento."
              : "As oportunidades deste cliente estão fechadas ou arquivadas. A ativação exige uma oportunidade aberta para esta cotação."}
          </p>
          <Button type="button" variant="outline" onClick={onCreateOpportunity}>
            <Plus className="size-4" />
            Nova oportunidade
          </Button>
        </div>
      )}
      {!live && openOpportunities.length > 0 && (
        <div className="flex flex-wrap gap-3">
          <Select
            value={selectedOpportunity?.id ?? ""}
            onValueChange={(value) => {
              setOpportunityId(value);
              setContextNote("");
              setHistoryIssue(undefined);
            }}
          >
            <SelectTrigger aria-label="Oportunidade da cotação" className="w-full sm:w-72">
              <SelectValue placeholder="Oportunidade da cotação" />
            </SelectTrigger>
            <SelectContent>
              {openOpportunities.map((opportunity) => (
                <SelectItem key={opportunity.id} value={opportunity.id}>
                  {opportunity.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            disabled={start.isPending || !selectedOpportunity || Boolean(historyInput)}
            onClick={() =>
              selectedOpportunity && start.mutate({ opportunityId: selectedOpportunity.id })
            }
          >
            <Play className="size-4" />
            Ativar pós-cotação
          </Button>
        </div>
      )}
      {historyInput && (
        <div
          className="space-y-3 rounded-md border p-3 text-sm"
          role="group"
          aria-label="Recuperar contexto da cotação"
        >
          <p role="status" className="font-medium">
            {historyRequested
              ? "Solicitamos o histórico ao celular. Abra o WhatsApp no aparelho e confira novamente em instantes."
              : historyIssue?.unavailable
                ? "O WhatsApp não disponibilizou o histórico agora."
                : "O histórico disponível ainda não traz a cotação."}
          </p>
          <Button
            variant="outline"
            disabled={start.isPending}
            onClick={() => start.mutate({ ...historyInput, lookupOnly: historyRequested })}
          >
            {historyRequested ? "Verificar histórico" : "Buscar histórico novamente"}
          </Button>
          <label className="block space-y-2">
            <span>Resumo desta cotação</span>
            <Textarea
              value={contextNote}
              onChange={(event) => setContextNote(event.target.value)}
              maxLength={POST_QUOTE_NOTE_MAX}
              placeholder="Quais opções você enviou, qual foi a última resposta e o que ficou combinado?"
            />
          </label>
          <p className="text-muted-foreground">
            Confira no WhatsApp se o cliente ainda espera seu retorno. Com o resumo, você aprova os
            envios enquanto a cotação não estiver disponível no histórico.
          </p>
          <Button
            disabled={start.isPending || contextNote.trim().length < POST_QUOTE_NOTE_MIN}
            onClick={() => start.mutate({ ...historyInput, contextNote: contextNote.trim() })}
          >
            {needsRecovery ? "Salvar resumo e reavaliar" : "Ativar com resumo e aprovação"}
          </Button>
        </div>
      )}
      {run && (
        <div className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <p className="text-muted-foreground">Próxima ação · São Paulo</p>
            <p>
              {needsRecovery
                ? "Envio suspenso · aguardando contexto"
                : action?.scheduled_for
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
                : reviews.length > 0
                  ? "Você · revisão de data"
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
      {reviews.map((r) => (
        <div
          key={r.id}
          role="alert"
          className="space-y-2 border-l-2 border-destructive pl-3 text-sm"
        >
          <p className="font-medium">Bloqueado · revisão de data</p>
          <p>{r.description}</p>
          <p className="text-muted-foreground">
            Nada será enviado até você revisar. Depois, use Reagendar para definir o próximo
            contato.
          </p>
          <Button
            size="sm"
            variant="outline"
            disabled={settle.isPending}
            onClick={() => settle.mutate({ kind: "date_review", commitmentId: r.id })}
          >
            Marcar como revisado
          </Button>
        </div>
      ))}
      {action?.send_state === "uncertain" && (
        <div role="alert" className="space-y-2 border-l-2 border-destructive pl-3 text-sm">
          <p className="font-medium">Envio sem confirmação · reenvio suspenso</p>
          <p className="text-muted-foreground">
            Abra o WhatsApp do número conectado, entre na conversa deste cliente e confira se a
            mensagem acima aparece como enviada
            {action.send_started_at
              ? ` por volta de ${formatDateTime(action.send_started_at)}`
              : ""}
            . Descreva o que você viu; sem isso a tentativa continua bloqueada.
          </p>
          <Input
            aria-label="O que você verificou"
            placeholder="Ex.: vi a mensagem com dois tiques às 10h02"
            value={evidence}
            onChange={(e) => setEvidence(e.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={settle.isPending}
              onClick={() =>
                settle.mutate({ kind: "uncertain", actionId: action.id, outcome: "delivered" })
              }
            >
              Chegou ao cliente
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={settle.isPending}
              onClick={() =>
                settle.mutate({ kind: "uncertain", actionId: action.id, outcome: "not_delivered" })
              }
            >
              Não chegou
            </Button>
          </div>
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
