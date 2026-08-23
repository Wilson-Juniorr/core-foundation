export type AnalyticsRange = "today" | "7d" | "30d" | "custom";

export interface AnalyticsPeriod {
  from: string;
  to: string;
}

export interface AnalyticsOverview {
  new_contacts: number;
  new_opportunities: number;
  opportunities_open: number;
  opportunities_won: number;
  opportunities_lost: number;
  opportunities_without_next_action: number;
  opportunities_overdue: number;
  followups_started: number;
  followups_sent: number;
  followups_with_reply: number;
  reply_rate: number | null;
  avg_reply_seconds: number | null;
  recovered_contacts: number;
  messages_automatic: number;
  messages_manual: number;
  messages_failed: number;
  actions_failed: number;
  human_interventions: number;
  opt_out_contacts: number;
  opt_outs_in_period: number;
  conversion_with_followup: ConversionSlice;
  conversion_without_followup: ConversionSlice;
}

export interface ConversionSlice {
  total: number;
  won: number;
  rate: number | null;
}

export interface FunnelStage {
  stage_id: string;
  name: string;
  position: number;
  open_count: number;
  won_count: number;
  lost_count: number;
  entered_in_period: number;
  avg_seconds_in_stage: number | null;
}

export interface FlowPerformance {
  flow_id: string;
  name: string;
  is_active: boolean;
  started: number;
  replied: number;
  reply_rate: number | null;
  completed: number;
  interrupted: number;
  failed: number;
  avg_reply_seconds: number | null;
  last_reply_step_position: number | null;
  won_opportunities: number;
}

export interface StrategyPerformance {
  strategy_id: string;
  strategy_version: number | null;
  name: string | null;
  current_version: number | null;
  generated: number;
  sent: number;
  approved: number;
  edited: number;
  rejected: number;
  contacts: number;
  won_opportunities: number;
}

export interface HealthConnection {
  id: string;
  status: string;
  phone_number: string | null;
  display_name: string | null;
  last_event_at: string | null;
  last_synced_at: string | null;
  last_sync_status: string | null;
}

export interface OperationalHealth {
  connections: HealthConnection[];
  webhook_last_event_at: string | null;
  actions_pending: number;
  actions_overdue: number;
  actions_failed_24h: number;
  actions_blocked_24h: number;
  messages_failed_24h: number;
  messages_failed_prev_24h: number;
  messages_sent_24h: number;
  ai_jobs_pending: number;
  ai_jobs_failed_24h: number;
  ai_calls_failed_24h: number;
  ai_cost_30d: number;
  attention_open: number;
  automation_paused: boolean;
  test_mode: boolean;
}

export type AnalyticsAlertLevel = "critical" | "warning" | "info";

export interface AnalyticsAlert {
  id: string;
  level: AnalyticsAlertLevel;
  title: string;
  detail: string;
}

export interface AnalyticsReport {
  period: AnalyticsPeriod;
  overview: AnalyticsOverview;
  funnel: FunnelStage[];
  flows: FlowPerformance[];
  strategies: StrategyPerformance[];
  health: OperationalHealth;
  alerts: AnalyticsAlert[];
}

export type AnalyticsExportDataset =
  "contatos" | "oportunidades" | "followup_runs" | "mensagens" | "estrategias";

export const EXPORT_LABELS: Record<AnalyticsExportDataset, string> = {
  contatos: "Clientes",
  oportunidades: "Oportunidades",
  followup_runs: "Execuções de follow-up",
  mensagens: "Mensagens (metadados)",
  estrategias: "Desempenho por estratégia",
};
