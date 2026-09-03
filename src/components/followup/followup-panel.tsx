import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Brain, CalendarClock, Pause, Play, Plus, Square, X } from "lucide-react";
import { toast } from "sonner";

import { ScheduleMessageDialog } from "@/components/followup/schedule-message-dialog";
import { StartFollowupDialog } from "@/components/followup/start-followup-dialog";
import { StartSmartFlowDialog } from "@/components/smart/start-smart-flow-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime } from "@/lib/domain/datetime";
import {
  cancelFollowupRun,
  cancelScheduledMessage,
  pauseFollowupRun,
  resumeFollowupRun,
} from "@/lib/followup.functions";
import { followupKeys, followupSummaryQuery } from "@/lib/followup.queries";
import {
  ACTION_TYPE_LABELS,
  RUN_STATUS_LABELS,
  SCHEDULED_STATUS_LABELS,
  stopReasonLabel,
} from "@/lib/followup/labels";
import { SMART_RUN_STATE_LABELS } from "@/lib/smart/types";
import type { SmartRunState } from "@/lib/smart/types";

/**
 * Painel de follow-up reutilizado na página do cliente e na conversa.
 * Mostra somente o estado real vindo do servidor — sem contagem local.
 */
export function FollowupPanel({
  contactId,
  conversationId,
  contactPhone,
  opportunityId,
  compact = false,
}: {
  contactId: string;
  conversationId: string | null;
  /** Telefone do cliente: permite iniciar sem conversa existente. */
  contactPhone?: string | null;
  opportunityId?: string | null;
  compact?: boolean;
}) {
  const queryClient = useQueryClient();
  const [starting, setStarting] = useState(false);
  const [startingSmart, setStartingSmart] = useState(false);
  const [scheduling, setScheduling] = useState(false);

  const summary = useQuery(
    followupSummaryQuery(conversationId ? { conversationId } : { contactId }),
  );

  const invalidate = () => queryClient.invalidateQueries({ queryKey: followupKeys.root });

  const pause = useMutation({
    mutationFn: (runId: string) => pauseFollowupRun({ data: { runId } }),
    onSuccess: async () => {
      await invalidate();
      toast.success("Follow-up pausado.");
    },
    onError: () => toast.error("Não foi possível pausar."),
  });

  const resume = useMutation({
    mutationFn: (runId: string) => resumeFollowupRun({ data: { runId } }),
    onSuccess: async () => {
      await invalidate();
      toast.success("Follow-up retomado.");
    },
    onError: () => toast.error("Não foi possível retomar."),
  });

  const cancel = useMutation({
    mutationFn: (runId: string) => cancelFollowupRun({ data: { runId } }),
    onSuccess: async () => {
      await invalidate();
      toast.success("Follow-up encerrado.");
    },
    onError: () => toast.error("Não foi possível encerrar."),
  });

  const cancelAction = useMutation({
    mutationFn: (actionId: string) => cancelScheduledMessage({ data: { actionId } }),
    onSuccess: async () => {
      await invalidate();
      toast.success("Agendamento cancelado.");
    },
    onError: () => toast.error("Não foi possível cancelar o agendamento."),
  });

  const run = summary.data?.run ?? null;
  const lastStopped = summary.data?.last_stopped_run ?? null;
  const scheduled = summary.data?.scheduled ?? [];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
        <CardTitle className="text-base">Follow-up</CardTitle>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setStarting(true)}>
            <Plus className="mr-1 size-4" />
            {run ? "Trocar fluxo" : "Iniciar"}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setStartingSmart(true)}>
            <Brain className="mr-1 size-4" />
            Inteligente
          </Button>

          {conversationId && (
            <Button size="sm" variant="ghost" onClick={() => setScheduling(true)}>
              <CalendarClock className="mr-1 size-4" />
              Agendar
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {summary.isLoading && <p className="text-muted-foreground">Carregando...</p>}

        {!summary.isLoading && !run && (
          <p className="text-muted-foreground">
            {lastStopped
              ? `Último fluxo (${lastStopped.flow_name}) encerrado — ${
                  stopReasonLabel(lastStopped.stop_reason) ?? RUN_STATUS_LABELS[lastStopped.status]
                }.`
              : "Nenhum follow-up ativo para este cliente."}
          </p>
        )}

        {run && (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-medium">{run.flow_name}</p>
              <Badge variant="secondary">{RUN_STATUS_LABELS[run.status]}</Badge>
              {run.flow_kind === "smart" && (
                <Badge variant="outline" className="gap-1">
                  <Brain className="size-3" /> Inteligente
                </Badge>
              )}
            </div>
            {run.flow_kind === "smart" ? (
              <p className="text-muted-foreground">
                {run.smart_state ? SMART_RUN_STATE_LABELS[run.smart_state as SmartRunState] : "Em acompanhamento"}
                {run.next_evaluation_at
                  ? ` · próxima análise em ${formatDateTime(run.next_evaluation_at)}`
                  : ""}
              </p>
            ) : (
              <p className="text-muted-foreground">
                Etapa {run.current_step_position ?? 1} de {run.total_steps} · {run.remaining_steps}{" "}
                restante(s)
              </p>
            )}
            {run.next_action ? (
              <p className="text-muted-foreground">
                Próxima ação: {ACTION_TYPE_LABELS[run.next_action.action_type]} em{" "}
                {formatDateTime(run.next_action.scheduled_for)} ·{" "}
                {SCHEDULED_STATUS_LABELS[run.next_action.status]}
              </p>
            ) : (
              <p className="text-muted-foreground">
                {run.flow_kind === "smart"
                  ? "Nenhuma mensagem gerada ainda — a IA reavalia o contexto a cada ciclo."
                  : "Sem próxima ação agendada."}
              </p>
            )}


            <div className="flex flex-wrap items-center gap-2 pt-1">
              {run.status === "active" ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => pause.mutate(run.id)}
                  disabled={pause.isPending}
                >
                  <Pause className="mr-1 size-4" /> Pausar
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => resume.mutate(run.id)}
                  disabled={resume.isPending}
                >
                  <Play className="mr-1 size-4" /> Retomar
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => cancel.mutate(run.id)}
                disabled={cancel.isPending}
              >
                <Square className="mr-1 size-4" /> Encerrar
              </Button>
            </div>
          </div>
        )}

        {!compact && scheduled.length > 0 && (
          <div className="space-y-2 border-t pt-3">
            <p className="text-xs font-medium tracking-wide uppercase">Próximas ações</p>
            <ul className="space-y-2">
              {scheduled.map((action) => (
                <li key={action.id} className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p>{ACTION_TYPE_LABELS[action.action_type]}</p>
                      <Badge variant="outline" className="text-xs">
                        {SCHEDULED_STATUS_LABELS[action.status]}
                      </Badge>
                    </div>
                    <p className="text-muted-foreground text-xs">
                      {formatDateTime(action.scheduled_for)}
                      {action.content ? ` · ${action.content.slice(0, 60)}` : ""}
                    </p>
                    {action.last_error ? (
                      <p className="text-destructive text-xs">{action.last_error}</p>
                    ) : null}
                  </div>
                  {(action.status === "scheduled" ||
                    action.status === "needs_approval" ||
                    action.status === "blocked" ||
                    action.status === "stale") && (
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label="Cancelar agendamento"
                      onClick={() => cancelAction.mutate(action.id)}
                    >
                      <X className="size-4" />
                    </Button>
                  )}
                </li>
              ))}
            </ul>

          </div>
        )}
      </CardContent>

      <StartFollowupDialog
        open={starting}
        onOpenChange={setStarting}
        contactId={contactId}
        conversationId={conversationId}
        contactPhone={contactPhone ?? null}
        opportunityId={opportunityId ?? null}
        hasActiveRun={Boolean(run)}
      />
      <StartSmartFlowDialog
        open={startingSmart}
        onOpenChange={setStartingSmart}
        contactId={contactId}
        conversationId={conversationId}
        opportunityId={opportunityId ?? null}
      />
      {conversationId && (
        <ScheduleMessageDialog
          open={scheduling}
          onOpenChange={setScheduling}
          conversationId={conversationId}
          contactId={contactId}
        />
      )}
    </Card>
  );
}
