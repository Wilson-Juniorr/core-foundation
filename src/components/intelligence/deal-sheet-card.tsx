import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardList, Pencil, Thermometer } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { updateMemory } from "@/lib/ai.functions";
import { aiKeys, intelligenceQuery } from "@/lib/ai.queries";
import {
  DEAL_STAGES,
  TEMPERATURES,
  dealSheetFieldLabels,
  dealStageLabels,
  temperatureLabels,
  type DealSheet,
  type DealSheetField,
  type Temperature,
} from "@/lib/ai/deal-sheet";
import type { CustomerMemory } from "@/lib/ai/types";
import { formatCurrency } from "@/lib/domain/opportunity-status";

const temperatureClass: Record<Temperature, string> = {
  hot: "bg-destructive text-destructive-foreground",
  warm: "bg-warning text-warning-foreground",
  cold: "bg-primary/15 text-primary",
  unknown: "bg-muted text-muted-foreground",
};

function Origin({ memory, field }: { memory: CustomerMemory | null; field: DealSheetField }) {
  const human = memory?.field_sources?.[field]?.source === "human";
  return (
    <span className="text-[11px] text-muted-foreground">{human ? "você" : "lido pela IA"}</span>
  );
}

function Item({
  label,
  value,
  memory,
  field,
}: {
  label: string;
  value: string | null;
  memory: CustomerMemory | null;
  field: DealSheetField;
}) {
  return (
    <div className="space-y-0.5">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-sm">{value ?? "—"}</p>
      {value ? <Origin memory={memory} field={field} /> : null}
    </div>
  );
}

function EditDialog({
  contactId,
  sheet,
  open,
  onOpenChange,
}: {
  contactId: string;
  sheet: DealSheet;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(() => ({
    deal_stage: sheet.deal_stage,
    temperature: sheet.temperature,
    decision_maker: sheet.decision_maker ?? "",
    quoted_operator: sheet.quoted_operator ?? "",
    quoted_plan: sheet.quoted_plan ?? "",
    quoted_value: sheet.quoted_value != null ? String(sheet.quoted_value) : "",
    quoted_lives: sheet.quoted_lives != null ? String(sheet.quoted_lives) : "",
  }));

  const mutation = useMutation({
    mutationFn: (patch: Record<string, unknown>) =>
      updateMemory({ data: { contactId, patch } as never }),
    onSuccess: async () => {
      toast.success("Ficha salva. A IA não vai mudar o que você corrigiu.");
      await queryClient.invalidateQueries({ queryKey: aiKeys.intelligence(contactId) });
      onOpenChange(false);
    },
    onError: (error: Error) => toast.error(error.message || "Não foi possível salvar."),
  });

  function num(value: string): number | null {
    const parsed = Number(value.replace(/\./g, "").replace(",", "."));
    return value.trim() && Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  function submit() {
    // Só os campos alterados ficam travados como "confirmado por você".
    const next: Partial<DealSheet> = {
      deal_stage: form.deal_stage,
      temperature: form.temperature,
      decision_maker: form.decision_maker.trim() || null,
      quoted_operator: form.quoted_operator.trim() || null,
      quoted_plan: form.quoted_plan.trim() || null,
      quoted_value: num(form.quoted_value),
      quoted_lives: num(form.quoted_lives) != null ? Math.round(num(form.quoted_lives)!) : null,
    };
    const patch = Object.fromEntries(
      Object.entries(next).filter(([key, value]) => value !== sheet[key as keyof DealSheet]),
    );
    if (Object.keys(patch).length === 0) {
      onOpenChange(false);
      return;
    }
    mutation.mutate(patch);
  }

  const text = (key: keyof typeof form, id: string, placeholder: string, inputMode?: "decimal") => (
    <div className="space-y-2">
      <Label htmlFor={id}>{dealSheetFieldLabels[key as DealSheetField]}</Label>
      <Input
        id={id}
        inputMode={inputMode}
        placeholder={placeholder}
        value={form[key]}
        onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.value }))}
      />
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Editar ficha</DialogTitle>
          <DialogDescription>
            O que você mudar aqui fica confirmado e a IA não altera mais.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>{dealSheetFieldLabels.deal_stage}</Label>
            <Select
              value={form.deal_stage}
              onValueChange={(value) =>
                setForm((current) => ({ ...current, deal_stage: value as DealSheet["deal_stage"] }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DEAL_STAGES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {dealStageLabels[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>{dealSheetFieldLabels.temperature}</Label>
            <Select
              value={form.temperature}
              onValueChange={(value) =>
                setForm((current) => ({ ...current, temperature: value as Temperature }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TEMPERATURES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {temperatureLabels[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="sm:col-span-2">
            {text("decision_maker", "sheet-decider", "Ex.: cliente + esposa")}
          </div>
          {text("quoted_operator", "sheet-operator", "Ex.: Amil")}
          {text("quoted_plan", "sheet-plan", "Ex.: S380 enfermaria")}
          {text("quoted_value", "sheet-value", "Ex.: 389,90", "decimal")}
          {text("quoted_lives", "sheet-lives", "Ex.: 3", "decimal")}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={mutation.isPending}>
            {mutation.isPending ? "Salvando…" : "Salvar ficha"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DealSheetCard({ contactId }: { contactId: string }) {
  const { data, isLoading } = useQuery(intelligenceQuery(contactId));
  const [editing, setEditing] = useState(false);
  const memory = data?.memory ?? null;
  const sheet: DealSheet = memory?.sheet ?? {
    deal_stage: "unknown",
    decision_maker: null,
    quoted_operator: null,
    quoted_plan: null,
    quoted_value: null,
    quoted_lives: null,
    temperature: "unknown",
    temperature_reason: null,
  };

  const plan = [sheet.quoted_operator, sheet.quoted_plan].filter(Boolean).join(" · ") || null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <ClipboardList className="size-4 text-primary" />
          Ficha da cotação
        </CardTitle>
        <Button size="sm" variant="outline" onClick={() => setEditing(true)} disabled={isLoading}>
          <Pencil className="size-3.5" />
          Editar
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary" className="text-sm">
            {dealStageLabels[sheet.deal_stage]}
          </Badge>
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${temperatureClass[sheet.temperature]}`}
          >
            <Thermometer className="size-3.5" />
            {temperatureLabels[sheet.temperature]}
          </span>
        </div>
        {sheet.temperature_reason ? (
          <p className="text-sm text-muted-foreground">{sheet.temperature_reason}</p>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <Item
            label="Quem decide"
            value={sheet.decision_maker}
            memory={memory}
            field="decision_maker"
          />
          <Item label="Plano cotado" value={plan} memory={memory} field="quoted_plan" />
          <Item
            label="Valor mensal"
            value={sheet.quoted_value != null ? formatCurrency(sheet.quoted_value) : null}
            memory={memory}
            field="quoted_value"
          />
          <Item
            label="Vidas"
            value={sheet.quoted_lives != null ? String(sheet.quoted_lives) : null}
            memory={memory}
            field="quoted_lives"
          />
        </div>

        {!memory ? (
          <p className="text-xs text-muted-foreground">
            A ficha é preenchida sozinha quando o cliente conversa pelo WhatsApp. Você também pode
            preencher agora.
          </p>
        ) : null}
      </CardContent>

      {editing ? (
        <EditDialog contactId={contactId} sheet={sheet} open={editing} onOpenChange={setEditing} />
      ) : null}
    </Card>
  );
}
