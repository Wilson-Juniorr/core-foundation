import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Plus, Search } from "lucide-react";
import { useState } from "react";

import { AppShell } from "@/components/app-shell";
import { ContactFormDialog } from "@/components/contact-form-dialog";
import { EmptyState, ErrorState, LoadingState } from "@/components/states";
import { ReadContactDialog } from "@/components/read-contact-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Camera, Plus, Search } from "lucide-react";
import { contactsQuery } from "@/lib/crm.queries";
import { formatPhone } from "@/lib/domain/phone";

export const Route = createFileRoute("/_authenticated/clientes/")({
  head: () => ({
    meta: [
      { title: "Clientes — Próximo Passo" },
      {
        name: "description",
        content: "Cadastro central de clientes com busca, arquivamento e histórico.",
      },
      { property: "og:title", content: "Clientes — Próximo Passo" },
      {
        property: "og:description",
        content: "Cadastro central de clientes com busca, arquivamento e histórico.",
      },
    ],
  }),
  component: ContactsPage,
});

function ContactsPage() {
  const [search, setSearch] = useState("");
  const [includeArchived, setIncludeArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  const contacts = useQuery(contactsQuery(search, includeArchived));

  return (
    <AppShell
      title="Clientes"
      description="Todo cliente cadastrado uma única vez, com histórico preservado."
      actions={
        <Button onClick={() => setCreating(true)}>
          <Plus className="size-4" />
          Novo cliente
        </Button>
      }
    >
      <div className="space-y-6">
        <div className="flex flex-wrap items-center gap-4">
          <div className="relative min-w-56 flex-1">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Buscar por nome, telefone ou e-mail"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              aria-label="Buscar clientes"
            />
          </div>
          <div className="flex items-center gap-2">
            <Switch
              id="include-archived"
              checked={includeArchived}
              onCheckedChange={setIncludeArchived}
            />
            <Label htmlFor="include-archived" className="text-sm text-muted-foreground">
              Mostrar arquivados
            </Label>
          </div>
        </div>

        {contacts.isPending ? (
          <LoadingState rows={5} />
        ) : contacts.isError ? (
          <ErrorState onRetry={() => contacts.refetch()} />
        ) : contacts.data.length === 0 ? (
          <EmptyState
            title={search ? "Nenhum cliente encontrado" : "Nenhum cliente cadastrado"}
            description={
              search
                ? "Ajuste a busca ou cadastre um novo cliente com esse contato."
                : "Cadastre o primeiro cliente para começar a acompanhar oportunidades."
            }
            action={
              <Button onClick={() => setCreating(true)}>
                <Plus className="size-4" />
                Novo cliente
              </Button>
            }
          />
        ) : (
          <ul className="divide-y rounded-lg border">
            {contacts.data.map((contact) => (
              <li key={contact.id}>
                <Link
                  to="/clientes/$contactId"
                  params={{ contactId: contact.id }}
                  className="flex flex-wrap items-center justify-between gap-3 px-4 py-4 transition-colors hover:bg-secondary/50"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">{contact.name}</p>
                    <p className="truncate text-sm text-muted-foreground">
                      {formatPhone(contact.phone) || contact.email || "Sem contato registrado"}
                    </p>
                  </div>
                  {contact.is_archived ? <Badge variant="outline">Arquivado</Badge> : null}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      <ContactFormDialog open={creating} onOpenChange={setCreating} />
    </AppShell>
  );
}
