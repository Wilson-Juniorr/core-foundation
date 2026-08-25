/**
 * Utilidades de gravação de áudio no navegador.
 *
 * Reaproveitamos a mesma arquitetura de mídia já existente: o resultado da
 * gravação é um `File` comum, tratado igual a um upload feito pelo usuário.
 */

/** Formatos aceitos, em ordem de preferência para WhatsApp/UAZAPI. */
const PREFERRED_MIME_TYPES = [
  "audio/ogg;codecs=opus",
  "audio/ogg",
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
] as const;

export const MAX_RECORDING_SECONDS = 300;

export function isRecordingSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.MediaRecorder !== "undefined" &&
    Boolean(navigator.mediaDevices?.getUserMedia)
  );
}

/** Escolhe o melhor container suportado pelo navegador atual. */
export function pickRecordingMimeType(): string | null {
  if (typeof window === "undefined" || typeof window.MediaRecorder === "undefined") return null;
  for (const type of PREFERRED_MIME_TYPES) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return null;
}

export function extensionForMimeType(mimeType: string): string {
  const base = mimeType.split(";")[0]?.trim() ?? "";
  if (base === "audio/ogg") return "ogg";
  if (base === "audio/webm") return "webm";
  if (base === "audio/mp4" || base === "audio/m4a") return "m4a";
  if (base === "audio/mpeg") return "mp3";
  return "bin";
}

export function formatDuration(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function recordingFilename(mimeType: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  return `audio-${stamp}.${extensionForMimeType(mimeType)}`;
}

export function describeRecordingError(error: unknown): string {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Permissão do microfone negada. Libere o acesso no navegador e tente de novo.";
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return "Nenhum microfone encontrado neste dispositivo.";
  }
  if (name === "NotReadableError") {
    return "O microfone está em uso por outro aplicativo.";
  }
  return error instanceof Error ? error.message : "Não foi possível gravar o áudio.";
}
