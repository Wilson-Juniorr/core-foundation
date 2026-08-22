import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { scheduleMessage } from "@/lib/followup.functions";
import { followupKeys } from "@/lib/followup.queries";

/** datetime-local (hora local do navegador) -> ISO com offset. */
function toIsoWithOffset(localValue: string): string {
  const date = new Date(localValue);
  return date.toISOString();
}

function defaultLocalValue(): string {
  const date = new Date(Date.now() + 60 * 60 * 1000);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function ScheduleMessageDialog({
  open,
  onOpenChange,
  conversationId,
  contactId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversationId: string;
  contactId?: string | null;
}) {
  const queryClient = useQueryClient();
  const [content, setContent] = useState("");
  const [when, setWhen] = useState(defaultLocalValue());

  useEffect(() => {
    if (open) {
      setContent("");
      setWhen(defaultLocalValue());
    }
  }, [open]);

  const mutation = useMutation({
    mutationFn: () =>
      scheduleMessage({
        data: {
          conversationId,
          contactId: contactId ?? null,
          scheduledFor: toIsoWithOffset(when),
          actionType: "text_message",
          content,
          cancelOnReply: true,
        },
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: followupKeys.root });
      toast.success("Mensagem agendada.");
      onOpenChange(false);
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Não foi possível agendar a mensagem."),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Agendar mensagem</DialogTitle>
          <DialogDescription>
            O envio respeita a janela de horário configurada e é cancelado se o cliente responder
            antes.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="schedule-when">Data e hora</Label>
            <Input
              id="schedule-when"
              type="datetime-local"
              value={when}
              onChange={(event) => setWhen(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="schedule-content">Mensagem</Label>
            <Textarea
              id="schedule-content"
              rows={4}
              value={content}
              onChange={(event) => setContent(event.target.value)}
              placeholder="Olá {{first_name}}, passando para confirmar..."
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || content.trim().length === 0}
          >
            {mutation.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
            Agendar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
