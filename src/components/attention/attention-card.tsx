import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  CalendarClock,
  Check,
  Info,
  Loader2,
  MessagesSquare,
  Sparkles,
  Repeat,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { GenerateMessageDialog } from "@/components/library/generate-message-dialog";
import { StartFollowupDialog } from "@/components/followup/start-followup-dialog";
import {
  closeAttentionItem,
  snoozeAttentionItem,
  suggestAttentionAction,
} from "@/lib/attention.functions";
import { attentionKeys } from "@/lib/attention.queries";
import {
  kindLabel,
  nextActionLabel,
  PRIORITY_CLASSES,
  PRIORITY_LABELS,
} from "@/lib/attention/labels";
import type { AttentionItem, AttentionPriority } from "@/lib/attention/types";
import { formatDateTime, fromDateTimeInputValue } from "@/lib/domain/datetime";
import { cn } from "@/lib/utils";

export function AttentionCard({ item }: { item: AttentionItem }) {
  const queryClient = useQueryClient();
  const [showFactors, setShowFactors] = useState(false);
  const [snoozeAt, setSnoozeAt] = useState("");
  const [note, setNote] = useState("");
  const [generateOpen, setGenerateOpen] = useState(false);
  const [flowOpen, setFlowOpen] = useState(false);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: attentionKeys.root });

  const suggest = useMutation({
    mutationFn: () => suggestAttentionAction({ data: { itemId: item.id } }),
    onSuccess: () => {
      toast.success("Sugestão atualizada pela IA.");
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message || "Não foi possível gerar a sugestão."),
  });

  const snooze = useMutation({
    mutationFn: (until: string) => snoozeAttentionItem({ data: { itemId: item.id, until } }),
    onSuccess: () => {
      toast.success("Item adiado. Ele volta na data escolhida.");
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message || "Não foi possível adiar."),
  });

  const close = useMutation({
    mutationFn: (status: "resolved" | "dismissed") =>
      closeAttentionItem({ data: { itemId: item.id, status, note: note.trim() || null } }),
    onSuccess: (_data, status) => {
      toast.success(status === "resolved" ? "Item resolvido." : "Item descartado.");
      setNote("");
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message || "Não foi possível concluir."),
  });

  const busy = suggest.isPending || snooze.isPending || close.isPending;
  const actionLabel = nextActionLabel(item.suggested_action_kind);

  return (
    <Card className={cn(item.priority === "critical" && "border-destructive/40")}>
      <CardContent className="space-y-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                variant="outline"
                className={PRIORITY_CLASSES[item.priority as AttentionPriority]}
              >
                {PRIORITY_LABELS[item.priority as AttentionPriority]} · {item.priority_score}
              </Badge>
              <span className="text-xs font-medium text-muted-foreground">
                {kindLabel(item.kind)}
              </span>
              {item.occurrences > 1 ? (
                <span className="text-xs text-muted-foreground">{item.occurrences}× detectado</span>
              ) : null}
              {item.blocks_automation ? (
                <Badge variant="outline" className="border-amber-500/40 text-amber-600">
                  Automação pausada
                </Badge>
              ) : null}
              {item.status === "snoozed" && item.snoozed_until ? (
                <Badge variant="outline">Volta em {formatDateTime(item.snoozed_until)}</Badge>
              ) : null}
            </div>

            <p className="font-medium">
              {item.contact_name ? `${item.contact_name} — ` : ""}
              {item.title}
            </p>
            {item.summary ? <p className="text-sm text-muted-foreground">{item.summary}</p> : null}
          </div>

          <span className="text-xs text-muted-foreground">
            {formatDateTime(item.last_detected_at)}
          </span>
        </div>

        <div className="space-y-2 rounded-md border bg-secondary/40 p-3">
          <p className="text-sm">{item.reason}</p>
          {item.suggested_action ? (
            <p className="text-sm">
              <span className="font-medium">
                {actionLabel ? `${actionLabel}: ` : "Próxima ação: "}
              </span>
              {item.suggested_action}
              <span className="ml-2 text-xs text-muted-foreground">
                ({item.suggested_action_source === "ai" ? "sugestão da IA" : "regra do sistema"})
              </span>
            </p>
          ) : null}

          <button
            type="button"
            onClick={() => setShowFactors((value) => !value)}
            className="flex items-center gap-1 text-xs font-medium text-primary"
          >
            <Info className="size-3.5" />
            {showFactors ? "Ocultar cálculo da prioridade" : "Como esta prioridade foi calculada"}
          </button>

          {showFactors ? (
            <ul className="space-y-1 text-xs text-muted-foreground">
              {item.score_factors.map((factor, index) => (
                <li key={`${factor.label}-${index}`} className="flex justify-between gap-4">
                  <span>{factor.label}</span>
                  <span className="font-medium">
                    {factor.points > 0 ? `+${factor.points}` : factor.points}
                  </span>
                </li>
              ))}
              <li className="flex justify-between gap-4 border-t pt-1 font-medium text-foreground">
                <span>Total</span>
                <span>{item.priority_score}</span>
              </li>
            </ul>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-2">
          {item.conversation_id ? (
            <Button asChild variant="outline" size="sm">
              <Link to="/conversas" search={{ conversa: item.conversation_id }}>
                <MessagesSquare className="size-4" />
                Abrir conversa
              </Link>
            </Button>
          ) : null}

          {item.contact_id ? (
            <Button asChild variant="outline" size="sm">
              <Link to="/clientes/$contactId" params={{ contactId: item.contact_id }}>
                Ver cliente
              </Link>
            </Button>
          ) : null}

          {item.contact_id ? (
            <Button variant="outline" size="sm" onClick={() => setGenerateOpen(true)}>
              <Sparkles className="size-4" />
              Gerar sugestão
            </Button>
          ) : null}

          {item.contact_id && item.conversation_id ? (
            <Button variant="outline" size="sm" onClick={() => setFlowOpen(true)}>
              <Repeat className="size-4" />
              Iniciar fluxo
            </Button>
          ) : null}

          <Button variant="outline" size="sm" disabled={busy} onClick={() => suggest.mutate()}>
            {suggest.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Sparkles className="size-4" />
            )}
            Próxima melhor ação
          </Button>

          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" disabled={busy}>
                <CalendarClock className="size-4" />
                Lembrar depois
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-72 space-y-3">
              <div className="space-y-1">
                <Label htmlFor={`snooze-${item.id}`}>Voltar em</Label>
                <Input
                  id={`snooze-${item.id}`}
                  type="datetime-local"
                  value={snoozeAt}
                  onChange={(event) => setSnoozeAt(event.target.value)}
                />
              </div>
              <Button
                size="sm"
                className="w-full"
                disabled={!snoozeAt || snooze.isPending}
                onClick={() => {
                  const iso = fromDateTimeInputValue(snoozeAt);
                  if (iso) snooze.mutate(iso);
                }}
              >
                Adiar sem apagar
              </Button>
            </PopoverContent>
          </Popover>

          <Popover>
            <PopoverTrigger asChild>
              <Button size="sm" disabled={busy}>
                <Check className="size-4" />
                Marcar resolvido
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-72 space-y-3">
              <div className="space-y-1">
                <Label htmlFor={`note-${item.id}`}>Motivo (opcional)</Label>
                <Input
                  id={`note-${item.id}`}
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="Ex.: falei por telefone"
                />
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  className="flex-1"
                  disabled={close.isPending}
                  onClick={() => close.mutate("resolved")}
                >
                  Resolvido
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1"
                  disabled={close.isPending}
                  onClick={() => close.mutate("dismissed")}
                >
                  <X className="size-4" />
                  Descartar
                </Button>
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </CardContent>

      {item.contact_id ? (
        <GenerateMessageDialog
          open={generateOpen}
          onOpenChange={setGenerateOpen}
          contactId={item.contact_id}
          conversationId={item.conversation_id}
          opportunityId={item.opportunity_id}
        />
      ) : null}

      {item.contact_id && item.conversation_id ? (
        <StartFollowupDialog
          open={flowOpen}
          onOpenChange={setFlowOpen}
          contactId={item.contact_id}
          conversationId={item.conversation_id}
          opportunityId={item.opportunity_id}
          hasActiveRun={false}
        />
      ) : null}
    </Card>
  );
}
