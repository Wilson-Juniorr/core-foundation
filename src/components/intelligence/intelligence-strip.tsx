import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Brain } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { intelligenceQuery } from "@/lib/ai.queries";
import { intentLabels, interestLabels, sentimentLabels } from "@/lib/ai/labels";

/**
 * Versão compacta da memória do cliente, usada dentro da Central de Conversas.
 *
 * Mostra apenas o essencial (resumo curto + sinais principais) para não competir
 * com a conversa. A leitura completa e as correções ficam na página do cliente.
 */
export function IntelligenceStrip({ contactId }: { contactId: string }) {
  const query = useQuery({ ...intelligenceQuery(contactId), enabled: Boolean(contactId) });
  const memory = query.data?.memory ?? null;

  if (!memory?.current_summary) return null;

  return (
    <div className="border-b bg-muted/30 px-4 py-3">
      <div className="flex items-start gap-2">
        <Brain className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0 space-y-2">
          <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
            {memory.current_summary}
          </p>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="secondary" className="text-[11px]">
              {interestLabels[memory.interest_level]}
            </Badge>
            <Badge variant="outline" className="text-[11px]">
              {intentLabels[memory.customer_intent]}
            </Badge>
            <Badge variant="outline" className="text-[11px]">
              {sentimentLabels[memory.sentiment]}
            </Badge>
            <Link
              to="/clientes/$contactId"
              params={{ contactId }}
              className="text-[11px] font-medium underline underline-offset-2"
            >
              Ver inteligência completa
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
