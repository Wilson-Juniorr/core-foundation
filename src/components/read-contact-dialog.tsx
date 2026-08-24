import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ImagePlus, Loader2, ScanText, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { extractContactFromImages } from "@/lib/crm.functions";
import { extractionIsWeak, parseContactFromText } from "@/lib/crm/ocr-parse";

export type ReadResult = {
  name: string;
  phone: string;
  email: string;
  source: string;
  notes: string;
  opportunity_title: string;
  confidence: number;
};

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Não foi possível ler a imagem."));
    reader.readAsDataURL(file);
  });
}

export function ReadContactDialog({
  open,
  onOpenChange,
  onExtracted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onExtracted: (result: ReadResult) => void;
}) {
  const read = useServerFn(extractContactFromImages);
  const inputRef = useRef<HTMLInputElement>(null);
  const [images, setImages] = useState<string[]>([]);
  const [localBusy, setLocalBusy] = useState(false);
  const [needsAi, setNeedsAi] = useState(false);

  const mutation = useMutation({
    mutationFn: () => read({ data: { images } }),
    onSuccess: (data) => {
      const result: ReadResult = {
        name: data.name ?? "",
        phone: data.phone ?? "",
        email: data.email ?? "",
        source: data.source ?? "",
        notes: data.notes ?? "",
        opportunity_title: data.opportunity_title ?? "",
        confidence: data.confidence ?? 0,
      };
      onExtracted(result);
      onOpenChange(false);
    },
    onError: () => {
      toast.error("Não foi possível ler o print. Tente uma imagem mais nítida.");
    },
  });

  async function readLocally() {
    setLocalBusy(true);
    setNeedsAi(false);
    try {
      const [{ default: Tesseract }, { preprocessForOcr }] = await Promise.all([
        import("tesseract.js"),
        import("@/lib/crm/ocr-image"),
      ]);

      let text = "";
      for (const image of images) {
        const enhanced = await preprocessForOcr(image);
        // Duas passadas: layout em blocos (prints de conversa) e coluna única
        // (cartões/fichas). Juntar os textos aumenta muito o acerto.
        for (const psm of ["6", "4"]) {
          const { data } = await Tesseract.recognize(enhanced, "por+eng", {
            // @ts-expect-error opções aceitas em runtime pelo tesseract.js
            tessedit_pageseg_mode: psm,
            preserve_interword_spaces: "1",
          });
          text += `\n${data.text}`;
        }
      }

      const parsed = parseContactFromText(text);
      if (extractionIsWeak(parsed)) {
        setNeedsAi(true);
        toast.warning(
          "A leitura gratuita não encontrou telefone nem e-mail. Você pode revisar manualmente ou usar a IA.",
        );
        onExtracted({
          name: parsed.name,
          phone: parsed.phone,
          email: parsed.email,
          source: "Print",
          notes: parsed.notes,
          opportunity_title: "",
          confidence: 0.3,
        });
        return;
      }
      onExtracted({
        name: parsed.name,
        phone: parsed.phone,
        email: parsed.email,
        source: "Print",
        notes: parsed.notes,
        opportunity_title: "",
        confidence: 0.8,
      });
      onOpenChange(false);
    } catch {
      setNeedsAi(true);
      toast.error("Falha na leitura local. Tente novamente ou use a leitura com IA.");
    } finally {
      setLocalBusy(false);
    }
  }


  async function addFiles(list: FileList | null) {
    if (!list) return;
    const files = Array.from(list).filter((file) => file.type.startsWith("image/"));
    if (files.length === 0) {
      toast.error("Envie apenas imagens (print, foto ou cartão).");
      return;
    }
    const urls = await Promise.all(files.slice(0, 3).map(fileToDataUrl));
    setImages((prev) => [...prev, ...urls].slice(0, 3));
    setNeedsAi(false);
  }

  useEffect(() => {
    if (!open) return;

    async function onPaste(event: ClipboardEvent) {
      const items = Array.from(event.clipboardData?.items ?? []);
      const files = items
        .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
        .map((item) => item.getAsFile())
        .filter((file): file is File => Boolean(file));

      if (files.length === 0) return;
      event.preventDefault();

      const urls = await Promise.all(files.slice(0, 3).map(fileToDataUrl));
      setImages((prev) => [...prev, ...urls].slice(0, 3));
      setNeedsAi(false);
      toast.success(files.length > 1 ? "Prints colados!" : "Print colado!");
    }

    const handler = (event: ClipboardEvent) => void onPaste(event);
    window.addEventListener("paste", handler);
    return () => window.removeEventListener("paste", handler);
  }, [open]);




  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Cadastrar por print</DialogTitle>
          <DialogDescription>
            Envie um print de conversa, cartão ou ficha. A IA lê os dados e preenche o cadastro
            automaticamente para você revisar.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(event) => {
              void addFiles(event.target.files);
              event.target.value = "";
            }}
          />

          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="flex w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-8 text-center transition-colors hover:bg-secondary/50"
          >
            <ScanText className="size-6 text-muted-foreground" aria-hidden />
            <span className="text-sm font-medium">Escolher print ou colar (Ctrl+V)</span>
            <span className="text-xs text-muted-foreground">
              PNG, JPG ou WEBP · até 3 imagens · cole direto da área de transferência
            </span>
          </button>

          {images.length > 0 ? (
            <div className="grid grid-cols-3 gap-2">
              {images.map((src, index) => (
                <div
                  key={index}
                  className="relative aspect-square overflow-hidden rounded-md border"
                >
                  <img
                    src={src}
                    alt={`Print ${index + 1}`}
                    className="h-full w-full object-contain"
                  />
                  <Button
                    type="button"
                    variant="destructive"
                    size="icon"
                    className="absolute right-1 top-1 size-6"
                    aria-label={`Remover imagem ${index + 1}`}
                    onClick={() => setImages((prev) => prev.filter((_, i) => i !== index))}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          ) : null}

          <div className="space-y-2">
            <Button
              type="button"
              className="w-full"
              disabled={images.length === 0 || localBusy || mutation.isPending}
              onClick={() => void readLocally()}
            >
              {localBusy ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Lendo no seu aparelho…
                </>
              ) : (
                <>
                  <ImagePlus className="size-4" />
                  Ler print (grátis, sem créditos)
                </>
              )}
            </Button>

            {images.length > 0 ? (
              <Button
                type="button"
                variant="outline"
                className="w-full"
                disabled={images.length === 0 || mutation.isPending}
                onClick={() => mutation.mutate()}
              >
                {mutation.isPending ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Lendo com IA…
                  </>
                ) : (
                  <>
                    <ScanText className="size-4" />
                    Tentar leitura com IA (usa créditos)
                  </>
                )}
              </Button>
            ) : null}

            <p className="text-center text-xs text-muted-foreground">
              A leitura roda no seu aparelho e não gasta créditos. A IA fica como reserva quando o
              print estiver difícil de ler.
            </p>
          </div>

        </div>
      </DialogContent>
    </Dialog>
  );
}
