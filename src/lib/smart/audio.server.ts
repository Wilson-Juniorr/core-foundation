/**
 * Smart Flow — áudio como parte do contexto.
 *
 * Áudio nunca é tratado apenas como arquivo: tentamos transcrever e, quando não
 * é possível, a conversa fica marcada como `audio_context_unknown` e decisões
 * automáticas de maior risco param de ser tomadas. Silenciosamente ignorar um
 * áudio é proibido.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import { patchControl } from "./control.server";

type Admin = SupabaseClient<Database>;

const TRANSCRIPTION_MODEL = "google/gemini-3.7-flash";
const MAX_AUDIO_BYTES = 8 * 1024 * 1024;

export interface TranscriptionResult {
  text: string | null;
  confidence: number;
  reason: string | null;
}

function formatFromMime(mime: string | null): string | null {
  if (!mime) return null;
  if (mime.includes("ogg")) return "ogg";
  if (mime.includes("mpeg") || mime.includes("mp3")) return "mp3";
  if (mime.includes("wav")) return "wav";
  if (mime.includes("mp4") || mime.includes("m4a") || mime.includes("aac")) return "m4a";
  if (mime.includes("webm")) return "webm";
  return null;
}

async function downloadAudio(
  db: Admin,
  mediaUrl: string,
): Promise<{ base64: string; bytes: number } | null> {
  const { MEDIA_BUCKET, STORAGE_PREFIX } = await import("@/lib/whatsapp/store.server");

  let buffer: ArrayBuffer;
  if (mediaUrl.startsWith(STORAGE_PREFIX)) {
    const path = mediaUrl.slice(STORAGE_PREFIX.length);
    const { data, error } = await db.storage.from(MEDIA_BUCKET).download(path);
    if (error || !data) return null;
    buffer = await data.arrayBuffer();
  } else if (/^https?:\/\//.test(mediaUrl)) {
    const response = await fetch(mediaUrl);
    if (!response.ok) return null;
    buffer = await response.arrayBuffer();
  } else {
    return null;
  }

  if (buffer.byteLength > MAX_AUDIO_BYTES) return null;
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]!);
  return { base64: btoa(binary), bytes: buffer.byteLength };
}

/**
 * Transcrição best-effort pelo AI Gateway. Qualquer falha devolve `text: null`
 * com o motivo — quem chama decide o que fazer, nunca assume "áudio vazio".
 */
export async function transcribeAudioMessage(
  db: Admin,
  messageId: string,
): Promise<TranscriptionResult> {
  const { data: message } = await db
    .from("messages")
    .select("id, media_url, media_mime_type, text_content, message_type")
    .eq("id", messageId)
    .maybeSingle();

  if (!message || message.message_type !== "audio") {
    return { text: null, confidence: 0, reason: "not_audio" };
  }
  if ((message.text_content ?? "").trim()) {
    return { text: message.text_content!, confidence: 1, reason: null };
  }
  if (!message.media_url) return { text: null, confidence: 0, reason: "missing_file" };

  const format = formatFromMime(message.media_mime_type);
  if (!format) return { text: null, confidence: 0, reason: "unsupported_format" };

  const audio = await downloadAudio(db, message.media_url);
  if (!audio) return { text: null, confidence: 0, reason: "download_failed" };

  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey) return { text: null, confidence: 0, reason: "ai_not_configured" };

  try {
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": apiKey,
        "X-Lovable-AIG-SDK": "fetch",
      },
      body: JSON.stringify({
        model: TRANSCRIPTION_MODEL,
        messages: [
          {
            role: "system",
            content:
              'Transcreva o áudio em português do Brasil. Responda em JSON com {"transcript": string, "confidence": number entre 0 e 1}. Se não conseguir entender, use transcript vazio e confidence 0.',
          },
          {
            role: "user",
            content: [
              { type: "text", text: "Transcreva este áudio de uma conversa comercial." },
              { type: "input_audio", input_audio: { data: audio.base64, format } },
            ],
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "audio_transcription",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              required: ["transcript", "confidence"],
              properties: {
                transcript: { type: "string" },
                confidence: { type: "number" },
              },
            },
          },
        },
      }),
    });

    if (!response.ok) {
      return { text: null, confidence: 0, reason: `gateway_${response.status}` };
    }

    const payload = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const raw = payload.choices?.[0]?.message?.content;
    if (!raw) return { text: null, confidence: 0, reason: "empty_response" };

    const parsed = JSON.parse(raw) as { transcript?: string; confidence?: number };
    const transcript = (parsed.transcript ?? "").trim();
    const confidence = Math.max(0, Math.min(1, Number(parsed.confidence ?? 0)));

    if (!transcript || confidence < 0.4) {
      return { text: null, confidence, reason: "low_confidence" };
    }
    return { text: transcript, confidence, reason: null };
  } catch {
    return { text: null, confidence: 0, reason: "transcription_failed" };
  }
}

/**
 * Processa um áudio (recebido ou enviado manualmente): transcreve, guarda o
 * texto na própria mensagem e alimenta o contexto. Falha → contexto marcado
 * como desconhecido, sem decisão arriscada.
 */
export async function ingestAudioContext(
  db: Admin,
  input: {
    userId: string;
    conversationId: string;
    contactId: string | null;
    messageId: string;
    direction: "inbound" | "outbound";
  },
): Promise<TranscriptionResult> {
  const result = await transcribeAudioMessage(db, input.messageId);

  if (result.text) {
    await db
      .from("messages")
      .update({
        text_content: result.text,
        metadata: { transcript_source: "ai", transcript_confidence: result.confidence },
      })
      .eq("id", input.messageId);

    await patchControl(db, input.conversationId, { audio_context_unknown: false });

    const { extractAndStoreCommitments } = await import("./commitments.server");
    await extractAndStoreCommitments(db, {
      userId: input.userId,
      conversationId: input.conversationId,
      contactId: input.contactId,
      messageId: input.messageId,
      text: result.text,
      direction: input.direction,
    });
    return result;
  }

  await patchControl(db, input.conversationId, {
    audio_context_unknown: true,
    decision_reason: `Áudio não compreendido (${result.reason ?? "desconhecido"}): decisões automáticas de risco suspensas.`,
  });

  const { writeAudit } = await import("@/lib/audit/log.server");
  await writeAudit(db, input.userId, {
    action: "smart_audio_context_unknown",
    summary: "Não foi possível transcrever um áudio da conversa.",
    entityType: "message",
    entityId: input.messageId,
    actor: "system",
    severity: "warning",
    metadata: { reason: result.reason ?? "unknown", direction: input.direction },
  });

  return result;
}
