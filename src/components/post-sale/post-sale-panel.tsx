import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ClipboardCheck, Copy, MessageSquare } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { crmKeys } from "@/lib/crm.queries";
import type { OpportunityWithRelations } from "@/lib/crm.types";
import {
  addCalendarDays,
  displayPostSaleDay,
  isPostSaleStage,
  POST_SALE_LABELS,
  POST_SALE_STAGES,
  postSaleTask,
  saoPauloDay,
  type PostSaleStage,
} from "@/lib/domain/post-sale";
import { savePostSale } from "@/lib/post-sale.functions";
import { postSaleDueKey } from "@/lib/post-sale.queries";

export function PostSalePanel({
  contactId,
  conversationId,
  opportunities,
  archived,
}: {
  contactId: string;
  conversationId: string | null;
  opportunities: OpportunityWithRelations[];
  archived: boolean;
}) {
  const sales = opportunities.filter((opportunity) => opportunity.status === "won");
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <ClipboardCheck className="size-4 text-primary" aria-hidden />
          Pós-venda
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Acompanhe a emissão, as pendências e o início do plano. Os lembretes aparecem em Precisa
          de Mim. Você decide quando enviar cada mensagem.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {archived ? (
          <p className="text-sm text-muted-foreground">
            Reative o cliente para acompanhar a venda.
          </p>
        ) : sales.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Marque uma oportunidade como ganha no Resumo para iniciar.
          </p>
        ) : (
          sales.map((opportunity) => (
            <PostSaleEntry
              key={`${opportunity.id}:${opportunity.post_sale_version ?? 0}`}
              opportunity={opportunity}
              contactId={contactId}
              conversationId={conversationId}
            />
          ))
        )}
      </CardContent>
    </Card>
  );
}

function PostSaleEntry({
  opportunity,
  contactId,
  conversationId,
}: {
  opportunity: OpportunityWithRelations;
  contactId: string;
  conversationId: string | null;
}) {
  const queryClient = useQueryClient();
  const fieldId = useId();
  const current = opportunity.post_sale_stage ?? null;
  const dueOn = opportunity.post_sale_due_on ?? null;
  const effectiveOn = opportunity.post_sale_effective_on ?? null;
  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState<PostSaleStage>(current ?? "issuing");
  const [day, setDay] = useState(
    current === "onboarding" && effectiveOn
      ? effectiveOn
      : (dueOn ?? addCalendarDays(saoPauloDay(), 2)),
  );
  const [note, setNote] = useState(opportunity.post_sale_note ?? "");
  const save = useMutation({
    mutationFn: () =>
      savePostSale({
        data: {
          contactId,
          opportunityId: opportunity.id,
          stage,
          day,
          note,
          version: opportunity.post_sale_version ?? 0,
        },
      }),
    onSuccess: async () => {
      setOpen(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: crmKeys.contact(contactId) }),
        queryClient.invalidateQueries({ queryKey: crmKeys.opportunities }),
        queryClient.invalidateQueries({ queryKey: postSaleDueKey }),
      ]);
      toast.success("Pós-venda atualizado.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  function changeStage(value: string) {
    if (!isPostSaleStage(value)) return;
    setStage(value);
    setDay(
      value === "onboarding"
        ? (effectiveOn ?? "")
        : current !== "onboarding" && dueOn
          ? dueOn
          : addCalendarDays(saoPauloDay(), 2),
    );
  }

  async function copyDraft() {
    if (!current) return;
    const today = saoPauloDay();
    const draft =
      current === "onboarding" && effectiveOn
        ? today >= (dueOn ?? effectiveOn)
          ? "Oi, tudo bem? Você conseguiu acessar o app e a carteirinha do plano? Se precisar, te ajudo por aqui."
          : `Oi, tudo bem? A vigência do seu plano foi confirmada para ${displayPostSaleDay(effectiveOn)}. Se precisar de ajuda com os próximos passos, me chama por aqui.`
        : "Oi, tudo bem? Passando para te atualizar sobre a proposta do plano. Vou acompanhar os próximos passos por aqui e te aviso assim que tiver novidades.";
    try {
      await navigator.clipboard.writeText(draft);
      toast.success("Rascunho copiado. Revise antes de enviar.");
    } catch {
      toast.error("Não foi possível copiar o rascunho.");
    }
  }

  return (
    <section className="space-y-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="break-words font-medium">{opportunity.title}</h3>
          {current && dueOn && (
            <p className="mt-1 text-sm text-muted-foreground">
              {postSaleTask(current)} em {displayPostSaleDay(dueOn)}
            </p>
          )}
          {effectiveOn && (
            <p className="mt-1 text-sm text-muted-foreground">
              Vigência em {displayPostSaleDay(effectiveOn)}
            </p>
          )}
        </div>
        <Badge variant={dueOn && dueOn < saoPauloDay() ? "destructive" : "secondary"}>
          {dueOn && dueOn < saoPauloDay() ? "Atrasado · " : ""}
          {current ? POST_SALE_LABELS[current] : "A iniciar"}
        </Badge>
      </div>
      {opportunity.post_sale_note && !open && (
        <p className="whitespace-pre-wrap break-words text-sm">{opportunity.post_sale_note}</p>
      )}
      {current !== "done" && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant={open ? "outline" : "default"} onClick={() => setOpen(!open)}>
            {open ? "Fechar edição" : current ? "Atualizar pós-venda" : "Iniciar pós-venda"}
          </Button>
          {current && current !== "pending" && (
            <Button size="sm" variant="outline" onClick={copyDraft}>
              <Copy aria-hidden />
              Copiar rascunho
            </Button>
          )}
          {conversationId && (
            <Button size="sm" variant="ghost" asChild>
              <Link to="/conversas" search={{ conversa: conversationId }}>
                <MessageSquare aria-hidden />
                Abrir conversa
              </Link>
            </Button>
          )}
        </div>
      )}
      {open && (
        <form
          className="grid gap-3 border-t pt-4 sm:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate();
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor={`${fieldId}-stage`}>Etapa confirmada</Label>
            <select
              id={`${fieldId}-stage`}
              value={stage}
              onChange={(event) => changeStage(event.target.value)}
              className="border-input bg-background h-9 rounded-md border px-3 text-sm focus-visible:outline-2 focus-visible:outline-ring"
            >
              {POST_SALE_STAGES.filter((item) => item !== "done" || current === "onboarding").map(
                (item) => (
                  <option key={item} value={item}>
                    {POST_SALE_LABELS[item]}
                  </option>
                ),
              )}
            </select>
          </div>
          {stage !== "done" && (
            <div className="grid gap-1.5">
              <Label htmlFor={`${fieldId}-day`}>
                {stage === "onboarding" ? "Data da vigência" : "Data para conferir"}
              </Label>
              <Input
                id={`${fieldId}-day`}
                type="date"
                value={day}
                onChange={(event) => setDay(event.target.value)}
                required
              />
            </div>
          )}
          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor={`${fieldId}-note`}>
              {stage === "pending" ? "O que está pendente" : "Nota interna"}
            </Label>
            <Textarea
              id={`${fieldId}-note`}
              value={note}
              maxLength={1500}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Registre o que foi confirmado e quem precisa agir."
              required={stage === "pending"}
            />
            <p className="text-xs text-muted-foreground">
              Mesmo sem histórico do WhatsApp, você pode registrar o que confirmou com o cliente ou
              com a operadora.
            </p>
          </div>
          <div className="sm:col-span-2">
            <Button type="submit" size="sm" disabled={save.isPending}>
              {save.isPending ? "Salvando…" : "Salvar pós-venda"}
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
