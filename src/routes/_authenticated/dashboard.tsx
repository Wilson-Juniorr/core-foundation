import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";

import { AppShell } from "@/components/app-shell";
import { EmptyState, ErrorState, LoadingState } from "@/components/states";
import { NextActionBadge } from "@/components/next-action-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { dashboardQuery } from "@/lib/crm.queries";
import { formatCurrency } from "@/lib/domain/opportunity-status";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Visão geral — Próximo Passo" },
      {
        name: "description",
        content: "Indicadores do seu acompanhamento comercial e o que precisa de atenção hoje.",
      },
      { property: "og:title", content: "Visão geral — Próximo Passo" },
      {
        property: "og:description",
        content: "Indicadores do seu acompanhamento comercial e o que precisa de atenção hoje.",
      },
    ],
  }),
  component: DashboardPage,
});

function MetricCard({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="font-display text-3xl font-semibold">{value}</p>
      </CardContent>
    </Card>
  );
}

function DashboardPage() {
  const dashboard = useQuery(dashboardQuery());

  return (
    <AppShell title="Visão geral" description="O estado atual do seu acompanhamento comercial.">
      {dashboard.isPending ? (
        <LoadingState rows={4} />
      ) : dashboard.isError ? (
        <ErrorState onRetry={() => dashboard.refetch()} />
      ) : (
        <div className="space-y-8">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard label="Clientes ativos" value={dashboard.data.activeContacts} />
            <MetricCard label="Oportunidades abertas" value={dashboard.data.openOpportunities} />
            <MetricCard label="Sem próxima ação" value={dashboard.data.withoutNextAction} />
            <MetricCard label="Ações para hoje" value={dashboard.data.dueToday} />
          </div>

          <section className="space-y-4">
            <div>
              <h2 className="text-base font-semibold">Precisa de atenção</h2>
              <p className="text-sm text-muted-foreground">
                Oportunidades abertas sem próxima ação definida ou com ação atrasada.
              </p>
            </div>

            {dashboard.data.attention.length === 0 ? (
              <EmptyState
                title="Nada pendente por aqui"
                description="Todas as oportunidades abertas têm uma próxima ação agendada. Bom trabalho."
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
