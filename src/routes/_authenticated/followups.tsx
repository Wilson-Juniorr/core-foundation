import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Loader2, Pause, Pencil, Play, Plus, Square, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { FlowBuilderDialog } from "@/components/followup/flow-builder-dialog";
import { EmptyState, ErrorState, LoadingState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatDateTime } from "@/lib/domain/datetime";
import {
  cancelFollowupRun,
  cancelScheduledMessage,
  duplicateFollowupFlow,
  pauseFollowupRun,
  resumeFollowupRun,
  saveUserSettings,
  setFollowupFlowActive,
} from "@/lib/followup.functions";
import {
  failedActionsQuery,
  flowsQuery,
  followupKeys,
  runsQuery,
  scheduledMessagesQuery,
  userSettingsQuery,
} from "@/lib/followup.queries";
import {
  ACTION_TYPE_LABELS,
  RUN_STATUS_LABELS,
  SCHEDULED_STATUS_LABELS,
  stopReasonLabel,
} from "@/lib/followup/labels";
import type { FollowupRunView } from "@/lib/followup/types";

export const Route = createFileRoute("/_authenticated/followups")({
  head: () => ({
    meta: [
      { title: "Follow-ups automáticos | Próximo Passo" },
      {
        name: "description",
        content:
          "Crie fluxos de follow-up, acompanhe execuções ativas e agende mensagens automáticas de WhatsApp.",
      },
      { property: "og:title", content: "Follow-ups automáticos | Próximo Passo" },
      {
        property: "og:description",
        content: "Motor de follow-up com fluxos, janelas de envio e parada automática na resposta.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: FollowupsPage,
});

function RunRow({ run }: { run: FollowupRunView }) {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: followupKeys.root });

  const pause = useMutation({
    mutationFn: () => pauseFollowupRun({ data: { runId: run.id } }),
    onSuccess: invalidate,
    onError: () => toast.error("Não foi possível pausar."),
  });
  const resume = useMutation({
    mutationFn: () => resumeFollowupRun({ data: { runId: run.id } }),
    onSuccess: invalidate,
    onError: () => toast.error("Não foi possível retomar."),
  });
  const cancel = useMutation({
    mutationFn: () => cancelFollowupRun({ data: { runId: run.id } }),
    onSuccess: invalidate,
    onError: () => toast.error("Não foi possível encerrar."),
  });

  const isLive = run.status === "active" || run.status === "paused";

  return (
    <li className="flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to="/clientes/$contactId"
            params={{ contactId: run.contact_id }}
            className="font-medium hover:underline"
          >
            {run.contact_name ?? "Cliente"}
          </Link>
          <Badge variant="secondary">{RUN_STATUS_LABELS[run.status]}</Badge>
        </div>
        <p className="text-muted-foreground text-sm">
          {run.flow_name} · etapa {run.current_step_position ?? run.total_steps} de{" "}
          {run.total_steps}
          {run.next_action
            ? ` · próxima ${ACTION_TYPE_LABELS[run.next_action.action_type]} em ${formatDateTime(run.next_action.scheduled_for)}`
            : ""}
        </p>
        {!isLive && (
          <p className="text-muted-foreground text-xs">
            {stopReasonLabel(run.stop_reason) ?? RUN_STATUS_LABELS[run.status]} ·{" "}
            {formatDateTime(run.stopped_at ?? run.completed_at ?? run.started_at)}
          </p>
        )}
      </div>

      {isLive && (
        <div className="flex items-center gap-2">
          {run.status === "active" ? (
            <Button size="sm" variant="outline" onClick={() => pause.mutate()}>
              <Pause className="mr-1 size-4" /> Pausar
            </Button>
          ) : (
            <Button size="sm" variant="outline" onClick={() => resume.mutate()}>
              <Play className="mr-1 size-4" /> Retomar
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => cancel.mutate()}>
            <Square className="mr-1 size-4" /> Encerrar
          </Button>
        </div>
      )}
    </li>
  );
}

function RunList({ status }: { status: "active" | "paused" | "history" }) {
  const runs = useQuery(runsQuery(status));

  if (runs.isLoading) return <LoadingState />;
  if (runs.isError) return <ErrorState onRetry={() => runs.refetch()} />;
  if ((runs.data ?? []).length === 0) {
    return (
      <EmptyState
        title="Nada por aqui"
        description={
          status === "history"
            ? "Follow-ups encerrados aparecem nesta lista."
            : "Inicie um follow-up na página do cliente ou na conversa."
        }
      />
    );
  }

  return (
    <ul className="space-y-2">
      {runs.data!.map((run) => (
        <RunRow key={run.id} run={run} />
      ))}
    </ul>
  );
}

function SettingsCard() {
  const queryClient = useQueryClient();
  const settings = useQuery(userSettingsQuery());
  const [draft, setDraft] = useState<{
    start: string;
    end: string;
    timezone: string;
    handoff: boolean;
  } | null>(null);

  const current = draft ?? {
    start: settings.data?.send_window_start ?? "08:00",
    end: settings.data?.send_window_end ?? "20:00",
    timezone: settings.data?.timezone ?? "America/Sao_Paulo",
    handoff: settings.data?.pause_automation_on_handoff ?? true,
  };

  const save = useMutation({
    mutationFn: () =>
      saveUserSettings({
        data: {
          timezone: current.timezone,
          send_window_start: current.start,
          send_window_end: current.end,
          pause_automation_on_handoff: current.handoff,
        },
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: followupKeys.root });
      toast.success("Preferências de envio atualizadas.");
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Não foi possível salvar."),
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Janela de envio</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-4 sm:items-end">
        <div className="space-y-1.5">
          <Label htmlFor="tz">Fuso horário</Label>
          <Input
            id="tz"
            value={current.timezone}
            onChange={(event) => setDraft({ ...current, timezone: event.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="win-start">Início</Label>
          <Input
            id="win-start"
            type="time"
            value={current.start}
            onChange={(event) => setDraft({ ...current, start: event.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="win-end">Fim</Label>
          <Input
            id="win-end"
            type="time"
            value={current.end}
            onChange={(event) => setDraft({ ...current, end: event.target.value })}
          />
        </div>
        <Button onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
          Salvar
        </Button>

        <label className="flex items-start gap-3 rounded-md border p-3 sm:col-span-4">
          <input
            type="checkbox"
            className="mt-1 size-4 accent-primary"
            checked={current.handoff}
            onChange={(event) => setDraft({ ...current, handoff: event.target.checked })}
          />
          <span className="text-sm">
            <span className="font-medium">Pausar automações quando eu precisar intervir</span>
            <span className="block text-muted-foreground">
              Ao detectar pedido de desconto, objeção, pedido de ligação ou intenção de fechar, os
              follow-ups genéricos daquele cliente ficam pausados até você resolver o item.
            </span>
          </span>
        </label>
      </CardContent>
    </Card>
  );
}

function FlowsTab({ onEdit }: { onEdit: (flowId: string | null) => void }) {
  const queryClient = useQueryClient();
  const flows = useQuery(flowsQuery());
  const invalidate = () => queryClient.invalidateQueries({ queryKey: followupKeys.root });

  const toggle = useMutation({
    mutationFn: (input: { flowId: string; isActive: boolean }) =>
      setFollowupFlowActive({ data: input }),
    onSuccess: invalidate,
    onError: () => toast.error("Não foi possível alterar o fluxo."),
  });

  const duplicate = useMutation({
    mutationFn: (flowId: string) => duplicateFollowupFlow({ data: { flowId } }),
    onSuccess: async () => {
      await invalidate();
      toast.success("Fluxo duplicado.");
    },
    onError: () => toast.error("Não foi possível duplicar."),
  });

  if (flows.isLoading) return <LoadingState />;
  if (flows.isError) return <ErrorState onRetry={() => flows.refetch()} />;
  if ((flows.data ?? []).length === 0) {
    return (
      <EmptyState
        title="Nenhum fluxo criado"
        description="Crie um fluxo com as etapas do seu follow-up padrão."
        action={
          <Button onClick={() => onEdit(null)}>
            <Plus className="mr-1 size-4" /> Novo fluxo
          </Button>
        }
      />
    );
  }

  return (
    <ul className="space-y-2">
      {flows.data!.map((flow) => (
        <li
          key={flow.id}
          className="flex flex-col gap-3 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-medium">{flow.name}</p>
              {!flow.is_active && <Badge variant="outline">Inativo</Badge>}
            </div>
            <p className="text-muted-foreground text-sm">
              {flow.step_count} etapa(s) · {flow.active_runs} em andamento
              {flow.window_start && flow.window_end
                ? ` · janela ${flow.window_start.slice(0, 5)}–${flow.window_end.slice(0, 5)}`
                : ""}
            </p>
            {flow.description && (
              <p className="text-muted-foreground text-xs">{flow.description}</p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Switch
              checked={flow.is_active}
              aria-label="Ativar fluxo"
              onCheckedChange={(checked) => toggle.mutate({ flowId: flow.id, isActive: checked })}
            />
            <Button size="sm" variant="outline" onClick={() => onEdit(flow.id)}>
              <Pencil className="mr-1 size-4" /> Editar
            </Button>
            <Button size="sm" variant="ghost" onClick={() => duplicate.mutate(flow.id)}>
              <Copy className="mr-1 size-4" /> Duplicar
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive hover:text-destructive"
                  aria-label={`Excluir fluxo ${flow.name}`}
                >
                  <Trash2 className="mr-1 size-4" /> Excluir
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Excluir “{flow.name}”?</AlertDialogTitle>
                  <AlertDialogDescription>
                    O fluxo e suas {flow.step_count} etapa(s) serão apagados. Fluxos que já foram
                    executados não podem ser excluídos — nesse caso, desative-o.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction
                    disabled={remove.isPending}
                    onClick={() => remove.mutate(flow.id)}
                  >
                    Excluir fluxo
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </li>
      ))}
    </ul>
  );
}

function ScheduledTab() {
  const queryClient = useQueryClient();
  const scheduled = useQuery(scheduledMessagesQuery());
  const failed = useQuery(failedActionsQuery());

  const cancelAction = useMutation({
    mutationFn: (actionId: string) => cancelScheduledMessage({ data: { actionId } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: followupKeys.root });
      toast.success("Agendamento cancelado.");
    },
    onError: () => toast.error("Não foi possível cancelar."),
  });

  if (scheduled.isLoading) return <LoadingState />;
  if (scheduled.isError) return <ErrorState onRetry={() => scheduled.refetch()} />;

  const failures = failed.data ?? [];

  return (
    <div className="space-y-6">
      {(scheduled.data ?? []).length === 0 ? (
        <EmptyState
          title="Sem mensagens agendadas"
          description="Agende mensagens pontuais direto na conversa do cliente."
        />
      ) : (
        <ul className="space-y-2">
          {scheduled.data!.map((action) => (
            <li
              key={action.id}
              className="flex items-start justify-between gap-3 rounded-md border p-3"
            >
              <div className="space-y-1">
                <p className="font-medium">{action.contact_name ?? "Cliente"}</p>
                <p className="text-muted-foreground text-sm">
                  {ACTION_TYPE_LABELS[action.action_type]} · {formatDateTime(action.scheduled_for)}{" "}
                  · {SCHEDULED_STATUS_LABELS[action.status]}
                </p>
                {action.content && (
                  <p className="text-muted-foreground text-xs">{action.content.slice(0, 120)}</p>
                )}
              </div>
              {action.status === "scheduled" && (
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
      )}

      {failures.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Falhas de envio</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {failures.map((action) => (
              <div key={action.id} className="rounded-md border p-3">
                <p className="font-medium">{action.contact_name ?? "Cliente"}</p>
                <p className="text-muted-foreground text-xs">
                  {formatDateTime(action.scheduled_for)} · {action.attempts} tentativa(s) ·{" "}
                  {action.last_error ?? "erro desconhecido"}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function FollowupsPage() {
  const [builderOpen, setBuilderOpen] = useState(false);
  const [editingFlowId, setEditingFlowId] = useState<string | null>(null);

  function openBuilder(flowId: string | null) {
    setEditingFlowId(flowId);
    setBuilderOpen(true);
  }

  return (
    <AppShell
      title="Follow-ups"
      description="Fluxos automáticos que continuam rodando mesmo com o app fechado."
      actions={
        <Button onClick={() => openBuilder(null)}>
          <Plus className="mr-1 size-4" /> Novo fluxo
        </Button>
      }
    >
      <div className="space-y-6">
        <SettingsCard />

        <Tabs defaultValue="flows">
          <TabsList>
            <TabsTrigger value="flows">Fluxos</TabsTrigger>
            <TabsTrigger value="active">Ativos</TabsTrigger>
            <TabsTrigger value="paused">Pausados</TabsTrigger>
            <TabsTrigger value="scheduled">Agendadas</TabsTrigger>
            <TabsTrigger value="history">Histórico</TabsTrigger>
          </TabsList>

          <TabsContent value="flows" className="mt-4">
            <FlowsTab onEdit={openBuilder} />
          </TabsContent>
          <TabsContent value="active" className="mt-4">
            <RunList status="active" />
          </TabsContent>
          <TabsContent value="paused" className="mt-4">
            <RunList status="paused" />
          </TabsContent>
          <TabsContent value="scheduled" className="mt-4">
            <ScheduledTab />
          </TabsContent>
          <TabsContent value="history" className="mt-4">
            <RunList status="history" />
          </TabsContent>
        </Tabs>
      </div>

      <FlowBuilderDialog open={builderOpen} onOpenChange={setBuilderOpen} flowId={editingFlowId} />
    </AppShell>
  );
}
