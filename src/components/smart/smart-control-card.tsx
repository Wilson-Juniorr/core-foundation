import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AudioLines, Brain, Check, Gauge, UserCheck, X } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { formatDateTime } from "@/lib/domain/datetime";
import {
  approveSmartActionFn,
  completeCommitmentFn,
  rejectSmartActionFn,
} from "@/lib/smart.functions";
import { conversationSmartQuery, smartKeys } from "@/lib/smart.queries";
import {
  AUTONOMY_LABELS,
  COMMITMENT_RESPONSIBLE_LABELS,
  CONTROL_STATE_LABELS,
  NEXT_RESPONSIBLE_LABELS,
  OWNER_LABELS,
  SMART_RUN_STATE_LABELS,
  SMART_STRATEGY_META,
  pressureLabel,
} from "@/lib/smart/types";
import type { SmartStrategy } from "@/lib/smart/types";

/**
 * Painel do acompanhamento inteligente: mostra quem está com a bola,
 * compromissos assumidos e mensagens que aguardam sua aprovação.
 */
export function SmartControlCard({ conversationId }: { conversationId: string | null }) {
  const queryClient = useQueryClient();
  const [edits, setEdits] = useState<Record<string, string>>({});
  const smart = useQuery(conversationSmartQuery(conversationId));

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: smartKeys.root });
    await queryClient.invalidateQueries({ queryKey: ["followup"] });
  };

  const approve = useMutation({
    mutationFn: (input: { actionId: string; content: string | null }) =>
      approveSmartActionFn({ data: input }),
    onSuccess: async () => {
      await invalidate();
      toast.success("Mensagem aprovada — será enviada após a checagem de contexto.");
    },
    onError: (error: Error) => toast.error(error.message || "Não foi possível aprovar."),
  });

  const reject = useMutation({
    mutationFn: (actionId: string) => rejectSmartActionFn({ data: { actionId } }),
    onSuccess: async () => {
      await invalidate();
      toast.success("Mensagem descartada.");
    },
    onError: () => toast.error("Não foi possível descartar."),
  });

  const finishCommitment = useMutation({
    mutationFn: (commitmentId: string) => completeCommitmentFn({ data: { commitmentId } }),
    onSuccess: async () => {
      await invalidate();
      toast.success("Compromisso marcado como cumprido.");
    },
    onError: () => toast.error("Não foi possível atualizar o compromisso."),
  });

  const control = smart.data?.control ?? null;
  const run = smart.data?.run ?? null;
  const commitments = smart.data?.commitments ?? [];
  const pending = (smart.data?.pending ?? []).filter(
    (item) => item.requires_approval || item.is_stale,
  );

  if (!conversationId) return null;
  if (!control && !run && commitments.length === 0 && pending.length === 0) return null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Brain className="size-4" /> Acompanhamento inteligente
        </CardTitle>
        {run && <Badge variant="secondary">{AUTONOMY_LABELS[run.autonomy]}</Badge>}
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {control && (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">
                <UserCheck className="mr-1 size-3" />
                Com a bola: {NEXT_RESPONSIBLE_LABELS[control.next_responsible]}
              </Badge>
              <Badge variant="outline">{CONTROL_STATE_LABELS[control.state]}</Badge>
              <Badge variant="outline">Controle: {OWNER_LABELS[control.owner]}</Badge>
              <Badge variant="outline">
                <Gauge className="mr-1 size-3" />
                Pressão {pressureLabel(control.pressure_score)}
              </Badge>
              {control.audio_context_unknown && (
                <Badge variant="destructive">
                  <AudioLines className="mr-1 size-3" /> Áudio não entendido
                </Badge>
              )}
            </div>
            {control.next_responsible_reason && (
              <p className="text-muted-foreground">{control.next_responsible_reason}</p>
            )}
            {run?.smart_state && (
              <p className="text-muted-foreground">
                Situação: {SMART_RUN_STATE_LABELS[run.smart_state]}
                {run.next_evaluation_at
                  ? ` · próxima avaliação em ${formatDateTime(run.next_evaluation_at)}`
                  : ""}
              </p>
            )}
          </div>
        )}

        {commitments.length > 0 && (
          <div className="space-y-2 border-t pt-3">
            <p className="text-xs font-medium tracking-wide uppercase">Compromissos em aberto</p>
            <ul className="space-y-2">
              {commitments.map((item) => (
                <li key={item.id} className="flex items-start justify-between gap-3">
                  <div>
                    <p>{item.description}</p>
                    <p className="text-muted-foreground text-xs">
                      {COMMITMENT_RESPONSIBLE_LABELS[item.responsible]}
                      {item.due_at ? ` · até ${formatDateTime(item.due_at)}` : ""}
                      {item.is_ambiguous ? " · prazo impreciso" : ""}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => finishCommitment.mutate(item.id)}
                    disabled={finishCommitment.isPending}
                  >
                    <Check className="mr-1 size-4" /> Cumprido
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {pending.length > 0 && (
          <div className="space-y-3 border-t pt-3">
            <p className="text-xs font-medium tracking-wide uppercase">Aguardando sua aprovação</p>
            {pending.map((item) => {
              const strategy = item.smart_strategy as SmartStrategy | null;
              return (
                <div key={item.id} className="space-y-2 rounded-md border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    {strategy && SMART_STRATEGY_META[strategy] && (
                      <Badge variant="secondary">{SMART_STRATEGY_META[strategy].label}</Badge>
                    )}
                    {item.is_stale && <Badge variant="destructive">Contexto mudou</Badge>}
                  </div>
                  {item.decision_reason && (
                    <p className="text-muted-foreground text-xs">{item.decision_reason}</p>
                  )}
                  <Textarea
                    rows={3}
                    value={edits[item.id] ?? item.content ?? ""}
                    onChange={(event) =>
                      setEdits((current) => ({ ...current, [item.id]: event.target.value }))
                    }
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      onClick={() =>
                        approve.mutate({
                          actionId: item.id,
                          content: edits[item.id] ?? item.content ?? null,
                        })
                      }
                      disabled={approve.isPending}
                    >
                      <Check className="mr-1 size-4" /> Aprovar e enviar
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => reject.mutate(item.id)}
                      disabled={reject.isPending}
                    >
                      <X className="mr-1 size-4" /> Descartar
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
