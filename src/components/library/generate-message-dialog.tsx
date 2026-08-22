import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  approveMessageDraft,
  editMessageDraft,
  generateStrategicMessage,
  rejectMessageDraft,
} from "@/lib/library.functions";
import { libraryKeys, strategiesQuery } from "@/lib/library.queries";
import type { MessageDraft } from "@/lib/library/api-types";
import { autonomyLabels } from "@/lib/library/labels";

export function GenerateMessageDialog({
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
  const strategies = useQuery({ ...strategiesQuery(), enabled: open });
  const [strategyId, setStrategyId] = useState<string | null>(null);
  const [objective, setObjective] = useState("");
  const [draft, setDraft] = useState<MessageDraft | null>(null);
  const [content, setContent] = useState("");
  const [warning, setWarning] = useState<string | null>(null);

  useEffect(() => {
    if (open) return;
    setStrategyId(null);
    setObjective("");
    setDraft(null);
    setContent("");
    setWarning(null);
  }, [open]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: libraryKeys.root });

  const generateMutation = useMutation({
    mutationFn: () =>
      generateStrategicMessage({
        data: {
          contactId,
          strategyId: strategyId!,
          conversationId,
          opportunityId: opportunityId ?? null,
          objective: objective.trim() || null,
        },
      }),
    onSuccess: async (result) => {
      setDraft(result.draft);
      setContent(result.draft.edited_content ?? result.draft.generated_content);
      setWarning(result.warning);
      await invalidate();
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Não foi possível gerar a mensagem."),
  });

  const approveMutation = useMutation({
    mutationFn: async () => {
      if (!draft) throw new Error("Nenhum rascunho.");
      const current = draft.edited_content ?? draft.generated_content;
      if (content.trim() !== current.trim()) {
        await editMessageDraft({ data: { draftId: draft.id, content: content.trim() } });
      }
      return approveMessageDraft({ data: { draftId: draft.id } });
    },
    onSuccess: async () => {
      await invalidate();
      toast.success("Mensagem enviada.");
      onOpenChange(false);
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Não foi possível enviar a mensagem."),
  });

  const rejectMutation = useMutation({
    mutationFn: () => rejectMessageDraft({ data: { draftId: draft!.id, reason: null } }),
    onSuccess: async () => {
      await invalidate();
      toast.success("Rascunho recusado.");
      onOpenChange(false);
    },
  });

  const activeStrategies = (strategies.data ?? []).filter((item) => item.is_active);
  const selected = activeStrategies.find((item) => item.id === strategyId) ?? null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Gerar mensagem estratégica</DialogTitle>
          <DialogDescription>
            A IA usa o histórico, a memória do cliente e o tempo desde o último contato. Você revisa
            antes de enviar.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Estratégia</Label>
            <Select value={strategyId ?? ""} onValueChange={(value) => setStrategyId(value)}>
              <SelectTrigger>
                <SelectValue placeholder="Escolha a estratégia" />
              </SelectTrigger>
              <SelectContent>
                {activeStrategies.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selected ? (
              <p className="text-xs text-muted-foreground">
                {selected.objective} · {autonomyLabels[selected.autonomy_mode]}
              </p>
            ) : null}
            {activeStrategies.length === 0 && !strategies.isLoading ? (
              <p className="text-xs text-muted-foreground">
                Nenhuma estratégia ativa. Crie uma na Biblioteca.
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="generate-objective">Objetivo específico (opcional)</Label>
            <Input
              id="generate-objective"
              value={objective}
              onChange={(event) => setObjective(event.target.value)}
              placeholder="Ex.: confirmar a reunião de quinta"
            />
          </div>

          {draft ? (
            <div className="space-y-3 rounded-md border border-border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">{draft.strategy_name}</Badge>
                {draft.suggested_asset ? (
                  <Badge variant="outline">Material: {draft.suggested_asset.name}</Badge>
                ) : null}
              </div>
              <Textarea
                rows={8}
                value={content}
                onChange={(event) => setContent(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                {content.trim().length} caracteres · edições ficam registradas junto ao texto
                original da IA.
              </p>
              {draft.asset_rationale ? (
                <p className="text-xs text-muted-foreground">Material: {draft.asset_rationale}</p>
              ) : null}
              {warning ? <p className="text-xs text-amber-600">{warning}</p> : null}
              {!conversationId ? (
                <p className="text-xs text-destructive">
                  Sem conversa de WhatsApp vinculada — não é possível enviar por aqui.
                </p>
              ) : null}
            </div>
          ) : null}
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-row">
          {draft ? (
            <>
              <Button
                variant="ghost"
                onClick={() => rejectMutation.mutate()}
                disabled={rejectMutation.isPending}
              >
                Recusar
              </Button>
              <Button
                variant="outline"
                onClick={() => generateMutation.mutate()}
                disabled={generateMutation.isPending}
              >
                {generateMutation.isPending ? (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                ) : null}
                Gerar outra versão
              </Button>
              <Button
                onClick={() => approveMutation.mutate()}
                disabled={approveMutation.isPending || !content.trim() || !conversationId}
              >
                {approveMutation.isPending ? (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                ) : null}
                Aprovar e enviar
              </Button>
            </>
          ) : (
            <Button
              onClick={() => generateMutation.mutate()}
              disabled={!strategyId || generateMutation.isPending}
            >
              {generateMutation.isPending ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <Sparkles className="mr-2 size-4" />
              )}
              Gerar mensagem
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
