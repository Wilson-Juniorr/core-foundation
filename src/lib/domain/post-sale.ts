export const POST_SALE_STAGES = ["issuing", "pending", "onboarding", "done"] as const;
export type PostSaleStage = (typeof POST_SALE_STAGES)[number];

export const POST_SALE_LABELS: Record<PostSaleStage, string> = {
  issuing: "Em emissão",
  pending: "Aguardando pendência",
  onboarding: "Vigência confirmada",
  done: "Concluído",
};

export function isPostSaleStage(value: string | null | undefined): value is PostSaleStage {
  return POST_SALE_STAGES.some((stage) => stage === value);
}

export function saoPauloDay(now = new Date()): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function addCalendarDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function isCalendarDay(value: string): boolean {
  if (!/^[1-9]\d{3}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function displayPostSaleDay(day: string): string {
  const [year, month, date] = day.split("-");
  return `${date}/${month}/${year}`;
}

export function postSaleTask(stage: PostSaleStage): string {
  switch (stage) {
    case "issuing":
      return "Conferir emissão";
    case "pending":
      return "Acompanhar pendência";
    case "onboarding":
      return "Conferir acesso ao plano";
    case "done":
      return "Pós-venda concluído";
  }
}

export function nextPostSaleState(
  current: PostSaleStage | null,
  effectiveOn: string | null,
  input: { stage: PostSaleStage; day?: string | undefined; note?: string | undefined },
) {
  if (current === "done" || (input.stage === "done" && current !== "onboarding")) {
    throw new Error("Essa mudança de etapa não está disponível.");
  }
  if (input.stage === "pending" && !input.note?.trim()) {
    throw new Error("Informe qual pendência precisa de acompanhamento.");
  }

  if (input.stage === "done") {
    return { stage: input.stage, dueOn: null, effectiveOn };
  }

  if (!input.day || !isCalendarDay(input.day)) throw new Error("Informe uma data válida.");

  if (input.stage === "onboarding") {
    const dueOn = addCalendarDays(input.day, 7);
    if (!isCalendarDay(dueOn)) throw new Error("Informe uma data de vigência válida.");
    return { stage: input.stage, dueOn, effectiveOn: input.day };
  }

  return { stage: input.stage, dueOn: input.day, effectiveOn: null };
}
