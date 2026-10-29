/**
 * "Toque" = um contato com o cliente. Mensagens de um fluxo enviadas em
 * sequência (ex.: "Bom dia!" e, 1 minuto depois, a continuação) formam um
 * único toque: contam juntas nos limites diários e a continuação não espera o
 * intervalo entre automações.
 */
export const TOUCH_GROUP_MINUTES = 10;
/** No máximo 3 mensagens seguidas formam um mesmo toque. */
export const MAX_MESSAGES_PER_TOUCH = 3;

/** Agrupa horários de envio em toques e devolve os grupos (mais antigo primeiro). */
export function groupTouches(sentAtIso: string[], gapMinutes = TOUCH_GROUP_MINUTES): number[][] {
  const times = sentAtIso
    .map((iso) => new Date(iso).getTime())
    .filter((t) => !Number.isNaN(t))
    .sort((a, b) => a - b);
  const groups: number[][] = [];
  for (const t of times) {
    const last = groups[groups.length - 1];
    const prev = last?.[last.length - 1];
    if (last && prev !== undefined && t - prev <= gapMinutes * 60_000) last.push(t);
    else groups.push([t]);
  }
  return groups;
}

export function countTouches(sentAtIso: string[]): number {
  return groupTouches(sentAtIso).length;
}

/**
 * A próxima mensagem continua o toque atual? Sim quando o último envio do
 * mesmo fluxo foi há no máximo 10 minutos e o toque ainda não tem 3 mensagens.
 */
export function continuesCurrentTouch(sentAtIso: string[], now: Date): boolean {
  const groups = groupTouches(sentAtIso);
  const last = groups[groups.length - 1];
  if (!last) return false;
  const lastAt = last[last.length - 1];
  if (lastAt === undefined) return false;
  if (now.getTime() - lastAt > TOUCH_GROUP_MINUTES * 60_000) return false;
  return last.length < MAX_MESSAGES_PER_TOUCH;
}
