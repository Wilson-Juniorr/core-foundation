import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Json } from "@/integrations/supabase/types";
import type { AuditAction, AuditSeverity } from "./types";

type Client = SupabaseClient<Database>;

export interface AuditInput {
  action: AuditAction;
  summary: string;
  severity?: AuditSeverity;
  entityType?: string | null;
  entityId?: string | null;
  /** "user" para ações no app, "system" para o motor/cron. */
  actor?: "user" | "system";
  metadata?: Record<string, unknown>;
}

/**
 * Registra uma ação crítica. A auditoria nunca derruba a operação principal:
 * uma falha ao gravar é logada, não propagada.
 */
export async function writeAudit(db: Client, userId: string, input: AuditInput): Promise<void> {
  const { error } = await db.from("audit_logs").insert({
    user_id: userId,
    action: input.action,
    severity: input.severity ?? "info",
    entity_type: input.entityType ?? null,
    entity_id: input.entityId ?? null,
    summary: input.summary.slice(0, 400),
    actor: input.actor ?? "user",
    metadata: JSON.parse(JSON.stringify(input.metadata ?? {})) as Json,
  });
  if (error) console.error("audit_log_insert_failed", error.message);
}
