import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import { formatDateTime } from "@/lib/domain/datetime";
import type { AttentionCandidate, AttentionPriority, ScoreFactor } from "./types";

type Client = SupabaseClient<Database>;

const HOUR = 60 * 60 * 1000;

/** Peso inicial de cada situação — determinístico e auditável. */
const BASE: Record<AttentionCandidate["kind"], number> = {
  ready_to_close: 72,
  discount_requested: 66,
  call_requested: 60,
  whatsapp_disconnected: 62,
  message_failed: 56,
  objection_needs_human: 55,
  own_promise_overdue: 50,
  flow_failed: 48,
  customer_replied: 44,
  high_interest: 44,
  document_received: 40,
  overdue_next_action: 38,
  missing_next_action: 26,
  unlinked_conversation: 22,
  low_ai_confidence: 18,
};

function priorityFromScore(score: number): AttentionPriority {
  if (score >= 70) return "critical";
  if (score >= 45) return "high";
  if (score >= 25) return "medium";
  return "low";
}

function sum(factors: ScoreFactor[]): number {
  return factors.reduce((total, factor) => total + factor.points, 0);
}

function hoursSince(iso: string | null | undefined, now: number): number | null {
  if (!iso) return null;
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return null;
  return (now - time) / HOUR;
}

function waitFactor(hours: number | null): ScoreFactor | null {
  if (hours === null) return null;
  if (hours >= 24) return { label: `Sem resposta há ${Math.round(hours / 24)} dia(s)`, points: 15 };
  if (hours >= 4) return { label: `Aguardando há ${Math.round(hours)}h`, points: 8 };
  return null;
}

function valueFactor(value: number | null): ScoreFactor | null {
  if (!value) return null;
  if (value >= 10000) return { label: "Oportunidade de alto valor", points: 10 };
  if (value >= 3000) return { label: "Oportunidade de valor relevante", points: 5 };
  return null;
}

/** Prefixos de explicação alinhados à prioridade final. */
const PRIORITY_PREFIX: Record<AttentionPriority, string> = {
  critical: "Prioridade crítica",
  high: "Alta prioridade",
  medium: "Média prioridade",
  low: "Baixa prioridade",
};

const DISCOUNT_RE =
  /\b(desconto|abatimento|melhor pre[çc]o|mais barato|condi[çc][ãa]o especial)\b/i;
const CALL_RE =
  /\b(me liga|pode ligar|ligar para mim|liga[çc][ãa]o|chamada|me chama no telefone)\b/i;

/** Constrói um candidato aplicando fatores em cima do peso base. */
function build(input: {
  kind: AttentionCandidate["kind"];
  dedupe_key: string;
  title: string;
  summary?: string | null;
  reason: string;
  suggested_action: string;
  suggested_action_kind: AttentionCandidate["suggested_action_kind"];
  bucket: AttentionCandidate["bucket"];
  factors: (ScoreFactor | null)[];
  contact_id?: string | null;
  opportunity_id?: string | null;
  conversation_id?: string | null;
  blocks_automation?: boolean;
  metadata?: AttentionCandidate["metadata"];
}): AttentionCandidate {
  const factors: ScoreFactor[] = [
    { label: `Situação: ${input.title}`, points: BASE[input.kind] },
    ...input.factors.filter((factor): factor is ScoreFactor => Boolean(factor)),
  ];
  const score = Math.max(1, Math.min(100, sum(factors)));
  const priority = priorityFromScore(score);

  // A explicação precisa combinar com a prioridade realmente calculada.
  const reason = input.reason.replace(
    /^(Prioridade cr[íi]tica|Alta prioridade|M[ée]dia prioridade|Baixa prioridade)/,
    PRIORITY_PREFIX[priority],
  );

  return {
    kind: input.kind,
    dedupe_key: input.dedupe_key,
    priority,
    priority_score: score,
    score_factors: factors,
    bucket: input.bucket,
    title: input.title,
    summary: input.summary ?? null,
    reason,
    suggested_action: input.suggested_action,
    suggested_action_kind: input.suggested_action_kind,
    contact_id: input.contact_id ?? null,
    opportunity_id: input.opportunity_id ?? null,
    conversation_id: input.conversation_id ?? null,
    blocks_automation: input.blocks_automation ?? false,
    metadata: input.metadata ?? {},
  };
}

/**
 * Varre os dados reais do usuário e devolve todos os itens de atenção
 * detectados agora. Nenhuma decisão depende de IA.
 */
export async function detectAttention(
  db: Client,
  userId: string,
  now = new Date(),
): Promise<AttentionCandidate[]> {
  const nowMs = now.getTime();

  const [
    contactsResult,
    opportunitiesResult,
    stagesResult,
    conversationsResult,
    messagesResult,
    memoryResult,
    actionsResult,
    runsResult,
    connectionsResult,
  ] = await Promise.all([
    db.from("contacts").select("id, name, is_archived").eq("user_id", userId),
    db
      .from("opportunities")
      .select("id, contact_id, title, status, estimated_value, next_action_at, pipeline_stage_id")
      .eq("user_id", userId)
      .eq("status", "open"),
    db.from("pipeline_stages").select("id, name, position").eq("user_id", userId),
    db
      .from("conversations")
      .select("id, contact_id, display_name, phone_number, last_message_at, unread_count")
      .eq("user_id", userId)
      .eq("is_archived", false),
    db
      .from("messages")
      .select(
        "id, conversation_id, contact_id, direction, message_type, text_content, sent_at, status",
      )
      .eq("user_id", userId)
      .order("sent_at", { ascending: false })
      .limit(500),
    db.from("customer_memory").select("*").eq("user_id", userId).is("opportunity_id", null),
    db
      .from("scheduled_actions")
      .select("id, contact_id, conversation_id, status, last_error, scheduled_for")
      .eq("user_id", userId)
      .eq("status", "failed")
      .order("updated_at", { ascending: false })
      .limit(50),
    db
      .from("followup_runs")
      .select("id, contact_id, conversation_id, flow_id, status, stop_reason")
      .eq("user_id", userId)
      .eq("status", "failed")
      .limit(50),
    db
      .from("whatsapp_connections")
      .select("id, display_name, phone_number, status, last_error")
      .eq("user_id", userId),
  ]);

  const contactName = new Map<string, string>();
  for (const contact of contactsResult.data ?? []) contactName.set(contact.id, contact.name);

  const stagePosition = new Map<string, { name: string; position: number; total: number }>();
  const stages = stagesResult.data ?? [];
  const maxPosition = stages.reduce((max, stage) => Math.max(max, stage.position), 1);
  for (const stage of stages) {
    stagePosition.set(stage.id, { name: stage.name, position: stage.position, total: maxPosition });
  }

  const opportunities = opportunitiesResult.data ?? [];
  const opportunityByContact = new Map<string, (typeof opportunities)[number]>();
  for (const opportunity of opportunities) {
    const current = opportunityByContact.get(opportunity.contact_id);
    const value = Number(opportunity.estimated_value ?? 0);
    if (!current || value > Number(current.estimated_value ?? 0)) {
      opportunityByContact.set(opportunity.contact_id, opportunity);
    }
  }

  const messages = messagesResult.data ?? [];
  const lastInbound = new Map<string, (typeof messages)[number]>();
  const lastOutbound = new Map<string, (typeof messages)[number]>();
  for (const message of messages) {
    const bucket = message.direction === "inbound" ? lastInbound : lastOutbound;
    if (!bucket.has(message.conversation_id)) bucket.set(message.conversation_id, message);
  }

  const candidates: AttentionCandidate[] = [];
  const stageFactor = (stageId: string | null | undefined): ScoreFactor | null => {
    if (!stageId) return null;
    const stage = stagePosition.get(stageId);
    if (!stage) return null;
    if (stage.position >= stage.total - 1) {
      return { label: `Etapa avançada do pipeline (${stage.name})`, points: 8 };
    }
    return null;
  };

  /* ------------------------------ conversas ------------------------------ */

  for (const conversation of conversationsResult.data ?? []) {
    const inbound = lastInbound.get(conversation.id) ?? null;
    const outbound = lastOutbound.get(conversation.id) ?? null;
    const name = conversation.contact_id
      ? (contactName.get(conversation.contact_id) ?? conversation.display_name ?? "Cliente")
      : (conversation.display_name ?? conversation.phone_number ?? "Contato desconhecido");
    const opportunity = conversation.contact_id
      ? (opportunityByContact.get(conversation.contact_id) ?? null)
      : null;
    const value = opportunity ? Number(opportunity.estimated_value ?? 0) : null;

    if (!conversation.contact_id) {
      candidates.push(
        build({
          kind: "unlinked_conversation",
          dedupe_key: `unlinked_conversation:${conversation.id}`,
          title: "Conversa sem cliente",
          summary: `${name} conversa sem cadastro vinculado.`,
          reason:
            "Média prioridade porque esta conversa não está vinculada a nenhum cliente, então o histórico comercial não é registrado.",
          suggested_action: "Vincular a conversa a um cliente existente ou criar o cadastro.",
          suggested_action_kind: "fix_operational",
          bucket: "today",
          conversation_id: conversation.id,
          factors: [],
        }),
      );
    }

    if (!inbound) continue;

    const inboundIsLast =
      !outbound || new Date(inbound.sent_at).getTime() > new Date(outbound.sent_at).getTime();
    const waitHours = hoursSince(inbound.sent_at, nowMs);
    const text = inbound.text_content ?? "";

    if (inboundIsLast && (waitHours ?? 0) < 24 * 7) {
      candidates.push(
        build({
          kind: "customer_replied",
          dedupe_key: `customer_replied:${conversation.id}:${inbound.id}`,
          title: "Cliente respondeu",
          summary: text ? text.slice(0, 160) : "Nova mensagem recebida.",
          reason: `Alta prioridade porque ${name} respondeu ${formatDateTime(inbound.sent_at)} e ainda não houve resposta sua.`,
          suggested_action: "Responder agora, retomando o último ponto da conversa.",
          suggested_action_kind: "reply_now",
          bucket: (waitHours ?? 0) >= 24 ? "overdue" : "now",
          contact_id: conversation.contact_id,
          opportunity_id: opportunity?.id ?? null,
          conversation_id: conversation.id,
          factors: [
            waitFactor(waitHours),
            valueFactor(value),
            stageFactor(opportunity?.pipeline_stage_id),
          ],
          metadata: { message_id: inbound.id, unread: conversation.unread_count },
        }),
      );
    }

    if (inboundIsLast && DISCOUNT_RE.test(text)) {
      candidates.push(
        build({
          kind: "discount_requested",
          dedupe_key: `discount_requested:${conversation.id}:${inbound.id}`,
          title: "Pediu desconto",
          summary: text.slice(0, 160),
          reason: `Prioridade crítica porque ${name} pediu condição comercial — isso exige decisão sua, não uma mensagem automática.`,
          suggested_action: "Definir a condição possível e responder pessoalmente.",
          suggested_action_kind: "review_proposal",
          bucket: "now",
          contact_id: conversation.contact_id,
          opportunity_id: opportunity?.id ?? null,
          conversation_id: conversation.id,
          blocks_automation: true,
          factors: [
            { label: "Pedido explícito do cliente", points: 12 },
            waitFactor(waitHours),
            valueFactor(value),
          ],
          metadata: { message_id: inbound.id },
        }),
      );
    }

    if (inboundIsLast && CALL_RE.test(text)) {
      candidates.push(
        build({
          kind: "call_requested",
          dedupe_key: `call_requested:${conversation.id}:${inbound.id}`,
          title: "Pediu ligação",
          summary: text.slice(0, 160),
          reason: `Prioridade alta porque ${name} pediu contato por telefone.`,
          suggested_action: "Ligar para o cliente e registrar o resultado.",
          suggested_action_kind: "call",
          bucket: "now",
          contact_id: conversation.contact_id,
          opportunity_id: opportunity?.id ?? null,
          conversation_id: conversation.id,
          blocks_automation: true,
          factors: [{ label: "Pedido explícito do cliente", points: 12 }, waitFactor(waitHours)],
          metadata: { message_id: inbound.id },
        }),
      );
    }

    if (inbound.message_type === "document" && (waitHours ?? 99) < 72) {
      candidates.push(
        build({
          kind: "document_received",
          dedupe_key: `document_received:${conversation.id}:${inbound.id}`,
          title: "Documento recebido",
          summary: "O cliente enviou um documento que precisa de conferência.",
          reason: `Prioridade alta porque ${name} enviou um documento e a conferência depende de você.`,
          suggested_action: "Conferir o documento e confirmar o recebimento ao cliente.",
          suggested_action_kind: "review_proposal",
          bucket: "today",
          contact_id: conversation.contact_id,
          opportunity_id: opportunity?.id ?? null,
          conversation_id: conversation.id,
          factors: [valueFactor(value)],
          metadata: { message_id: inbound.id },
        }),
      );
    }
  }

  /* ------------------------------- memória ------------------------------- */

  const conversationByContact = new Map<string, string>();
  for (const conversation of conversationsResult.data ?? []) {
    if (conversation.contact_id && !conversationByContact.has(conversation.contact_id)) {
      conversationByContact.set(conversation.contact_id, conversation.id);
    }
  }

  for (const memory of memoryResult.data ?? []) {
    const name = contactName.get(memory.contact_id) ?? "Cliente";
    const opportunity = opportunityByContact.get(memory.contact_id) ?? null;
    const value = opportunity ? Number(opportunity.estimated_value ?? 0) : null;
    const conversationId = conversationByContact.get(memory.contact_id) ?? null;
    const shared = {
      contact_id: memory.contact_id,
      opportunity_id: opportunity?.id ?? null,
      conversation_id: conversationId,
    };

    if (memory.customer_intent === "ready_to_close") {
      candidates.push(
        build({
          ...shared,
          kind: "ready_to_close",
          dedupe_key: `ready_to_close:${memory.contact_id}`,
          title: "Quer fechar",
          summary: memory.next_step_detected ?? memory.current_summary,
          reason: `Prioridade crítica porque a leitura da conversa indica que ${name} está pronto para fechar.`,
          suggested_action: "Enviar o fechamento (proposta/documentos) hoje mesmo.",
          suggested_action_kind: "review_proposal",
          bucket: "now",
          blocks_automation: true,
          factors: [
            { label: "Intenção de compra declarada", points: 12 },
            valueFactor(value),
            stageFactor(opportunity?.pipeline_stage_id),
          ],
        }),
      );
    } else if (
      memory.interest_level === "very_high" ||
      (memory.interest_level === "high" && memory.customer_intent === "negotiating")
    ) {
      candidates.push(
        build({
          ...shared,
          kind: "high_interest",
          dedupe_key: `high_interest:${memory.contact_id}`,
          title: "Alto interesse",
          summary: memory.current_summary,
          reason: `Prioridade alta porque ${name} demonstra interesse elevado e a janela de decisão está aberta.`,
          suggested_action: "Avançar a negociação com uma mensagem específica sobre o interesse.",
          suggested_action_kind: "send_information",
          bucket: "today",
          factors: [valueFactor(value), stageFactor(opportunity?.pipeline_stage_id)],
        }),
      );
    }

    const objections = Array.isArray(memory.main_objections) ? memory.main_objections : [];
    const openObjection = objections[0] as { value?: string } | undefined;
    if (openObjection?.value) {
      candidates.push(
        build({
          ...shared,
          kind: "objection_needs_human",
          dedupe_key: `objection:${memory.contact_id}`,
          title: "Objeção precisa de você",
          summary: openObjection.value,
          reason: `Prioridade alta porque existe uma objeção aberta de ${name} que automação genérica não resolve.`,
          suggested_action: "Tratar a objeção pessoalmente antes de qualquer novo follow-up.",
          suggested_action_kind: "reply_now",
          bucket: "today",
          blocks_automation: true,
          factors: [valueFactor(value)],
        }),
      );
    }

    const commitments = (
      Array.isArray(memory.seller_commitments) ? memory.seller_commitments : []
    ) as { value?: string; due?: string | null }[];
    for (const commitment of commitments) {
      if (!commitment?.value || !commitment.due) continue;
      const due = new Date(commitment.due).getTime();
      if (Number.isNaN(due) || due > nowMs) continue;
      const lateDays = Math.max(1, Math.round((nowMs - due) / (24 * HOUR)));
      candidates.push(
        build({
          ...shared,
          kind: "own_promise_overdue",
          dedupe_key: `own_promise:${memory.contact_id}:${commitment.value.slice(0, 40)}`,
          title: "Sua promessa venceu",
          summary: commitment.value,
          reason: `Prioridade alta porque você prometeu algo a ${name} e o prazo venceu há ${lateDays} dia(s).`,
          suggested_action: "Cumprir a promessa ou reposicionar o prazo com o cliente.",
          suggested_action_kind: "reply_now",
          bucket: "overdue",
          factors: [{ label: `Atraso de ${lateDays} dia(s)`, points: Math.min(15, lateDays * 3) }],
        }),
      );
    }

    if (
      memory.analysis_status === "ready" &&
      Number(memory.confidence ?? 0) > 0 &&
      Number(memory.confidence) < 0.45
    ) {
      candidates.push(
        build({
          ...shared,
          kind: "low_ai_confidence",
          dedupe_key: `low_confidence:${memory.contact_id}`,
          title: "Leitura da IA incerta",
          summary: `Confiança de ${Math.round(Number(memory.confidence) * 100)}% na leitura da conversa.`,
          reason: `Prioridade baixa: a leitura automática de ${name} está com confiança baixa e precisa da sua confirmação.`,
          suggested_action: "Revisar e corrigir a memória do cliente manualmente.",
          suggested_action_kind: "fix_operational",
          bucket: "waiting",
          factors: [],
        }),
      );
    }
  }

  /* ---------------------------- oportunidades ---------------------------- */

  for (const opportunity of opportunities) {
    const name = contactName.get(opportunity.contact_id) ?? "Cliente";
    const value = Number(opportunity.estimated_value ?? 0);
    const conversationId = conversationByContact.get(opportunity.contact_id) ?? null;
    const shared = {
      contact_id: opportunity.contact_id,
      opportunity_id: opportunity.id,
      conversation_id: conversationId,
    };

    if (!opportunity.next_action_at) {
      candidates.push(
        build({
          ...shared,
          kind: "missing_next_action",
          dedupe_key: `missing_next_action:${opportunity.id}`,
          title: "Sem próxima ação",
          summary: opportunity.title,
          reason: `Prioridade média porque a oportunidade de ${name} está aberta sem próximo passo definido.`,
          suggested_action: "Definir a próxima ação com data e hora.",
          suggested_action_kind: "schedule_contact",
          bucket: "today",
          factors: [valueFactor(value), stageFactor(opportunity.pipeline_stage_id)],
        }),
      );
      continue;
    }

    const dueMs = new Date(opportunity.next_action_at).getTime();
    if (!Number.isNaN(dueMs) && dueMs < nowMs) {
      const lateDays = Math.max(1, Math.round((nowMs - dueMs) / (24 * HOUR)));
      candidates.push(
        build({
          ...shared,
          kind: "overdue_next_action",
          dedupe_key: `overdue_next_action:${opportunity.id}`,
          title: "Próxima ação atrasada",
          summary: opportunity.next_action_at
            ? `${opportunity.title} — previsto para ${formatDateTime(opportunity.next_action_at)}`
            : opportunity.title,
          reason: `Prioridade alta porque a ação combinada com ${name} está atrasada há ${lateDays} dia(s).`,
          suggested_action: "Executar a ação agora ou reagendar com uma nova data.",
          suggested_action_kind: "reply_now",
          bucket: "overdue",
          factors: [
            { label: `Atraso de ${lateDays} dia(s)`, points: Math.min(15, lateDays * 3) },
            valueFactor(value),
            stageFactor(opportunity.pipeline_stage_id),
          ],
        }),
      );
    }
  }

  /* ------------------------- falhas operacionais ------------------------- */

  for (const action of actionsResult.data ?? []) {
    const name = action.contact_id ? (contactName.get(action.contact_id) ?? "Cliente") : "Cliente";
    candidates.push(
      build({
        kind: "message_failed",
        dedupe_key: `message_failed:${action.id}`,
        title: "Mensagem falhou",
        summary: action.last_error ?? "Envio automático não concluído.",
        reason: `Prioridade crítica porque uma mensagem programada para ${name} não foi entregue.`,
        suggested_action: "Verificar a conexão e reenviar a mensagem manualmente.",
        suggested_action_kind: "fix_operational",
        bucket: "overdue",
        contact_id: action.contact_id,
        conversation_id: action.conversation_id,
        factors: [{ label: "Falha operacional", points: 10 }],
        metadata: { scheduled_action_id: action.id },
      }),
    );
  }

  for (const run of runsResult.data ?? []) {
    const name = contactName.get(run.contact_id) ?? "Cliente";
    candidates.push(
      build({
        kind: "flow_failed",
        dedupe_key: `flow_failed:${run.id}`,
        title: "Fluxo falhou",
        summary: run.stop_reason ?? "O acompanhamento automático foi interrompido por erro.",
        reason: `Prioridade alta porque o fluxo de ${name} parou por falha e o cliente ficou sem sequência.`,
        suggested_action: "Revisar o fluxo e retomar o acompanhamento.",
        suggested_action_kind: "start_flow",
        bucket: "overdue",
        contact_id: run.contact_id,
        conversation_id: run.conversation_id,
        factors: [{ label: "Falha operacional", points: 10 }],
        metadata: { flow_run_id: run.id },
      }),
    );
  }

  for (const connection of connectionsResult.data ?? []) {
    if (connection.status !== "error" && connection.status !== "disconnected") continue;
    candidates.push(
      build({
        kind: "whatsapp_disconnected",
        dedupe_key: `whatsapp_disconnected:${connection.id}`,
        title: "WhatsApp desconectado",
        summary:
          connection.last_error ??
          `${connection.display_name ?? connection.phone_number ?? "Instância"} está fora do ar.`,
        reason:
          "Prioridade crítica porque, sem WhatsApp conectado, nenhuma mensagem (manual ou automática) sai.",
        suggested_action: "Reconectar a instância em Configurações › WhatsApp.",
        suggested_action_kind: "fix_operational",
        bucket: "now",
        factors: [{ label: "Falha operacional", points: 10 }],
        metadata: { connection_id: connection.id },
      }),
    );
  }

  // Deduplicação de contexto: um mesmo problema não deve gerar vários alertas.
  // Quando a conversa já gerou um sinal específico (desconto, fechamento, objeção,
  // ligação, documento...), o alerta genérico "cliente respondeu" é redundante.
  const specificConversations = new Set(
    candidates
      .filter((candidate) => candidate.kind !== "customer_replied" && candidate.conversation_id)
      .map((candidate) => candidate.conversation_id as string),
  );

  return candidates.filter(
    (candidate) =>
      candidate.kind !== "customer_replied" ||
      !candidate.conversation_id ||
      !specificConversations.has(candidate.conversation_id),
  );
}
