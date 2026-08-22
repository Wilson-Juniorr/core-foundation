/**
 * Logs estruturados das integrações.
 *
 * Nunca registrar tokens, secrets ou o conteúdo completo das mensagens —
 * apenas metadados suficientes para auditar o fluxo.
 */

type LogLevel = "info" | "warn" | "error";

type LogFields = Record<string, string | number | boolean | null | undefined>;

const REDACTED_KEYS = /token|secret|password|apikey|authorization/i;

function safeFields(fields: LogFields): LogFields {
  const output: LogFields = {};
  for (const [key, value] of Object.entries(fields)) {
    if (REDACTED_KEYS.test(key)) continue;
    output[key] = value;
  }
  return output;
}

function emit(level: LogLevel, event: string, fields: LogFields = {}): void {
  const payload = JSON.stringify({
    scope: "whatsapp",
    event,
    at: new Date().toISOString(),
    ...safeFields(fields),
  });

  if (level === "error") console.error(payload);
  else if (level === "warn") console.warn(payload);
  else console.log(payload);
}

export const waLog = {
  info: (event: string, fields?: LogFields) => emit("info", event, fields),
  warn: (event: string, fields?: LogFields) => emit("warn", event, fields),
  error: (event: string, fields?: LogFields) => emit("error", event, fields),
};

/** Mensagem de erro segura para exibir ao usuário. */
export function userFacingProviderError(error: unknown): string {
  if (error instanceof ProviderError) return error.userMessage;
  return "Não foi possível falar com o provedor de WhatsApp. Tente novamente.";
}

export class ProviderError extends Error {
  readonly userMessage: string;
  readonly statusCode: number | null;

  constructor(message: string, userMessage: string, statusCode: number | null = null) {
    super(message);
    this.name = "ProviderError";
    this.userMessage = userMessage;
    this.statusCode = statusCode;
  }
}
