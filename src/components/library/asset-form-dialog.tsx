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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { saveContentAsset } from "@/lib/library.functions";
import { libraryKeys } from "@/lib/library.queries";
import type { ContentAsset, ContentAssetType } from "@/lib/library/api-types";
import { assetTypeLabels } from "@/lib/library/labels";
import { CONTENT_ASSET_TYPES } from "@/lib/library/types";

const MAX_FILE_BYTES = 12 * 1024 * 1024;

async function fileToBase64(file: File): Promise<string> {
  const buffer = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let index = 0; index < buffer.length; index += 1) {
    binary += String.fromCharCode(buffer[index]!);
  }
  return btoa(binary);
}

export function AssetFormDialog({
  open,
  onOpenChange,
  asset,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  asset: ContentAsset | null;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [type, setType] = useState<ContentAssetType>("text");
  const [purpose, setPurpose] = useState("");
  const [description, setDescription] = useState("");
  const [body, setBody] = useState("");
  const [transcript, setTranscript] = useState("");
  const [tags, setTags] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [file, setFile] = useState<File | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(asset?.name ?? "");
    setType(asset?.type ?? "text");
    setPurpose(asset?.purpose ?? "");
    setDescription(asset?.description ?? "");
    setBody(asset?.body ?? "");
    setTranscript(asset?.transcript ?? "");
    setTags((asset?.tags ?? []).join(", "));
    setIsActive(asset?.is_active ?? true);
    setFile(null);
  }, [open, asset]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      let filePayload: { base64: string; mimeType: string; filename: string } | null = null;
      if (file) {
        if (file.size > MAX_FILE_BYTES) throw new Error("Arquivo acima de 12 MB.");
        filePayload = {
          base64: await fileToBase64(file),
          mimeType: file.type || "application/octet-stream",
          filename: file.name,
        };
      }
      return saveContentAsset({
        data: {
          id: asset?.id,
          name: name.trim(),
          type,
          purpose: purpose.trim() || null,
          description: description.trim() || null,
          body: type === "text" ? body.trim() || null : null,
          transcript: type === "audio" ? transcript.trim() || null : null,
          tags: tags
            .split(",")
            .map((tag) => tag.trim())
            .filter(Boolean),
          is_active: isActive,
          file: filePayload,
        },
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: libraryKeys.root });
      toast.success(asset ? "Material atualizado." : "Material adicionado.");
      onOpenChange(false);
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Não foi possível salvar o material."),
  });

  const needsFile = type !== "text";
  const canSave =
    name.trim().length > 1 &&
    (type === "text" ? body.trim().length > 0 : Boolean(file) || Boolean(asset?.storage_reference));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{asset ? "Editar material" : "Novo material"}</DialogTitle>
          <DialogDescription>
            Descreva bem para que serve — é isso que a IA usa para escolher quando enviar.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="asset-name">Nome</Label>
            <Input
              id="asset-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Ex.: Áudio explicando a cobertura"
            />
          </div>

          <div className="space-y-2">
            <Label>Tipo</Label>
            <Select value={type} onValueChange={(value) => setType(value as ContentAssetType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CONTENT_ASSET_TYPES.map((item) => (
                  <SelectItem key={item} value={item}>
                    {assetTypeLabels[item]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="asset-purpose">Para que serve</Label>
            <Input
              id="asset-purpose"
              value={purpose}
              onChange={(event) => setPurpose(event.target.value)}
              placeholder="Ex.: usar quando o cliente acha caro"
            />
          </div>

          {type === "text" ? (
            <div className="space-y-2">
              <Label htmlFor="asset-body">Conteúdo</Label>
              <Textarea
                id="asset-body"
                rows={5}
                value={body}
                onChange={(event) => setBody(event.target.value)}
              />
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="asset-file">Arquivo</Label>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  id="asset-file"
                  type="file"
                  className="flex-1"
                  onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                />
                {type === "audio" ? (
                  <Button type="button" variant="outline" onClick={() => setRecorderOpen(true)}>
                    <Mic className="mr-2 size-4" aria-hidden /> Gravar áudio
                  </Button>
                ) : null}
              </div>
              {file ? (
                <p className="text-muted-foreground text-xs">Selecionado: {file.name}</p>
              ) : asset?.filename ? (
                <p className="text-muted-foreground text-xs">Atual: {asset.filename}</p>
              ) : null}
            </div>
          )}


          {type === "audio" ? (
            <div className="space-y-2">
              <Label htmlFor="asset-transcript">Transcrição (opcional)</Label>
              <Textarea
                id="asset-transcript"
                rows={3}
                value={transcript}
                onChange={(event) => setTranscript(event.target.value)}
                placeholder="Ajuda a IA a entender o que o áudio diz."
              />
            </div>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="asset-description">Observações internas</Label>
            <Textarea
              id="asset-description"
              rows={2}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="asset-tags">Etiquetas</Label>
            <Input
              id="asset-tags"
              value={tags}
              onChange={(event) => setTags(event.target.value)}
              placeholder="preço, objeção, institucional"
            />
          </div>

          <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
            <div>
              <p className="text-sm font-medium">Disponível para uso</p>
              <p className="text-xs text-muted-foreground">
                Materiais inativos não são oferecidos à IA.
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
            {needsFile && !file && !asset ? "Selecione um arquivo" : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
