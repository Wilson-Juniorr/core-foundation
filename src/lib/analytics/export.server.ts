import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import type { AnalyticsExportDataset, AnalyticsPeriod, StrategyPerformance } from "./types";

type Client = SupabaseClient<Database>;

const MAX_ROWS = 5000;

function toCsv(rows: Record<string, unknown>[], columns: string[]): string {
  const escape = (value: unknown): string => {
    if (value === null || value === undefined) return "";
    const text = typeof value === "object" ? JSON.stringify(value) : String(value);
    return /[",\n;]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  const header = columns.join(";");
  const body = rows.map((row) => columns.map((column) => escape(row[column])).join(";"));
  return [header, ...body].join("\n");
}

/**
 * Exporta apenas colunas de negócio. Nunca inclui tokens, webhooks,
 * payloads brutos, prompts ou conteúdo de credenciais.
 */
export async function exportDataset(
  supabase: Client,
  dataset: AnalyticsExportDataset,
  period: AnalyticsPeriod,
): Promise<{ filename: string; csv: string; rows: number }> {
  const stamp = period.from.slice(0, 10);

  if (dataset === "contatos") {
    const { data, error } = await supabase
      .from("contacts")
      .select("id, name, phone, email, source, is_archived, created_at")
      .gte("created_at", period.from)
      .lt("created_at", period.to)
      .order("created_at", { ascending: false })
      .limit(MAX_ROWS);
    if (error) throw new Error(error.message);
    return {
      filename: `clientes-${stamp}.csv`,
      csv: toCsv(data ?? [], [
        "id",
        "name",
        "phone",
        "email",
        "source",
        "is_archived",
        "created_at",
      ]),
      rows: data?.length ?? 0,
    };
  }

  if (dataset === "oportunidades") {
    const { data, error } = await supabase
      .from("opportunities")
      .select(
        "id, title, status, estimated_value, next_action_at, next_action_description, created_at, updated_at, contacts(name), pipeline_stages(name)",
      )
      .gte("created_at", period.from)
      .lt("created_at", period.to)
      .order("created_at", { ascending: false })
      .limit(MAX_ROWS);
    if (error) throw new Error(error.message);
    const rows = (data ?? []).map((row) => ({
      ...row,
      contact_name: (row.contacts as { name: string } | null)?.name ?? "",
      stage_name: (row.pipeline_stages as { name: string } | null)?.name ?? "",
    }));
    return {
      filename: `oportunidades-${stamp}.csv`,
      csv: toCsv(rows, [
        "id",
        "title",
        "contact_name",
        "stage_name",
        "status",
        "estimated_value",
        "next_action_at",
        "next_action_description",
        "created_at",
        "updated_at",
      ]),
      rows: rows.length,
    };
  }

  if (dataset === "followup_runs") {
    const { data, error } = await supabase
      .from("followup_runs")
      .select(
        "id, status, started_at, paused_at, stopped_at, completed_at, stop_reason, followup_flows(name), contacts(name)",
      )
      .gte("started_at", period.from)
      .lt("started_at", period.to)
      .order("started_at", { ascending: false })
      .limit(MAX_ROWS);
    if (error) throw new Error(error.message);
    const rows = (data ?? []).map((row) => ({
      ...row,
      flow_name: (row.followup_flows as { name: string } | null)?.name ?? "",
      contact_name: (row.contacts as { name: string } | null)?.name ?? "",
    }));
    return {
      filename: `followups-${stamp}.csv`,
      csv: toCsv(rows, [
        "id",
        "flow_name",
        "contact_name",
        "status",
        "started_at",
        "paused_at",
        "stopped_at",
        "completed_at",
        "stop_reason",
      ]),
      rows: rows.length,
    };
  }

  if (dataset === "mensagens") {
    const { data, error } = await supabase
      .from("messages")
      .select(
        "id, direction, message_type, status, sent_at, delivered_at, read_at, conversation_id",
      )
      .gte("sent_at", period.from)
      .lt("sent_at", period.to)
      .order("sent_at", { ascending: false })
      .limit(MAX_ROWS);
    if (error) throw new Error(error.message);
    return {
      filename: `mensagens-${stamp}.csv`,
      csv: toCsv(data ?? [], [
        "id",
        "conversation_id",
        "direction",
        "message_type",
        "status",
        "sent_at",
        "delivered_at",
        "read_at",
      ]),
      rows: data?.length ?? 0,
    };
  }

  const { data, error } = await supabase.rpc("analytics_strategies", {
    _from: period.from,
    _to: period.to,
  });
  if (error) throw new Error(error.message);
  const rows = (data as unknown as StrategyPerformance[]) ?? [];
  return {
    filename: `estrategias-${stamp}.csv`,
    csv: toCsv(rows as unknown as Record<string, unknown>[], [
      "strategy_id",
      "name",
      "strategy_version",
      "current_version",
      "generated",
      "sent",
      "approved",
      "edited",
      "rejected",
      "contacts",
      "won_opportunities",
    ]),
    rows: rows.length,
  };
}
