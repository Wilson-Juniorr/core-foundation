import type {
  DelayUnit,
  FollowupActionType,
  FollowupRunStatus,
  ScheduledActionStatus,
} from "./types";

export const ACTION_TYPE_LABELS: Record<FollowupActionType, string> = {
  text_message: "Mensagem de texto",
  audio: "Áudio",
  image: "Imagem",
  document: "Documento",
};

export const DELAY_UNIT_LABELS: Record<DelayUnit, string> = {
  minutes: "minutos",
  hours: "horas",
  days: "dias",
};

export const RUN_STATUS_LABELS: Record<FollowupRunStatus, string> = {
  active: "Ativo",
  paused: "Pausado",
  stopped: "Interrompido",
  completed: "Concluído",
  cancelled: "Cancelado",
  failed: "Com falha",
};

export const SCHEDULED_STATUS_LABELS: Record<ScheduledActionStatus, string> = {
  scheduled: "Agendada",
  processing: "Enviando",
  sent: "Enviada",
  cancelled: "Cancelada",
  failed: "Falhou",
  skipped: "Ignorada",
  blocked: "Bloqueada por política",
  simulated: "Simulada (modo teste)",
  needs_approval: "Aguardando sua aprovação",
  stale: "Desatualizada pelo contexto",

};

export const STOP_REASON_LABELS: Record<string, string> = {
  customer_replied: "Cliente respondeu",
  manually_cancelled: "Cancelado manualmente",
  replaced: "Substituído por outro fluxo",
  send_failed: "Falha de envio",
};

export function stopReasonLabel(reason: string | null): string | null {
  if (!reason) return null;
  return STOP_REASON_LABELS[reason] ?? reason;
}

/** Placeholders determinísticos suportados no texto das etapas. */
export const SUPPORTED_PLACEHOLDERS = ["{{name}}", "{{first_name}}"] as const;

export class PlaceholderError extends Error {
  constructor(public placeholder: string) {
    super(`Não foi possível preencher ${placeholder}`);
    this.name = "PlaceholderError";
  }
}

/**
 * Substitui placeholders simples. Se algum placeholder não puder ser
 * preenchido, lança erro — nunca enviamos texto quebrado ao cliente.
 */
export function renderContent(
  template: string,
  values: { name: string | null; firstName: string | null },
): string {
  return template.replace(/\{\{\s*(name|first_name)\s*\}\}/g, (_match, key: string) => {
    const value = key === "name" ? values.name : values.firstName;
    if (!value || !value.trim()) throw new PlaceholderError(`{{${key}}}`);
    return value.trim();
  });
}

export function firstNameOf(name: string | null): string | null {
  if (!name) return null;
  const [first] = name.trim().split(/\s+/);
  return first ?? null;
}
