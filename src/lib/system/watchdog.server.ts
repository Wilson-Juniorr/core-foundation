import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Json } from "@/integrations/supabase/types";
import { writeAudit } from "@/lib/audit/log.server";
import { waLog } from "@/lib/whatsapp/log.server";

type Admin = SupabaseClient<Database>;
type ConnectionRow = Database["public"]["Tables"]["whatsapp_connections"]["Row"];

/** Intervalo mínimo entre dois avisos da mesma queda. */
const ALERT_REPEAT_MINUTES = 30;

export interface WatchdogResult {
  checked: number;
  down: number;
  recovered: number;
  alerts: number;
  requeued: number;
}

interface HealthState {
  down_since?: string | null;
  last_alert_at?: string | null;
  alerts?: number;
  last_reason?: string | null;
}

function readHealth(connection: ConnectionRow): HealthState {
  const metadata = (connection.metadata ?? {}) as Record<string, unknown>;
  const health = metadata["health"];
  return health && typeof health === "object" ? (health as HealthState) : {};
}

async function writeHealth(
  db: Admin,
  connection: ConnectionRow,
  health: HealthState | null,
  patch: Partial<ConnectionRow> = {},
): Promise<void> {
  const metadata = { ...((connection.metadata ?? {}) as Record<string, unknown>) };
  if (health) metadata["health"] = health;
  else delete metadata["health"];

  await db
    .from("whatsapp_connections")
    .update({ ...patch, metadata: metadata as Json })
    .eq("id", connection.id);
}

function connectionLabel(connection: ConnectionRow): string {
  return connection.display_name ?? connection.phone_number ?? "WhatsApp";
}

/**
 * Sonda ativa: pergunta ao provedor se a instância continua conectada.
 * Não confia apenas no webhook — uma instância pode cair sem avisar.
 */
async function probeConnection(
  db: Admin,
  connection: ConnectionRow,
): Promise<{ online: boolean; reason: string | null }> {
  const { loadCredentials } = await import("@/lib/whatsapp/store.server");
  const { getWhatsAppProvider } = await import("@/lib/whatsapp/provider.server");

  let credentials: Awaited<ReturnType<typeof loadCredentials>> = null;
  try {
    credentials = await loadCredentials(db, connection);
  } catch {
    credentials = null;
  }
  if (!credentials) return { online: false, reason: "credenciais_ausentes" };

  try {
    const provider = await getWhatsAppProvider(connection.provider);
    const status = await provider.getSessionStatus(credentials);
    return {
      online: status.status === "connected",
      reason: status.status === "connected" ? null : status.status,
    };
  } catch (error) {
    return {
      online: false,
      reason: error instanceof Error ? error.message.slice(0, 160) : "provedor_inacessivel",
    };
  }
}

/**
 * A Central de Atenção já tem a regra de "WhatsApp desconectado". Depois de
 * gravar o novo estado da conexão, sincronizamos na hora para que o alerta
 * apareça no mesmo minuto da queda — e desapareça sozinho ao reconectar.
 */
async function syncAttentionNow(db: Admin, userId: string): Promise<void> {
  try {
    const { syncAttention } = await import("@/lib/attention/store.server");
    await syncAttention(db, userId);
  } catch (error) {
    waLog.warn("watchdog_attention_sync_failed", {
      reason: error instanceof Error ? error.message : "unknown",
    });
  }
}

/**
 * Nada se perde: ações que foram barradas/falharam por causa da queda voltam
 * para a fila, e as vencidas são reespaçadas dentro da janela permitida.
 */
async function requeueAfterRecovery(db: Admin, userId: string): Promise<number> {
  const { data: stuck } = await db
    .from("scheduled_actions")
    .select("id")
    .eq("user_id", userId)
    .in("status", ["blocked", "failed"])
    .ilike("last_error", "%disconnect%");

  const ids = (stuck ?? []).map((row) => row.id);
  if (ids.length > 0) {
    await db
      .from("scheduled_actions")
      .update({
        status: "scheduled",
        scheduled_for: new Date().toISOString(),
        attempts: 0,
        last_error: null,
      })
      .in("id", ids);
  }

  const { reevaluateAfterReconnect } = await import("@/lib/followup/engine.server");
  const { rescheduled } = await reevaluateAfterReconnect(userId);
  return ids.length + rescheduled;
}

/**
 * Vigia de conexão. Roda a cada ciclo do agendador: detecta queda na hora,
 * avisa o dono e, ao reconectar, devolve à fila tudo que ficou parado.
 */
export async function runConnectionWatchdog(db: Admin): Promise<WatchdogResult> {
  const result: WatchdogResult = { checked: 0, down: 0, recovered: 0, alerts: 0, requeued: 0 };

  const { data: connections } = await db
    .from("whatsapp_connections")
    .select("*")
    .neq("status", "not_configured");

  for (const connection of connections ?? []) {
    result.checked += 1;
    const health = readHealth(connection);
    const probe = await probeConnection(db, connection);
    const nowIso = new Date().toISOString();

    if (probe.online) {
      const wasDown = Boolean(health.down_since);
      await writeHealth(db, connection, null, {
        status: "connected",
        last_connected_at: nowIso,
        last_error: null,
      });

      if (wasDown) {
        result.recovered += 1;
        await syncAttentionNow(db, connection.user_id);
        try {
          result.requeued += await requeueAfterRecovery(db, connection.user_id);
        } catch (error) {
          waLog.error("watchdog_requeue_failed", {
            connection_id: connection.id,
            reason: error instanceof Error ? error.message : "unknown",
          });
        }
        await writeAudit(db, connection.user_id, {
          action: "whatsapp_connected",
          summary: `WhatsApp ${connectionLabel(connection)} voltou. Follow-ups parados foram recolocados na fila.`,
          entityType: "whatsapp_connection",
          entityId: connection.id,
          actor: "system",
          metadata: { down_since: health.down_since ?? null },
        });
        await notifyOwner(db, connection.user_id, {
          kind: "recovered",
          title: `WhatsApp ${connectionLabel(connection)} reconectado`,
          body: "Os follow-ups que ficaram parados voltaram para a fila e saem no horário permitido.",
        });
      }
      continue;
    }

    result.down += 1;
    const downSince = health.down_since ?? nowIso;
    const lastAlert = health.last_alert_at ? new Date(health.last_alert_at).getTime() : 0;
    const shouldAlert = Date.now() - lastAlert >= ALERT_REPEAT_MINUTES * 60_000;

    await writeHealth(
      db,
      connection,
      {
        down_since: downSince,
        last_alert_at: shouldAlert ? nowIso : (health.last_alert_at ?? null),
        alerts: (health.alerts ?? 0) + (shouldAlert ? 1 : 0),
        last_reason: probe.reason,
      },
      {
        status: "disconnected",
        last_error: probe.reason ?? "whatsapp_disconnected",
      },
    );

    await syncAttentionNow(db, connection.user_id);

    if (shouldAlert) {
      result.alerts += 1;
      await writeAudit(db, connection.user_id, {
        action: "whatsapp_disconnected",
        summary: `WhatsApp ${connectionLabel(connection)} está desconectado — nenhum follow-up será enviado até reconectar.`,
        entityType: "whatsapp_connection",
        entityId: connection.id,
        severity: "critical",
        actor: "system",
        metadata: { reason: probe.reason ?? "desconectado", down_since: downSince },
      });
      await notifyOwner(db, connection.user_id, {
        kind: "down",
        title: `WhatsApp ${connectionLabel(connection)} caiu`,
        body: "Nenhum follow-up sai enquanto estiver fora do ar. Reconecte lendo o QR Code em Configurações › WhatsApp.",
      });
      waLog.error("watchdog_connection_down", {
        connection_id: connection.id,
        reason: probe.reason ?? "unknown",
      });
    }
  }

  return result;
}

/**
 * Aviso fora do sistema. Hoje registra a notificação e tenta e-mail quando o
 * domínio de envio estiver configurado; o aviso dentro do app nunca depende
 * deste canal.
 */
async function notifyOwner(
  db: Admin,
  userId: string,
  input: { kind: "down" | "recovered"; title: string; body: string },
): Promise<void> {
  try {
    const { data: settings } = await db
      .from("user_settings")
      .select("notify_failures")
      .eq("user_id", userId)
      .maybeSingle();
    if (settings && settings.notify_failures === false) return;

    const { sendOwnerAlert } = await import("./alerts.server");
    await sendOwnerAlert(db, userId, input);
  } catch (error) {
    waLog.warn("watchdog_notify_failed", {
      reason: error instanceof Error ? error.message : "unknown",
    });
  }
}
