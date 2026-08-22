import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { AttentionCard } from "@/components/attention/attention-card";
import { EmptyState, ErrorState, LoadingState } from "@/components/states";
import { NextActionBadge } from "@/components/next-action-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { operationalDashboardQuery } from "@/lib/attention.queries";
import { dashboardQuery } from "@/lib/crm.queries";
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

function MetricCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "danger" | "default";
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <p
          className={`font-display text-3xl font-semibold ${
            tone === "danger" && value > 0 ? "text-destructive" : ""
          }`}
        >
          {value}
        </p>
      </CardContent>
    </Card>
  );
}

function DashboardPage() {
  const operational = useQuery(operationalDashboardQuery());
  const dashboard = useQuery(dashboardQuery());

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
        <div className="space-y-8">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard label="Aguardando você" value={operational.data.waitingOnYou} />
            <MetricCard label="Atrasados" value={operational.data.overdue} tone="danger" />
            <MetricCard label="Em acompanhamento" value={operational.data.followingUp} />
            <MetricCard
              label="Automações programadas"
              value={operational.data.scheduledAutomations}
            />
            <MetricCard label="Sem próxima ação" value={operational.data.withoutNextAction} />
            <MetricCard label="Respostas nas últimas 24h" value={operational.data.recentReplies} />
            <MetricCard label="Falhas de envio" value={operational.data.failures} tone="danger" />
            <MetricCard
              label="Clientes ativos"
              value={dashboard.data?.activeContacts ?? 0}
            />
          </div>

          <section className="space-y-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold">Prioridade crítica agora</h2>
                <p className="text-sm text-muted-foreground">
                  Itens que não podem esperar, com a prioridade explicada.
                </p>
              </div>
              <Button asChild variant="outline" size="sm">
                <Link to="/atencao">Ver fila completa</Link>
              </Button>
            </div>

            {operational.data.criticalItems.length === 0 ? (
              <EmptyState
                title="Nada crítico no momento"
                description="Nenhum item de prioridade crítica. Confira a fila completa para o que é importante, mas pode esperar."
              />
            ) : (
              <div className="space-y-4">
                {operational.data.criticalItems.map((item) => (
                  <AttentionCard key={item.id} item={item} />
                ))}
              </div>
            )}
          </section>

          <section className="space-y-4">
            <div>
              <h2 className="text-base font-semibold">Oportunidades sem próximo passo</h2>
              <p className="text-sm text-muted-foreground">
                Negociações abertas sem próxima ação definida ou com ação atrasada.
              </p>
            </div>

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
              <ul className="divide-y rounded-lg border">
                {dashboard.data.attention.map((opportunity) => (
                  <li key={opportunity.id}>
                    <Link
                      to="/clientes/$contactId"
                      params={{ contactId: opportunity.contact_id }}
                      className="flex flex-wrap items-center justify-between gap-3 px-4 py-4 transition-colors hover:bg-secondary/50"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-medium">{opportunity.title}</p>
                        <p className="truncate text-sm text-muted-foreground">
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
          </section>
        </div>
      )}
    </AppShell>
  );
}
