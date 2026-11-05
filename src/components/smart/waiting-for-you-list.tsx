import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { EmptyState, ErrorState, LoadingState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { formatDateTime } from "@/lib/domain/datetime";
import { waitingForYouQuery } from "@/lib/handoff.queries";

/** Todo cliente com acompanhamento parado aparece aqui, com motivo e desde quando. */
export function WaitingForYouList() {
  const list = useQuery(waitingForYouQuery());

  if (list.isLoading) return <LoadingState />;
  if (list.isError) return <ErrorState error={list.error} onRetry={() => list.refetch()} />;
  const items = list.data ?? [];
  if (items.length === 0) {
    return (
      <EmptyState
        title="Ninguém esperando você"
        description="Quando o agente passar um cliente para você, ele aparece aqui com o motivo."
      />
    );
  }

  return (
    <div className="space-y-2">
      {items.map((item) => (
        <Card key={item.conversationId}>
          <CardContent className="flex flex-wrap items-start justify-between gap-3 p-4 text-sm">
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                {item.contactId ? (
                  <Link
                    to="/clientes/$contactId"
                    params={{ contactId: item.contactId }}
                    className="font-medium text-primary hover:underline"
                  >
                    {item.contactName}
                  </Link>
                ) : (
                  <span className="font-medium">{item.contactName}</span>
                )}
                {item.customerWaiting ? (
                  <Badge variant="destructive">Esperando sua resposta</Badge>
                ) : null}
              </div>
              <p className="text-muted-foreground">{item.reason}</p>
            </div>
            <div className="text-right text-xs text-muted-foreground">
              {item.since ? <p>Desde {formatDateTime(item.since)}</p> : null}
              {item.returnLabel ? (
                <p className="text-foreground">
                  {item.returnLabel}
                  {item.returnAt ? ` · ${formatDateTime(item.returnAt)}` : ""}
                </p>
              ) : (
                <p>Sem volta agendada</p>
              )}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
