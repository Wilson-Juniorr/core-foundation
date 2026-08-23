import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import type {
  AnalyticsAlert,
  AnalyticsOverview,
  AnalyticsPeriod,
  AnalyticsReport,
  FlowPerformance,
  FunnelStage,
  OperationalHealth,
  StrategyPerformance,
} from "./types";

type Client = SupabaseClient<Database>;

async function rpcJson<T>(
  supabase: Client,
  fn: "analytics_overview" | "analytics_funnel" | "analytics_flows" | "analytics_strategies",
  period: AnalyticsPeriod,
): Promise<T> {
  const { data, error } = await supabase.rpc(fn, { _from: period.from, _to: period.to });
  if (error) throw new Error(`Falha ao carregar métricas (${fn}): ${error.message}`);
  return data as T;
}

export async function getHealth(supabase: Client): Promise<OperationalHealth> {
  const { data, error } = await supabase.rpc("analytics_health");
  if (error) throw new Error(`Falha ao carregar saúde operacional: ${error.message}`);
  return data as unknown as OperationalHealth;
}

function buildAlerts(
  overview: AnalyticsOverview,
  health: OperationalHealth,
  flows: FlowPerformance[],
): AnalyticsAlert[] {
  const alerts: AnalyticsAlert[] = [];

  if (health.automation_paused) {
    alerts.push({
      id: "automation_paused",
      level: "critical",
      title: "Automação está pausada",
      detail: "Nenhum follow-up automático será enviado até você reativar no Orquestrador.",
    });
  }

  const disconnected = health.connections.filter((c) => c.status !== "connected");
  if (disconnected.length > 0) {
    alerts.push({
      id: "whatsapp_disconnected",
      level: "critical",
      title: `${disconnected.length} conexão(ões) de WhatsApp fora do ar`,
      detail: "Mensagens automáticas e recebimento de respostas ficam interrompidos.",
    });
  }

  if (health.actions_overdue >= 5) {
    alerts.push({
      id: "actions_overdue",
      level: "critical",
      title: `${health.actions_overdue} ações estão atrasadas`,
      detail: "A fila de envios não está sendo processada no horário previsto.",
    });
  }

  if (
    health.messages_failed_24h >= 3 &&
    health.messages_failed_24h > health.messages_failed_prev_24h
  ) {
    alerts.push({
      id: "failure_rate_up",
      level: "warning",
      title: "Taxa de falha de mensagens aumentou",
      detail: `${health.messages_failed_24h} falhas nas últimas 24h contra ${health.messages_failed_prev_24h} no dia anterior.`,
    });
  }

  if (health.ai_jobs_failed_24h >= 3 || health.ai_calls_failed_24h >= 5) {
    alerts.push({
      id: "ai_failures",
      level: "warning",
      title: "Falhas de IA nas últimas 24h",
      detail: `${health.ai_jobs_failed_24h} análises e ${health.ai_calls_failed_24h} chamadas falharam.`,
    });
  }

  if (overview.opportunities_without_next_action >= 3) {
    alerts.push({
      id: "no_next_action",
      level: "warning",
      title: `${overview.opportunities_without_next_action} oportunidades sem próximo passo`,
      detail: "Sem próxima ação definida, essas oportunidades tendem a ser esquecidas.",
    });
  }

  if (overview.opportunities_overdue >= 1) {
    alerts.push({
      id: "overdue_actions",
      level: "warning",
      title: `${overview.opportunities_overdue} próximas ações vencidas`,
      detail: "Elas já passaram da data combinada com o cliente.",
    });
  }

  const weakFlow = flows.find((flow) => flow.started >= 10 && (flow.reply_rate ?? 100) < 10);
  if (weakFlow) {
    alerts.push({
      id: `flow_low_reply_${weakFlow.flow_id}`,
      level: "info",
      title: `Fluxo "${weakFlow.name}" com pouca resposta`,
      detail: `${weakFlow.replied} respostas em ${weakFlow.started} execuções. Vale revisar a abordagem.`,
    });
  }

  if (overview.opt_outs_in_period >= 3) {
    alerts.push({
      id: "opt_out_spike",
      level: "warning",
      title: `${overview.opt_outs_in_period} clientes pediram para não receber mais mensagens`,
      detail: "Volume ou tom das mensagens pode estar incomodando.",
    });
  }

  if (health.test_mode) {
    alerts.push({
      id: "test_mode",
      level: "info",
      title: "Modo teste ativo",
      detail: "As automações estão sendo simuladas e nada é enviado ao cliente.",
    });
  }

  return alerts;
}

export async function getAnalyticsReport(
  supabase: Client,
  period: AnalyticsPeriod,
): Promise<AnalyticsReport> {
  const [overview, funnel, flows, strategies, health] = await Promise.all([
    rpcJson<AnalyticsOverview>(supabase, "analytics_overview", period),
    rpcJson<FunnelStage[]>(supabase, "analytics_funnel", period),
    rpcJson<FlowPerformance[]>(supabase, "analytics_flows", period),
    rpcJson<StrategyPerformance[]>(supabase, "analytics_strategies", period),
    getHealth(supabase),
  ]);

  return {
    period,
    overview,
    funnel,
    flows,
    strategies,
    health,
    alerts: buildAlerts(overview, health, flows),
  };
}
