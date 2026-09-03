import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { NextActionBadge } from "@/components/next-action-badge";
import { EmptyState, ErrorState, LoadingState } from "@/components/states";
import { updateOpportunity } from "@/lib/crm.functions";
import { crmKeys, opportunitiesQuery, pipelineStagesQuery } from "@/lib/crm.queries";
import type { OpportunityWithRelations } from "@/lib/crm.types";
import { formatCurrency } from "@/lib/domain/opportunity-status";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/pipeline")({
  head: () => ({
    meta: [
      { title: "Pipeline — Próximo Passo" },
      {
        name: "description",
        content: "Kanban das oportunidades abertas por etapa, com próxima ação sempre visível.",
      },
      { property: "og:title", content: "Pipeline — Próximo Passo" },
      {
        property: "og:description",
        content: "Kanban das oportunidades abertas por etapa, com próxima ação sempre visível.",
      },
    ],
  }),
  component: PipelinePage,
});

/** Faixas coloridas das etapas, na ordem do kanban (referência Bitrix24). */
const STAGE_COLORS = [
  "#f1b62c",
  "#e8a03c",
  "#f07f4a",
  "#4ab4e8",
  "#3d8fd6",
  "#7b8fd6",
  "#5bbf7a",
  "#3fae8f",
] as const;

function PipelinePage() {
  const queryClient = useQueryClient();
  const stages = useQuery(pipelineStagesQuery());
  const opportunities = useQuery(opportunitiesQuery());
  const update = useServerFn(updateOpportunity);
  const [dragOverStage, setDragOverStage] = useState<string | null>(null);

  const moveMutation = useMutation({
    mutationFn: (input: { id: string; pipeline_stage_id: string; stage_name: string }) =>
      update({ data: { id: input.id, pipeline_stage_id: input.pipeline_stage_id } }),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: crmKeys.opportunities });
      const previous = queryClient.getQueryData<OpportunityWithRelations[]>(crmKeys.opportunities);
      queryClient.setQueryData<OpportunityWithRelations[]>(crmKeys.opportunities, (current) =>
        (current ?? []).map((item) =>
          item.id === input.id
            ? { ...item, pipeline_stage_id: input.pipeline_stage_id, stage_name: input.stage_name }
            : item,
        ),
      );
      return { previous };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["opportunities"] });
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success("Oportunidade movida");
    },
    onError: (_error, _input, context) => {
      if (context?.previous) {
        queryClient.setQueryData(crmKeys.opportunities, context.previous);
      }
      toast.error("Não foi possível mover a oportunidade. Etapa anterior restaurada.");
    },
  });

  const isPending = stages.isPending || opportunities.isPending;
  const isError = stages.isError || opportunities.isError;

  return (
    <AppShell
      title="Pipeline"
      description="Arraste as oportunidades entre etapas para atualizar a negociação."
    >
      {isPending ? (
        <LoadingState rows={3} />
      ) : isError ? (
        <ErrorState
          onRetry={() => {
            stages.refetch();
            opportunities.refetch();
          }}
        />
      ) : (stages.data ?? []).length === 0 ? (
        <EmptyState
          title="Nenhuma etapa configurada"
          description="As etapas padrão são criadas junto com a conta. Recarregue a página em instantes."
        />
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-4">
          {(stages.data ?? []).map((stage, stageIndex) => {
            const stageOpportunities = (opportunities.data ?? []).filter(
              (opportunity) =>
                opportunity.pipeline_stage_id === stage.id && opportunity.status === "open",
            );
            const stageTotal = stageOpportunities.reduce(
              (sum, item) => sum + (item.estimated_value ?? 0),
              0,
            );
            const stageColor = STAGE_COLORS[stageIndex % STAGE_COLORS.length];

            return (
              <div
                key={stage.id}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragOverStage(stage.id);
                }}
                onDragLeave={() =>
                  setDragOverStage((current) => (current === stage.id ? null : current))
                }
                onDrop={(event) => {
                  event.preventDefault();
                  setDragOverStage(null);
                  const id = event.dataTransfer.getData("text/plain");
                  const dragged = (opportunities.data ?? []).find((item) => item.id === id);
                  if (!dragged || dragged.pipeline_stage_id === stage.id) return;
                  moveMutation.mutate({
                    id,
                    pipeline_stage_id: stage.id,
                    stage_name: stage.name,
                  });
                }}
                className={cn(
                  "flex w-72 shrink-0 flex-col gap-2 transition-colors",
                  dragOverStage === stage.id && "rounded-md ring-2 ring-ring",
                )}
              >
                {/* Faixa da etapa: cor sólida, nome e contagem — leitura Bitrix. */}
                <div
                  className="flex items-center justify-between rounded-sm px-3 py-2 text-xs font-bold tracking-wide text-white uppercase"
                  style={{ backgroundColor: stageColor }}
                >
                  <span className="truncate">{stage.name}</span>
                  <span className="ml-2 shrink-0 opacity-90">{stageOpportunities.length}</span>
                </div>

                <p className="text-muted-foreground text-center text-xs font-semibold">
                  {formatCurrency(stageTotal)}
                </p>

                <div className="flex flex-col gap-2">
                  {stageOpportunities.length === 0 ? (
                    <p className="text-muted-foreground rounded-md border border-dashed px-3 py-6 text-center text-xs">
                      Nenhuma oportunidade
                    </p>
                  ) : (
                    stageOpportunities.map((opportunity) => (
                      <article
                        key={opportunity.id}
                        draggable
                        onDragStart={(event) =>
                          event.dataTransfer.setData("text/plain", opportunity.id)
                        }
                        className="bg-card cursor-grab rounded-sm border p-3 shadow-sm transition-shadow hover:shadow-md active:cursor-grabbing"
                      >
                        <Link
                          to="/clientes/$contactId"
                          params={{ contactId: opportunity.contact_id }}
                          className="block"
                        >
                          <p className="truncate text-sm font-semibold">{opportunity.title}</p>
                          <p className="text-foreground mt-1 text-sm font-bold">
                            {formatCurrency(opportunity.estimated_value)}
                          </p>
                          <p className="text-primary mt-1 truncate text-xs">
                            {opportunity.contact_name}
                          </p>
                          <NextActionBadge
                            nextActionAt={opportunity.next_action_at}
                            className="mt-3"
                          />
                        </Link>
                      </article>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </AppShell>
  );
}
