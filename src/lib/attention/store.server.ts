import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import { logEvent } from "@/lib/crm.server";
import { detectAttention } from "./rules.server";
import type {
  AttentionCandidate,
  AttentionCounts,
  AttentionItem,
  AttentionStatus,
  AttentionView,
  OperationalDashboard,
  ScoreFactor,
} from "./types";

type Client = SupabaseClient<Database>;
type Row = Database["public"]["Tables"]["attention_items"]["Row"] & {
  contacts?: { name: string } | null;
};

const SELECT = "*, contacts(name)";

/** Situações que exigem intervenção humana antes de qualquer automação seguir. */
const HANDOFF_KINDS = new Set([
  "discount_requested",
  "call_requested",
  "objection_needs_human",
  "ready_to_close",
]);

export function mapItem(row: Row): AttentionItem {
  return {
    id: row.id,
    kind: row.kind,
    priority: row.priority,
    priority_score: row.priority_score,
    score_factors: (Array.isArray(row.score_factors)
      ? row.score_factors
      : []) as unknown as ScoreFactor[],
    bucket: row.bucket,
    status: row.status,
    title: row.title,
    summary: row.summary,
    reason: row.reason,
    suggested_action: row.suggested_action,
    suggested_action_kind: row.suggested_action_kind,
    suggested_action_source: row.suggested_action_source,
    contact_id: row.contact_id,
    contact_name: row.contacts?.name ?? null,
    opportunity_id: row.opportunity_id,
    conversation_id: row.conversation_id,
    blocks_automation: row.blocks_automation,
    occurrences: row.occurrences,
    snoozed_until: row.snoozed_until,
    resolved_at: row.resolved_at,
    resolution_note: row.resolution_note,
    first_detected_at: row.first_detected_at,
    last_detected_at: row.last_detected_at,
    metadata: (row.metadata ?? {}) as AttentionItem["metadata"],
  };
}

async function admin(): Promise<Client> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as unknown as Client;
}

/**
 * Sincroniza a Central de Atenção: detecta, deduplica pela `dedupe_key`,
 * reativa snoozes vencidos, fecha o que já não se aplica e — quando a política
 * do usuário permitir — pausa automações conflitantes.
 */
export async function syncAttention(
  db: Client,
  userId: string,
): Promise<{ created: number; updated: number; autoResolved: number; pausedRuns: number }> {
  const now = new Date();
  const candidates = await detectAttention(db, userId, now);

  const { data: existingRows } = await db
    .from("attention_items")
    .select("*")
    .eq("user_id", userId)
    .in("status", ["open", "snoozed", "resolved", "dismissed"]);

  const existing = new Map((existingRows ?? []).map((row) => [row.dedupe_key, row]));

  // Snoozes vencidos voltam para a fila sem perder histórico.
  const expired = (existingRows ?? []).filter(
    (row) => row.status === "snoozed" && row.snoozed_until && new Date(row.snoozed_until) <= now,
  );
  if (expired.length > 0) {
    await db
      .from("attention_items")
      .update({ status: "open", snoozed_until: null })
      .in(
        "id",
        expired.map((row) => row.id),
      );
  }

  let created = 0;
  let updated = 0;
  let pausedRuns = 0;
  const detectedKeys = new Set<string>();

  for (const candidate of candidates) {
    detectedKeys.add(candidate.dedupe_key);
    const current = existing.get(candidate.dedupe_key);
    const blocks = candidate.blocks_automation || HANDOFF_KINDS.has(candidate.kind);

    if (!current) {
      const { data: inserted, error } = await db
        .from("attention_items")
        .insert({
          user_id: userId,
          contact_id: candidate.contact_id,
          opportunity_id: candidate.opportunity_id,
          conversation_id: candidate.conversation_id,
          kind: candidate.kind,
          priority: candidate.priority,
          priority_score: candidate.priority_score,
          score_factors: candidate.score_factors as unknown as Row["score_factors"],
          bucket: candidate.bucket,
          title: candidate.title,
          summary: candidate.summary,
          reason: candidate.reason,
          suggested_action: candidate.suggested_action,
          suggested_action_kind: candidate.suggested_action_kind,
          suggested_action_source: "rule",
          dedupe_key: candidate.dedupe_key,
          blocks_automation: blocks,
          first_detected_at: now.toISOString(),
          last_detected_at: now.toISOString(),
          metadata: candidate.metadata as unknown as Row["metadata"],
        })
        .select("id, contact_id")
        .maybeSingle();

      if (error) {
        console.error("attention_insert_failed", error.message);
        continue;
      }
      created += 1;

      if (blocks && inserted?.contact_id) {
        pausedRuns += await pauseConflictingAutomation(
          db,
          userId,
          inserted.contact_id,
          inserted.id,
          candidate.title,
        );
      }
      continue;
    }

    // Deduplicação: o mesmo problema atualiza o item existente.
    if (current.status === "resolved" || current.status === "dismissed") continue;

    const patch: Database["public"]["Tables"]["attention_items"]["Update"] = {
      priority: candidate.priority,
      priority_score: candidate.priority_score,
      score_factors: candidate.score_factors as unknown as Row["score_factors"],
      bucket: candidate.bucket,
      reason: candidate.reason,
      summary: candidate.summary,
      last_detected_at: now.toISOString(),
      occurrences: current.occurrences + 1,
      blocks_automation: blocks,
    };
    if (current.suggested_action_source !== "ai") {
      patch.suggested_action = candidate.suggested_action;
      patch.suggested_action_kind = candidate.suggested_action_kind;
    }
    const { error } = await db.from("attention_items").update(patch).eq("id", current.id);
    if (error) console.error("attention_update_failed", error.message);
    else updated += 1;

    // Handoff continua valendo enquanto o item está aberto: automações iniciadas
    // depois da detecção também devem ser pausadas.
    if (blocks && current.status === "open" && current.contact_id) {
      pausedRuns += await pauseConflictingAutomation(
        db,
        userId,
        current.contact_id,
        current.id,
        candidate.title,
      );
    }
  }

  // O que não foi detectado agora deixou de existir: fecha automaticamente.
  const stale = (existingRows ?? []).filter(
    (row) => row.status === "open" && !detectedKeys.has(row.dedupe_key),
  );
  if (stale.length > 0) {
    await db
      .from("attention_items")
      .update({
        status: "resolved",
        resolved_at: now.toISOString(),
        resolution_note: "Resolvido automaticamente: a situação não ocorre mais.",
      })
      .in(
        "id",
        stale.map((row) => row.id),
      );
  }

  return { created, updated, autoResolved: stale.length, pausedRuns };
}

/**
 * Handoff: enquanto o humano não resolver, os follow-ups genéricos daquele
 * cliente ficam pausados (se a política do usuário estiver ativa).
 */
async function pauseConflictingAutomation(
  db: Client,
  userId: string,
  contactId: string,
  itemId: string,
  itemTitle: string,
): Promise<number> {
  const { data: settings } = await db
    .from("user_settings")
    .select("pause_automation_on_handoff")
    .eq("user_id", userId)
    .maybeSingle();
  if (settings && settings.pause_automation_on_handoff === false) return 0;

  const { data: runs } = await db
    .from("followup_runs")
    .select("id")
    .eq("user_id", userId)
    .eq("contact_id", contactId)
    .eq("status", "active");
  if (!runs || runs.length === 0) return 0;

  const { pauseRun } = await import("@/lib/followup/engine.server");
  const paused: string[] = [];
  for (const run of runs) {
    try {
      await pauseRun(userId, run.id);
      paused.push(run.id);
    } catch (error) {
      console.error("attention_pause_failed", error);
    }
  }

  if (paused.length > 0) {
    const { data: currentItem } = await db
      .from("attention_items")
      .select("metadata")
      .eq("id", itemId)
      .maybeSingle();
    const currentMeta = (currentItem?.metadata ?? {}) as Record<string, unknown>;
    const previous = Array.isArray(currentMeta["paused_run_ids"])
      ? (currentMeta["paused_run_ids"] as string[])
      : [];

    await db
      .from("attention_items")
      .update({
        metadata: {
          ...currentMeta,
          paused_run_ids: Array.from(new Set([...previous, ...paused])),
        } as unknown as Row["metadata"],
      })
      .eq("id", itemId);

    await logEvent(db, userId, {
      event_type: "attention_handoff_paused",
      contact_id: contactId,
      metadata: { attention_item_id: itemId, title: itemTitle, paused_run_ids: paused },
    });
  }

  return paused.length;
}

/* ------------------------------- leitura ------------------------------- */

export async function listAttention(
  db: Client,
  filter: { status?: AttentionStatus | null; bucket?: string | null; contactId?: string | null },
): Promise<AttentionView> {
  let query = db
    .from("attention_items")
    .select(SELECT)
    .order("priority_score", { ascending: false })
    .order("last_detected_at", { ascending: false })
    .limit(200);

  query = filter.status
    ? query.eq("status", filter.status)
    : query.in("status", ["open", "snoozed"]);
  if (filter.bucket) query = query.eq("bucket", filter.bucket);
  if (filter.contactId) query = query.eq("contact_id", filter.contactId);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const items = (data ?? []).map((row) => mapItem(row as Row));

  const counts: AttentionCounts = {
    now: 0,
    today: 0,
    overdue: 0,
    automatic: 0,
    waiting: 0,
    snoozed: 0,
    critical: 0,
  };
  const { data: openRows } = await db
    .from("attention_items")
    .select("bucket, status, priority")
    .in("status", ["open", "snoozed"]);
  for (const row of openRows ?? []) {
    if (row.status === "snoozed") {
      counts.snoozed += 1;
      continue;
    }
    if (row.bucket in counts) counts[row.bucket as keyof AttentionCounts] += 1;
    if (row.priority === "critical") counts.critical += 1;
  }

  const { count: scheduled } = await db
    .from("scheduled_actions")
    .select("id", { count: "exact", head: true })
    .eq("status", "scheduled");
  counts.automatic = scheduled ?? 0;

  return { items, counts, syncedAt: new Date().toISOString() };
}

export async function operationalDashboard(
  db: Client,
  userId: string,
): Promise<OperationalDashboard> {
  const now = new Date();
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

  const [runs, itemRows, scheduled, opportunities, replies, failures, critical] = await Promise.all(
    [
      db.from("followup_runs").select("id", { count: "exact", head: true }).eq("status", "active"),
      db.from("attention_items").select("bucket, kind, status").eq("status", "open"),
      db
        .from("scheduled_actions")
        .select("id", { count: "exact", head: true })
        .eq("status", "scheduled"),
      db.from("opportunities").select("id, next_action_at").eq("status", "open"),
      db
        .from("messages")
        .select("id", { count: "exact", head: true })
        .eq("direction", "inbound")
        .gte("sent_at", since),
      db
        .from("scheduled_actions")
        .select("id", { count: "exact", head: true })
        .eq("status", "failed"),
      db
        .from("attention_items")
        .select(SELECT)
        .eq("status", "open")
        .eq("priority", "critical")
        .order("priority_score", { ascending: false })
        .limit(5),
    ],
  );

  const open = opportunities.data ?? [];
  const items = itemRows.data ?? [];

  return {
    followingUp: runs.count ?? 0,
    waitingOnYou: items.filter((item) => item.bucket === "now" || item.bucket === "today").length,
    scheduledAutomations: scheduled.count ?? 0,
    overdue: items.filter((item) => item.bucket === "overdue").length,
    withoutNextAction: open.filter((item) => item.next_action_at === null).length,
    recentReplies: replies.count ?? 0,
    failures: failures.count ?? 0,
    criticalItems: (critical.data ?? []).map((row) => mapItem(row as Row)),
  };
}

/* ------------------------------ resolução ------------------------------ */

async function loadItem(db: Client, itemId: string): Promise<Row> {
  const { data, error } = await db
    .from("attention_items")
    .select(SELECT)
    .eq("id", itemId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Item de atenção não encontrado.");
  return data as Row;
}

export async function snoozeItem(
  db: Client,
  userId: string,
  input: { itemId: string; until: string },
): Promise<AttentionItem> {
  const item = await loadItem(db, input.itemId);
  const { data, error } = await db
    .from("attention_items")
    .update({ status: "snoozed", snoozed_until: input.until })
    .eq("id", input.itemId)
    .select(SELECT)
    .maybeSingle();
  if (error) throw new Error(error.message);

  await logEvent(db, userId, {
    event_type: "attention_snoozed",
    contact_id: item.contact_id,
    opportunity_id: item.opportunity_id,
    metadata: { attention_item_id: item.id, title: item.title, until: input.until },
  });

  return mapItem(data as Row);
}

export async function closeItem(
  db: Client,
  userId: string,
  input: { itemId: string; status: "resolved" | "dismissed"; note?: string | null },
): Promise<AttentionItem> {
  const item = await loadItem(db, input.itemId);
  const { data, error } = await db
    .from("attention_items")
    .update({
      status: input.status,
      resolved_at: new Date().toISOString(),
      resolution_note: input.note ?? null,
      snoozed_until: null,
    })
    .eq("id", input.itemId)
    .select(SELECT)
    .maybeSingle();
  if (error) throw new Error(error.message);

  await logEvent(db, userId, {
    event_type: input.status === "resolved" ? "attention_resolved" : "attention_dismissed",
    contact_id: item.contact_id,
    opportunity_id: item.opportunity_id,
    metadata: { attention_item_id: item.id, title: item.title, note: input.note ?? null },
  });

  // Handoff concluído: as automações pausadas por este item voltam a rodar.
  const pausedRuns = (item.metadata as { paused_run_ids?: string[] } | null)?.paused_run_ids ?? [];
  if (item.blocks_automation && pausedRuns.length > 0) {
    const { resumeRun } = await import("@/lib/followup/engine.server");
    for (const runId of pausedRuns) {
      try {
        await resumeRun(userId, runId);
      } catch (error) {
        console.error("attention_resume_failed", error);
      }
    }
  }

  return mapItem(data as Row);
}

/** Execução do tick: sincroniza a Central para todos os usuários ativos. */
export async function syncAllUsers(limit = 50): Promise<{ users: number }> {
  const db = await admin();
  const { data } = await db.from("profiles").select("id").limit(limit);
  let users = 0;
  for (const profile of data ?? []) {
    try {
      await syncAttention(db, profile.id);
      users += 1;
    } catch (error) {
      console.error("attention_sync_failed", profile.id, error);
    }
  }
  return { users };
}
