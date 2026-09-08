import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Check, Loader2, X } from "lucide-react";
import { toast } from "sonner";

import { EmptyState, ErrorState, LoadingState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { formatDateTime } from "@/lib/domain/datetime";
import { approveSmartActionFn, rejectSmartActionFn } from "@/lib/smart.functions";
import { smartApprovalsQuery, smartKeys } from "@/lib/smart.queries";
import { followupKeys } from "@/lib/followup.queries";
import { SMART_STRATEGY_META } from "@/lib/smart/types";

/** Fila de mensagens inteligentes que só saem depois da sua aprovação. */
export function SmartApprovalsList() {
  const queryClient = useQueryClient();
  const approvals = useQuery(smartApprovalsQuery());
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: smartKeys.root });
    await queryClient.invalidateQueries({ queryKey: followupKeys.root });
  };

  const approve = useMutation({
    mutationFn: (input: { actionId: string; content: string | null }) =>
      approveSmartActionFn({ data: input }),
    onSuccess: async () => {
      await invalidate();
      toast.success("Mensagem aprovada. Ela é enviada no próximo ciclo, se o contexto permitir.");
    },
    onError: (error: Error) => toast.error(error.message || "Não foi possível aprovar."),
    onSettled: () => setBusyId(null),
  });

  const reject = useMutation({
    mutationFn: (actionId: string) => rejectSmartActionFn({ data: { actionId, content: null } }),
    onSuccess: async () => {
      await invalidate();
      toast.success("Mensagem descartada.");
    },
    onError: (error: Error) => toast.error(error.message || "Não foi possível descartar."),
    onSettled: () => setBusyId(null),
  });

  if (approvals.isLoading) return <LoadingState />;
  if (approvals.isError) return <ErrorState onRetry={() => approvals.refetch()} />;

  const items = approvals.data ?? [];
  if (items.length === 0) {
    return (
      <EmptyState
        title="Nenhuma mensagem esperando você"
        description="Quando a automação preparar uma mensagem que precisa da sua aprovação, ela aparece aqui."
      />
    );
  }

  return (
    <ul className="space-y-3">
      {items.map((item) => {
        const value = edits[item.id] ?? item.content ?? "";
        const busy = busyId === item.id;
        return (
          <li key={item.id} className="space-y-3 rounded-md border p-3">
            <div className="flex flex-wrap items-center gap-2">
              {item.contact_id ? (
                <Link
                  to="/clientes/$contactId"
                  params={{ contactId: item.contact_id }}
                  className="font-medium hover:underline"
                >
                  {item.contact_name ?? "Cliente"}
                </Link>
              ) : (
                <span className="font-medium">{item.contact_name ?? "Cliente"}</span>
              )}
              {item.strategy && (
                <Badge variant="secondary">
                  {SMART_STRATEGY_META[item.strategy as keyof typeof SMART_STRATEGY_META]?.label ??
                    item.strategy}
                </Badge>
              )}
              {item.is_stale && <Badge variant="outline">Contexto mudou — revise</Badge>}
              <span className="text-muted-foreground text-xs">
                preparada para {formatDateTime(item.scheduled_for)}
              </span>
            </div>

            <Textarea
              value={value}
              rows={4}
              onChange={(event) => setEdits((prev) => ({ ...prev, [item.id]: event.target.value }))}
              aria-label="Mensagem que será enviada"
            />

            {item.decision_reason && (
              <p className="text-muted-foreground text-xs">Motivo: {item.decision_reason}</p>
            )}

            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                disabled={busy || value.trim().length === 0}
                onClick={() => {
                  setBusyId(item.id);
                  approve.mutate({ actionId: item.id, content: value.trim() });
                }}
              >
                {busy && approve.isPending ? (
                  <Loader2 className="mr-1 size-4 animate-spin" />
                ) : (
                  <Check className="mr-1 size-4" />
                )}
                Aprovar e enviar
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  setBusyId(item.id);
                  reject.mutate(item.id);
                }}
              >
                <X className="mr-1 size-4" /> Descartar
              </Button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
