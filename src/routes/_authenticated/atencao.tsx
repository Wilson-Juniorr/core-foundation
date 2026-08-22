import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { AttentionCard } from "@/components/attention/attention-card";
import { EmptyState, ErrorState, LoadingState } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { syncAttentionNow } from "@/lib/attention.functions";
import { attentionKeys, attentionQuery } from "@/lib/attention.queries";
import { BUCKET_LABELS } from "@/lib/attention/labels";
import type { AttentionBucket, AttentionStatus } from "@/lib/attention/types";

const TABS: { value: string; label: string }[] = [
  { value: "now", label: BUCKET_LABELS.now },
  { value: "today", label: BUCKET_LABELS.today },
  { value: "overdue", label: BUCKET_LABELS.overdue },
  { value: "waiting", label: BUCKET_LABELS.waiting },
  { value: "snoozed", label: "Adiados" },
  { value: "all", label: "Tudo" },
];

export const Route = createFileRoute("/_authenticated/atencao")({
  head: () => ({
    meta: [
      { title: "Precisa de Mim — Próximo Passo" },
      {
        name: "description",
        content:
          "A fila operacional com prioridade explicada: o que precisa de você agora, hoje e o que está atrasado.",
      },
      { property: "og:title", content: "Precisa de Mim — Próximo Passo" },
      {
        property: "og:description",
        content: "Fila priorizada de clientes que precisam da sua atenção agora.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AttentionPage,
});

function AttentionPage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState("now");

  const status: AttentionStatus | null = tab === "snoozed" ? "snoozed" : null;
  const bucket: AttentionBucket | null =
    tab === "snoozed" || tab === "all" ? null : (tab as AttentionBucket);

  const attention = useQuery(attentionQuery({ status, bucket }));

  const sync = useMutation({
    mutationFn: () => syncAttentionNow(),
    onSuccess: (result) => {
      toast.success(
        `Central atualizada: ${result.created} novo(s), ${result.autoResolved} fechado(s) automaticamente.`,
      );
      void queryClient.invalidateQueries({ queryKey: attentionKeys.root });
    },
    onError: (error: Error) => toast.error(error.message || "Não foi possível atualizar."),
  });

  const counts = attention.data?.counts;

  return (
    <AppShell
      title="Precisa de Mim"
      description="A fila do que depende de você, com a prioridade sempre explicada."
      actions={
        <Button variant="outline" onClick={() => sync.mutate()} disabled={sync.isPending}>
          {sync.isPending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <RefreshCw className="size-4" />
          )}
          Recalcular
        </Button>
      }
    >
      <div className="space-y-6">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="flex-wrap">
            {TABS.map((item) => {
              const count =
                item.value === "snoozed"
                  ? counts?.snoozed
                  : item.value === "all"
                    ? undefined
                    : counts?.[item.value as keyof typeof counts];
              return (
                <TabsTrigger key={item.value} value={item.value}>
                  {item.label}
                  {typeof count === "number" && count > 0 ? (
                    <span className="ml-1.5 rounded bg-secondary px-1.5 text-xs">{count}</span>
                  ) : null}
                </TabsTrigger>
              );
            })}
          </TabsList>
        </Tabs>

        {attention.isPending ? (
          <LoadingState rows={4} />
        ) : attention.isError ? (
          <ErrorState onRetry={() => attention.refetch()} />
        ) : attention.data.items.length === 0 ? (
          <EmptyState
            title="Nada exige você aqui"
            description="Nenhum item nesta fila. Quando um cliente responder, um prazo vencer ou uma automação falhar, o item aparece aqui automaticamente."
          />
        ) : (
          <div className="space-y-4">
            {attention.data.items.map((item) => (
              <AttentionCard key={item.id} item={item} />
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
