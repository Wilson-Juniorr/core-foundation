import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { AttentionCard } from "@/components/attention/attention-card";
import { EmptyState, ErrorState, LoadingState } from "@/components/states";
import { NextActionBadge } from "@/components/next-action-badge";
import { Button } from "@/components/ui/button";
import { operationalDashboardQuery } from "@/lib/attention.queries";
import { dashboardQuery, opportunitiesQuery, pipelineStagesQuery } from "@/lib/crm.queries";
import { formatCurrency } from "@/lib/domain/opportunity-status";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Visão geral — Próximo Passo" },
      {
        name: "description",
        content: "Sua fila operacional: quem espera por você, o que está atrasado e o que falhou.",
      },
      { property: "og:title", content: "Visão geral — Próximo Passo" },
      {
        property: "og:description",
        content: "Sua fila operacional: quem espera por você, o que está atrasado e o que falhou.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: DashboardPage,
});

/** Sempre dois dígitos: telemetria não deve "pular" de largura. */
function pad(value: number) {
  return value < 10 ? `0${value}` : String(value);
}

/** Célula de telemetria: rótulo micro em caixa-alta, número em destaque. */
function Telemetry({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: number;
  tone?: "neutral" | "signal" | "danger";
}) {
  const active = value > 0;
  const border =
    tone === "danger" && active
      ? "border-destructive/40"
      : tone === "signal" && active
        ? "border-signal/30"
        : "border-border";
  const numberTone =
    tone === "danger" && active
      ? "text-destructive"
      : tone === "signal" && active
        ? "text-signal"
        : "text-foreground";

  return (
    <div className={`bg-card relative overflow-hidden border ${border} p-4`}>
      <p className="label-tech">{label}</p>
      <p className={`font-display numeric mt-1 text-3xl font-bold ${numberTone}`}>{pad(value)}</p>
      <div className="bg-border mt-3 h-px w-full" />
    </div>
  );
}

function DashboardPage() {
  const operational = useQuery(operationalDashboardQuery());
  const dashboard = useQuery(dashboardQuery());
  const stages = useQuery(pipelineStagesQuery());
  const opportunities = useQuery(opportunitiesQuery());

  const openOpportunities = (opportunities.data ?? []).filter((item) => item.status === "open");

  return (
    <AppShell
      title="Visão geral"
      description="O estado operacional do seu acompanhamento comercial."
      actions={
        <Button asChild>
          <Link to="/atencao">
            Precisa de Mim
            <ArrowRight className="size-4" />
          </Link>
        </Button>
      }
    >
      {operational.isPending ? (
        <LoadingState rows={4} />
      ) : operational.isError ? (
        <ErrorState onRetry={() => operational.refetch()} />
      ) : (
        <div className="space-y-6">
          {/* Faixa de telemetria: o estado da operação em uma leitura. */}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Telemetry
              label="Aguardando você"
              value={operational.data.waitingOnYou}
              tone="signal"
            />
            <Telemetry label="Atrasados" value={operational.data.overdue} tone="danger" />
            <Telemetry label="Em acompanhamento" value={operational.data.followingUp} />
            <Telemetry label="Automações agendadas" value={operational.data.scheduledAutomations} />
            <Telemetry
              label="Sem próxima ação"
              value={operational.data.withoutNextAction}
              tone="danger"
            />
            <Telemetry label="Respostas 24h" value={operational.data.recentReplies} tone="signal" />
            <Telemetry label="Falhas de envio" value={operational.data.failures} tone="danger" />
            <Telemetry label="Clientes ativos" value={dashboard.data?.activeContacts ?? 0} />
          </div>

          <div className="grid gap-6 lg:grid-cols-12">
            {/* Coluna primária: a fila de ação de agora. */}
            <section className="space-y-3 lg:col-span-5">
              <div className="flex items-center justify-between">
                <h2 className="font-display text-base font-semibold tracking-tight">
                  Prioridade crítica agora
                </h2>
                <span className="border-signal/30 bg-signal/10 text-signal flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-widest uppercase">
                  <span className="bg-signal size-1.5 rounded-full" aria-hidden />
                  Ao vivo
                </span>
              </div>

              {operational.data.criticalItems.length === 0 ? (
                <EmptyState
                  title="Nada crítico no momento"
                  description="Nenhum item de prioridade crítica. Confira a fila completa para o que é importante, mas pode esperar."
                />
              ) : (
                <div className="space-y-3">
                  {operational.data.criticalItems.map((item) => (
                    <AttentionCard key={item.id} item={item} />
                  ))}
                </div>
              )}

              <Button asChild variant="outline" size="sm" className="w-full">
                <Link to="/atencao">Ver fila completa</Link>
              </Button>

              {/* Estado dos follow-ups automáticos. */}
              <div className="grid grid-cols-3 gap-2 pt-1">
                <div className="bg-card border-signal border-l-2 p-3">
                  <p className="label-tech">Em curso</p>
                  <p className="numeric text-lg font-bold">{pad(operational.data.followingUp)}</p>
                </div>
                <div className="bg-card border-l-2 border-[var(--warning)] p-3">
                  <p className="label-tech">Agendados</p>
                  <p className="numeric text-lg font-bold">
                    {pad(operational.data.scheduledAutomations)}
                  </p>
                </div>
                <div className="bg-card border-destructive border-l-2 p-3">
                  <p className="label-tech">Falhas</p>
                  <p className="numeric text-lg font-bold">{pad(operational.data.failures)}</p>
                </div>
              </div>
            </section>

            {/* Trilha compacta do pipeline. */}
            <section className="space-y-3 lg:col-span-7">
              <div className="flex items-center justify-between">
                <h2 className="font-display text-base font-semibold tracking-tight">
                  Pipeline comercial
                </h2>
                <Button asChild variant="ghost" size="sm">
                  <Link to="/pipeline">Abrir quadro</Link>
                </Button>
              </div>

              {stages.isPending || opportunities.isPending ? (
                <LoadingState rows={3} />
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  {(stages.data ?? []).map((stage) => {
                    const items = openOpportunities.filter(
                      (item) => item.pipeline_stage_id === stage.id,
                    );
                    return (
                      <div key={stage.id} className="space-y-2">
                        <div className="border-border flex items-center justify-between border-b pb-2">
                          <span className="label-tech">{stage.name}</span>
                          <span className="numeric bg-secondary text-muted-foreground px-1 text-[10px]">
                            {pad(items.length)}
                          </span>
                        </div>
                        {items.slice(0, 4).map((item) => (
                          <Link
                            key={item.id}
                            to="/clientes/$contactId"
                            params={{ contactId: item.contact_id }}
                            className="bg-card hover:border-signal/50 block border p-3 transition-colors"
                          >
                            <p className="truncate text-xs font-semibold">{item.contact_name}</p>
                            <p className="text-signal numeric mt-1 text-[10px]">
                              {formatCurrency(item.estimated_value)}
                            </p>
                          </Link>
                        ))}
                        {items.length === 0 ? (
                          <p className="text-muted-foreground/60 px-1 text-[10px]">Vazio</p>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Oportunidades sem próximo passo, em formato de registro. */}
              <div className="space-y-2 pt-2">
                <h3 className="font-display text-sm font-semibold tracking-tight">
                  Sem próximo passo definido
                </h3>
                {dashboard.isPending ? (
                  <LoadingState rows={2} />
                ) : dashboard.isError ? (
                  <ErrorState onRetry={() => dashboard.refetch()} />
                ) : dashboard.data.attention.length === 0 ? (
                  <EmptyState
                    title="Nada pendente por aqui"
                    description="Todas as oportunidades abertas têm uma próxima ação agendada."
                  />
                ) : (
                  <ul className="bg-card divide-border divide-y border">
                    {dashboard.data.attention.map((opportunity) => (
                      <li key={opportunity.id}>
                        <Link
                          to="/clientes/$contactId"
                          params={{ contactId: opportunity.contact_id }}
                          className="hover:bg-secondary/50 flex flex-wrap items-center justify-between gap-3 px-4 py-3 transition-colors"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">{opportunity.title}</p>
                            <p className="text-muted-foreground truncate text-xs">
                              {opportunity.contact_name} · {opportunity.stage_name} ·{" "}
                              {formatCurrency(opportunity.estimated_value)}
                            </p>
                          </div>
                          <NextActionBadge nextActionAt={opportunity.next_action_at} withDate />
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
          </div>
        </div>
      )}
    </AppShell>
  );
}
