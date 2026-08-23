import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Loader2, Plus, Trash2, Upload } from "lucide-react";
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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { saveFollowupFlow, uploadFollowupMedia } from "@/lib/followup.functions";
import { flowQuery, followupKeys } from "@/lib/followup.queries";
import { ACTION_TYPE_LABELS, DELAY_UNIT_LABELS } from "@/lib/followup/labels";
import type { DelayUnit, FollowupActionType, FollowupContentMode } from "@/lib/followup/types";
import { listContentAssets, listMessageStrategies } from "@/lib/library.functions";

interface StepDraft {
  id?: string;
  delay_value: number;
  delay_unit: DelayUnit;
  action_type: FollowupActionType;
  content: string;
  media_reference: string | null;
  media_mime_type: string | null;
  media_filename: string | null;
  preferred_time_start: string;
  preferred_time_end: string;
  content_mode: FollowupContentMode;
  strategy_id: string | null;
  asset_id: string | null;
  objective: string;
}

const CONTENT_MODE_LABELS: Record<FollowupContentMode, string> = {
  fixed_content: "Texto fixo",
  ai_generated: "Gerada pela IA",
  asset_selection: "Material da biblioteca",
  human_required: "Somente humano",
};

const emptyStep = (): StepDraft => ({
  delay_value: 4,
  delay_unit: "hours",
  action_type: "text_message",
  content: "",
  media_reference: null,
  media_mime_type: null,
  media_filename: null,
  preferred_time_start: "",
  preferred_time_end: "",
  content_mode: "fixed_content",
  strategy_id: null,
  asset_id: null,
  objective: "",
});

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

async function fileToBase64(file: File): Promise<string> {
  const buffer = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let i = 0; i < buffer.length; i += 1) binary += String.fromCharCode(buffer[i]!);
  return btoa(binary);
}

export function FlowBuilderDialog({
  open,
  onOpenChange,
  flowId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  flowId: string | null;
}) {
  const queryClient = useQueryClient();
  const existing = useQuery({ ...flowQuery(flowId), enabled: open && Boolean(flowId) });

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [stopOnReply, setStopOnReply] = useState(true);
  const [windowStart, setWindowStart] = useState("");
  const [windowEnd, setWindowEnd] = useState("");
  const [steps, setSteps] = useState<StepDraft[]>([{ ...emptyStep(), delay_value: 0 }]);
  const strategies = useQuery({
    queryKey: ["message-strategies", "flow-builder"],
    queryFn: () => listMessageStrategies(),
    enabled: open,
  });
  const assets = useQuery({
    queryKey: ["content-assets", "flow-builder"],
    queryFn: () => listContentAssets({ data: {} }),
    enabled: open,
  });

  useEffect(() => {
    if (!open) return;
    if (!flowId) {
      setName("");
      setDescription("");
      setIsActive(true);
      setStopOnReply(true);
      setWindowStart("");
      setWindowEnd("");
      setSteps([{ ...emptyStep(), delay_value: 0 }]);
      return;
    }
    const data = existing.data;
    if (!data) return;
    setName(data.name);
    setDescription(data.description ?? "");
    setIsActive(data.is_active);
    setStopOnReply(data.stop_on_reply);
    setWindowStart(data.window_start?.slice(0, 5) ?? "");
    setWindowEnd(data.window_end?.slice(0, 5) ?? "");
    setSteps(
      data.steps.map((step) => ({
        id: step.id,
        delay_value: step.delay_value,
        delay_unit: step.delay_unit,
        action_type: step.action_type,
        content: step.content ?? "",
        media_reference: step.media_reference,
        media_mime_type: step.media_mime_type,
        media_filename: step.media_filename,
        preferred_time_start: step.preferred_time_start?.slice(0, 5) ?? "",
        preferred_time_end: step.preferred_time_end?.slice(0, 5) ?? "",
        content_mode: step.content_mode,
        strategy_id: step.strategy_id,
        asset_id: step.asset_id,
        objective: step.objective ?? "",
      })),
    );
  }, [open, flowId, existing.data]);

  const uploadMutation = useMutation({
    mutationFn: async (input: { index: number; file: File }) => {
      if (input.file.size > MAX_UPLOAD_BYTES) throw new Error("Arquivo maior que 8 MB.");
      const base64 = await fileToBase64(input.file);
      const result = await uploadFollowupMedia({
        data: {
          base64,
          mimeType: input.file.type || "application/octet-stream",
          filename: input.file.name,
        },
      });
      return { index: input.index, file: input.file, reference: result.reference };
    },
    onSuccess: ({ index, file, reference }) => {
      updateStep(index, {
        media_reference: reference,
        media_mime_type: file.type || "application/octet-stream",
        media_filename: file.name,
      });
      toast.success("Arquivo anexado à etapa.");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Falha no upload."),
  });

  function validateSteps(): string | null {
    if (!name.trim()) return "Dê um nome ao fluxo.";
    for (const [index, step] of steps.entries()) {
      const label = `Etapa ${index + 1}`;
      if (step.content_mode === "ai_generated" && !step.strategy_id)
        return `${label}: escolha a estratégia usada pela IA.`;
      if (step.content_mode === "asset_selection" && !step.asset_id)
        return `${label}: escolha o material da biblioteca.`;
      if (step.content_mode === "fixed_content" && !step.content.trim() && !step.media_reference)
        return `${label}: escreva a mensagem ou anexe um arquivo.`;
    }
    return null;
  }

  const saveMutation = useMutation({
    mutationFn: () =>
      saveFollowupFlow({

        data: {
          ...(flowId ? { id: flowId } : {}),
          name,
          description,
          is_active: isActive,
          stop_on_reply: stopOnReply,
          window_start: windowStart || null,
          window_end: windowEnd || null,
          steps: steps.map((step) => ({
            ...(step.id ? { id: step.id } : {}),
            delay_value: step.delay_value,
            delay_unit: step.delay_unit,
            action_type: step.action_type,
            content: step.content,
            media_reference: step.media_reference,
            media_mime_type: step.media_mime_type,
            media_filename: step.media_filename,
            preferred_time_start: step.preferred_time_start || null,
            preferred_time_end: step.preferred_time_end || null,
            content_mode: step.content_mode,
            strategy_id: step.strategy_id,
            asset_id: step.asset_id,
            objective: step.objective || null,
          })),
        },
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: followupKeys.root });
      toast.success(flowId ? "Fluxo atualizado." : "Fluxo criado.");
      onOpenChange(false);
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Não foi possível salvar o fluxo."),
  });

  function updateStep(index: number, patch: Partial<StepDraft>) {
    setSteps((current) =>
      current.map((step, position) => (position === index ? { ...step, ...patch } : step)),
    );
  }

  function move(index: number, direction: -1 | 1) {
    setSteps((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const copy = [...current];
      const [removed] = copy.splice(index, 1);
      copy.splice(target, 0, removed!);
      return copy;
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{flowId ? "Editar fluxo" : "Novo fluxo"}</DialogTitle>
          <DialogDescription>
            As etapas são executadas em sequência. Se o cliente responder, o fluxo para.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="flow-name">Nome</Label>
              <Input
                id="flow-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Novo cliente — sem resposta"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="flow-description">Descrição</Label>
              <Input
                id="flow-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Sequência para quem não respondeu"
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="flow-window-start">Janela do fluxo — início</Label>
              <Input
                id="flow-window-start"
                type="time"
                value={windowStart}
                onChange={(event) => setWindowStart(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="flow-window-end">Janela do fluxo — fim</Label>
              <Input
                id="flow-window-end"
                type="time"
                value={windowEnd}
                onChange={(event) => setWindowEnd(event.target.value)}
              />
            </div>
          </div>
          <p className="text-muted-foreground text-xs">
            A janela global de envio da conta também é respeitada — vence sempre a regra mais
            restritiva.
          </p>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-8">
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={isActive} onCheckedChange={setIsActive} />
              Fluxo ativo
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={stopOnReply} onCheckedChange={setStopOnReply} />
              Parar quando o cliente responder
            </label>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">Etapas</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setSteps((current) => [...current, emptyStep()])}
              >
                <Plus className="mr-1 size-4" /> Adicionar etapa
              </Button>
            </div>

            {steps.map((step, index) => (
              <div key={step.id ?? `draft-${index}`} className="space-y-3 rounded-md border p-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">Etapa {index + 1}</p>
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label="Mover para cima"
                      onClick={() => move(index, -1)}
                      disabled={index === 0}
                    >
                      <ArrowUp className="size-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label="Mover para baixo"
                      onClick={() => move(index, 1)}
                      disabled={index === steps.length - 1}
                    >
                      <ArrowDown className="size-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label="Remover etapa"
                      onClick={() =>
                        setSteps((current) => current.filter((_, position) => position !== index))
                      }
                      disabled={steps.length === 1}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="space-y-1.5">
                    <Label>Esperar</Label>
                    <Input
                      type="number"
                      min={0}
                      value={step.delay_value}
                      onChange={(event) =>
                        updateStep(index, { delay_value: Number(event.target.value) })
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Unidade</Label>
                    <Select
                      value={step.delay_unit}
                      onValueChange={(value) =>
                        updateStep(index, { delay_unit: value as DelayUnit })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(DELAY_UNIT_LABELS).map(([value, label]) => (
                          <SelectItem key={value} value={value}>
                            {label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Conteúdo</Label>
                    <Select
                      value={step.content_mode}
                      onValueChange={(value) =>
                        updateStep(index, { content_mode: value as FollowupContentMode })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(CONTENT_MODE_LABELS).map(([value, label]) => (
                          <SelectItem key={value} value={value}>
                            {label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Ação</Label>
                    <Select
                      value={step.action_type}
                      onValueChange={(value) =>
                        updateStep(index, { action_type: value as FollowupActionType })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(ACTION_TYPE_LABELS).map(([value, label]) => (
                          <SelectItem key={value} value={value}>
                            {label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>Horário permitido — início</Label>
                    <Input
                      type="time"
                      value={step.preferred_time_start}
                      onChange={(event) =>
                        updateStep(index, { preferred_time_start: event.target.value })
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Horário permitido — fim</Label>
                    <Input
                      type="time"
                      value={step.preferred_time_end}
                      onChange={(event) =>
                        updateStep(index, { preferred_time_end: event.target.value })
                      }
                    />
                  </div>
                </div>

                {step.content_mode === "ai_generated" && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label>Estratégia</Label>
                      <Select
                        value={step.strategy_id ?? ""}
                        onValueChange={(value) => updateStep(index, { strategy_id: value })}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Escolha a estratégia" />
                        </SelectTrigger>
                        <SelectContent>
                          {(strategies.data ?? []).map((strategy) => (
                            <SelectItem key={strategy.id} value={strategy.id}>
                              {strategy.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Objetivo desta etapa</Label>
                      <Input
                        value={step.objective}
                        placeholder="Ex.: retomar a cotação enviada"
                        onChange={(event) => updateStep(index, { objective: event.target.value })}
                      />
                    </div>
                  </div>
                )}

                {step.content_mode === "asset_selection" && (
                  <div className="space-y-1.5">
                    <Label>Material</Label>
                    <Select
                      value={step.asset_id ?? ""}
                      onValueChange={(value) => updateStep(index, { asset_id: value })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Escolha o material" />
                      </SelectTrigger>
                      <SelectContent>
                        {(assets.data ?? []).map((asset) => (
                          <SelectItem key={asset.id} value={asset.id}>
                            {asset.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {step.content_mode === "human_required" && (
                  <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
                    Nesta etapa o sistema não envia nada: ele apenas avisa que é a sua vez.
                  </p>
                )}

                <div className="space-y-1.5">
                  <Label>
                    {step.action_type === "text_message" ? "Texto" : "Legenda (opcional)"}
                  </Label>
                  <Textarea
                    rows={3}
                    value={step.content}
                    onChange={(event) => updateStep(index, { content: event.target.value })}
                    placeholder="Olá {{first_name}}, tudo bem?"
                  />
                  <p className="text-muted-foreground text-xs">
                    Placeholders disponíveis: {"{{first_name}}"} e {"{{name}}"}.
                  </p>
                </div>

                {step.action_type !== "text_message" && (
                  <div className="space-y-1.5">
                    <Label htmlFor={`step-media-${index}`}>Arquivo</Label>
                    <div className="flex items-center gap-2">
                      <Input
                        id={`step-media-${index}`}
                        type="file"
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (file) uploadMutation.mutate({ index, file });
                        }}
                      />
                      {uploadMutation.isPending ? (
                        <Loader2 className="text-muted-foreground size-4 animate-spin" />
                      ) : (
                        <Upload className="text-muted-foreground size-4" />
                      )}
                    </div>
                    {step.media_filename ? (
                      <p className="text-muted-foreground text-xs">
                        Anexado: {step.media_filename}
                      </p>
                    ) : (
                      <p className="text-muted-foreground text-xs">Nenhum arquivo anexado.</p>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            onClick={() => {
              const problem = validateSteps();
              if (problem) {
                toast.error(problem);
                return;
              }
              saveMutation.mutate();
            }}
            disabled={saveMutation.isPending}
          >
            {saveMutation.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
            Salvar fluxo
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
