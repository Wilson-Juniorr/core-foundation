import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
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
import { updateOpportunity } from "@/lib/crm.functions";
import type { OpportunityWithRelations } from "@/lib/crm.types";
import { fromDateTimeInputValue, toDateTimeInputValue } from "@/lib/domain/datetime";

export function NextActionDialog({
  open,
  onOpenChange,
  opportunity,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  opportunity: OpportunityWithRelations;
}) {
  const queryClient = useQueryClient();
  const update = useServerFn(updateOpportunity);
  const [description, setDescription] = useState("");
  const [at, setAt] = useState("");

  useEffect(() => {
    if (!open) return;
    setDescription(opportunity.next_action_description ?? "");
    setAt(toDateTimeInputValue(opportunity.next_action_at));
  }, [open, opportunity]);

  const mutation = useMutation({
    mutationFn: () =>
      update({
        data: {
          id: opportunity.id,
          next_action_description: description.trim() === "" ? null : description.trim(),
          next_action_at: fromDateTimeInputValue(at),
        },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["contacts", opportunity.contact_id] });
      queryClient.invalidateQueries({ queryKey: ["opportunities"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success("Próxima ação atualizada");
      onOpenChange(false);
    },
    onError: () => toast.error("Não foi possível atualizar a próxima ação."),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Próxima ação</DialogTitle>
          <DialogDescription>{opportunity.title}</DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            mutation.mutate();
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="next-action-description">Descrição</Label>
            <Input
              id="next-action-description"
              placeholder="Ex.: confirmar se analisou a cotação"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="next-action-at">Data e hora</Label>
            <Input
              id="next-action-at"
              type="datetime-local"
              value={at}
              onChange={(event) => setAt(event.target.value)}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? "Salvando…" : "Salvar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
