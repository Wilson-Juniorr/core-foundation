import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
  AlertTriangle,
  Download,
  Activity,
  Info,
  RefreshCcw,
  TrendingUp,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { EmptyState, LoadingState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { exportAnalyticsCsv } from "@/lib/analytics.functions";
import { RANGE_LABELS, analyticsQuery, resolvePeriod } from "@/lib/analytics.queries";
import { EXPORT_LABELS } from "@/lib/analytics/types";
import type {
  AnalyticsAlert,
  AnalyticsExportDataset,
  AnalyticsRange,
  ConversionSlice,
} from "@/lib/analytics/types";
import { formatDateTime } from "@/lib/domain/datetime";

export const Route = createFileRoute("/_authenticated/analytics")({
  head: () => ({
    meta: [
      { title: "Analytics e Performance — Próximo Passo" },
      {
        name: "description",
        content:
          "Métricas de acompanhamento comercial: taxa de resposta, recuperação de clientes, funil, desempenho de fluxos e estratégias, além da saúde operacional.",
      },
      { property: "og:title", content: "Analytics e Performance" },
      {
        property: "og:description",
        content: "Descubra se o acompanhamento está aumentando conversão e evitando esquecimentos.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AnalyticsPage,
});

const RANGES: AnalyticsRange[] = ["today", "7d", "30d", "custom"];

function formatDuration(seconds: number | null): string {
  if (seconds === null || Number.isNaN(seconds)) return "—";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  if (seconds < 86_400) return `${(seconds / 3600).toFixed(1)} h`;
  return `${(seconds / 86_400).toFixed(1)} dias`;
}

function formatPercent(value: number | null): string {
  return value === null ? "—" : `${value}%`;
}

function Metric({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border bg-card px-4 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-display mt-1 text-2xl font-semibold tracking-tight">{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function AlertRow({ alert }: { alert: AnalyticsAlert }) {
  const tone =
    alert.level === "critical"
      ? "border-destructive/40 bg-destructive/5"
      : alert.level === "warning"
        ? "border-amber-500/40 bg-amber-500/5"
        : "border-border bg-muted/40";
  const Icon = alert.level === "info" ? Info : AlertTriangle;
  return (
    <div className={`flex items-start gap-3 rounded-lg border px-4 py-3 ${tone}`}>
      <Icon className="mt-0.5 size-4 shrink-0" />
      <div>
        <p className="text-sm font-medium">{alert.title}</p>
        <p className="text-xs text-muted-foreground">{alert.detail}</p>
      </div>
    </div>
  );
}

function ConversionBlock({ label, slice }: { label: string; slice: ConversionSlice }) {
  return (
    <div className="rounded-lg border px-4 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-display mt-1 text-xl font-semibold">{formatPercent(slice.rate)}</p>
      <p className="text-xs text-muted-foreground">
        {slice.won} ganhas de {slice.total} oportunidades
      </p>
    </div>
  );
}

function AnalyticsPage() {
  const [range, setRange] = useState<AnalyticsRange>("30d");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  const period = useMemo(
    () => resolvePeriod(range, { from: customFrom, to: customTo }),
    [range, customFrom, customTo],
  );

  const report = useQuery({
    ...analyticsQuery(period),
    enabled: range !== "custom" || Boolean(customFrom && customTo),
  });

  const exportMutation = useMutation({
    mutationFn: (dataset: AnalyticsExportDataset) =>
      exportAnalyticsCsv({ data: { dataset, from: period.from, to: period.to } }),
    onSuccess: (result) => {
      const blob = new Blob([`\uFEFF${result.csv}`], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = result.filename;
      link.click();
      URL.revokeObjectURL(url);
      toast.success(`${result.rows} linha(s) exportada(s).`);
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Não foi possível exportar."),
  });

  const data = report.data;

  return (
    <AppShell
      title="Analytics e Performance"
      description="Mede se o acompanhamento está gerando conversão — e onde oportunidades estão sendo esquecidas."
      actions={
        <Button
          variant="outline"
          size="sm"
          onClick={() => report.refetch()}
          disabled={report.isFetching}
        >
          <RefreshCcw className="mr-2 size-4" />
          Atualizar
        </Button>
      }
    >
      <div className="space-y-6">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-wrap gap-2">
            {RANGES.map((value) => (
              <Button
                key={value}
                size="sm"
                variant={range === value ? "default" : "outline"}
                onClick={() => setRange(value)}
              >
                {RANGE_LABELS[value]}
              </Button>
            ))}
          </div>
          {range === "custom" && (
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="from">De</Label>
                <Input
                  id="from"
                  type="date"
                  value={customFrom}
                  onChange={(event) => setCustomFrom(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="to">Até</Label>
                <Input
                  id="to"
                  type="date"
                  value={customTo}
                  onChange={(event) => setCustomTo(event.target.value)}
                />
              </div>
            </div>
          )}
        </div>

        {report.isLoading && <LoadingState label="Calculando métricas do período…" />}
        {report.isError && (
          <EmptyState
            title="Não foi possível carregar as métricas"
            description={report.error instanceof Error ? report.error.message : "Tente novamente."}
          />
        )}

        {data && (
          <>
            {data.alerts.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <AlertTriangle className="size-4" />
                    Alertas
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {data.alerts.map((alert) => (
                    <AlertRow key={alert.id} alert={alert} />
                  ))}
                </CardContent>
              </Card>
            )}

            <section className="space-y-3">
              <h2 className="font-display text-sm font-semibold tracking-tight uppercase text-muted-foreground">
                Acompanhamento no período
              </h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Metric label="Novos clientes" value={data.overview.new_contacts} />
                <Metric label="Novas oportunidades" value={data.overview.new_opportunities} />
                <Metric label="Follow-ups iniciados" value={data.overview.followups_started} />
                <Metric label="Mensagens de follow-up enviadas" value={data.overview.followups_sent} />
                <Metric
                  label="Taxa de resposta"
                  value={formatPercent(data.overview.reply_rate)}
                  hint={`${data.overview.followups_with_reply} respostas em até 72h`}
                />
                <Metric
                  label="Tempo médio até resposta"
                  value={formatDuration(data.overview.avg_reply_seconds)}
                />
                <Metric
                  label="Clientes reativados"
                  value={data.overview.recovered_contacts}
                  hint="Estavam há 7+ dias sem falar e voltaram após o follow-up"
                />
                <Metric
                  label="Oportunidades sem próximo passo"
                  value={data.overview.opportunities_without_next_action}
                />
                <Metric label="Ganhas no período" value={data.overview.opportunities_won} />
                <Metric label="Perdidas no período" value={data.overview.opportunities_lost} />
                <Metric
                  label="Próximas ações vencidas"
                  value={data.overview.opportunities_overdue}
                />
                <Metric label="Oportunidades abertas" value={data.overview.opportunities_open} />
                <Metric
                  label="Automáticas × manuais"
                  value={`${data.overview.messages_automatic} / ${data.overview.messages_manual}`}
                  hint="Mensagens enviadas pelo sistema × por você"
                />
                <Metric
                  label="Mensagens com falha"
                  value={data.overview.messages_failed + data.overview.actions_failed}
                />
                <Metric
                  label="Intervenções humanas"
                  value={data.overview.human_interventions}
                  hint="Handoffs, pausas e resoluções manuais"
                />
                <Metric
                  label="Clientes em opt-out"
                  value={data.overview.opt_out_contacts}
                  hint={`${data.overview.opt_outs_in_period} novos no período`}
                />
              </div>
            </section>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <TrendingUp className="size-4" />
                  Conversão
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <ConversionBlock
                    label="Oportunidades com acompanhamento"
                    slice={data.overview.conversion_with_followup}
                  />
                  <ConversionBlock
                    label="Oportunidades sem acompanhamento"
                    slice={data.overview.conversion_without_followup}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  Comparação observacional: os grupos não foram sorteados, então a diferença indica
                  correlação, não causa comprovada.
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Funil por estágio</CardTitle>
              </CardHeader>
              <CardContent>
                {data.funnel.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhum estágio ativo.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="text-muted-foreground">
                        <tr className="text-left">
                          <th className="py-2 pr-4 font-medium">Estágio</th>
                          <th className="py-2 pr-4 font-medium">Abertas</th>
                          <th className="py-2 pr-4 font-medium">Entradas no período</th>
                          <th className="py-2 pr-4 font-medium">Ganhas</th>
                          <th className="py-2 pr-4 font-medium">Perdidas</th>
                          <th className="py-2 font-medium">Tempo médio no estágio</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.funnel.map((stage) => (
                          <tr key={stage.stage_id} className="border-t">
                            <td className="py-2 pr-4">{stage.name}</td>
                            <td className="py-2 pr-4">{stage.open_count}</td>
                            <td className="py-2 pr-4">{stage.entered_in_period}</td>
                            <td className="py-2 pr-4">{stage.won_count}</td>
                            <td className="py-2 pr-4">{stage.lost_count}</td>
                            <td className="py-2">{formatDuration(stage.avg_seconds_in_stage)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Desempenho por fluxo</CardTitle>
              </CardHeader>
              <CardContent>
                {data.flows.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhum fluxo cadastrado.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="text-muted-foreground">
                        <tr className="text-left">
                          <th className="py-2 pr-4 font-medium">Fluxo</th>
                          <th className="py-2 pr-4 font-medium">Iniciados</th>
                          <th className="py-2 pr-4 font-medium">Responderam</th>
                          <th className="py-2 pr-4 font-medium">Taxa</th>
                          <th className="py-2 pr-4 font-medium">Etapa da última resposta</th>
                          <th className="py-2 pr-4 font-medium">Concluídos</th>
                          <th className="py-2 pr-4 font-medium">Interrompidos</th>
                          <th className="py-2 pr-4 font-medium">Falhas</th>
                          <th className="py-2 pr-4 font-medium">Tempo até resposta</th>
                          <th className="py-2 font-medium">Ganhas (contatos do fluxo)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.flows.map((flow) => (
                          <tr key={flow.flow_id} className="border-t">
                            <td className="py-2 pr-4">
                              <div className="flex items-center gap-2">
                                {flow.name}
                                {!flow.is_active && <Badge variant="outline">inativo</Badge>}
                              </div>
                            </td>
                            <td className="py-2 pr-4">{flow.started}</td>
                            <td className="py-2 pr-4">{flow.replied}</td>
                            <td className="py-2 pr-4">{formatPercent(flow.reply_rate)}</td>
                            <td className="py-2 pr-4">
                              {flow.last_reply_step_position ? `#${flow.last_reply_step_position}` : "—"}
                            </td>
                            <td className="py-2 pr-4">{flow.completed}</td>
                            <td className="py-2 pr-4">{flow.interrupted}</td>
                            <td className="py-2 pr-4">{flow.failed}</td>
                            <td className="py-2 pr-4">{formatDuration(flow.avg_reply_seconds)}</td>
                            <td className="py-2">{flow.won_opportunities}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Estratégias por versão</CardTitle>
              </CardHeader>
              <CardContent>
                {data.strategies.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Nenhuma mensagem gerada por estratégia neste período.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="text-muted-foreground">
                        <tr className="text-left">
                          <th className="py-2 pr-4 font-medium">Estratégia</th>
                          <th className="py-2 pr-4 font-medium">Versão</th>
                          <th className="py-2 pr-4 font-medium">Geradas</th>
                          <th className="py-2 pr-4 font-medium">Editadas</th>
                          <th className="py-2 pr-4 font-medium">Aprovadas</th>
                          <th className="py-2 pr-4 font-medium">Enviadas</th>
                          <th className="py-2 pr-4 font-medium">Rejeitadas</th>
                          <th className="py-2 font-medium">Ganhas</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.strategies.map((strategy) => (
                          <tr
                            key={`${strategy.strategy_id}-${strategy.strategy_version ?? 0}`}
                            className="border-t"
                          >
                            <td className="py-2 pr-4">{strategy.name ?? "Estratégia removida"}</td>
                            <td className="py-2 pr-4">
                              <div className="flex items-center gap-2">
                                v{strategy.strategy_version ?? "?"}
                                {strategy.current_version !== null &&
                                strategy.strategy_version !== strategy.current_version ? (
                                  <Badge variant="outline">versão antiga</Badge>
                                ) : null}
                              </div>
                            </td>
                            <td className="py-2 pr-4">{strategy.generated}</td>
                            <td className="py-2 pr-4">{strategy.edited}</td>
                            <td className="py-2 pr-4">{strategy.approved}</td>
                            <td className="py-2 pr-4">{strategy.sent}</td>
                            <td className="py-2 pr-4">{strategy.rejected}</td>
                            <td className="py-2">{strategy.won_opportunities}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Activity className="size-4" />
                  Saúde operacional
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Metric label="Ações pendentes" value={data.health.actions_pending} />
                  <Metric label="Fila atrasada" value={data.health.actions_overdue} />
                  <Metric label="Falhas de envio (24h)" value={data.health.actions_failed_24h} />
                  <Metric label="Bloqueadas/puladas (24h)" value={data.health.actions_blocked_24h} />
                  <Metric label="Análises de IA na fila" value={data.health.ai_jobs_pending} />
                  <Metric
                    label="Falhas de IA (24h)"
                    value={data.health.ai_jobs_failed_24h + data.health.ai_calls_failed_24h}
                  />
                  <Metric label="Custo de IA (30 dias)" value={`US$ ${data.health.ai_cost_30d}`} />
                  <Metric label="Itens na Central de Atenção" value={data.health.attention_open} />
                </div>
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">
                    Último evento recebido por webhook:{" "}
                    {data.health.webhook_last_event_at
                      ? formatDateTime(data.health.webhook_last_event_at)
                      : "nunca"}
                  </p>
                  {data.health.connections.map((connection) => (
                    <div
                      key={connection.id}
                      className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-sm"
                    >
                      <Badge variant={connection.status === "connected" ? "default" : "destructive"}>
                        {connection.status}
                      </Badge>
                      <span>{connection.display_name ?? connection.phone_number ?? "Conexão"}</span>
                      <span className="text-xs text-muted-foreground">
                        último evento:{" "}
                        {connection.last_event_at
                          ? formatDateTime(connection.last_event_at)
                          : "nunca"}
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Download className="size-4" />
                  Exportar CSV
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex flex-wrap gap-2">
                  {(Object.keys(EXPORT_LABELS) as AnalyticsExportDataset[]).map((dataset) => (
                    <Button
                      key={dataset}
                      variant="outline"
                      size="sm"
                      disabled={exportMutation.isPending}
                      onClick={() => exportMutation.mutate(dataset)}
                    >
                      {EXPORT_LABELS[dataset]}
                    </Button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  Exporta apenas os seus dados e somente campos de negócio — sem credenciais,
                  tokens ou conteúdo técnico de integração. Limite de 5.000 linhas por arquivo.
                </p>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </AppShell>
  );
}
