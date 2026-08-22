/**
 * Utilitário central de telefone.
 *
 * Toda a aplicação (CRM e WhatsApp) deve passar por aqui: normalizamos para
 * E.164 sempre que houver informação suficiente e mantemos os dígitos
 * digitados quando não for possível inferir país/DDD.
 */

const DEFAULT_COUNTRY_CODE = "55";

export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;

  const trimmed = raw.trim();
  if (trimmed === "") return null;

  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  if (digits === "") return null;

  if (hasPlus) return `+${digits}`;

  // Números brasileiros locais têm 10 (fixo) ou 11 (celular) dígitos com DDD.
  if (digits.length === 10 || digits.length === 11) {
    return `+${DEFAULT_COUNTRY_CODE}${digits}`;
  }

  return `+${digits}`;
}

export function formatPhone(value: string | null | undefined): string {
  if (!value) return "—";

  const match = /^\+55(\d{2})(\d{4,5})(\d{4})$/.exec(value);
  if (match) return `(${match[1]}) ${match[2]}-${match[3]}`;

  return value;
}

/**
 * Provedores de WhatsApp trabalham com o número somente em dígitos
 * (ex.: 5511999999999), sem "+" e sem sufixos.
 */
export function toProviderNumber(value: string | null | undefined): string | null {
  const normalized = normalizePhone(value);
  if (!normalized) return null;
  const digits = normalized.replace(/\D/g, "");
  return digits === "" ? null : digits;
}

/**
 * Extrai o telefone de um identificador de chat do WhatsApp
 * (ex.: 5511999999999@s.whatsapp.net, 5511999999999@c.us).
 * Grupos e broadcasts não possuem telefone individual.
 */
export function phoneFromChatId(chatId: string | null | undefined): string | null {
  if (!chatId) return null;
  const [rawUser] = chatId.split("@");
  if (!rawUser) return null;
  if (chatId.includes("@g.us") || chatId.includes("broadcast")) return null;
  const digits = rawUser.split(":")[0]?.replace(/\D/g, "") ?? "";
  if (digits.length < 8) return null;
  return `+${digits}`;
}

/** Monta o identificador de chat individual a partir de um telefone. */
export function chatIdFromPhone(value: string | null | undefined): string | null {
  const digits = toProviderNumber(value);
  return digits ? `${digits}@s.whatsapp.net` : null;
}
