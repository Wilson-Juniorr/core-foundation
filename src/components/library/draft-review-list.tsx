import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { EmptyState, ErrorState, LoadingState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { formatDateTime } from "@/lib/domain/datetime";
import {
  approveMessageDraft,
  editMessageDraft,
  rejectMessageDraft,
} from "@/lib/library.functions";
import { draftsQuery, libraryKeys } from "@/lib/library.queries";
import type { DraftStatus, MessageDraft } from "@/lib/library/api-types";
import { draftStatusLabels } from "@/lib/library/labels";

function DraftCard({ draft }: { draft: MessageDraft }) {
  const queryClient = useQueryClient();
  const [content, setContent] = useState(draft.edited_content ?? draft.generated_content);
  const pending = draft.status !== "sent" && draft.status !== "rejected";

  const invalidate = () => queryClient.invalidateQueries({ queryKey: libraryKeys.root });

  const approveMutation = useMutation({
    mutationFn: async () => {
      const current = draft.edited_content ?? draft.generated_content;
      if (content.trim() !== current.trim()) {
        await editMessageDraft({ data: { draftId: draft.id, content: content.trim() } });
      }
      return approveMessageDraft({ data: { draftId: draft.id } });
    },
    onSuccess: async () => {
      await invalidate();
      toast.success("Mensagem enviada.");
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Não foi possível enviar."),
  });

  const rejectMutation = useMutation({
    mutationFn: () => rejectMessageDraft({ data: { draftId: draft.id, reason: null } }),
    onSuccess: async () => {
      await invalidate();
      toast.success("Rascunho recusado.");
    },
  });

  const edited = Boolean(draft.edited_content);

  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {draft.contact_id ? (
            <Link
              to="/clientes/$contactId"
              params={{ contactId: draft.contact_id }}
              className="text-sm font-medium hover:underline"
            >
              {draft.contact_name ?? "Cliente"}
            </Link>
          ) : (
            <span className="text-sm font-medium">{draft.contact_name ?? "Cliente"}</span>
          )}
          <Badge variant="secondary">{draft.strategy_name ?? "Estratégia"}</Badge>
          <Badge variant="outline">{draftStatusLabels[draft.status]}</Badge>
          {edited ? <Badge variant="outline">Editado por você</Badge> : null}
        </div>
        <span className="text-xs text-muted-foreground">{formatDateTime(draft.created_at)}</span>
      </div>

      {pending ? (
        <Textarea
          className="mt-3"
          rows={5}
          value={content}
          onChange={(event) => setContent(event.target.value)}
        />
      ) : (
        <p className="mt-3 whitespace-pre-wrap text-sm text-muted-foreground">
          {draft.edited_content ?? draft.generated_content}
        </p>
      )}

      {draft.suggested_asset ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Material sugerido: {draft.suggested_asset.name}
          {draft.asset_rationale ? ` — ${draft.asset_rationale}` : ""}
        </p>
      ) : null}

      {edited && pending ? (
        <details className="mt-2 text-xs text-muted-foreground">
          <summary className="cursor-pointer">Ver texto original da IA</summary>
          <p className="mt-1 whitespace-pre-wrap">{draft.original_content}</p>
        </details>
      ) : null}

      {draft.rejection_reason ? (
        <p className="mt-2 text-xs text-muted-foreground">Motivo: {draft.rejection_reason}</p>
      ) : null}

      {pending ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            size="sm"
            onClick={() => approveMutation.mutate()}
            disabled={approveMutation.isPending || !content.trim() || !draft.conversation_id}
          >
            {approveMutation.isPending ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
            Aprovar e enviar
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => rejectMutation.mutate()}
            disabled={rejectMutation.isPending}
          >
            Recusar
          </Button>
          {!draft.conversation_id ? (
            <span className="self-center text-xs text-muted-foreground">
              Sem conversa de WhatsApp vinculada.
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function DraftReviewList({ status }: { status: DraftStatus | null }) {
  const drafts = useQuery(draftsQuery({ status }));

  if (drafts.isLoading) return <LoadingState />;
  if (drafts.isError) return <ErrorState onRetry={() => drafts.refetch()} />;

  const items = (drafts.data ?? []).filter((draft) =>
    status ? true : draft.status !== "sent" && draft.status !== "rejected",
  );

  if (items.length === 0) {
    return (
      <EmptyState
        title="Nenhuma mensagem aqui"
        description="Gere mensagens a partir da página do cliente ou da Central de Conversas."
      />
    );
  }

  return (
    <div className="space-y-3">
      {items.map((draft) => (
        <DraftCard key={draft.id} draft={draft} />
      ))}
    </div>
  );
}
