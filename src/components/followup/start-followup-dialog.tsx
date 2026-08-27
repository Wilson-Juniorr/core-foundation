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
import { isSendablePhone } from "@/lib/domain/phone";
import { contactSignalsQuery } from "@/lib/crm.queries";
import { formatRelative } from "@/lib/domain/datetime";

export function StartFollowupDialog({
  open,
  onOpenChange,
  contactId,
  conversationId,
  contactPhone,
  opportunityId,
  hasActiveRun,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contactId: string;
  conversationId: string | null;
  /** Telefone do cliente: permite iniciar antes da primeira conversa. */
  contactPhone?: string | null;
  opportunityId?: string | null;
  hasActiveRun: boolean;
}) {
  const queryClient = useQueryClient();
  const flows = useQuery(flowsQuery());
  const [flowId, setFlowId] = useState<string | null>(null);
  const preview = useQuery({ ...flowPreviewQuery(flowId), enabled: open && Boolean(flowId) });
  const signals = useQuery({ ...contactSignalsQuery([contactId]), enabled: open });
  const lastInboundAt = signals.data?.[0]?.last_inbound_at ?? null;
  // Cliente que respondeu há pouco merece atenção humana antes de automação.
  const repliedRecently = lastInboundAt
    ? Date.now() - new Date(lastInboundAt).getTime() < 3 * 24 * 60 * 60 * 1000
    : false;

  const phoneUsable = isSendablePhone(contactPhone);
  const willCreateConversation = !conversationId && phoneUsable;
  const canStart = Boolean(conversationId) || phoneUsable;

  useEffect(() => {
    if (!open) setFlowId(null);
  }, [open]);

  const startMutation = useMutation({
    mutationFn: () =>
      startFollowupFlow({
        data: {
          flowId: flowId!,
          contactId,
          conversationId: conversationId ?? null,
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
            {canStart
              ? "Escolha o fluxo. As mensagens são enviadas automaticamente e param quando o cliente responder."
              : "Este cliente não tem telefone válido cadastrado. Adicione o número com DDD para iniciar pelo WhatsApp."}
          </DialogDescription>
        </DialogHeader>

        {canStart && (
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

            {willCreateConversation && (
              <p className="text-muted-foreground text-xs">
                Uma nova conversa será iniciada com {contactPhone} no primeiro envio.
              </p>
            )}

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

            {repliedRecently && lastInboundAt && (
              <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                Este cliente respondeu {formatRelative(lastInboundAt)}. Confirme se faz sentido
                automatizar agora — talvez uma resposta sua pessoalmente funcione melhor.
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
            disabled={!flowId || !canStart || startMutation.isPending}
          >
            {startMutation.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
            Iniciar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
