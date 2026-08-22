import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Brain, Pencil, RefreshCw, Sparkles } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Textarea } from "@/components/ui/textarea";
import { requestAnalysis, setInsightStatus, updateMemory } from "@/lib/ai.functions";
import { aiKeys, intelligenceQuery } from "@/lib/ai.queries";
import {
  analysisStatusLabels,
  confidenceLabel,
  insightLabel,
  intentLabels,
  interestLabels,
  memoryFieldLabels,
  sentimentLabels,
} from "@/lib/ai/labels";
import {
  CUSTOMER_INTENTS,
  INTEREST_LEVELS,
  SENTIMENTS,
  type CustomerMemory,
  type MemoryItem,
  type MemoryListField,
} from "@/lib/ai/types";
import { formatDateTime } from "@/lib/domain/datetime";

const LIST_FIELDS: MemoryListField[] = [
  "main_objections",
  "pending_information",
  "customer_commitments",
  "seller_commitments",
  "important_dates",
  "products_or_services",
  "relevant_values",
  "decision_factors",
  "competitors",
];

function itemsToText(items: MemoryItem[]): string {
  return items.map((item) => item.value).join("\n");
}

function textToItems(text: string) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 20)
    .map((value) => ({ value }));
}

function MemoryList({
  field,
  items,
  locked,
}: {
  field: MemoryListField;
  items: MemoryItem[];
  locked: boolean;
}) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {memoryFieldLabels[field]}
        </p>
        {locked ? (
          <Badge variant="outline" className="text-[10px]">
            confirmado
          </Badge>
        ) : null}
      </div>
      <ul className="space-y-1">
        {items.map((item) => (
          <li
            key={`${field}-${item.value}`}
            className="flex flex-wrap items-baseline gap-2 text-sm"
          >
            <span>{item.value}</span>
            {item.due ? <span className="text-xs text-muted-foreground">({item.due})</span> : null}
            <span className="text-[11px] text-muted-foreground">
              {item.source === "human" ? "você" : `IA · ${confidenceLabel(item.confidence)}`}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CorrectionDialog({
  contactId,
  memory,
  open,
  onOpenChange,
}: {
  contactId: string;
  memory: CustomerMemory | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [summary, setSummary] = useState(memory?.current_summary ?? "");
  const [nextStep, setNextStep] = useState(memory?.next_step_detected ?? "");
  const [intent, setIntent] = useState(memory?.customer_intent ?? "unknown");
  const [interest, setInterest] = useState(memory?.interest_level ?? "unknown");
  const [sentiment, setSentiment] = useState(memory?.sentiment ?? "unknown");
  const [lists, setLists] = useState<Record<string, string>>(() =>
    Object.fromEntries(LIST_FIELDS.map((field) => [field, itemsToText(memory?.[field] ?? [])])),
  );

  const mutation = useMutation({
    mutationFn: (patch: Record<string, unknown>) =>
      updateMemory({ data: { contactId, patch } as never }),
    onSuccess: async () => {
      toast.success("Inteligência corrigida. A IA não vai sobrescrever esses campos.");
      await queryClient.invalidateQueries({ queryKey: aiKeys.intelligence(contactId) });
      onOpenChange(false);
    },
    onError: (error: Error) => toast.error(error.message || "Não foi possível salvar."),
  });

  function submit() {
    const patch: Record<string, unknown> = {
      current_summary: summary.trim() || null,
      next_step_detected: nextStep.trim() || null,
      customer_intent: intent,
      interest_level: interest,
      sentiment,
    };
    for (const field of LIST_FIELDS) {
      patch[field] = textToItems(lists[field] ?? "");
    }
    mutation.mutate(patch);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Corrigir inteligência</DialogTitle>
          <DialogDescription>
            Tudo que você salvar aqui fica marcado como confirmado por você e não é alterado pela
            IA. Uma informação por linha nas listas.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="mem-summary">{memoryFieldLabels.current_summary}</Label>
            <Textarea
              id="mem-summary"
              rows={5}
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-2">
              <Label>{memoryFieldLabels.customer_intent}</Label>
              <Select value={intent} onValueChange={(value) => setIntent(value as never)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CUSTOMER_INTENTS.map((value) => (
                    <SelectItem key={value} value={value}>
                      {intentLabels[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{memoryFieldLabels.interest_level}</Label>
              <Select value={interest} onValueChange={(value) => setInterest(value as never)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {INTEREST_LEVELS.map((value) => (
                    <SelectItem key={value} value={value}>
                      {interestLabels[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{memoryFieldLabels.sentiment}</Label>
              <Select value={sentiment} onValueChange={(value) => setSentiment(value as never)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SENTIMENTS.map((value) => (
                    <SelectItem key={value} value={value}>
                      {sentimentLabels[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="mem-next">{memoryFieldLabels.next_step_detected}</Label>
            <Textarea
              id="mem-next"
              rows={2}
              value={nextStep}
              onChange={(event) => setNextStep(event.target.value)}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {LIST_FIELDS.map((field) => (
              <div key={field} className="space-y-2">
                <Label htmlFor={`mem-${field}`}>{memoryFieldLabels[field]}</Label>
                <Textarea
                  id={`mem-${field}`}
                  rows={3}
                  value={lists[field] ?? ""}
                  onChange={(event) =>
                    setLists((current) => ({ ...current, [field]: event.target.value }))
                  }
                />
              </div>
            ))}
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={mutation.isPending}>
            {mutation.isPending ? "Salvando..." : "Salvar correção"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Área "Inteligência" da página do cliente.
 *
 * A IA é apresentada como apoio, nunca como verdade absoluta: cada bloco mostra
 * origem/confiança e a memória pode ser corrigida manualmente. Se a análise
 * falhar, o card apenas indica que está desatualizada — o resto do sistema
 * continua funcionando.
 */
export function IntelligenceCard({
  contactId,
  conversationId,
}: {
  contactId: string;
  conversationId?: string | null;
}) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const query = useQuery(intelligenceQuery(contactId));

  const analyze = useMutation({
    mutationFn: () =>
      requestAnalysis({
        data: { contactId, force: true, conversationId: conversationId ?? null },
      }),
    onSuccess: async (result) => {
      if (result.status === "updated") toast.success("Inteligência atualizada.");
      else if (result.status === "failed")
        toast.error(result.reason ?? "A IA está indisponível agora. Tente novamente.");
      else toast.info("Nada novo para analisar nesta conversa.");
      await queryClient.invalidateQueries({ queryKey: aiKeys.intelligence(contactId) });
    },
    onError: () => toast.error("Não foi possível atualizar a inteligência."),
  });

  const insightStatus = useMutation({
    mutationFn: (input: { insightId: string; status: "accepted" | "dismissed" }) =>
      setInsightStatus({ data: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: aiKeys.intelligence(contactId) }),
  });

  const memory = query.data?.memory ?? null;
  const stale =
    memory?.analysis_status === "stale" ||
    memory?.analysis_status === "failed" ||
    (query.data?.unanalyzedMessages ?? 0) > 0;
  const openInsights = (query.data?.insights ?? []).filter((item) => item.status === "open");

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
        <CardTitle className="flex items-center gap-2">
          <Brain className="size-4 text-muted-foreground" aria-hidden />
          Inteligência
        </CardTitle>
        <div className="flex items-center gap-2">
          {memory ? (
            <Badge variant={stale ? "outline" : "secondary"}>
              {stale
                ? analysisStatusLabels.stale
                : (analysisStatusLabels[memory.analysis_status] ?? "Atualizada")}
            </Badge>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            onClick={() => analyze.mutate()}
            disabled={analyze.isPending}
          >
            <RefreshCw
              className={analyze.isPending ? "size-4 animate-spin" : "size-4"}
              aria-hidden
            />
            {analyze.isPending ? "Analisando..." : "Atualizar inteligência"}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
            <Pencil className="size-4" aria-hidden />
            Corrigir
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        {query.isLoading ? <p className="text-sm text-muted-foreground">Carregando…</p> : null}

        {!query.isLoading && !memory ? (
          <EmptyState
            title="Sem memória ainda"
            description="Assim que houver conversa com este cliente, a IA monta o resumo comercial. Você também pode gerar agora."
          />
        ) : null}

        {memory ? (
          <>
            {memory.last_error ? (
              <p className="flex items-start gap-2 rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                <AlertTriangle className="mt-0.5 size-3.5" aria-hidden />
                Última análise não concluiu: {memory.last_error} — a conversa e os follow-ups
                continuam funcionando normalmente.
              </p>
            ) : null}

            {memory.do_not_contact ? (
              <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                O cliente pediu para não receber mensagens.
              </p>
            ) : null}

            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {memoryFieldLabels.current_summary}
              </p>
              <p className="whitespace-pre-line text-sm leading-relaxed">
                {memory.current_summary ?? "Sem resumo."}
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary">Interesse: {interestLabels[memory.interest_level]}</Badge>
              <Badge variant="secondary">Intenção: {intentLabels[memory.customer_intent]}</Badge>
              <Badge variant="secondary">Sentimento: {sentimentLabels[memory.sentiment]}</Badge>
              <Badge variant="outline">Confiança: {confidenceLabel(memory.confidence)}</Badge>
            </div>

            {memory.next_step_detected ? (
              <div className="space-y-1">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {memoryFieldLabels.next_step_detected}
                </p>
                <p className="text-sm">{memory.next_step_detected}</p>
              </div>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-2">
              {LIST_FIELDS.map((field) => (
                <MemoryList
                  key={field}
                  field={field}
                  items={memory[field]}
                  locked={memory.field_sources[field]?.source === "human"}
                />
              ))}
            </div>

            {openInsights.length > 0 ? (
              <div className="space-y-2">
                <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <Sparkles className="size-3.5" aria-hidden />
                  Sinais detectados
                </p>
                <ul className="space-y-2">
                  {openInsights.slice(0, 10).map((insight) => (
                    <li
                      key={insight.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2.5 text-sm"
                    >
                      <span>
                        <Badge variant="outline" className="mr-2 text-[10px]">
                          {insightLabel(insight.insight_type)}
                        </Badge>
                        {insight.content}
                        <span className="ml-2 text-[11px] text-muted-foreground">
                          confiança {confidenceLabel(insight.confidence)}
                        </span>
                      </span>
                      <span className="flex gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            insightStatus.mutate({ insightId: insight.id, status: "accepted" })
                          }
                        >
                          Confirmar
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            insightStatus.mutate({ insightId: insight.id, status: "dismissed" })
                          }
                        >
                          Descartar
                        </Button>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <p className="text-xs text-muted-foreground">
              Última atualização da IA:{" "}
              {memory.last_analyzed_at ? formatDateTime(memory.last_analyzed_at) : "—"}
              {memory.model ? ` · ${memory.model}` : ""}
              {query.data?.unanalyzedMessages
                ? ` · ${query.data.unanalyzedMessages} mensagem(ns) sem análise`
                : ""}
              {query.data?.usage.analyses
                ? ` · ${query.data.usage.analyses} análise(s), ${query.data.usage.totalTokens} tokens`
                : ""}
            </p>
          </>
        ) : null}
      </CardContent>

      {editing ? (
        <CorrectionDialog
          contactId={contactId}
          memory={memory}
          open={editing}
          onOpenChange={setEditing}
        />
      ) : null}
    </Card>
  );
}
