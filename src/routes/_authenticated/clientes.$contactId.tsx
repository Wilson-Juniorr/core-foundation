import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowLeft,
  CalendarClock,
  ChevronDown,
  Ellipsis,
  MessageSquare,
  Pencil,
  Plus,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { AppShell } from "@/components/app-shell";
import { ContactFormDialog } from "@/components/contact-form-dialog";
import { FollowupPanel } from "@/components/followup/followup-panel";
import { PostSalePanel } from "@/components/post-sale/post-sale-panel";
import { PostQuotePanel } from "@/components/smart/post-quote-panel";
import { SmartControlCard } from "@/components/smart/smart-control-card";
import { AgentHandoffCard } from "@/components/smart/agent-handoff-card";

import { MessageGeneratorCard } from "@/components/library/message-generator-card";
import { ContactPreferencesCard } from "@/components/automation/contact-preferences-card";
import { DealSheetCard } from "@/components/intelligence/deal-sheet-card";
import { IntelligenceCard } from "@/components/intelligence/intelligence-card";
import { NextActionBadge } from "@/components/next-action-badge";
import { NextActionDialog } from "@/components/next-action-dialog";
import { OpportunityFormDialog } from "@/components/opportunity-form-dialog";
import { EmptyState, ErrorState, LoadingState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { setContactArchived, updateOpportunity } from "@/lib/crm.functions";
import { contactDetailQuery } from "@/lib/crm.queries";
import type { OpportunityWithRelations } from "@/lib/crm.types";
import { formatDateTime } from "@/lib/domain/datetime";
import { timelineEventLabel } from "@/lib/domain/events";
import { formatCurrency, OPPORTUNITY_STATUS_LABELS } from "@/lib/domain/opportunity-status";
import { formatPhone } from "@/lib/domain/phone";
import { displayPostSaleDay, POST_SALE_LABELS, postSaleTask } from "@/lib/domain/post-sale";
import { postSaleDueKey } from "@/lib/post-sale.queries";
import { contactConversationQuery } from "@/lib/whatsapp.queries";

const sections = ["resumo", "acompanhamento", "pos-venda", "historico", "dados"] as const;
const sectionSchema = z.enum(sections);

export const Route = createFileRoute("/_authenticated/clientes/$contactId")({
  validateSearch: z.object({ aba: sectionSchema.optional().catch(undefined) }),
  head: () => ({
    meta: [
      { title: "Cliente — Próximo Passo" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      {
        name: "description",
        content: "Ficha do cliente com oportunidades, próximas ações e histórico completo.",
      },
      { property: "og:title", content: "Cliente — Próximo Passo" },
      {
        property: "og:description",
        content: "Ficha do cliente com oportunidades, próximas ações e histórico completo.",
      },
    ],
  }),
  component: ContactDetailPage,
});

function ContactDetailPage() {
  const { contactId } = Route.useParams();
  const { aba } = Route.useSearch();
  const navigate = Route.useNavigate();
  const queryClient = useQueryClient();
  const detail = useQuery(contactDetailQuery(contactId));
  const conversation = useQuery(contactConversationQuery(contactId));
  const archive = useServerFn(setContactArchived);
  const update = useServerFn(updateOpportunity);

  const [editing, setEditing] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [creatingOpportunity, setCreatingOpportunity] = useState(false);
  const [nextActionTarget, setNextActionTarget] = useState<OpportunityWithRelations | null>(null);
  const [statusTarget, setStatusTarget] = useState<{
    opportunity: OpportunityWithRelations;
    status: "won" | "lost";
  } | null>(null);

  const archiveMutation = useMutation({
    mutationFn: (isArchived: boolean) =>
      archive({ data: { id: contactId, is_archived: isArchived } }),
    onSuccess: (_data, isArchived) => {
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: postSaleDueKey });
      setConfirmArchive(false);
      toast.success(isArchived ? "Cliente arquivado" : "Cliente reativado");
    },
    onError: () => toast.error("Não foi possível alterar o status do cliente."),
  });

  const statusMutation = useMutation({
    mutationFn: (input: { id: string; status: "won" | "lost" }) => update({ data: input }),
    onSuccess: (_data, input) => {
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
      queryClient.invalidateQueries({ queryKey: ["opportunities"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: postSaleDueKey });
      toast.success(
        input.status === "won"
          ? "Oportunidade marcada como ganha"
          : "Oportunidade marcada como perdida",
      );
      setStatusTarget(null);
      if (input.status === "won") void navigate({ search: { aba: "pos-venda" }, replace: true });
    },
    onError: () => toast.error("Não foi possível alterar o status da oportunidade."),
  });

  if (detail.isPending) {
    return (
      <AppShell title="Cliente">
        <LoadingState rows={4} />
      </AppShell>
    );
  }

  if (detail.isError || !detail.data) {
    return (
      <AppShell title="Cliente">
        <ErrorState
          title="Cliente não encontrado"
          description="Ele pode ter sido removido ou o endereço está incorreto."
          onRetry={() => detail.refetch()}
        />
      </AppShell>
    );
  }

  const { contact, opportunities, timeline } = detail.data;
  const nextPostSale = contact.is_archived
    ? undefined
    : opportunities
        .filter((item) => item.status === "won" && item.post_sale_stage && item.post_sale_due_on)
        .sort((a, b) => (a.post_sale_due_on ?? "").localeCompare(b.post_sale_due_on ?? ""))[0];
  const conversationId = conversation.data?.id ?? null;

  return (
    <AppShell
      title={contact.name}
      description={formatPhone(contact.phone) || contact.email || "Sem contato registrado"}
      actions={
        conversationId ? (
          <Button asChild variant="outline">
            <Link to="/conversas" search={{ conversa: conversationId }}>
              <MessageSquare className="size-4" aria-hidden />
              Conversa
            </Link>
          </Button>
        ) : null
      }
    >
      <div className="mx-auto max-w-5xl space-y-4">
        <Link
          to="/clientes"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Clientes
        </Link>

        {contact.is_archived && <Badge variant="secondary">Cliente arquivado</Badge>}

        <Tabs
          value={aba ?? "resumo"}
          onValueChange={(value) => {
            const tab = sectionSchema.safeParse(value);
            if (tab.success)
              void navigate({
                search: { aba: tab.data === "resumo" ? undefined : tab.data },
                replace: true,
              });
          }}
        >
          <TabsList
            aria-label="Seções do cliente"
            className="h-auto max-w-full flex-wrap justify-start gap-1"
          >
            <TabsTrigger value="resumo">Resumo</TabsTrigger>
            <TabsTrigger value="acompanhamento">Acompanhamento</TabsTrigger>
            <TabsTrigger value="pos-venda">Pós-venda</TabsTrigger>
            <TabsTrigger value="historico">Histórico</TabsTrigger>
            <TabsTrigger value="dados">Dados</TabsTrigger>
          </TabsList>

          <TabsContent value="resumo" className="mt-4 space-y-4">
            {nextPostSale?.post_sale_stage && nextPostSale.post_sale_due_on && (
              <Link
                to="/clientes/$contactId"
                params={{ contactId }}
                search={{ aba: "pos-venda" }}
                className="flex items-center gap-3 rounded-lg border bg-card px-4 py-3 text-sm hover:border-primary/50"
              >
                <CalendarClock className="size-4 shrink-0 text-primary" aria-hidden />
                <span>
                  <span className="font-medium">{postSaleTask(nextPostSale.post_sale_stage)}</span>
                  <span className="text-muted-foreground">
                    {" "}
                    · {displayPostSaleDay(nextPostSale.post_sale_due_on)}
                  </span>
                </span>
              </Link>
            )}
            <section className="overflow-hidden rounded-xl border bg-card">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3 sm:px-5">
                <h2 className="text-base font-semibold">Oportunidades</h2>
                {!contact.is_archived && (
                  <Button size="sm" onClick={() => setCreatingOpportunity(true)}>
                    <Plus aria-hidden />
                    Nova oportunidade
                  </Button>
                )}
              </div>
              {opportunities.length === 0 ? (
                <div className="p-4">
                  <EmptyState
                    title="Nenhuma oportunidade"
                    description="As negociações deste cliente aparecem aqui."
                  />
                </div>
              ) : (
                <ul className="divide-y">
                  {opportunities.map((opportunity) => (
                    <li
                      key={opportunity.id}
                      className="flex items-start justify-between gap-2 px-4 py-3.5 sm:px-5"
                    >
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <p className="break-words font-medium">{opportunity.title}</p>
                          <Badge variant="secondary">
                            {OPPORTUNITY_STATUS_LABELS[opportunity.status]}
                          </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {opportunity.stage_name} · {formatCurrency(opportunity.estimated_value)}
                        </p>
                        {opportunity.status === "open" && (
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
                            {opportunity.next_action_description ?? "Próxima ação não definida"}
                            {opportunity.next_action_at && (
                              <NextActionBadge nextActionAt={opportunity.next_action_at} withDate />
                            )}
                          </div>
                        )}
                        {opportunity.status === "open" && opportunity.post_quote_next_at && (
                          <p className="text-xs text-muted-foreground">
                            Pós-cotação em {formatDateTime(opportunity.post_quote_next_at)}
                          </p>
                        )}
                        {opportunity.status === "won" && opportunity.post_sale_stage && (
                          <Link
                            to="/clientes/$contactId"
                            params={{ contactId }}
                            search={{ aba: "pos-venda" }}
                            className="text-sm text-primary hover:underline"
                          >
                            {POST_SALE_LABELS[opportunity.post_sale_stage]}
                          </Link>
                        )}
                      </div>
                      {opportunity.status === "open" && !contact.is_archived && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              size="icon"
                              variant="ghost"
                              aria-label={`Ações de ${opportunity.title}`}
                            >
                              <Ellipsis className="size-4" aria-hidden />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onSelect={() => setNextActionTarget(opportunity)}>
                              Definir próxima ação
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onSelect={() => setStatusTarget({ opportunity, status: "won" })}
                            >
                              Marcar como ganha
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onSelect={() => setStatusTarget({ opportunity, status: "lost" })}
                            >
                              Marcar como perdida
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </TabsContent>

          <TabsContent value="acompanhamento" className="mt-4 space-y-4">
            {contact.is_archived ? (
              <p className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
                Reative o cliente em Dados para gerenciar os acompanhamentos.
              </p>
            ) : (
              <>
                <PostQuotePanel
                  contactId={contactId}
                  opportunities={opportunities}
                  onCreateOpportunity={() => setCreatingOpportunity(true)}
                />
                <AgentHandoffCard conversationId={conversationId} />
                <ContactTools title="Ferramentas de acompanhamento">
                  <FollowupPanel
                    contactId={contactId}
                    conversationId={conversationId}
                    contactPhone={contact.phone}
                  />
                  <SmartControlCard conversationId={conversationId} />
                  <MessageGeneratorCard contactId={contactId} conversationId={conversationId} />
                </ContactTools>
              </>
            )}
          </TabsContent>

          <TabsContent value="pos-venda" className="mt-4">
            <PostSalePanel
              contactId={contactId}
              conversationId={conversationId}
              opportunities={opportunities}
              archived={contact.is_archived}
            />
          </TabsContent>

          <TabsContent value="historico" className="mt-4 space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Histórico do WhatsApp</CardTitle>
              </CardHeader>
              <CardContent>
                {conversationId ? (
                  <Button asChild variant="outline" size="sm">
                    <Link to="/conversas" search={{ conversa: conversationId }}>
                      Abrir mensagens e mídias
                    </Link>
                  </Button>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {conversation.isPending
                      ? "Consultando conversa…"
                      : conversation.isError
                        ? "Não foi possível verificar o vínculo. Tente novamente em Conversas."
                        : "Nenhuma conversa está vinculada. Para o pós-cotação, tente recuperar o histórico em Acompanhamento. No pós-venda, você pode registrar os dados confirmados na ficha."}
                  </p>
                )}
              </CardContent>
            </Card>
            <section className="space-y-4">
              <h2 className="text-base font-semibold">Atividade na ficha</h2>
              {timeline.length === 0 ? (
                <EmptyState
                  title="Sem atividade registrada"
                  description="As alterações do cliente e das oportunidades aparecem aqui."
                />
              ) : (
                <ol className="space-y-3">
                  {timeline.map((event) => (
                    <li key={event.id} className="rounded-lg border px-4 py-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-medium">
                          {timelineEventLabel(event.event_type)}
                        </p>
                        <Badge variant="outline">{formatDateTime(event.created_at)}</Badge>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </TabsContent>

          <TabsContent value="dados" className="mt-4 space-y-4">
            <Card>
              <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-3">
                <CardTitle className="text-base">Dados do cliente</CardTitle>
                <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                  <Pencil aria-hidden />
                  Editar dados
                </Button>
              </CardHeader>
              <CardContent className="grid gap-4 text-sm sm:grid-cols-2">
                <Field label="Telefone" value={formatPhone(contact.phone) || "—"} />
                <Field label="E-mail" value={contact.email ?? "—"} />
                <Field label="Origem" value={contact.source ?? "—"} />
                <Field label="Cadastrado em" value={formatDateTime(contact.created_at)} />
                <div className="sm:col-span-2">
                  <Field label="Observações" value={contact.notes ?? "—"} />
                </div>
                <div className="border-t pt-3 sm:col-span-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={archiveMutation.isPending}
                    onClick={() =>
                      contact.is_archived ? archiveMutation.mutate(false) : setConfirmArchive(true)
                    }
                  >
                    {contact.is_archived ? "Reativar cliente" : "Arquivar cliente"}
                  </Button>
                </div>
              </CardContent>
            </Card>
            <ContactPreferencesCard contactId={contactId} />
            <ContactTools title="Ficha comercial e inteligência">
              <DealSheetCard contactId={contactId} />
              <IntelligenceCard contactId={contactId} conversationId={conversationId} />
            </ContactTools>
          </TabsContent>
        </Tabs>
      </div>

      <AlertDialog
        open={confirmArchive}
        onOpenChange={(open) => !archiveMutation.isPending && setConfirmArchive(open)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Arquivar {contact.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              O cliente sairá da lista ativa e os lembretes de pós-venda serão ocultados. Você pode
              reativá-lo na ficha a qualquer momento.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={archiveMutation.isPending}>Voltar</AlertDialogCancel>
            <AlertDialogAction
              disabled={archiveMutation.isPending}
              onClick={(event) => {
                event.preventDefault();
                archiveMutation.mutate(true);
              }}
            >
              {archiveMutation.isPending ? "Arquivando…" : "Arquivar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ContactFormDialog open={editing} onOpenChange={setEditing} contact={contact} />
      <OpportunityFormDialog
        open={creatingOpportunity}
        onOpenChange={setCreatingOpportunity}
        contactId={contactId}
      />
      {nextActionTarget ? (
        <NextActionDialog
          open={nextActionTarget !== null}
          onOpenChange={(open) => {
            if (!open) setNextActionTarget(null);
          }}
          opportunity={nextActionTarget}
        />
      ) : null}

      <AlertDialog
        open={statusTarget !== null}
        onOpenChange={(open) => {
          if (!open && !statusMutation.isPending) setStatusTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {statusTarget?.status === "won"
                ? "Marcar oportunidade como ganha?"
                : "Marcar oportunidade como perdida?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {statusTarget
                ? `“${statusTarget.opportunity.title}” sairá do pipeline aberto e o evento será registrado no histórico. Você pode reabrir depois editando a oportunidade.`
                : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={statusMutation.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={statusMutation.isPending}
              onClick={(event) => {
                event.preventDefault();
                if (!statusTarget) return;
                statusMutation.mutate({
                  id: statusTarget.opportunity.id,
                  status: statusTarget.status,
                });
              }}
            >
              {statusMutation.isPending ? "Salvando..." : "Confirmar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}

function ContactTools({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Collapsible className="rounded-lg border bg-card p-4">
      <CollapsibleTrigger className="group flex w-full items-center justify-between gap-2 text-left text-sm font-medium focus-visible:outline-2 focus-visible:outline-ring">
        {title}
        <ChevronDown className="size-4 group-data-[state=open]:rotate-180" aria-hidden />
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-4 space-y-4">{children}</CollapsibleContent>
    </Collapsible>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 whitespace-pre-line">{value}</p>
    </div>
  );
}
