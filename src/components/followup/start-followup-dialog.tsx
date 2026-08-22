import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
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
import { formatDateTime } from "@/lib/domain/datetime";
import { startFollowupFlow } from "@/lib/followup.functions";
import { flowPreviewQuery, flowsQuery, followupKeys } from "@/lib/followup.queries";
import { ACTION_TYPE_LABELS } from "@/lib/followup/labels";

export function StartFollowupDialog({
  open,
  onOpenChange,
  contactId,
  conversationId,
  opportunityId,
  hasActiveRun,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contactId: string;
  conversationId: string | null;
  opportunityId?: string | null;
  hasActiveRun: boolean;
}) {
  const queryClient = useQueryClient();
  const flows = useQuery(flowsQuery());
  const [flowId, setFlowId] = useState<string | null>(null);
  const preview = useQuery({ ...flowPreviewQuery(flowId), enabled: open && Boolean(flowId) });

  useEffect(() => {
    if (!open) setFlowId(null);
  }, [open]);

  const startMutation = useMutation({
    mutationFn: () =>
      startFollowupFlow({
        data: {
          flowId: flowId!,
          contactId,
          conversationId: conversationId!,
          opportunityId: opportunityId ?? null,
          replaceExisting: hasActiveRun,
        },
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: followupKeys.root });
      toast.success("Follow-up iniciado.");
      onOpenChange(false);
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Não foi possível iniciar o follow-up."),
  });

  const activeFlows = (flows.data ?? []).filter((flow) => flow.is_active);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Iniciar follow-up</DialogTitle>
          <DialogDescription>
            {conversationId
              ? "Escolha o fluxo. As mensagens são enviadas automaticamente e param quando o cliente responder."
              : "Este cliente ainda não tem conversa de WhatsApp vinculada."}
          </DialogDescription>
        </DialogHeader>

        {conversationId && (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Fluxo</Label>
              <Select value={flowId ?? ""} onValueChange={setFlowId}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione um fluxo ativo" />
                </SelectTrigger>
                <SelectContent>
                  {activeFlows.map((flow) => (
                    <SelectItem key={flow.id} value={flow.id}>
                      {flow.name} · {flow.step_count} etapa(s)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {activeFlows.length === 0 && (
                <p className="text-muted-foreground text-xs">
                  Nenhum fluxo ativo. Crie um fluxo em Follow-ups.
                </p>
              )}
            </div>

            {preview.data && (
              <div className="bg-muted/50 space-y-1 rounded-md border p-3 text-sm">
                <p className="font-medium">{preview.data.flow_name}</p>
                <p className="text-muted-foreground">
                  {preview.data.step_count} etapa(s). Primeira ação:{" "}
                  {ACTION_TYPE_LABELS[preview.data.first_action_type]} em{" "}
                  {formatDateTime(preview.data.first_action_at)}.
                </p>
                {preview.data.first_action_content && (
                  <p className="text-muted-foreground italic">
                    “{preview.data.first_action_content}”
                  </p>
                )}
              </div>
            )}

            {hasActiveRun && (
              <p className="text-muted-foreground text-xs">
                Já existe um follow-up em andamento nesta conversa. Ele será encerrado e
                substituído.
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            onClick={() => startMutation.mutate()}
            disabled={!flowId || !conversationId || startMutation.isPending}
          >
            {startMutation.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
            Iniciar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
