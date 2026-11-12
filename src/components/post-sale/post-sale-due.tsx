import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { CalendarClock, ChevronRight } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { displayPostSaleDay, postSaleTask } from "@/lib/domain/post-sale";
import { postSaleDueQuery } from "@/lib/post-sale.queries";

export function PostSaleDue() {
  const due = useQuery(postSaleDueQuery());
  if (due.isError) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card px-4 py-3 text-sm">
        Não foi possível verificar os prazos de pós-venda.
        <Button size="sm" variant="outline" onClick={() => due.refetch()}>
          Tentar novamente
        </Button>
      </div>
    );
  }
  if (!due.data?.items.length) return null;
  const { today, items, total } = due.data;
  return (
    <section className="overflow-hidden rounded-xl border bg-card" aria-labelledby="post-sale-due">
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
        <CalendarClock className="size-4 text-primary" aria-hidden />
        <h2 id="post-sale-due" className="font-semibold">
          Pós-vendas com prazo
        </h2>
        <Badge variant="secondary">{total}</Badge>
      </div>
      <ul className="divide-y">
        {items.map((item) => (
          <li key={item.id}>
            <Link
              to="/clientes/$contactId"
              params={{ contactId: item.contactId }}
              search={{ aba: "pos-venda" }}
              className="flex flex-wrap items-center gap-2 px-4 py-3 text-sm hover:bg-accent/50"
            >
              <div className="min-w-0 flex-1 basis-36">
                <p className="break-words font-medium">{item.contactName}</p>
                <p className="break-words text-muted-foreground">
                  {postSaleTask(item.stage)} · {item.title}
                </p>
              </div>
              <Badge variant={item.dueOn < today ? "destructive" : "outline"}>
                {item.dueOn < today ? displayPostSaleDay(item.dueOn) : "Hoje"}
              </Badge>
              <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
      {total > items.length && (
        <p className="border-t px-4 py-3 text-sm text-muted-foreground">
          Mostrando os {items.length} prazos mais antigos.
        </p>
      )}
    </section>
  );
}
