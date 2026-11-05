import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, Hand, Loader2, MessageSquareText, Send, UserRound, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { formatDateTime } from "@/lib/domain/datetime";
import {
  cancelInstructionFn,
  interpretInstructionFn,
  returnAgentNowFn,
  saveInstructionFn,
} from "@/lib/handoff.functions";
import { agentHandoffQuery, handoffKeys } from "@/lib/handoff.queries";
import { smartKeys } from "@/lib/smart.queries";

type Interpretation = Awaited<ReturnType<typeof interpretInstructionFn>>;

const OWNER_LABEL = { ai: "Agente", human: "Você", none: "Ninguém" } as const;

const STATUS_LABEL: Record<string, string> = {
  active: "valendo",
  applied: "cumprida",
  superseded: "substituída",
  cancelled: "cancelada",
};

/**
 * Quem conduz a conversa, por que o agente saiu, quando ele volta — e a caixa
 * para você conversar com o agente sobre este cliente.
 */
export function AgentHandoffCard({ conversationId }: { conversationId: string | null }) {
  const queryClient = useQueryClient();
  const view = useQuery(agentHandoffQuery(conversationId));
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<Interpretation | null>(null);

  const refresh = async () => {
    if (!conversationId) return;
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: handoffKeys.conversation(conversationId) }),
      queryClient.invalidateQueries({ queryKey: smartKeys.conversation(conversationId) }),
      queryClient.invalidateQueries({ queryKey: handoffKeys.waiting }),
    ]);
  };

  const interpret = useMutation({
    mutationFn: () => interpretInstructionFn({ data: { conversationId: conversationId!, text } }),
    onSuccess: (result) => setPreview(result),
    onError: (error: Error) => toast.error(error.message),
  });

  const save = useMutation({
    mutationFn: () =>
      saveInstructionFn({
        data: { conversationId: conversationId!, text, interpretation: preview! },
      }),
    onSuccess: async () => {
      setText("");
      setPreview(null);
      await refresh();
      toast.success("Instrução salva.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const cancel = useMutation({
    mutationFn: (instructionId: string) => cancelInstructionFn({ data: { instructionId } }),
    onSuccess: refresh,
    onError: (error: Error) => toast.error(error.message),
  });

  const returnNow = useMutation({
    mutationFn: (mode: "auto" | "confirm") =>
      returnAgentNowFn({ data: { conversationId: conversationId!, mode } }),
    onSuccess: async () => {
      await refresh();
      toast.success("O agente voltou a acompanhar este cliente.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (!conversationId) return null;
  const data = view.data;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          {data?.owner === "ai" ? (
            <Bot className="size-4 text-primary" />
          ) : (
            <UserRound className="size-4 text-primary" />
          )}
          Quem conduz a conversa
          {data ? (
            <Badge variant={data.owner === "ai" ? "default" : "secondary"}>
              {OWNER_LABEL[data.owner]}
            </Badge>
          ) : null}
          {data?.customerWaiting ? (
            <Badge variant="destructive">Cliente esperando resposta</Badge>
          ) : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {view.isLoading ? (
          <p className="text-muted-foreground">Carregando…</p>
        ) : !data ? null : (
          <>
            {!data.hasSmartRun ? (
              <p className="text-muted-foreground">
                Sem acompanhamento inteligente neste cliente. As instruções ficam guardadas e valem
                quando você iniciar um.
              </p>
            ) : data.owner === "ai" ? (
              <p className="text-muted-foreground">
                O agente está acompanhando. Se você mandar mensagem, ele sai na hora.
              </p>
            ) : (
              <div className="space-y-2 rounded-md border bg-muted/40 p-3">
                {data.handoff ? (
                  <p>
                    <span className="font-medium">Saiu porque:</span>{" "}
                    {data.handoff.reason ?? data.handoff.label}
                    {data.handoff.at ? (
                      <span className="text-muted-foreground">
                        {" "}
                        · desde {formatDateTime(data.handoff.at)}
                      </span>
                    ) : null}
                  </p>
                ) : null}
                {data.returnPlan ? (
                  <p>
                    <span className="font-medium">Volta:</span> {data.returnPlan.label}
                    {data.returnPlan.at ? ` — ${formatDateTime(data.returnPlan.at)}` : ""}
                    {data.returnPlan.reason ? (
                      <span className="block text-muted-foreground">
                        {data.returnPlan.reason}
                        {data.returnPlan.source === "instruction" ? " (sua instrução)" : ""}
                      </span>
                    ) : null}
                  </p>
                ) : data.analyzingAt ? (
                  <p className="text-muted-foreground">
                    O agente vai analisar a conversa em {formatDateTime(data.analyzingAt)} para
                    decidir quando voltar.
                  </p>
                ) : null}
                {data.canReturn ? (
                  <div className="flex flex-wrap gap-2 pt-1">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={returnNow.isPending}
                      onClick={() => returnNow.mutate("auto")}
                    >
                      <Bot className="mr-1 size-4" /> Devolver ao agente agora
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={returnNow.isPending}
                      onClick={() => returnNow.mutate("confirm")}
                    >
                      Devolver, mas me mostrar antes
                    </Button>
                  </div>
                ) : null}
              </div>
            )}

            <div className="space-y-2">
              <p className="flex items-center gap-1.5 font-medium">
                <MessageSquareText className="size-4" /> Instruções para o agente
              </p>
              <Textarea
                value={text}
                onChange={(event) => {
                  setText(event.target.value);
                  setPreview(null);
                }}
                rows={2}
                maxLength={500}
                placeholder='Ex.: "Volta a falar com ela segunda, ela tá vendo com o marido" ou "Não fala nada até eu mandar"'
              />
              {preview ? (
                <div className="space-y-2 rounded-md border border-primary/30 bg-primary/5 p-3">
                  <p className="flex items-start gap-1.5">
                    <Bot className="mt-0.5 size-4 shrink-0 text-primary" />
                    {preview.reply}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" disabled={save.isPending} onClick={() => save.mutate()}>
                      {save.isPending ? <Loader2 className="mr-1 size-4 animate-spin" /> : null}
                      Confirmar
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setPreview(null)}>
                      Corrigir
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    disabled={text.trim().length < 3 || interpret.isPending}
                    onClick={() => interpret.mutate()}
                  >
                    {interpret.isPending ? (
                      <Loader2 className="mr-1 size-4 animate-spin" />
                    ) : (
                      <Send className="mr-1 size-4" />
                    )}
                    Enviar ao agente
                  </Button>
                  {data.owner === "ai" && data.hasSmartRun ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={interpret.isPending}
                      onClick={() => {
                        setText("Não fala nada com esse cliente até eu mandar");
                        setPreview(null);
                      }}
                    >
                      <Hand className="mr-1 size-4" /> Segurar comigo
                    </Button>
                  ) : null}
                </div>
              )}
            </div>

            {data.instructions.length > 0 ? (
              <ul className="space-y-2 border-t pt-3">
                {data.instructions.map((item) => (
                  <li key={item.id} className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="break-words">“{item.text}”</p>
                      {item.reply ? (
                        <p className="text-xs text-muted-foreground">{item.reply}</p>
                      ) : null}
                      <p className="text-[11px] text-muted-foreground">
                        {formatDateTime(item.createdAt)} · {STATUS_LABEL[item.status] ?? item.status}
                      </p>
                    </div>
                    {item.status === "active" ? (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-7 shrink-0"
                        aria-label="Cancelar instrução"
                        disabled={cancel.isPending}
                        onClick={() => cancel.mutate(item.id)}
                      >
                        <X className="size-4" />
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
