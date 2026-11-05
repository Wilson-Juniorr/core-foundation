/**
 * Avisos no WhatsApp pessoal do consultor.
 *
 * - Cliente esperando resposta há X minutos (padrão 10).
 * - Cliente parado com você há mais de 2 dias úteis sem decisão.
 * - Agente quer voltar e precisa do seu ok.
 *
 * Fora do horário útil (dia útil, 8h–20h), os avisos são juntados num resumo
 * enviado às 8h. A fila fica no banco: uma falha nunca perde o aviso.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import { DEFAULT_TIMEZONE } from "@/lib/followup/time";
import { addBusinessDays } from "./business-calendar";
import { alertSendAfter, customerWaitingTooLong, HANDOFF_KIND_LABELS, type HandoffKind } from "./handoff";

type Admin = SupabaseClient<Database>;

const APP_URL = "https://engage-flow-89.lovable.app";
const MAX_ATTEMPTS = 3;

function clientLink(contactId: string | null): string {
  return contactId ? `${APP_URL}/clientes/${contactId}` : `${APP_URL}/conversas`;
}

export async function queueOwnerAlert(
  db: Admin,
  input: {
    userId: string;
    kind: "waiting" | "stuck" | "approval";
    conversationId: string | null;
    contactId: string | null;
    title: string;
    body: string;
    dedupeKey: string;
    now?: Date;
  },
): Promise<void> {
  const now = input.now ?? new Date();
  const { error } = await db.from("owner_alerts").insert({
    user_id: input.userId,
    kind: input.kind,
    conversation_id: input.conversationId,
    contact_id: input.contactId,
    title: input.title,
    body: input.body,
    dedupe_key: input.dedupeKey,
    send_after: alertSendAfter(now, DEFAULT_TIMEZONE).toISOString(),
  });
  if (error && error.code !== "23505") throw new Error(error.message);
}

async function contactNames(db: Admin, ids: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (ids.length === 0) return map;
  const { data } = await db.from("contacts").select("id, name").in("id", ids);
  for (const row of data ?? []) map.set(row.id, row.name);
  return map;
}

/* ------------------------------ cliente esperando ------------------------- */

export async function queueWaitingAlerts(db: Admin, now = new Date()): Promise<number> {
  const since = new Date(now.getTime() - 24 * 3_600_000).toISOString();
  const { data: rows } = await db
    .from("conversation_control")
    .select(
      "conversation_id, user_id, owner, last_inbound_at, last_human_message_at, last_automation_at, last_alerted_inbound_at",
    )
    .gte("last_inbound_at", since)
    .lte("last_inbound_at", new Date(now.getTime() - 5 * 60_000).toISOString())
    .limit(300);

  const candidates = (rows ?? []).filter(
    (row) =>
      !row.last_alerted_inbound_at ||
      (row.last_inbound_at && row.last_alerted_inbound_at < row.last_inbound_at),
  );
  if (candidates.length === 0) return 0;

  const userIds = [...new Set(candidates.map((row) => row.user_id))];
  const { data: settings } = await db
    .from("user_settings")
    .select("user_id, alert_phone, alert_waiting_minutes")
    .in("user_id", userIds);
  const settingsByUser = new Map((settings ?? []).map((row) => [row.user_id, row]));

  let queued = 0;
  for (const row of candidates) {
    const threshold = settingsByUser.get(row.user_id)?.alert_waiting_minutes ?? 10;
    const lastOutbound = [row.last_human_message_at, row.last_automation_at]
      .filter(Boolean)
      .sort()
      .pop();

    // Confirma pela própria conversa: qualquer resposta depois do cliente conta.
    const { data: outbound } = await db
      .from("messages")
      .select("sent_at")
      .eq("conversation_id", row.conversation_id)
      .eq("direction", "outbound")
      .order("sent_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const latestOutbound = [lastOutbound, outbound?.sent_at].filter(Boolean).sort().pop() ?? null;

    const waiting = customerWaitingTooLong({
      now,
      lastInboundAt: row.last_inbound_at ? new Date(row.last_inbound_at) : null,
      lastOutboundAt: latestOutbound ? new Date(latestOutbound) : null,
      lastAlertedInboundAt: row.last_alerted_inbound_at ? new Date(row.last_alerted_inbound_at) : null,
      thresholdMinutes: threshold,
    });
    if (!waiting) continue;

    // Só clientes que importam: com oportunidade aberta ou acompanhamento.
    const { data: conversation } = await db
      .from("conversations")
      .select("contact_id")
      .eq("id", row.conversation_id)
      .maybeSingle();
    const contactId = conversation?.contact_id ?? null;

    let relevant = false;
    if (contactId) {
      const [{ data: opp }, { data: run }] = await Promise.all([
        db
          .from("opportunities")
          .select("id")
          .eq("contact_id", contactId)
          .eq("status", "open")
          .limit(1),
        db
          .from("followup_runs")
          .select("id")
          .eq("conversation_id", row.conversation_id)
          .in("status", ["active", "paused"])
          .limit(1),
      ]);
      relevant = (opp ?? []).length > 0 || (run ?? []).length > 0;
    }

    // Marca mesmo quando não alerta: evita rajada de avisos antigos depois.
    await db
      .from("conversation_control")
      .update({ last_alerted_inbound_at: row.last_inbound_at })
      .eq("conversation_id", row.conversation_id);

    if (!relevant || !settingsByUser.get(row.user_id)?.alert_phone) continue;

    const { data: lastMessage } = await db
      .from("messages")
      .select("text_content, message_type")
      .eq("conversation_id", row.conversation_id)
      .eq("direction", "inbound")
      .order("sent_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const names = await contactNames(db, contactId ? [contactId] : []);
    const name = (contactId && names.get(contactId)) || "Cliente";
    const said =
      lastMessage?.text_content?.trim().slice(0, 160) ||
      (lastMessage?.message_type === "audio" ? "(mandou um áudio)" : "(mandou uma mensagem)");
    const minutes = Math.round(
      (now.getTime() - new Date(row.last_inbound_at as string).getTime()) / 60_000,
    );

    await queueOwnerAlert(db, {
      userId: row.user_id,
      kind: "waiting",
      conversationId: row.conversation_id,
      contactId,
      title: `${name} está esperando você há ${minutes} min`,
      body: `⏰ *${name}* está esperando sua resposta há ${minutes} min.\n\n"${said}"\n\n${clientLink(contactId)}`,
      dedupeKey: `waiting:${row.conversation_id}:${row.last_inbound_at}`,
      now,
    });
    queued += 1;
  }
  return queued;
}

/* ------------------------------ cliente esquecido ------------------------- */

export async function queueStuckAlerts(db: Admin, now = new Date()): Promise<number> {
  const { data: rows } = await db
    .from("conversation_control")
    .select(
      "conversation_id, user_id, handoff_at, handoff_kind, handoff_reason, return_mode, return_at, last_human_message_at, last_inbound_at, last_stuck_alert_at",
    )
    .eq("owner", "human")
    .not("handoff_at", "is", null)
    .lte("handoff_at", new Date(now.getTime() - 2 * 86_400_000).toISOString())
    .limit(200);

  let queued = 0;
  for (const row of rows ?? []) {
    if (row.last_stuck_alert_at && row.handoff_at && row.last_stuck_alert_at >= row.handoff_at) {
      continue;
    }
    // Volta já agendada: não está esquecido.
    if ((row.return_mode === "auto" || row.return_mode === "confirm") && row.return_at) continue;

    const lastActivity = [row.handoff_at, row.last_human_message_at, row.last_inbound_at]
      .filter(Boolean)
      .sort()
      .pop() as string;
    if (addBusinessDays(new Date(lastActivity), 2) > now) continue;

    // Só conversas com acompanhamento inteligente que o agente poderia retomar.
    const { data: smartRun } = await db
      .from("followup_runs")
      .select("id, followup_flows!inner(kind)")
      .eq("conversation_id", row.conversation_id)
      .in("status", ["active", "paused"])
      .in("smart_state", ["human_active", "needs_human", "closing"])
      .eq("followup_flows.kind", "smart")
      .limit(1);
    if ((smartRun ?? []).length === 0) continue;

    const { data: conversation } = await db
      .from("conversations")
      .select("contact_id")
      .eq("id", row.conversation_id)
      .maybeSingle();
    const contactId = conversation?.contact_id ?? null;
    const names = await contactNames(db, contactId ? [contactId] : []);
    const name = (contactId && names.get(contactId)) || "Cliente";
    const reason =
      row.handoff_reason ??
      HANDOFF_KIND_LABELS[(row.handoff_kind ?? "manual") as HandoffKind] ??
      "Com você";

    await db
      .from("conversation_control")
      .update({ last_stuck_alert_at: now.toISOString() })
      .eq("conversation_id", row.conversation_id);

    await queueOwnerAlert(db, {
      userId: row.user_id,
      kind: "stuck",
      conversationId: row.conversation_id,
      contactId,
      title: `${name} está parado com você`,
      body: `📌 *${name}* está parado com você há mais de 2 dias úteis.\nMotivo: ${reason}\n\nResponda o cliente ou devolva ao agente:\n${clientLink(contactId)}`,
      dedupeKey: `stuck:${row.conversation_id}:${row.handoff_at}`,
      now,
    });
    queued += 1;
  }
  return queued;
}

/* --------------------------------- envio ---------------------------------- */

export async function dispatchOwnerAlerts(
  db: Admin,
  now = new Date(),
): Promise<{ sent: number; failed: number }> {
  const { data: pending } = await db
    .from("owner_alerts")
    .select("*")
    .eq("status", "pending")
    .lte("send_after", now.toISOString())
    .order("created_at", { ascending: true })
    .limit(100);
  if (!pending || pending.length === 0) return { sent: 0, failed: 0 };

  const byUser = new Map<string, typeof pending>();
  for (const alert of pending) {
    const list = byUser.get(alert.user_id) ?? [];
    list.push(alert);
    byUser.set(alert.user_id, list);
  }

  const { sendOwnerNotice } = await import("@/lib/whatsapp/service.server");
  let sent = 0;
  let failed = 0;

  for (const [userId, alerts] of byUser) {
    const { data: settings } = await db
      .from("user_settings")
      .select("alert_phone")
      .eq("user_id", userId)
      .maybeSingle();
    const ids = alerts.map((alert) => alert.id);

    if (!settings?.alert_phone) {
      await db
        .from("owner_alerts")
        .update({ status: "skipped", last_error: "Sem número pessoal cadastrado." })
        .in("id", ids);
      continue;
    }

    const text =
      alerts.length === 1
        ? alerts[0]!.body
        : [
            `📋 *Resumo: ${alerts.length} clientes precisam de você*`,
            "",
            ...alerts.map(
              (alert) => `• ${alert.title}\n  ${clientLink(alert.contact_id)}`,
            ),
          ].join("\n");

    try {
      await sendOwnerNotice(userId, { phoneNumber: settings.alert_phone, text });
      await db
        .from("owner_alerts")
        .update({ status: "sent", sent_at: new Date().toISOString() })
        .in("id", ids);
      sent += alerts.length;
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 300) : "falha no envio";
      // WhatsApp fora do ar não gasta tentativa: o aviso sai quando reconectar.
      const disconnected = /desconectad/i.test(message);
      for (const alert of alerts) {
        const attempts = disconnected ? alert.attempts : alert.attempts + 1;
        await db
          .from("owner_alerts")
          .update({
            attempts,
            last_error: message,
            status: attempts >= MAX_ATTEMPTS ? "failed" : "pending",
            send_after: new Date(now.getTime() + 2 * 60_000).toISOString(),
          })
          .eq("id", alert.id);
      }
      failed += alerts.length;
    }
  }

  return { sent, failed };
}
