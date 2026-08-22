import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { saveMessageStrategy } from "@/lib/library.functions";
import { assetsQuery, libraryKeys } from "@/lib/library.queries";
import type {
  ContentAssetType,
  MessageStrategy,
  StrategyAutonomy,
} from "@/lib/library/api-types";
import {
  assetTypeLabels,
  autonomyDescriptions,
  autonomyLabels,
  FORBIDDEN_BEHAVIOR_OPTIONS,
} from "@/lib/library/labels";
import { CONTENT_ASSET_TYPES, STRATEGY_AUTONOMY_MODES } from "@/lib/library/types";

export function StrategyFormDialog({
  open,
  onOpenChange,
  strategy,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  strategy: MessageStrategy | null;
}) {
  const queryClient = useQueryClient();
  const assets = useQuery({ ...assetsQuery(), enabled: open });

  const [name, setName] = useState("");
  const [objective, setObjective] = useState("");
  const [tone, setTone] = useState("");
  const [shouldMention, setShouldMention] = useState("");
  const [shouldAvoid, setShouldAvoid] = useState("");
  const [whenToUse, setWhenToUse] = useState("");
  const [assetTypes, setAssetTypes] = useState<ContentAssetType[]>([]);
  const [allowedAssets, setAllowedAssets] = useState<string[]>([]);
  const [forbidden, setForbidden] = useState<string[]>([]);
  const [autonomy, setAutonomy] = useState<StrategyAutonomy>("approval_required");
  const [maxLength, setMaxLength] = useState(450);
  const [isActive, setIsActive] = useState(true);

  useEffect(() => {
    if (!open) return;
    setName(strategy?.name ?? "");
    setObjective(strategy?.objective ?? "");
    setTone(strategy?.tone ?? "");
    setShouldMention(strategy?.should_mention ?? "");
    setShouldAvoid(strategy?.should_avoid ?? "");
    setWhenToUse(strategy?.when_to_use ?? "");
    setAssetTypes(strategy?.allowed_asset_types ?? []);
    setAllowedAssets(strategy?.allowed_assets ?? []);
    setForbidden(
      strategy?.forbidden_behaviors ?? ["pressure", "false_urgency", "invent_offer", "invent_facts"],
    );
    setAutonomy(strategy?.autonomy_mode ?? "approval_required");
    setMaxLength(strategy?.max_length ?? 450);
    setIsActive(strategy?.is_active ?? true);
  }, [open, strategy]);

  const toggle = <T,>(list: T[], value: T): T[] =>
    list.includes(value) ? list.filter((item) => item !== value) : [...list, value];

  const saveMutation = useMutation({
    mutationFn: () =>
      saveMessageStrategy({
        data: {
          id: strategy?.id,
          name: name.trim(),
          objective: objective.trim(),
          tone: tone.trim(),
          should_mention: shouldMention.trim() || null,
          should_avoid: shouldAvoid.trim() || null,
          when_to_use: whenToUse.trim() || null,
          allowed_asset_types: assetTypes,
          allowed_assets: allowedAssets,
          forbidden_behaviors: forbidden,
          autonomy_mode: autonomy,
          max_length: maxLength,
          is_active: isActive,
        },
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: libraryKeys.root });
      toast.success(strategy ? "Estratégia atualizada (nova versão)." : "Estratégia criada.");
      onOpenChange(false);
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Não foi possível salvar a estratégia."),
  });

  const eligibleAssets = (assets.data ?? []).filter(
    (asset) => assetTypes.length === 0 || assetTypes.includes(asset.type),
  );

  const canSave = name.trim().length > 1 && objective.trim().length > 4 && tone.trim().length > 2;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{strategy ? "Editar estratégia" : "Nova estratégia"}</DialogTitle>
          <DialogDescription>
            Você descreve a intenção comercial; a IA escreve a mensagem seguindo essas regras.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="strategy-name">Nome</Label>
              <Input
                id="strategy-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Ex.: Pós-cotação sem pressão"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="strategy-tone">Tom</Label>
              <Input
                id="strategy-tone"
                value={tone}
                onChange={(event) => setTone(event.target.value)}
                placeholder="Ex.: consultivo e tranquilo"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="strategy-objective">Objetivo da mensagem</Label>
            <Textarea
              id="strategy-objective"
              rows={2}
              value={objective}
              onChange={(event) => setObjective(event.target.value)}
              placeholder="O que essa mensagem precisa conseguir?"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="strategy-mention">O que deve ser mencionado</Label>
              <Textarea
                id="strategy-mention"
                rows={2}
                value={shouldMention}
                onChange={(event) => setShouldMention(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="strategy-avoid">O que deve ser evitado</Label>
              <Textarea
                id="strategy-avoid"
                rows={2}
                value={shouldAvoid}
                onChange={(event) => setShouldAvoid(event.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="strategy-when">Quando usar</Label>
            <Textarea
              id="strategy-when"
              rows={2}
              value={whenToUse}
              onChange={(event) => setWhenToUse(event.target.value)}
              placeholder="Ex.: cliente recebeu a cotação e não respondeu."
            />
          </div>

          <div className="space-y-2">
            <Label>Materiais que podem acompanhar</Label>
            <div className="flex flex-wrap gap-3">
              {CONTENT_ASSET_TYPES.map((item) => (
                <label key={item} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={assetTypes.includes(item)}
                    onCheckedChange={() => setAssetTypes((prev) => toggle(prev, item))}
                  />
                  {assetTypeLabels[item]}
                </label>
              ))}
            </div>
            {assetTypes.length > 0 && eligibleAssets.length > 0 ? (
              <div className="mt-2 max-h-40 space-y-2 overflow-y-auto rounded-md border border-border p-3">
                <p className="text-xs text-muted-foreground">
                  Restringir a materiais específicos (opcional):
                </p>
                {eligibleAssets.map((asset) => (
                  <label key={asset.id} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={allowedAssets.includes(asset.id)}
                      onCheckedChange={() => setAllowedAssets((prev) => toggle(prev, asset.id))}
                    />
                    <span className="truncate">
                      {asset.name}{" "}
                      <span className="text-xs text-muted-foreground">
                        ({assetTypeLabels[asset.type]})
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label>Comportamentos proibidos</Label>
            <div className="grid gap-2 sm:grid-cols-2">
              {FORBIDDEN_BEHAVIOR_OPTIONS.map((option) => (
                <label key={option.value} className="flex items-start gap-2 text-sm">
                  <Checkbox
                    checked={forbidden.includes(option.value)}
                    onCheckedChange={() => setForbidden((prev) => toggle(prev, option.value))}
                  />
                  {option.label}
                </label>
              ))}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Autonomia</Label>
              <Select
                value={autonomy}
                onValueChange={(value) => setAutonomy(value as StrategyAutonomy)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STRATEGY_AUTONOMY_MODES.map((mode) => (
                    <SelectItem key={mode} value={mode}>
                      {autonomyLabels[mode]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{autonomyDescriptions[autonomy]}</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="strategy-length">Tamanho máximo (caracteres)</Label>
              <Input
                id="strategy-length"
                type="number"
                min={120}
                max={1200}
                value={maxLength}
                onChange={(event) => setMaxLength(Number(event.target.value) || 450)}
              />
            </div>
          </div>

          <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
            <div>
              <p className="text-sm font-medium">Estratégia ativa</p>
              <p className="text-xs text-muted-foreground">
                Editar salva uma nova versão; rascunhos antigos mantêm a versão usada.
              </p>
            </div>
            <Switch checked={isActive} onCheckedChange={setIsActive} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={!canSave || saveMutation.isPending}
          >
            {saveMutation.isPending ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
