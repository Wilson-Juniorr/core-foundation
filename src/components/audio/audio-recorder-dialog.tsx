import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Mic, Pause, Play, Square, Trash2 } from "lucide-react";
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
import {
  MAX_RECORDING_SECONDS,
  describeRecordingError,
  formatDuration,
  isRecordingSupported,
  pickRecordingMimeType,
  recordingFilename,
} from "@/lib/audio/recording";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Tamanho máximo aceito pelo destino (mesmo limite do upload por arquivo). */
  maxBytes: number;
  /** Recebe o áudio gravado como `File`, igual a um upload manual. */
  onConfirm: (file: File) => void | Promise<void>;
  isSaving?: boolean;
};

export function AudioRecorderDialog({
  open,
  onOpenChange,
  maxBytes,
  onConfirm,
  isSaving = false,
}: Props) {
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [state, setState] = useState<"idle" | "recording" | "paused" | "ready">("idle");
  const [seconds, setSeconds] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [supported, setSupported] = useState(true);

  useEffect(() => setSupported(isRecordingSupported()), []);

  const stopTicking = useCallback(() => {
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = null;
  }, []);

  const releaseStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    recorderRef.current = null;
  }, []);

  const reset = useCallback(() => {
    stopTicking();
    releaseStream();
    chunksRef.current = [];
    setState("idle");
    setSeconds(0);
    setFile(null);
    setPreviewUrl((url) => {
      if (url) URL.revokeObjectURL(url);
      return null;
    });
  }, [releaseStream, stopTicking]);

  // Fechar o diálogo sempre libera microfone e memória.
  useEffect(() => {
    if (!open) reset();
  }, [open, reset]);

  useEffect(() => () => reset(), [reset]);

  const finalize = useCallback(
    (mimeType: string) => {
      const blob = new Blob(chunksRef.current, { type: mimeType });
      chunksRef.current = [];
      if (blob.size === 0) {
        toast.error("Gravação vazia. Tente novamente.");
        reset();
        return;
      }
      if (blob.size > maxBytes) {
        toast.error(
          `Áudio maior que ${Math.floor(maxBytes / (1024 * 1024))} MB. Grave menos tempo.`,
        );
        reset();
        return;
      }
      const recorded = new File([blob], recordingFilename(mimeType), { type: mimeType });
      setFile(recorded);
      setPreviewUrl(URL.createObjectURL(recorded));
      setState("ready");
    },
    [maxBytes, reset],
  );

  const start = useCallback(async () => {
    if (!isRecordingSupported()) {
      setSupported(false);
      return;
    }
    const mimeType = pickRecordingMimeType();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onerror = () => {
        toast.error("Erro durante a gravação.");
        reset();
      };
      recorder.onstop = () => {
        stopTicking();
        releaseStream();
        finalize(recorder.mimeType || mimeType || "audio/webm");
      };

      recorder.start(250);
      setSeconds(0);
      setState("recording");
      tickRef.current = setInterval(() => {
        setSeconds((value) => {
          const next = value + 1;
          if (next >= MAX_RECORDING_SECONDS && recorderRef.current?.state !== "inactive") {
            recorderRef.current?.stop();
          }
          return next;
        });
      }, 1000);
    } catch (error) {
      releaseStream();
      toast.error(describeRecordingError(error));
    }
  }, [finalize, releaseStream, reset, stopTicking]);

  const togglePause = () => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    if (recorder.state === "recording") {
      recorder.pause();
      stopTicking();
      setState("paused");
      return;
    }
    if (recorder.state === "paused") {
      recorder.resume();
      setState("recording");
      tickRef.current = setInterval(() => setSeconds((value) => value + 1), 1000);
    }
  };

  const stop = () => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
  };

  const canPause = typeof MediaRecorder !== "undefined" && state !== "idle" && state !== "ready";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Gravar áudio</DialogTitle>
          <DialogDescription>
            Grave direto aqui, ouça antes de usar e refaça quantas vezes quiser.
          </DialogDescription>
        </DialogHeader>

        {!supported ? (
          <p className="text-sm text-muted-foreground">
            Este navegador não suporta gravação de áudio. Use a opção de enviar arquivo.
          </p>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between rounded-md border px-4 py-3">
              <div className="flex items-center gap-2">
                <span
                  className={
                    state === "recording"
                      ? "bg-destructive size-2.5 animate-pulse rounded-full"
                      : "bg-muted-foreground size-2.5 rounded-full"
                  }
                  aria-hidden
                />
                <span className="font-mono text-lg tabular-nums">{formatDuration(seconds)}</span>
              </div>
              <span className="text-xs text-muted-foreground">
                {state === "recording"
                  ? "Gravando…"
                  : state === "paused"
                    ? "Pausado"
                    : state === "ready"
                      ? "Pronto para usar"
                      : `Máximo ${Math.floor(MAX_RECORDING_SECONDS / 60)} min`}
              </span>
            </div>

            {state === "ready" && previewUrl ? (
              <audio src={previewUrl} controls className="w-full" />
            ) : null}

            <div className="flex flex-wrap gap-2">
              {state === "idle" ? (
                <Button type="button" onClick={() => void start()}>
                  <Mic className="mr-2 size-4" aria-hidden /> Iniciar gravação
                </Button>
              ) : null}

              {state === "recording" || state === "paused" ? (
                <>
                  {canPause ? (
                    <Button type="button" variant="outline" onClick={togglePause}>
                      {state === "recording" ? (
                        <>
                          <Pause className="mr-2 size-4" aria-hidden /> Pausar
                        </>
                      ) : (
                        <>
                          <Play className="mr-2 size-4" aria-hidden /> Continuar
                        </>
                      )}
                    </Button>
                  ) : null}
                  <Button type="button" onClick={stop}>
                    <Square className="mr-2 size-4" aria-hidden /> Finalizar
                  </Button>
                </>
              ) : null}

              {state === "ready" ? (
                <Button type="button" variant="outline" onClick={reset} disabled={isSaving}>
                  <Trash2 className="mr-2 size-4" aria-hidden /> Excluir e regravar
                </Button>
              ) : null}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isSaving}>
            Cancelar
          </Button>
          <Button
            disabled={!file || isSaving}
            onClick={() => {
              if (file) void onConfirm(file);
            }}
          >
            {isSaving ? <Loader2 className="mr-2 size-4 animate-spin" aria-hidden /> : null}
            Usar áudio
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
