import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { startSmartFlowFn } from "@/lib/smart.functions";
import { smartFlowsQuery, smartKeys } from "@/lib/smart.queries";
import { AUTONOMY_LABELS } from "@/lib/smart/types";

/** Inicia um acompanhamento inteligente para o cliente. */
export function StartSmartFlowDialog({
  open,
  onOpenChange,
  contactId,
  conversationId,
  opportunityId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contactId: string;
  conversationId: string | null;
  opportunityId?: string | null;
}) {
  const queryClient = useQueryClient();
  const flows = useQuery(smartFlowsQuery());
  const [flowId, setFlowId] = useState<string | null>(null);

  const active = (flows.data ?? []).filter((flow) => flow.is_active);

  useEffect(() => {
    const first = active[0];
    if (open && !flowId && first) setFlowId(first.id);
  }, [open, flowId, active]);

  const start = useMutation({
    mutationFn: () =>
      startSmartFlowFn({
        data: {
          flowId: flowId as string,
          contactId,
          conversationId: conversationId ?? null,
          opportunityId: opportunityId ?? null,
        },
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: smartKeys.root });
      await queryClient.invalidateQueries({ queryKey: ["followup"] });
      toast.success("Acompanhamento inteligente iniciado.");
      onOpenChange(false);
    },
    onError: (error: Error) => toast.error(error.message || "Não foi possível iniciar."),
  });

  const selected = active.find((flow) => flow.id === flowId) ?? null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Acompanhamento inteligente</DialogTitle>
          <DialogDescription>
            A automação decide quando falar dentro das regras do fluxo escolhido.
          </DialogDescription>
        </DialogHeader>

        {active.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            Nenhum fluxo inteligente ativo. Crie um em Follow-ups &gt; Inteligentes.
          </p>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Fluxo</Label>
              <Select value={flowId ?? ""} onValueChange={(value) => setFlowId(value)}>
                <SelectTrigger>
                  <SelectValue placeholder="Escolha o fluxo" />
                </SelectTrigger>
                <SelectContent>
                  {active.map((flow) => (
                    <SelectItem key={flow.id} value={flow.id}>
                      {flow.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {selected && (
              <div className="text-muted-foreground space-y-1 text-sm">
                <p>Objetivo: {selected.config.goal}</p>
                <p>
                  {AUTONOMY_LABELS[selected.config.autonomy]} · até{" "}
                  {selected.config.max_duration_days} dias · máximo{" "}
                  {selected.config.max_actions_per_week} ações por semana
                </p>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={() => start.mutate()} disabled={!flowId || start.isPending}>
            Iniciar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
