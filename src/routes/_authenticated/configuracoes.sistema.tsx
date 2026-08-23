import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Info, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { EmptyState, ErrorState, LoadingState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime, formatRelative } from "@/lib/domain/datetime";
import { formatPhone } from "@/lib/domain/phone";
import { AUDIT_ACTION_LABELS, AUDIT_FILTERS, type AuditFilter } from "@/lib/audit/types";
import {
  cancelScheduledActionAction,
  retryAnalysisJobAction,
  retryFailedMessageAction,
  retryScheduledActionAction,
} from "@/lib/system.functions";
import { auditLogsQuery, systemKeys, systemStatusQuery } from "@/lib/system.queries";
import { CONNECTION_STATUS_LABELS } from "@/lib/whatsapp/labels";
import type { SystemIncident } from "@/lib/system/types";

export const Route = createFileRoute("/_authenticated/configuracoes/sistema")({
  head: () => ({
    meta: [
      { title: "Saúde do sistema — Próximo Passo" },
      {
        name: "description",
        content:
          "Diagnóstico técnico da operação: conexões, filas, falhas de envio, reprocessamento e histórico de alterações.",
      },
      { property: "og:title", content: "Saúde do sistema" },
      {
        property: "og:description",
        content: "Saiba em segundos se o sistema está trabalhando por você.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SystemPage,
});

const SEVERITY_ICON = {
  critical: AlertTriangle,
  warning: AlertTriangle,
  info: Info,
} as const;

function IncidentRow({ incident }: { incident: SystemIncident }) {
  const Icon = SEVERITY_ICON[incident.severity];
  return (
    <li className="flex gap-3 rounded-lg border p-4">
      <Icon
        className={
          incident.severity === "critical"
            ? "text-destructive mt-0.5 size-4 shrink-0"
            : "text-muted-foreground mt-0.5 size-4 shrink-0"
        }
        aria-hidden
      />
      <div className="min-w-0">
        <p className="text-sm font-medium">{incident.title}</p>
        <p className="text-muted-foreground text-xs">{incident.detail}</p>
        <p className="mt-1 text-xs">{incident.hint}</p>
      </div>
    </li>
  );
}

function Metric({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <div className="rounded-lg border p-4">
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className="font-display mt-1 text-2xl font-semibold tracking-tight">{value}</p>
      {hint ? <p className="text-muted-foreground mt-1 text-xs">{hint}</p> : null}
    </div>
  );
}

function AuditList() {
  const [filter, setFilter] = useState<AuditFilter>("all");
  const logs = useQuery(auditLogsQuery(filter));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Histórico de alterações</CardTitle>
        <CardDescription>
          Quem mexeu no quê e quando — inclusive as ações feitas pelo próprio sistema.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {AUDIT_FILTERS.map((option) => (
            <Button
              key={option.value}
              size="sm"
              variant={filter === option.value ? "default" : "outline"}
              onClick={() => setFilter(option.value)}
            >
              {option.label}
            </Button>
          ))}
        </div>

        {logs.isLoading ? <LoadingState rows={4} /> : null}
        {logs.isError ? <ErrorState onRetry={() => logs.refetch()} /> : null}
        {logs.data && logs.data.items.length === 0 ? (
          <EmptyState
            title="Nenhum registro ainda"
            description="Assim que configurações forem alteradas ou automações executadas, o histórico aparece aqui."
          />
        ) : null}
        {logs.data && logs.data.items.length > 0 ? (
          <ul className="divide-y">
            {logs.data.items.map((item) => (
              <li key={item.id} className="flex flex-wrap items-baseline gap-2 py-3">
                <span className="text-sm font-medium">
                  {AUDIT_ACTION_LABELS[item.action] ?? item.action}
                </span>
                {item.severity !== "info" ? (
                  <Badge variant={item.severity === "critical" ? "destructive" : "secondary"}>
                    {item.severity === "critical" ? "Crítico" : "Atenção"}
                  </Badge>
                ) : null}
                {item.actor === "system" ? <Badge variant="outline">Sistema</Badge> : null}
                <span className="text-muted-foreground w-full text-xs">{item.summary}</span>
                <span className="text-muted-foreground text-xs">
                  {formatDateTime(item.created_at)}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  );
}

function SystemPage() {
  const queryClient = useQueryClient();
  const status = useQuery(systemStatusQuery());

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: systemKeys.status }),
      queryClient.invalidateQueries({ queryKey: systemKeys.auditRoot }),
    ]);
  };

  const recovery = useMutation({
    mutationFn: async (input: { kind: "message" | "action" | "cancel" | "job"; id: string }) => {
      if (input.kind === "message") return retryFailedMessageAction({ data: { id: input.id } });
      if (input.kind === "action") return retryScheduledActionAction({ data: { id: input.id } });
      if (input.kind === "cancel") return cancelScheduledActionAction({ data: { id: input.id } });
      return retryAnalysisJobAction({ data: { id: input.id } });
    },
    onSuccess: async (result) => {
      toast.success(result.message);
      await refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <AppShell
      title="Saúde do sistema"
      description="Um diagnóstico honesto: o que está funcionando, o que travou e o que fazer agora."
      actions={
        <Button variant="outline" size="sm" onClick={refresh}>
          <RefreshCw className="mr-2 size-4" aria-hidden />
          Atualizar
        </Button>
      }
    >
      {status.isLoading ? <LoadingState rows={5} /> : null}
      {status.isError ? <ErrorState onRetry={() => status.refetch()} /> : null}

      {status.data ? (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Situação agora</CardTitle>
              <CardDescription>
                Atualizado {formatRelative(status.data.generated_at)}.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {status.data.incidents.length === 0 ? (
                <div className="flex items-center gap-3 rounded-lg border p-4">
                  <CheckCircle2 className="size-4 text-emerald-600" aria-hidden />
                  <p className="text-sm">
                    Tudo em ordem: conexão ativa, filas em dia e nenhuma falha recente.
                  </p>
                </div>
              ) : (
                <ul className="space-y-3">
                  {status.data.incidents.map((incident) => (
                    <IncidentRow key={incident.id} incident={incident} />
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Metric
              label="Ações na fila"
              value={status.data.queues.scheduled_pending}
              hint={`${status.data.queues.scheduled_overdue} atrasada(s)`}
            />
            <Metric
              label="Análises na fila"
              value={status.data.queues.ai_pending}
              hint={`${status.data.queues.ai_stuck} travada(s)`}
            />
            <Metric
              label="Falhas de envio (24h)"
              value={status.data.failures.messages_failed_24h}
              hint={`${status.data.failures.actions_failed_24h} ação(ões) com erro`}
            />
            <Metric
              label="Aguardando você"
              value={status.data.guardrails.attention_open}
              hint={`${status.data.guardrails.drafts_waiting} rascunho(s) para aprovar`}
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Conexões de WhatsApp</CardTitle>
              <CardDescription>Última atividade recebida de cada número.</CardDescription>
            </CardHeader>
            <CardContent>
              {status.data.connections.length === 0 ? (
                <EmptyState
                  title="Nenhum número conectado"
                  description="Conecte um WhatsApp para começar a receber e enviar mensagens."
                />
              ) : (
                <ul className="divide-y">
                  {status.data.connections.map((connection) => (
                    <li key={connection.id} className="flex flex-wrap items-center gap-3 py-3">
                      <Badge
                        variant={connection.status === "connected" ? "secondary" : "destructive"}
                      >
                        {CONNECTION_STATUS_LABELS[
                          connection.status as keyof typeof CONNECTION_STATUS_LABELS
                        ] ?? connection.status}
                      </Badge>
                      <span className="text-sm font-medium">
                        {connection.display_name ?? formatPhone(connection.phone_number) ?? "Instância"}
                      </span>
                      <span className="text-muted-foreground text-xs">
                        Último evento:{" "}
                        {connection.last_event_at
                          ? formatRelative(connection.last_event_at)
                          : "nenhum ainda"}
                      </span>
                      {connection.last_sync_status ? (
                        <span className="text-muted-foreground w-full text-xs">
                          {connection.last_sync_status}
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Reprocessar pendências</CardTitle>
              <CardDescription>
                Nada é reenviado sem você pedir — e cada tentativa fica registrada.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <section className="space-y-2">
                <h3 className="text-sm font-medium">Mensagens que falharam</h3>
                {status.data.failed_messages.length === 0 ? (
                  <p className="text-muted-foreground text-sm">Nenhuma falha pendente.</p>
                ) : (
                  <ul className="divide-y">
                    {status.data.failed_messages.map((item) => (
                      <li key={item.id} className="flex flex-wrap items-center gap-3 py-3">
                        <span className="text-sm font-medium">
                          {item.contact_name ?? "Cliente sem cadastro"}
                        </span>
                        <span className="text-muted-foreground text-xs">
                          {formatDateTime(item.sent_at)}
                        </span>
                        <span className="text-muted-foreground w-full text-xs">
                          {item.preview ?? "Mensagem com mídia"}
                        </span>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!item.can_retry || recovery.isPending}
                          onClick={() => recovery.mutate({ kind: "message", id: item.id })}
                        >
                          Reenviar
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="space-y-2">
                <h3 className="text-sm font-medium">Ações agendadas travadas</h3>
                {status.data.stuck_actions.length === 0 ? (
                  <p className="text-muted-foreground text-sm">Fila limpa.</p>
                ) : (
                  <ul className="divide-y">
                    {status.data.stuck_actions.map((item) => (
                      <li key={item.id} className="flex flex-wrap items-center gap-3 py-3">
                        <Badge variant="outline">{item.status}</Badge>
                        <span className="text-sm font-medium">
                          {item.contact_name ?? "Cliente sem cadastro"}
                        </span>
                        <span className="text-muted-foreground text-xs">
                          Previsto para {formatDateTime(item.scheduled_for)}
                        </span>
                        {item.last_error ? (
                          <span className="text-muted-foreground w-full text-xs">
                            {item.last_error}
                          </span>
                        ) : null}
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={recovery.isPending}
                            onClick={() => recovery.mutate({ kind: "action", id: item.id })}
                          >
                            Reprocessar
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={recovery.isPending}
                            onClick={() => recovery.mutate({ kind: "cancel", id: item.id })}
                          >
                            Cancelar
                          </Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="space-y-2">
                <h3 className="text-sm font-medium">Análises de conversa pendentes</h3>
                {status.data.failed_jobs.length === 0 ? (
                  <p className="text-muted-foreground text-sm">Nenhuma análise travada.</p>
                ) : (
                  <ul className="divide-y">
                    {status.data.failed_jobs.map((item) => (
                      <li key={item.id} className="flex flex-wrap items-center gap-3 py-3">
                        <Badge variant="outline">{item.status}</Badge>
                        <span className="text-sm font-medium">
                          {item.contact_name ?? "Cliente sem cadastro"}
                        </span>
                        <span className="text-muted-foreground text-xs">
                          {formatDateTime(item.requested_at)} · {item.attempts} tentativa(s)
                        </span>
                        {item.last_error ? (
                          <span className="text-muted-foreground w-full text-xs">
                            {item.last_error}
                          </span>
                        ) : null}
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={recovery.isPending}
                          onClick={() => recovery.mutate({ kind: "job", id: item.id })}
                        >
                          Reprocessar
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </CardContent>
          </Card>

          <AuditList />
        </div>
      ) : null}
    </AppShell>
  );
}
