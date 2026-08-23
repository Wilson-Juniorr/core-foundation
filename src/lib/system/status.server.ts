import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import type {
  FailedJobItem,
  FailedMessageItem,
  StuckActionItem,
  SystemIncident,
  SystemStatus,
} from "./types";

type Client = SupabaseClient<Database>;

const STUCK_MINUTES = 15;
const OVERDUE_MINUTES = 5;

function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

/**
 * Diagnóstico técnico: mostra fila, falhas e conexões em números pequenos e
 * acionáveis, para que o operador saiba se o sistema está trabalhando por ele.
 */
export async function loadSystemStatus(client: Client, userId: string): Promise<SystemStatus> {
  const stuckBefore = minutesAgo(STUCK_MINUTES);
  const overdueBefore = minutesAgo(OVERDUE_MINUTES);
  const dayAgo = minutesAgo(24 * 60);

  const [
    connections,
    settings,
    pending,
    overdue,
    stuck,
    aiPending,
    aiStuck,
    messagesFailed,
    actionsFailed,
    actionsBlocked,
    jobsFailed,
    attentionOpen,
    draftsWaiting,
    failedMessagesRows,
    stuckActionRows,
    failedJobRows,
  ] = await Promise.all([
    client
      .from("whatsapp_connections")
      .select(
        "id, status, phone_number, display_name, last_event_at, last_synced_at, last_sync_status, last_error",
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: true }),
    client
      .from("user_settings")
      .select("automation_paused, automation_paused_at, test_mode, require_approval_all")
      .eq("user_id", userId)
      .maybeSingle(),
    client
      .from("scheduled_actions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("status", "scheduled"),
    client
      .from("scheduled_actions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("status", "scheduled")
      .lt("scheduled_for", overdueBefore),
    client
      .from("scheduled_actions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("status", "processing")
      .lt("updated_at", stuckBefore),
    client
      .from("ai_analysis_jobs")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("status", "pending"),
    client
      .from("ai_analysis_jobs")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("status", "processing")
      .lt("claimed_at", stuckBefore),
    client
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("status", "failed")
      .gte("sent_at", dayAgo),
    client
      .from("scheduled_actions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("status", "failed")
      .gte("updated_at", dayAgo),
    client
      .from("scheduled_actions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .in("status", ["blocked", "skipped"])
      .gte("updated_at", dayAgo),
    client
      .from("ai_analysis_jobs")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("status", "failed")
      .gte("created_at", dayAgo),
    client
      .from("attention_items")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("status", "open"),
    client
      .from("message_drafts")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .in("status", ["generated", "edited"]),
    client
      .from("messages")
      .select("id, conversation_id, text_content, sent_at, message_type, contacts(name)")
      .eq("user_id", userId)
      .eq("status", "failed")
      .order("sent_at", { ascending: false })
      .limit(10),
    client
      .from("scheduled_actions")
      .select("id, status, scheduled_for, last_error, attempts, contacts(name)")
      .eq("user_id", userId)
      .in("status", ["failed", "processing", "blocked"])
      .order("scheduled_for", { ascending: true })
      .limit(10),
    client
      .from("ai_analysis_jobs")
      .select("id, reason, status, attempts, requested_at, last_error, contacts(name)")
      .eq("user_id", userId)
      .in("status", ["failed", "processing"])
      .order("requested_at", { ascending: false })
      .limit(10),
  ]);

  const connectionRows = connections.data ?? [];
  const webhookLastEvent =
    connectionRows
      .map((row) => row.last_event_at)
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1) ?? null;

  const failedMessages: FailedMessageItem[] = (failedMessagesRows.data ?? []).map((row) => ({
    id: row.id,
    conversation_id: row.conversation_id,
    contact_name: (row.contacts as { name: string } | null)?.name ?? null,
    preview: row.text_content ? row.text_content.slice(0, 120) : null,
    sent_at: row.sent_at,
    can_retry: row.message_type === "text" && Boolean(row.text_content),
  }));

  const stuckActions: StuckActionItem[] = (stuckActionRows.data ?? []).map((row) => ({
    id: row.id,
    status: row.status,
    scheduled_for: row.scheduled_for,
    contact_name: (row.contacts as { name: string } | null)?.name ?? null,
    last_error: row.last_error,
    attempts: row.attempts,
  }));

  const failedJobs: FailedJobItem[] = (failedJobRows.data ?? []).map((row) => ({
    id: row.id,
    reason: row.reason,
    status: row.status,
    attempts: row.attempts,
    requested_at: row.requested_at,
    last_error: row.last_error,
    contact_name: (row.contacts as { name: string } | null)?.name ?? null,
  }));

  const guardrails = {
    automation_paused: settings.data?.automation_paused ?? false,
    automation_paused_at: settings.data?.automation_paused_at ?? null,
    test_mode: settings.data?.test_mode ?? false,
    require_approval_all: settings.data?.require_approval_all ?? false,
    attention_open: attentionOpen.count ?? 0,
    drafts_waiting: draftsWaiting.count ?? 0,
  };

  const incidents: SystemIncident[] = [];

  if (connectionRows.length === 0) {
    incidents.push({
      id: "no_connection",
      severity: "critical",
      title: "Nenhum WhatsApp conectado",
      detail: "Sem conexão ativa o sistema não recebe nem envia mensagens.",
      hint: "Configure o WhatsApp em Configurações.",
    });
  }
  for (const connection of connectionRows) {
    if (connection.status !== "connected") {
      incidents.push({
        id: `connection_${connection.id}`,
        severity: "critical",
        title: `WhatsApp ${connection.display_name ?? connection.phone_number ?? ""} sem conexão`,
        detail: connection.last_error ?? "A instância não está conectada.",
        hint: "Reconecte lendo o QR Code novamente.",
      });
    }
  }
  if (webhookLastEvent && webhookLastEvent < minutesAgo(120)) {
    incidents.push({
      id: "webhook_silent",
      severity: "warning",
      title: "Nenhum evento recebido nas últimas 2 horas",
      detail: "Pode ser um período tranquilo ou o webhook parou de chegar.",
      hint: "Confira se o endereço do webhook segue configurado no provedor.",
    });
  }
  if ((overdue.count ?? 0) > 0) {
    incidents.push({
      id: "queue_overdue",
      severity: "warning",
      title: `${overdue.count} ação(ões) agendada(s) atrasada(s)`,
      detail: "As ações passaram do horário previsto e ainda não foram executadas.",
      hint: "Reprocessar resolve na maioria dos casos.",
    });
  }
  if ((stuck.count ?? 0) > 0 || (aiStuck.count ?? 0) > 0) {
    incidents.push({
      id: "queue_stuck",
      severity: "warning",
      title: "Itens travados em processamento",
      detail: `${stuck.count ?? 0} envio(s) e ${aiStuck.count ?? 0} análise(s) presos há mais de ${STUCK_MINUTES} minutos.`,
      hint: "Use Reprocessar para devolvê-los à fila.",
    });
  }
  if ((messagesFailed.count ?? 0) > 0) {
    incidents.push({
      id: "messages_failed",
      severity: "warning",
      title: `${messagesFailed.count} mensagem(ns) falharam nas últimas 24h`,
      detail: "Elas não chegaram ao cliente.",
      hint: "Reenvie a partir da lista abaixo.",
    });
  }
  if (guardrails.automation_paused) {
    incidents.push({
      id: "automation_paused",
      severity: "info",
      title: "Automações pausadas",
      detail: "A parada de emergência está ativa: nada é enviado automaticamente.",
      hint: "Desative em Orquestrador quando quiser retomar.",
    });
  }
  if (guardrails.test_mode) {
    incidents.push({
      id: "test_mode",
      severity: "info",
      title: "Modo teste ativo",
      detail: "As mensagens automáticas são simuladas, exceto números da lista de teste.",
      hint: "Desligue em Configurações antes do uso real.",
    });
  }

  return {
    generated_at: new Date().toISOString(),
    connections: connectionRows,
    webhook_last_event_at: webhookLastEvent,
    queues: {
      scheduled_pending: pending.count ?? 0,
      scheduled_overdue: overdue.count ?? 0,
      scheduled_stuck: stuck.count ?? 0,
      ai_pending: aiPending.count ?? 0,
      ai_stuck: aiStuck.count ?? 0,
    },
    failures: {
      messages_failed_24h: messagesFailed.count ?? 0,
      actions_failed_24h: actionsFailed.count ?? 0,
      actions_blocked_24h: actionsBlocked.count ?? 0,
      ai_jobs_failed_24h: jobsFailed.count ?? 0,
    },
    guardrails,
    incidents,
    failed_messages: failedMessages,
    stuck_actions: stuckActions,
    failed_jobs: failedJobs,
  };
}
