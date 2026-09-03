import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { saveSmartFlowFn } from "@/lib/smart.functions";
import { smartFlowQuery, smartKeys } from "@/lib/smart.queries";
import {
  AUTONOMY_LABELS,
  AUTONOMY_MODES,
  SMART_STRATEGIES,
  SMART_STRATEGY_META,
} from "@/lib/smart/types";
import type { AutonomyMode, SmartStrategy } from "@/lib/smart/types";

interface FormState {
  name: string;
  description: string;
  goal: string;
  max_duration_days: number;
  autonomy: AutonomyMode;
  allowed_strategies: SmartStrategy[];
  max_pressure: number;
  min_hours_between_actions: number;
  max_actions_per_week: number;
  confidence_min: number;
  window_start: string;
  window_end: string;
  handoff_situations: string;
  completion_criteria: string;
  is_active: boolean;
}

const DEFAULTS: FormState = {
  name: "Acompanhamento pós-cotação",
  description: "",
  goal: "Levar o cliente à decisão depois da cotação enviada, sem pressionar.",
  max_duration_days: 30,
  autonomy: "assist",
  allowed_strategies: [
    "LIGHT_FOLLOWUP",
    "QUESTION_DISCOVERY",
    "VALUE_REINFORCEMENT",
    "DECISION_SIMPLIFICATION",
    "WAITING_DECISION",
    "FUTURE_CALLBACK",
    "HUMAN_HANDOFF",
  ],
  max_pressure: 60,
  min_hours_between_actions: 36,
  max_actions_per_week: 2,
  confidence_min: 0.6,
  window_start: "09:00",
  window_end: "19:00",
  handoff_situations: "Cliente irritado\nPedido de desconto\nDúvida jurídica ou contratual",
  completion_criteria: "Cliente fechou, recusou ou pediu retorno em data distante.",
  is_active: true,
};

/** Criação e edição de um fluxo inteligente (sem etapas fixas). */
export function SmartFlowDialog({
  open,
  onOpenChange,
  flowId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  flowId?: string | null;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>(DEFAULTS);
  const existing = useQuery(smartFlowQuery(open && flowId ? flowId : null));

  useEffect(() => {
    if (!open) return;
    if (!flowId) {
      setForm(DEFAULTS);
      return;
    }
    const data = existing.data;
    if (!data?.config) return;
    setForm({
      name: data.name,
      description: data.description ?? "",
      goal: data.config.goal,
      max_duration_days: data.config.max_duration_days,
      autonomy: data.config.autonomy as AutonomyMode,
      allowed_strategies: (data.config.allowed_strategies ?? []) as SmartStrategy[],
      max_pressure: data.config.max_pressure,
      min_hours_between_actions: data.config.min_hours_between_actions,
      max_actions_per_week: data.config.max_actions_per_week,
      confidence_min: Number(data.config.confidence_min),
      window_start: data.window_start?.slice(0, 5) ?? "09:00",
      window_end: data.window_end?.slice(0, 5) ?? "19:00",
      handoff_situations: (data.config.handoff_situations ?? []).join("\n"),
      completion_criteria: data.config.completion_criteria ?? "",
      is_active: data.is_active,
    });
  }, [open, flowId, existing.data]);

  const save = useMutation({
    mutationFn: () =>
      saveSmartFlowFn({
        data: {
          id: flowId ?? undefined,
          name: form.name,
          description: form.description,
          is_active: form.is_active,
          window_start: form.window_start,
          window_end: form.window_end,
          goal: form.goal,
          max_duration_days: form.max_duration_days,
          autonomy: form.autonomy,
          allowed_strategies: form.allowed_strategies,
          allowed_media: ["text", "audio"],
          max_pressure: form.max_pressure,
          min_hours_between_actions: form.min_hours_between_actions,
          max_actions_per_week: form.max_actions_per_week,
          handoff_situations: form.handoff_situations
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean),
          completion_criteria: form.completion_criteria,
          confidence_min: form.confidence_min,
        },
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: smartKeys.root });
      toast.success("Fluxo inteligente salvo.");
      onOpenChange(false);
    },
    onError: (error: Error) => toast.error(error.message || "Não foi possível salvar."),
  });

  const toggleStrategy = (strategy: SmartStrategy) =>
    setForm((current) => ({
      ...current,
      allowed_strategies: current.allowed_strategies.includes(strategy)
        ? current.allowed_strategies.filter((item) => item !== strategy)
        : [...current.allowed_strategies, strategy],
    }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {flowId ? "Editar fluxo inteligente" : "Novo fluxo inteligente"}
          </DialogTitle>
          <DialogDescription>
            Você define o objetivo e os limites. A automação decide quando falar, o que usar e
            quando chamar você.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="smart-name">Nome</Label>
            <Input
              id="smart-name"
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="smart-goal">Objetivo comercial</Label>
            <Textarea
              id="smart-goal"
              rows={2}
              value={form.goal}
              onChange={(event) => setForm({ ...form, goal: event.target.value })}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Nível de autonomia</Label>
              <Select
                value={form.autonomy}
                onValueChange={(value) => setForm({ ...form, autonomy: value as AutonomyMode })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {AUTONOMY_MODES.map((mode) => (
                    <SelectItem key={mode} value={mode}>
                      {AUTONOMY_LABELS[mode]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="smart-days">Prazo máximo (dias)</Label>
              <Input
                id="smart-days"
                type="number"
                min={1}
                max={180}
                value={form.max_duration_days}
                onChange={(event) =>
                  setForm({ ...form, max_duration_days: Number(event.target.value) })
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="smart-window-start">Janela — início</Label>
              <Input
                id="smart-window-start"
                type="time"
                value={form.window_start}
                onChange={(event) => setForm({ ...form, window_start: event.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="smart-window-end">Janela — fim</Label>
              <Input
                id="smart-window-end"
                type="time"
                value={form.window_end}
                onChange={(event) => setForm({ ...form, window_end: event.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="smart-gap">Intervalo mínimo entre ações (horas)</Label>
              <Input
                id="smart-gap"
                type="number"
                min={1}
                max={720}
                value={form.min_hours_between_actions}
                onChange={(event) =>
                  setForm({ ...form, min_hours_between_actions: Number(event.target.value) })
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="smart-week">Máximo de ações por semana</Label>
              <Input
                id="smart-week"
                type="number"
                min={1}
                max={14}
                value={form.max_actions_per_week}
                onChange={(event) =>
                  setForm({ ...form, max_actions_per_week: Number(event.target.value) })
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="smart-pressure">Pressão máxima aceita (10–100)</Label>
              <Input
                id="smart-pressure"
                type="number"
                min={10}
                max={100}
                value={form.max_pressure}
                onChange={(event) => setForm({ ...form, max_pressure: Number(event.target.value) })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="smart-confidence">Confiança mínima (0–1)</Label>
              <Input
                id="smart-confidence"
                type="number"
                step="0.05"
                min={0}
                max={1}
                value={form.confidence_min}
                onChange={(event) =>
                  setForm({ ...form, confidence_min: Number(event.target.value) })
                }
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Estratégias permitidas</Label>
            <div className="grid gap-2 sm:grid-cols-2">
              {SMART_STRATEGIES.map((strategy) => (
                <label key={strategy} className="flex items-start gap-2 text-sm">
                  <Checkbox
                    checked={form.allowed_strategies.includes(strategy)}
                    onCheckedChange={() => toggleStrategy(strategy)}
                  />
                  <span>
                    {SMART_STRATEGY_META[strategy].label}
                    <span className="text-muted-foreground block text-xs">
                      {SMART_STRATEGY_META[strategy].intent}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="smart-handoff">Situações que exigem você (uma por linha)</Label>
            <Textarea
              id="smart-handoff"
              rows={3}
              value={form.handoff_situations}
              onChange={(event) => setForm({ ...form, handoff_situations: event.target.value })}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="smart-complete">Critério de encerramento</Label>
            <Textarea
              id="smart-complete"
              rows={2}
              value={form.completion_criteria}
              onChange={(event) => setForm({ ...form, completion_criteria: event.target.value })}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            Salvar fluxo
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
