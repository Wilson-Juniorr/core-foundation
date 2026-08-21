/**
 * Telefone é o identificador que a futura integração de mensageria usará.
 * Por isso normalizamos para o formato E.164 sempre que houver informação
 * suficiente, mantendo o dígito digitado quando não for possível inferir.
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
