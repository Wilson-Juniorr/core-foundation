import type { ContentAssetType, DraftStatus, StrategyAutonomy } from "./types";

export const assetTypeLabels: Record<ContentAssetType, string> = {
  text: "Texto",
  audio: "Áudio",
  image: "Imagem",
  document: "Documento",
};

export const autonomyLabels: Record<StrategyAutonomy, string> = {
  manual: "Manual",
  approval_required: "Requer aprovação",
  automatic: "Automático",
};

export const autonomyDescriptions: Record<StrategyAutonomy, string> = {
  manual: "A IA sugere, você decide e escreve o envio.",
  approval_required: "Gera rascunho e espera sua aprovação antes de enviar.",
  automatic: "Poderá ser usada pelo motor quando todas as regras permitirem.",
};

export const draftStatusLabels: Record<DraftStatus, string> = {
  generated: "Gerado",
  edited: "Editado",
  approved: "Aprovado",
  rejected: "Recusado",
  sent: "Enviado",
};

/** Comportamentos proibidos oferecidos como checkboxes no editor de estratégia. */
export const FORBIDDEN_BEHAVIOR_OPTIONS = [
  { value: "pressure", label: "Pressionar ou cobrar resposta" },
  { value: "false_urgency", label: "Criar urgência ou escassez artificial" },
  { value: "invent_offer", label: "Oferecer desconto ou condição não registrada" },
  { value: "invent_facts", label: "Afirmar fatos que não estão no contexto" },
  { value: "pretend_manual", label: "Fingir que a mensagem foi digitada agora" },
  { value: "negotiate", label: "Negociar valores sem o vendedor" },
  { value: "insist_after_stop", label: "Insistir depois de pedido para parar" },
  { value: "long_message", label: "Escrever mensagem longa demais" },
] as const;

export const forbiddenBehaviorLabels: Record<string, string> = Object.fromEntries(
  FORBIDDEN_BEHAVIOR_OPTIONS.map((option) => [option.value, option.label]),
);

export function forbiddenBehaviorLabel(value: string): string {
  return forbiddenBehaviorLabels[value] ?? value;
}

export function formatDuration(seconds: number | null): string {
  if (!seconds || seconds <= 0) return "—";
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}
