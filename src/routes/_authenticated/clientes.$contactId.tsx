import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, Pencil, Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { ContactFormDialog } from "@/components/contact-form-dialog";
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
import { setContactArchived, updateOpportunity } from "@/lib/crm.functions";
import { contactDetailQuery } from "@/lib/crm.queries";
import type { OpportunityWithRelations } from "@/lib/crm.types";
import { formatDateTime } from "@/lib/domain/datetime";
import { timelineEventLabel } from "@/lib/domain/events";
import { formatCurrency, OPPORTUNITY_STATUS_LABELS } from "@/lib/domain/opportunity-status";
import { formatPhone } from "@/lib/domain/phone";

export const Route = createFileRoute("/_authenticated/clientes/$contactId")({
  head: () => ({
    meta: [
      { title: "Cliente — Próximo Passo" },
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
  const queryClient = useQueryClient();
  const detail = useQuery(contactDetailQuery(contactId));
  const archive = useServerFn(setContactArchived);
  const update = useServerFn(updateOpportunity);

  const [editing, setEditing] = useState(false);
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
      toast.success(
        input.status === "won"
          ? "Oportunidade marcada como ganha"
          : "Oportunidade marcada como perdida",
      );
      setStatusTarget(null);
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

  return (
    <AppShell
      title={contact.name}
      description={formatPhone(contact.phone) || contact.email || "Sem contato registrado"}
      actions={
        <>
          {conversation.data && (
            <Button asChild variant="outline">
              <Link to="/conversas" search={{ conversa: conversation.data.id }}>
                <MessageSquare className="size-4" />
                Conversa
              </Link>
            </Button>
          )}
          <Button variant="outline" onClick={() => setEditing(true)}>
            <Pencil className="size-4" />
            Editar
          </Button>
          <Button onClick={() => setCreatingOpportunity(true)}>
            <Plus className="size-4" />
            Oportunidade
          </Button>
        </>
      }
    >
      <div className="space-y-8">
        <Link
          to="/clientes"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Voltar para clientes
        </Link>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Dados do cliente</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 text-sm sm:grid-cols-2">
            <Field label="Telefone" value={formatPhone(contact.phone) || "—"} />
            <Field label="E-mail" value={contact.email ?? "—"} />
            <Field label="Origem" value={contact.source ?? "—"} />
            <Field label="Cadastrado em" value={formatDateTime(contact.created_at)} />
            <div className="sm:col-span-2">
              <Field label="Observações" value={contact.notes ?? "—"} />
            </div>
            <div className="sm:col-span-2">
              <Button
                variant="outline"
                disabled={archiveMutation.isPending}
                onClick={() => archiveMutation.mutate(!contact.is_archived)}
              >
                {contact.is_archived ? "Reativar cliente" : "Arquivar cliente"}
              </Button>
              <p className="mt-2 text-xs text-muted-foreground">
                Arquivar preserva todo o histórico; nada é excluído.
              </p>
            </div>
          </CardContent>
        </Card>

        <section className="space-y-4">
          <h2 className="text-base font-semibold">Oportunidades</h2>
          {opportunities.length === 0 ? (
            <EmptyState
              title="Nenhuma oportunidade"
              description="Crie a primeira oportunidade para acompanhar esta negociação no pipeline."
              action={
                <Button onClick={() => setCreatingOpportunity(true)}>
                  <Plus className="size-4" />
                  Nova oportunidade
                </Button>
              }
            />
          ) : (
            <ul className="divide-y rounded-lg border">
              {opportunities.map((opportunity) => (
                <li
                  key={opportunity.id}
                  className="flex flex-wrap items-center justify-between gap-3 px-4 py-4"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">{opportunity.title}</p>
                    <p className="truncate text-sm text-muted-foreground">
                      {opportunity.stage_name} · {formatCurrency(opportunity.estimated_value)} ·{" "}
                      {OPPORTUNITY_STATUS_LABELS[opportunity.status]}
                    </p>
                    <p className="mt-1 truncate text-sm text-muted-foreground">
                      {opportunity.next_action_description ?? "Próxima ação não definida"}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <NextActionBadge nextActionAt={opportunity.next_action_at} withDate />
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setNextActionTarget(opportunity)}
                    >
                      Definir ação
                    </Button>
                    {opportunity.status === "open" ? (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setStatusTarget({ opportunity, status: "won" })}
                        >
                          Marcar como ganha
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setStatusTarget({ opportunity, status: "lost" })}
                        >
                          Marcar como perdida
                        </Button>
                      </>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="space-y-4">
          <h2 className="text-base font-semibold">Histórico</h2>
          {timeline.length === 0 ? (
            <EmptyState
              title="Sem histórico ainda"
              description="Cada alteração relevante do cliente e das oportunidades aparece aqui."
            />
          ) : (
            <ol className="space-y-3">
              {timeline.map((event) => (
                <li key={event.id} className="rounded-lg border px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium">{timelineEventLabel(event.event_type)}</p>
                    <Badge variant="outline">{formatDateTime(event.created_at)}</Badge>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>

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

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 whitespace-pre-line">{value}</p>
    </div>
  );
}
