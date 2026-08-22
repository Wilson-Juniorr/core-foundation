import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";

import { GenerateMessageDialog } from "@/components/library/generate-message-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { draftsQuery } from "@/lib/library.queries";
import { draftStatusLabels } from "@/lib/library/labels";

/** Bloco na página do cliente para gerar e revisar mensagens estratégicas. */
export function MessageGeneratorCard({
  contactId,
  conversationId,
  opportunityId,
}: {
  contactId: string;
  conversationId: string | null;
  opportunityId?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const drafts = useQuery(draftsQuery({ contactId }));
  const pending = (drafts.data ?? []).filter(
    (draft) => draft.status !== "sent" && draft.status !== "rejected",
  );

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 pb-3">
        <div>
          <CardTitle className="text-base">Mensagem estratégica</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            A IA escreve com base no histórico e na memória deste cliente. Você aprova antes do
            envio.
          </p>
        </div>
        <Button size="sm" onClick={() => setOpen(true)}>
          <Sparkles className="mr-2 size-4" />
          Gerar
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {pending.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum rascunho aguardando revisão.</p>
        ) : (
          pending.slice(0, 3).map((draft) => (
            <div key={draft.id} className="rounded-md border border-border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">{draft.strategy_name}</Badge>
                <Badge variant="outline">{draftStatusLabels[draft.status]}</Badge>
              </div>
              <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-sm text-muted-foreground">
                {draft.edited_content ?? draft.generated_content}
              </p>
            </div>
          ))
        )}
        {pending.length > 0 ? (
          <p className="text-xs text-muted-foreground">
            Revise e envie na Biblioteca, aba “Para aprovar”.
          </p>
        ) : null}
      </CardContent>

      <GenerateMessageDialog
        open={open}
        onOpenChange={setOpen}
        contactId={contactId}
        conversationId={conversationId}
        opportunityId={opportunityId ?? null}
      />
    </Card>
  );
}
