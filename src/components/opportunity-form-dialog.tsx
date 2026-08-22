import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { createOpportunity } from "@/lib/crm.functions";
import { pipelineStagesQuery } from "@/lib/crm.queries";
import { fromDateTimeInputValue } from "@/lib/domain/datetime";

type FormState = {
  title: string;
  pipeline_stage_id: string;
  estimated_value: string;
  next_action_description: string;
  next_action_at: string;
  notes: string;
};

const EMPTY_FORM: FormState = {
  title: "",
  pipeline_stage_id: "",
  estimated_value: "",
  next_action_description: "",
  next_action_at: "",
  notes: "",
};

export function OpportunityFormDialog({
  open,
  onOpenChange,
  contactId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contactId: string;
}) {
  const queryClient = useQueryClient();
  const create = useServerFn(createOpportunity);
  const stages = useQuery(pipelineStagesQuery());
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  useEffect(() => {
    if (!open) return;
    const firstStage = stages.data?.[0]?.id ?? "";
    setForm({ ...EMPTY_FORM, pipeline_stage_id: firstStage });
  }, [open, stages.data]);

  const mutation = useMutation({
    mutationFn: () =>
      create({
        data: {
          contact_id: contactId,
          pipeline_stage_id: form.pipeline_stage_id,
          title: form.title,
          estimated_value: form.estimated_value === "" ? null : Number(form.estimated_value),
          next_action_description: form.next_action_description,
          next_action_at: fromDateTimeInputValue(form.next_action_at),
          notes: form.notes,
        },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["contacts", contactId] });
      queryClient.invalidateQueries({ queryKey: ["opportunities"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success("Oportunidade criada");
      onOpenChange(false);
    },
    onError: () => toast.error("Não foi possível criar a oportunidade. Tente novamente."),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Nova oportunidade</DialogTitle>
          <DialogDescription>
            Defina a etapa do pipeline e, de preferência, já registre a próxima ação.
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!form.pipeline_stage_id) {
              toast.error("Selecione uma etapa do pipeline.");
              return;
            }
            mutation.mutate();
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="opportunity-title">Título</Label>
            <Input
              id="opportunity-title"
              required
              value={form.title}
              onChange={(event) => setForm({ ...form, title: event.target.value })}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="opportunity-stage">Etapa</Label>
              <Select
                value={form.pipeline_stage_id}
                onValueChange={(value) => setForm({ ...form, pipeline_stage_id: value })}
              >
                <SelectTrigger id="opportunity-stage">
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  {(stages.data ?? []).map((stage) => (
                    <SelectItem key={stage.id} value={stage.id}>
                      {stage.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="opportunity-value">Valor estimado</Label>
              <Input
                id="opportunity-value"
                type="number"
                min="0"
                step="0.01"
                value={form.estimated_value}
                onChange={(event) => setForm({ ...form, estimated_value: event.target.value })}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="opportunity-next-action">Próxima ação</Label>
            <Input
              id="opportunity-next-action"
              placeholder="Ex.: confirmar se analisou a cotação"
              value={form.next_action_description}
              onChange={(event) =>
                setForm({ ...form, next_action_description: event.target.value })
              }
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="opportunity-next-action-at">Data e hora da próxima ação</Label>
            <Input
              id="opportunity-next-action-at"
              type="datetime-local"
              value={form.next_action_at}
              onChange={(event) => setForm({ ...form, next_action_at: event.target.value })}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="opportunity-notes">Observações</Label>
            <Textarea
              id="opportunity-notes"
              rows={3}
              value={form.notes}
              onChange={(event) => setForm({ ...form, notes: event.target.value })}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? "Criando…" : "Criar oportunidade"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
