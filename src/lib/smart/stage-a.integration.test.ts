import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { testDatabase } from "./stage-a-db.fixture";
import { startSmartFlow, evaluateSmartRun, smartPreSendCheck } from "./engine.server";
import { executeClaimedAction } from "../followup/engine.server";
import { loadControl, patchControl, registerCustomerMessage } from "./control.server";
import { nextSilenceContact, POST_QUOTE_FLOW_NAME } from "./post-quote-cadence";
import { applyReturn } from "./return.server";
import { loadMessages } from "../ai/analysis.server";
import { reconcileSmartSends } from "./send-reconciliation.server";
import { approveSmartAction } from "./approvals.server";
import {
  activatePostQuote,
  controlPostQuote,
  recordPostQuoteAccepted,
} from "./post-quote-runtime.server";
import { WhatsAppDispatchCancelled } from "../whatsapp/dispatch";
import { extractCommitments } from "./rules";
const fake = vi.hoisted(() => ({ send: vi.fn(), decision: vi.fn(), policy: "allowed" }));
vi.mock("@/lib/audit/log.server", () => ({ writeAudit: vi.fn() }));
vi.mock("@/lib/crm.server", () => ({ logEvent: vi.fn() }));
vi.mock("./decision.server", () => ({ decideNextStep: fake.decision }));
vi.mock("./learning.server", () => ({
  strategyPerformance: async () => [],
  describePerformance: () => "",
  rankStrategies: () => [],
}));
vi.mock("./timing.server", () => ({
  learnContactTiming: async () => ({ preferredHour: null }),
  alignToPreferredHour: ({ target }: { target: Date }) => target,
}));
vi.mock("./return.server", async (original) => ({
  ...(await original<typeof import("./return.server")>()),
  consultantNotes: async () => [],
  markHandoff: vi.fn(),
}));
vi.mock("./quality.server", () => ({ reviewMessage: () => ({ verdict: "accept" }) }));
vi.mock("@/lib/whatsapp/store.server", async (original) => ({
  ...(await original<typeof import("@/lib/whatsapp/store.server")>()),
  loadPrimaryConnection: async () => ({ status: "connected" }),
}));
vi.mock("@/lib/whatsapp/link.server", () => ({
  ensureConversationForContact: async () => ({ conversationId: conv }),
}));
vi.mock("@/lib/whatsapp/service.server", () => ({ sendText: fake.send, sendMedia: vi.fn() }));
vi.mock("@/lib/automation/policy.server", () => ({
  loadPolicySettings: async () => ({}),
  evaluatePolicy: async () => ({ decision: fake.policy, rules: [], reason: "allowed" }),
}));
vi.mock("@/lib/automation/audit.server", () => ({ recordDecision: vi.fn() }));
vi.mock("@/lib/automation/adaptive.server", () => ({
  resolveAdaptiveContent: async (
    _db: unknown,
    _action: unknown,
    _policy: unknown,
    text: string,
  ) => ({ kind: "send", text, media: null }),
}));
const user = "10000000-0000-4000-8000-000000000001",
  contact = "10000000-0000-4000-8000-000000000002",
  conv = "10000000-0000-4000-8000-000000000003",
  flow = "10000000-0000-4000-8000-000000000004",
  opp = "10000000-0000-4000-8000-000000000005";
let fixture: Awaited<ReturnType<typeof testDatabase>>;
const db = () => fixture.db as never;
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-03-09T12:00:00Z"));
  fixture = await testDatabase();
  await fixture.pg.exec(
    `INSERT INTO contacts(id,user_id,name,is_archived)VALUES('${contact}','${user}','Teste',false); INSERT INTO opportunities(id,user_id,contact_id,status,next_action_description)VALUES('${opp}','${user}','${contact}','open','Tarefa manual'); INSERT INTO followup_flows(id,user_id,kind,is_active,name,window_start,window_end)VALUES('${flow}','${user}','smart',true,'Teste','09:00','19:00'); INSERT INTO smart_flow_configs(flow_id,user_id,autonomy,max_duration_days,min_hours_between_actions,max_actions_per_week,max_pressure,confidence_min,goal,allowed_strategies)VALUES('${flow}','${user}','auto',90,36,2,100,0.6,'Acompanhar', '["CHECK_IN"]'); INSERT INTO conversation_control(conversation_id,user_id,owner,next_responsible,context_version)VALUES('${conv}','${user}','ai','customer',1);`,
  );
  fake.policy = "allowed";
  fake.decision.mockResolvedValue({
    action: "send",
    message: "Como ficou sua análise da proposta?",
    strategy: "CHECK_IN",
    waitHours: 0,
    confidence: 0.9,
    reason: "Cadência",
    nextResponsible: "customer",
  });
  fake.send.mockImplementation(async () => ({ messageId: crypto.randomUUID() }));
});
afterEach(async () => {
  vi.useRealTimers();
  await fixture.pg.close();
  vi.clearAllMocks();
});
async function start(options: { history?: boolean; note?: string } = {}) {
  if (options.history !== false)
    await fixture.pg.query(
      "INSERT INTO messages(id,user_id,conversation_id,contact_id,direction,message_type,status,text_content,sent_at) VALUES ($1,$2,$3,$4,'outbound','text','sent','Segue a cotação do plano.',now()) ON CONFLICT DO NOTHING",
      ["10000000-0000-4000-8000-000000000006", user, conv, contact],
    );
  return startSmartFlow(db(), user, {
    flowId: flow,
    contactId: contact,
    conversationId: conv,
    opportunityId: opp,
    policyKey: "post_quote_v1",
    ...(options.note ? { postQuoteContextNote: options.note } : {}),
  });
}
async function actionFor(runId: string) {
  const r = await fixture.pg.query(
    "SELECT * FROM scheduled_actions WHERE flow_run_id=$1 ORDER BY created_at DESC",
    [runId],
  );
  return r.rows[0] as Record<string, unknown>;
}
async function runFor(runId: string) {
  return (await fixture.pg.query("SELECT * FROM followup_runs WHERE id=$1", [runId]))
    .rows[0] as Record<string, unknown>;
}
describe("Stage A actual engine + isolated PostgreSQL + fake provider", () => {
  it("activate → persist → execute → accepted → next; first Smart send stays active", async () => {
    const { runId } = await start();
    expect((await runFor(runId))["next_contact_at"]).toEqual(new Date("2026-03-10T13:00:00Z"));
    expect(await evaluateSmartRun(db(), runId)).toBe("waiting_cadence");
    vi.setSystemTime(new Date("2026-03-10T13:00:00Z"));
    expect(await evaluateSmartRun(db(), runId)).toBe("scheduled");
    const action = await actionFor(runId);
    expect(
      (await fixture.pg.query("SELECT context_version FROM conversation_control")).rows[0],
    ).toEqual({ context_version: 1 });
    await fixture.pg.query("UPDATE scheduled_actions SET status='processing' WHERE id=$1", [
      action["id"],
    ]);
    const outcome = await executeClaimedAction(db(), action as never);
    expect(outcome).toBe("sent");
    const run = await runFor(runId);
    expect(run["status"]).toBe("active");
    expect(run["contacts_done"]).toBe(1);
    expect(run["next_contact_at"]).toEqual(new Date("2026-03-13T18:00:00Z"));
    expect(fake.send).toHaveBeenCalledTimes(1);
  });
  it("does not activate without an imported quote and allows the confirmed note", async () => {
    await fixture.pg.query(
      "INSERT INTO conversations(id,user_id,contact_id,external_chat_id,whatsapp_connection_id) VALUES($1,$2,$3,'5511999999999@s.whatsapp.net',$4)",
      [conv, user, contact, crypto.randomUUID()],
    );
    await fixture.pg.query("UPDATE followup_flows SET name=$1 WHERE id=$2", [
      POST_QUOTE_FLOW_NAME,
      flow,
    ]);
    expect(await activatePostQuote(db(), user, contact, opp)).toEqual({
      status: "history_required",
      sync: "unavailable",
    });
    expect((await fixture.pg.query("SELECT id FROM followup_runs")).rows).toHaveLength(0);
    const result = await activatePostQuote(db(), user, contact, opp, {
      contextNote: "Enviei a opção Porto P220. Cliente vai decidir com a esposa.",
    });
    expect(result).toMatchObject({ status: "activated", contextNote: true });
    if (result.status !== "activated") throw new Error("Ciclo não ativado");
    expect((await runFor(result.runId))["post_quote_context_note"]).toContain("Porto P220");
    expect(fake.send).not.toHaveBeenCalled();
  });
  it("suspends evaluation when the proposal is missing and keeps the attempt unspent", async () => {
    const { runId } = await start({ history: false });
    vi.setSystemTime(new Date("2026-03-10T13:00:00Z"));
    expect(await evaluateSmartRun(db(), runId)).toBe("post_quote_history_required");
    expect(await actionFor(runId)).toBeUndefined();
    expect((await runFor(runId))["contacts_done"]).toBe(0);
    expect(fake.decision).not.toHaveBeenCalled();
  });
  it("uses the consultant's proposal summary with mandatory approval", async () => {
    const note = "Enviei a opção Porto P220. Cliente vai avaliar com a esposa.";
    const { runId } = await start({ history: false, note });
    vi.setSystemTime(new Date("2026-03-10T13:00:00Z"));
    expect(await evaluateSmartRun(db(), runId)).toBe("needs_approval");
    expect(fake.decision.mock.calls[0]?.[1]).toMatchObject({ postQuoteContextNote: note });
    expect((await actionFor(runId))["status"]).toBe("needs_approval");
    expect(fake.send).not.toHaveBeenCalled();
  });
  it("discards an already scheduled action if the history is no longer available", async () => {
    const { runId } = await start();
    vi.setSystemTime(new Date("2026-03-10T13:00:00Z"));
    expect(await evaluateSmartRun(db(), runId)).toBe("scheduled");
    await fixture.pg.query("DELETE FROM messages WHERE conversation_id=$1", [conv]);
    const action = await actionFor(runId);
    expect(await smartPreSendCheck(db(), action as never)).toMatchObject({
      allowed: false,
      verdict: "stale",
    });
    expect((await runFor(runId))["contacts_done"]).toBe(0);
    expect(fake.send).not.toHaveBeenCalled();
  });
  it("operational update does not stale text; real context changes atomically", async () => {
    await patchControl(db(), conv, { decision_reason: "operational" }, { bumpVersion: false });
    expect(
      (await fixture.pg.query("SELECT context_version FROM conversation_control")).rows[0],
    ).toEqual({ context_version: 1 });
    await Promise.all([
      patchControl(db(), conv, { owner: "human" }),
      patchControl(db(), conv, { state: "waiting_human" }),
    ]);
    expect(
      (await fixture.pg.query("SELECT context_version FROM conversation_control")).rows[0],
    ).toEqual({ context_version: 3 });
  });
  it("parallel evaluation creates one action", async () => {
    const { runId } = await start();
    vi.setSystemTime(new Date("2026-03-10T13:00:00Z"));
    await Promise.all([evaluateSmartRun(db(), runId), evaluateSmartRun(db(), runId)]);
    expect(
      (await fixture.pg.query("SELECT count(*)::int AS n FROM scheduled_actions")).rows[0],
    ).toEqual({ n: 1 });
  });
  it("discard decision when customer context changes during generation", async () => {
    const { runId } = await start();
    vi.setSystemTime(new Date("2026-03-10T13:00:00Z"));
    fake.decision.mockImplementationOnce(async () => {
      await patchControl(db(), conv, { state: "waiting_human" });
      return {
        action: "send",
        strategy: "CHECK_IN",
        message: "Texto antigo",
        confidence: 0.9,
        waitHours: 0,
      };
    });
    expect(await evaluateSmartRun(db(), runId)).toBe("context_changed_during_generation");
    expect(
      (await fixture.pg.query("SELECT count(*)::int AS n FROM scheduled_actions")).rows[0],
    ).toEqual({ n: 0 });
  });
  it("known reply allows return; new reply with same timestamp invalidates pending text", async () => {
    const { runId } = await start();
    vi.setSystemTime(new Date("2026-03-10T13:00:00Z"));
    const message = crypto.randomUUID();
    await fixture.pg.query(
      "INSERT INTO messages(id,user_id,conversation_id,direction,sent_at,status)VALUES($1,$2,$3,'inbound','2026-03-10T12:00:00Z','received')",
      [message, user, conv],
    );
    await evaluateSmartRun(db(), runId);
    const action = await actionFor(runId);
    expect((await smartPreSendCheck(db(), action as never)).allowed).toBe(true);
    await fixture.pg.query(
      "INSERT INTO messages(user_id,conversation_id,direction,sent_at,status)VALUES($1,$2,'inbound','2026-03-10T12:00:00Z','received')",
      [user, conv],
    );
    expect((await smartPreSendCheck(db(), action as never)).allowed).toBe(false);
  });
  it("eight accepted logical contacts idempotently close only cycle and preserve manual task", async () => {
    const { runId } = await start();
    let at = new Date("2026-03-10T13:00:00Z");
    for (let i = 1; i <= 8; i++) {
      const aid = crypto.randomUUID(),
        mid = crypto.randomUUID();
      await fixture.pg.query(
        "INSERT INTO scheduled_actions(id,user_id,conversation_id,flow_run_id,opportunity_id,logical_contact,status,send_state)VALUES($1,$2,$3,$4,$5,$6,'processing','started')",
        [aid, user, conv, runId, opp, i],
      );
      const action = (await fixture.pg.query("SELECT * FROM scheduled_actions WHERE id=$1", [aid]))
        .rows[0];
      await recordPostQuoteAccepted(db(), action as never, mid, at);
      await recordPostQuoteAccepted(db(), action as never, mid, at);
      expect((await runFor(runId))["contacts_done"]).toBe(i);
      at =
        nextSilenceContact({
          doneContacts: i,
          activatedAt: new Date("2026-03-09T12:00:00Z"),
          lastContactAt: at,
        })?.at ?? at;
    }
    const run = await runFor(runId);
    expect(run["status"]).toBe("completed");
    expect(run["next_evaluation_at"]).toBeNull();
    expect(
      (await fixture.pg.query("SELECT status,next_action_description FROM opportunities")).rows[0],
    ).toEqual({ status: "open", next_action_description: "Tarefa manual" });
  });
  it("uncertain attempt never counts or blindly resends; confirmed receipt reconciles once", async () => {
    const { runId } = await start();
    vi.setSystemTime(new Date("2026-03-10T13:00:00Z"));
    await evaluateSmartRun(db(), runId);
    const action = await actionFor(runId),
      mid = crypto.randomUUID();
    await fixture.pg.query(
      "INSERT INTO messages(id,user_id,conversation_id,status,sent_at)VALUES($1,$2,$3,'pending','2026-03-10T13:00:00Z')",
      [mid, user, conv],
    );
    await fixture.pg.query(
      "UPDATE scheduled_actions SET status='processing',send_state='uncertain',message_id=$1,send_started_at='2026-03-10T12:58:00Z' WHERE id=$2",
      [mid, action["id"]],
    );
    expect(await executeClaimedAction(db(), { ...action, send_state: "uncertain" } as never)).toBe(
      "skipped",
    );
    expect((await runFor(runId))["contacts_done"]).toBe(0);
    expect(fake.send).not.toHaveBeenCalled();
    await reconcileSmartSends(db());
    expect((await runFor(runId))["contacts_done"]).toBe(0);
    await fixture.pg.query("UPDATE messages SET status='sent' WHERE id=$1", [mid]);
    await reconcileSmartSends(db());
    await reconcileSmartSends(db());
    expect((await runFor(runId))["contacts_done"]).toBe(1);
  });
  it("future approval retains appointment in PostgreSQL", async () => {
    const { runId } = await start();
    vi.setSystemTime(new Date("2026-03-10T12:50:00Z"));
    await evaluateSmartRun(db(), runId);
    const action = await actionFor(runId);
    await fixture.pg.query(
      "UPDATE scheduled_actions SET status='needs_approval',requires_approval=true WHERE id=$1",
      [action["id"]],
    );
    await approveSmartAction(db(), user, { actionId: String(action["id"]) });
    expect((await actionFor(runId))["scheduled_for"]).toEqual(new Date("2026-03-10T13:00:00Z"));
  });
  it("memory reads every batch beyond 400 without skipping equal timestamps", async () => {
    await fixture.pg.query("INSERT INTO customer_memory(user_id,contact_id)VALUES($1,$2)", [
      user,
      contact,
    ]);
    await fixture.pg.query(
      "INSERT INTO messages(user_id,contact_id,sent_at,text_content) SELECT $1::uuid,$2::uuid,'2026-03-09T12:00:00Z'::timestamptz,'message '||i FROM generate_series(1,425)i",
      [user, contact],
    );
    const ids: string[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 8; i++) {
      const batch = await loadMessages(db(), user, contact, cursor);
      ids.push(...batch.fresh.map((m) => m.id));
      const last = batch.fresh.at(-1);
      if (last) {
        cursor = last.id;
        await fixture.pg.query(
          "UPDATE customer_memory SET message_cursor_at=$1,message_cursor_id=$2,last_analyzed_message_id=$2",
          [last.sent_at, last.id],
        );
      }
      if (!batch.hasMore) break;
    }
    expect(ids.length).toBe(425);
    expect(new Set(ids).size).toBe(425);
  });
  it("classic sender still completes its last registered step", async () => {
    const { runId } = await start();
    vi.setSystemTime(new Date("2026-03-10T13:00:00Z"));
    await evaluateSmartRun(db(), runId);
    const action = await actionFor(runId);
    await fixture.pg.query("UPDATE followup_flows SET kind='classic' WHERE id=$1", [flow]);
    await fixture.pg.query("UPDATE followup_runs SET policy_key=NULL WHERE id=$1", [runId]);
    await fixture.pg.query(
      "UPDATE scheduled_actions SET status='processing',smart_strategy=NULL,logical_contact=NULL,cancel_on_reply=false WHERE id=$1",
      [action["id"]],
    );
    expect(
      await executeClaimedAction(db(), {
        ...action,
        status: "processing",
        smart_strategy: null,
        logical_contact: null,
        cancel_on_reply: false,
      } as never),
    ).toBe("sent");
    expect((await runFor(runId))["status"]).toBe("completed");
  });
  it("pause and reschedule preserve accepted contact count", async () => {
    const { runId } = await start();
    await fixture.pg.query("UPDATE followup_runs SET contacts_done=2 WHERE id=$1", [runId]);
    await controlPostQuote(db(), user, { runId, command: "pause" });
    expect((await runFor(runId))["contacts_done"]).toBe(2);
    await controlPostQuote(db(), user, {
      runId,
      command: "reschedule",
      at: "2026-03-12T18:30:00Z",
    });
    const run = await runFor(runId);
    expect(run["contacts_done"]).toBe(2);
    expect(run["next_contact_at"]).toEqual(new Date("2026-03-12T18:30:00Z"));
  });
  it("simulation does not count or complete Smart run", async () => {
    const { runId } = await start();
    vi.setSystemTime(new Date("2026-03-10T13:00:00Z"));
    await evaluateSmartRun(db(), runId);
    const action = await actionFor(runId);
    fake.policy = "simulated";
    await fixture.pg.query("UPDATE scheduled_actions SET status='processing' WHERE id=$1", [
      action["id"],
    ]);
    expect(await executeClaimedAction(db(), action as never)).toBe("skipped");
    expect((await runFor(runId))["contacts_done"]).toBe(0);
    expect((await runFor(runId))["status"]).toBe("paused");
    expect(fake.send).not.toHaveBeenCalled();
  });
  it("proved failure does not count or complete the cycle", async () => {
    const { runId } = await start();
    vi.setSystemTime(new Date("2026-03-10T13:00:00Z"));
    await evaluateSmartRun(db(), runId);
    const action = await actionFor(runId);
    await fixture.pg.query(
      "UPDATE scheduled_actions SET status='processing',send_state='rejected' WHERE id=$1",
      [action["id"]],
    );
    fake.send.mockRejectedValueOnce(new Error("Proved rejected"));
    expect(await executeClaimedAction(db(), action as never)).toBe("rescheduled");
    expect((await runFor(runId))["contacts_done"]).toBe(0);
    expect((await runFor(runId))["status"]).toBe("active");
  });
});

describe("Stage A closing round (isolated, fake clock + provider)", () => {
  it.each([
    "me chama dia 32",
    "me chama dia 0",
    "me chama às 14h",
    "me chama quinta dia 13/03/2026 às 14h25",
  ])("%s persists a review barrier and prevents any provider call", async (text) => {
    const { runId } = await start();
    const items = extractCommitments({ text, direction: "inbound", now: new Date() });
    expect(items).toHaveLength(1);
    const item = items[0];
    if (!item) throw new Error("Missing review barrier");
    await fixture.pg.query(
      "INSERT INTO commitments(user_id,conversation_id,contact_id,commitment_type,responsible,description,is_ambiguous,status)VALUES($1,$2,$3,$4,$5,$6,$7,'pending')",
      [
        user,
        conv,
        contact,
        item.commitment_type,
        item.responsible,
        item.description,
        item.is_ambiguous,
      ],
    );
    vi.setSystemTime(new Date("2026-03-10T13:00:00Z"));
    expect(await evaluateSmartRun(db(), runId)).toBe("human_commitment");
    expect((await runFor(runId))["status"]).toBe("paused");
    expect((await runFor(runId))["contacts_done"]).toBe(0);
    expect(
      (await fixture.pg.query("SELECT count(*)::int AS n FROM scheduled_actions")).rows[0],
    ).toEqual({ n: 0 });
    expect(fake.send).not.toHaveBeenCalled();
  });

  it("individual rescheduling preserves return-with-approval; no send before approval; accepted contact is 1 of 8", async () => {
    const { runId } = await start();
    await patchControl(db(), conv, { owner: "ai", force_approval_next: true });
    await controlPostQuote(db(), user, {
      runId,
      command: "reschedule",
      at: "2026-03-10T18:25:00Z",
    });
    vi.setSystemTime(new Date("2026-03-10T18:25:00Z"));
    expect(await evaluateSmartRun(db(), runId)).toBe("needs_approval");
    let action = await actionFor(runId);
    expect(action["requires_approval"]).toBe(true);
    expect(action["scheduled_for"]).toEqual(new Date("2026-03-10T18:25:00Z"));
    expect((await runFor(runId))["contacts_done"]).toBe(0);
    expect(fake.send).not.toHaveBeenCalled();
    await approveSmartAction(db(), user, { actionId: String(action["id"]) });
    action = await actionFor(runId);
    expect(action["scheduled_for"]).toEqual(new Date("2026-03-10T18:25:00Z"));
    expect(fake.send).not.toHaveBeenCalled();
    await fixture.pg.query("UPDATE scheduled_actions SET status='processing' WHERE id=$1", [
      action["id"],
    ]);
    expect(await executeClaimedAction(db(), { ...action, status: "processing" } as never)).toBe(
      "sent",
    );
    expect(fake.send).toHaveBeenCalledTimes(1);
    expect((await runFor(runId))["contacts_done"]).toBe(1);
    expect((await loadControl(db(), conv))?.force_approval_next).toBe(false);
    expect((await runFor(runId))["next_contact_at"]).toEqual(new Date("2026-03-13T18:00:00Z"));
    expect(
      (
        await fixture.pg.query(
          "SELECT status,next_action_description,post_quote_next_at FROM opportunities",
        )
      ).rows[0],
    ).toEqual({
      status: "open",
      next_action_description: "Tarefa manual",
      post_quote_next_at: new Date("2026-03-13T18:00:00Z"),
    });
  });

  it("permite ativar a política de pós-cotação apenas pelo fluxo dedicado", async () => {
    await fixture.pg.query("UPDATE followup_flows SET name=$1 WHERE id=$2", [
      POST_QUOTE_FLOW_NAME,
      flow,
    ]);
    await expect(
      startSmartFlow(db(), user, {
        flowId: flow,
        contactId: contact,
        conversationId: conv,
        opportunityId: opp,
      }),
    ).rejects.toThrow("Use Ativar pós-cotação");
    const { runId } = await start();
    expect((await runFor(runId))["policy_key"]).toBe("post_quote_v1");
  });

  it("a pausa manual vence uma volta automática já agendada", async () => {
    const { runId } = await start();
    await fixture.pg.query("UPDATE followup_runs SET smart_state='human_active' WHERE id=$1", [
      runId,
    ]);
    await patchControl(db(), conv, {
      owner: "human",
      return_at: "2026-03-09T12:00:00Z",
      return_mode: "auto",
      return_source: "ai",
    });
    await controlPostQuote(db(), user, { runId, command: "pause" });
    const control = (await loadControl(db(), conv))!;
    expect(
      await applyReturn(db(), control, { mode: "auto", source: "ai", waiveCooldown: false }),
    ).toBe(0);
    expect((await runFor(runId))["status"]).toBe("paused");
    expect((await loadControl(db(), conv))?.owner).toBe("human");
    expect(
      (await fixture.pg.query("SELECT post_quote_next_at FROM opportunities")).rows[0],
    ).toEqual({ post_quote_next_at: null });

    expect(
      await applyReturn(db(), (await loadControl(db(), conv))!, {
        mode: "confirm",
        source: "manual",
        waiveCooldown: true,
      }),
    ).toBe(1);
    expect((await runFor(runId))["status"]).toBe("active");
    expect((await runFor(runId))["stop_reason"]).toBeNull();
    expect((await loadControl(db(), conv))?.force_approval_next).toBe(true);
  });

  it("uma resposta invalida o rascunho e o texto novo ainda precisa de aprovação", async () => {
    const { runId } = await start();
    await patchControl(db(), conv, { force_approval_next: true });
    vi.setSystemTime(new Date("2026-03-10T13:00:00Z"));
    expect(await evaluateSmartRun(db(), runId)).toBe("needs_approval");
    const old = await actionFor(runId);
    await registerCustomerMessage(db(), {
      userId: user,
      contactId: contact,
      conversationId: conv,
      messageType: "text",
      text: "Ainda estou vendo a proposta.",
      at: "2026-03-10T13:01:00Z",
    });
    expect(
      (await fixture.pg.query("SELECT status FROM scheduled_actions WHERE id=$1", [old["id"]]))
        .rows[0],
    ).toEqual({ status: "stale" });
    vi.setSystemTime(new Date("2026-03-10T13:05:00Z"));
    expect(await evaluateSmartRun(db(), runId)).toBe("needs_approval");
    expect((await loadControl(db(), conv))?.force_approval_next).toBe(true);
    expect(fake.send).not.toHaveBeenCalled();
  });

  it("encerra o pós-cotação quando a cliente recusa, preservando a oportunidade", async () => {
    const { runId } = await start();
    vi.setSystemTime(new Date("2026-03-10T13:00:00Z"));
    expect(await evaluateSmartRun(db(), runId)).toBe("scheduled");
    await registerCustomerMessage(db(), {
      userId: user,
      contactId: contact,
      conversationId: conv,
      messageType: "text",
      text: "Agora não, obrigado.",
      at: "2026-03-10T13:01:00Z",
    });
    const run = await runFor(runId);
    expect(run["status"]).toBe("stopped");
    expect(run["next_contact_at"]).toBeNull();
    expect((await actionFor(runId))["status"]).toBe("cancelled");
    expect((await fixture.pg.query("SELECT status FROM opportunities")).rows[0]).toEqual({
      status: "open",
    });
    expect(fake.send).not.toHaveBeenCalled();
  });

  it.each(["pause", "end"] as const)("recibo atrasado preserva o comando %s", async (command) => {
    const { runId } = await start();
    vi.setSystemTime(new Date("2026-03-10T13:00:00Z"));
    expect(await evaluateSmartRun(db(), runId)).toBe("scheduled");
    const action = await actionFor(runId);
    await fixture.pg.query(
      "UPDATE scheduled_actions SET status='blocked', send_state='uncertain' WHERE id=$1",
      [action["id"]],
    );
    await controlPostQuote(db(), user, { runId, command });
    await recordPostQuoteAccepted(db(), action as never, crypto.randomUUID());
    const run = await runFor(runId);
    expect(run["status"]).toBe(command === "pause" ? "paused" : "cancelled");
    expect(run["contacts_done"]).toBe(1);
    expect(run["next_evaluation_at"]).toBeNull();
    expect(
      (await fixture.pg.query("SELECT post_quote_next_at FROM opportunities")).rows[0],
    ).toEqual({ post_quote_next_at: null });
  });

  it("full cycle: activate → first contact → prepared text → accepted → counted → next; opportunity task kept", async () => {
    const { runId } = await start();
    expect((await runFor(runId))["next_contact_at"]).toEqual(new Date("2026-03-10T13:00:00Z"));
    vi.setSystemTime(new Date("2026-03-10T13:00:00Z"));
    expect(await evaluateSmartRun(db(), runId)).toBe("scheduled");
    const action = await actionFor(runId);
    expect(action["content"]).toBe("Como ficou sua análise da proposta?");
    expect(action["logical_contact"]).toBe(1);
    await fixture.pg.query("UPDATE scheduled_actions SET status='processing' WHERE id=$1", [
      action["id"],
    ]);
    expect(await executeClaimedAction(db(), action as never)).toBe("sent");
    const run = await runFor(runId);
    expect(run["contacts_done"]).toBe(1);
    expect(run["next_contact_at"]).toEqual(new Date("2026-03-13T18:00:00Z"));
    const o = (
      await fixture.pg.query(
        "SELECT status,next_action_description,post_quote_next_at FROM opportunities",
      )
    ).rows[0];
    expect(o).toEqual({
      status: "open",
      next_action_description: "Tarefa manual",
      post_quote_next_at: new Date("2026-03-13T18:00:00Z"),
    });
  });

  it("unreadable date blocks the cadence visibly until reviewed; count preserved", async () => {
    const { runId } = await start();
    await fixture.pg.query("UPDATE followup_runs SET contacts_done=3 WHERE id=$1", [runId]);
    const { resolveDateReview } = await import("./post-quote-runtime.server");
    const c = (
      await fixture.pg.query(
        "INSERT INTO commitments(user_id,conversation_id,contact_id,commitment_type,responsible,description,is_ambiguous,status)VALUES($1,$2,$3,'date_review','human','Revise a data: data inexistente',true,'pending') RETURNING id",
        [user, conv, contact],
      )
    ).rows[0] as { id: string };
    vi.setSystemTime(new Date("2026-03-10T13:00:00Z"));
    expect(await evaluateSmartRun(db(), runId)).toBe("human_commitment");
    let run = await runFor(runId);
    expect(run["status"]).toBe("paused");
    expect(run["next_contact_responsible"]).toBe("human");
    expect(String(run["next_contact_reason"])).toContain("revisar");
    expect(
      (await fixture.pg.query("SELECT count(*)::int AS n FROM scheduled_actions")).rows[0],
    ).toEqual({ n: 0 });
    await resolveDateReview(db(), user, { commitmentId: c.id, note: "Combinei por telefone" });
    await controlPostQuote(db(), user, {
      runId,
      command: "reschedule",
      at: "2026-03-11T18:00:00Z",
    });
    run = await runFor(runId);
    expect(run["status"]).toBe("active");
    expect(run["contacts_done"]).toBe(3);
  });

  it("uncertain send: weak confirmation keeps it blocked; written check resolves auditable, never resends", async () => {
    const { runId } = await start();
    vi.setSystemTime(new Date("2026-03-10T13:00:00Z"));
    await evaluateSmartRun(db(), runId);
    const action = await actionFor(runId);
    await fixture.pg.query(
      "UPDATE scheduled_actions SET status='blocked',send_state='uncertain',send_started_at='2026-03-10T13:00:00Z' WHERE id=$1",
      [action["id"]],
    );
    const { resolveUncertainSend } = await import("./post-quote-runtime.server");
    await expect(
      resolveUncertainSend(db(), user, {
        actionId: String(action["id"]),
        outcome: "delivered",
        evidence: "ok",
      }),
    ).rejects.toThrow(/segue bloqueada/);
    expect((await actionFor(runId))["send_state"]).toBe("uncertain");
    await resolveUncertainSend(db(), user, {
      actionId: String(action["id"]),
      outcome: "not_delivered",
      evidence: "Conversa no celular não mostra a mensagem",
    });
    const run = await runFor(runId);
    expect((await actionFor(runId))["status"]).toBe("failed");
    expect(run["contacts_done"]).toBe(0);
    expect(run["status"]).toBe("paused");
    expect(run["next_contact_responsible"]).toBe("human");
    expect(fake.send).not.toHaveBeenCalled();
  });

  it("uncertain send confirmed as delivered counts exactly once", async () => {
    const { runId } = await start();
    vi.setSystemTime(new Date("2026-03-10T13:00:00Z"));
    await evaluateSmartRun(db(), runId);
    const action = await actionFor(runId);
    await fixture.pg.query(
      "UPDATE scheduled_actions SET status='blocked',send_state='uncertain',send_started_at='2026-03-10T13:00:00Z' WHERE id=$1",
      [action["id"]],
    );
    const { resolveUncertainSend } = await import("./post-quote-runtime.server");
    const input = {
      actionId: String(action["id"]),
      outcome: "delivered" as const,
      evidence: "Vi a mensagem com dois tiques às 10h01",
    };
    await resolveUncertainSend(db(), user, input);
    await expect(resolveUncertainSend(db(), user, input)).rejects.toThrow();
    expect((await runFor(runId))["contacts_done"]).toBe(1);
    expect(fake.send).not.toHaveBeenCalled();
  });

  it("after the eighth contact no ninth action is prepared", async () => {
    const { runId } = await start();
    await fixture.pg.query("UPDATE followup_runs SET contacts_done=7 WHERE id=$1", [runId]);
    const aid = crypto.randomUUID();
    await fixture.pg.query(
      "INSERT INTO scheduled_actions(id,user_id,conversation_id,flow_run_id,opportunity_id,logical_contact,status,send_state)VALUES($1,$2,$3,$4,$5,8,'processing','started')",
      [aid, user, conv, runId, opp],
    );
    const a = (await fixture.pg.query("SELECT * FROM scheduled_actions WHERE id=$1", [aid]))
      .rows[0];
    await recordPostQuoteAccepted(db(), a as never, crypto.randomUUID(), new Date());
    vi.setSystemTime(new Date("2026-06-01T13:00:00Z"));
    await evaluateSmartRun(db(), runId);
    const run = await runFor(runId);
    expect(run["status"]).toBe("completed");
    expect(run["contacts_done"]).toBe(8);
    expect(
      (
        await fixture.pg.query(
          "SELECT count(*)::int AS n FROM scheduled_actions WHERE status IN ('scheduled','needs_approval')",
        )
      ).rows[0],
    ).toEqual({ n: 0 });
  });

  it("old Smart: executor does not reactivate a run the send just closed", async () => {
    const { runId } = await start();
    vi.setSystemTime(new Date("2026-03-10T13:00:00Z"));
    await evaluateSmartRun(db(), runId);
    const action = await actionFor(runId);
    await fixture.pg.query("UPDATE followup_runs SET policy_key=NULL WHERE id=$1", [runId]);
    await fixture.pg.query(
      "UPDATE scheduled_actions SET status='processing',logical_contact=NULL,smart_strategy='GRACEFUL_DECLINE' WHERE id=$1",
      [action["id"]],
    );
    const outcome = await executeClaimedAction(db(), {
      ...action,
      status: "processing",
      logical_contact: null,
      smart_strategy: "GRACEFUL_DECLINE",
    } as never);
    expect(outcome).toBe("sent");
    expect((await runFor(runId))["status"]).toBe("completed");
  });

  it("discards a newly received audio while the transport is preparing the send", async () => {
    const { runId } = await start();
    vi.setSystemTime(new Date("2026-03-10T13:00:00Z"));
    await evaluateSmartRun(db(), runId);
    const action = await actionFor(runId);
    await fixture.pg.query("UPDATE scheduled_actions SET status='processing' WHERE id=$1", [
      action["id"],
    ]);
    const provider = vi.fn();
    fake.send.mockImplementationOnce(async (_user, { beforeDispatch }) => {
      await fixture.pg.query(
        "INSERT INTO messages(user_id,conversation_id,direction,message_type,status,sent_at) VALUES ($1,$2,'inbound','audio','received',$3)",
        [user, conv, new Date().toISOString()],
      );
      if (!(await beforeDispatch())) throw new WhatsAppDispatchCancelled();
      return provider();
    });

    expect(await executeClaimedAction(db(), { ...action, status: "processing" } as never)).toBe(
      "skipped",
    );
    expect(provider).not.toHaveBeenCalled();
    expect(await actionFor(runId)).toMatchObject({
      status: "stale",
      last_error: "new_customer_reply",
      send_state: null,
    });
  });

  it("database guards the final claim against a late reply and duplicate dispatch", async () => {
    const { runId } = await start();
    vi.setSystemTime(new Date("2026-03-10T13:00:00Z"));
    await evaluateSmartRun(db(), runId);
    const action = await actionFor(runId);
    await fixture.pg.query("UPDATE scheduled_actions SET status='processing' WHERE id=$1", [
      action["id"],
    ]);
    await fixture.pg.query(
      "INSERT INTO conversations(id,user_id,phone_number) VALUES ($1,$2,'+5511999999999')",
      [conv, user],
    );
    const prepared = crypto.randomUUID();
    const incoming = crypto.randomUUID();
    await fixture.pg.query(
      "INSERT INTO messages(id,user_id,conversation_id,direction,message_type,status,sent_at,recipient_phone) VALUES ($1,$2,$3,'outbound','text','pending',$5,'+5511999999999'),($4,$2,$3,'inbound','text','received',$5,NULL)",
      [prepared, user, conv, incoming, new Date().toISOString()],
    );
    const begin = () =>
      fixture.db.rpc("begin_automation_dispatch", {
        p_action: action["id"],
        p_user: user,
        p_message: prepared,
      });
    expect(await begin()).toEqual({ data: false, error: null });
    await fixture.pg.query("DELETE FROM messages WHERE id=$1", [incoming]);
    await fixture.pg.query(
      "INSERT INTO user_settings(user_id,test_mode,test_mode_allowlist) VALUES ($1,true,ARRAY['999999999'])",
      [user],
    );
    expect(await begin()).toEqual({ data: false, error: null });
    await fixture.pg.query(
      "UPDATE user_settings SET test_mode_allowlist=ARRAY['(11) 99999-9999'], require_approval_all=true WHERE user_id=$1",
      [user],
    );
    expect(await begin()).toEqual({ data: false, error: null });
    await fixture.pg.query(
      "UPDATE scheduled_actions SET dispatch_approved_at=clock_timestamp() WHERE id=$1",
      [action["id"]],
    );
    expect(await begin()).toEqual({ data: true, error: null });
    expect(await begin()).toEqual({ data: false, error: null });
    expect(await actionFor(runId)).toMatchObject({ message_id: prepared, send_state: "started" });
  });

  it("proved failure stays visible with reason and next attempt", async () => {
    const { runId } = await start();
    vi.setSystemTime(new Date("2026-03-10T13:00:00Z"));
    await evaluateSmartRun(db(), runId);
    const action = await actionFor(runId);
    await fixture.pg.query(
      "UPDATE scheduled_actions SET status='processing',send_state='rejected' WHERE id=$1",
      [action["id"]],
    );
    fake.send.mockRejectedValueOnce(new Error("Proved rejected"));
    await executeClaimedAction(db(), action as never);
    const after = await actionFor(runId);
    expect(after["last_error"]).toBeTruthy();
    expect(after["status"]).toBe("scheduled");
    expect(new Date(String(after["scheduled_for"])).getTime()).toBeGreaterThan(Date.now());
    const run = await runFor(runId);
    expect(run["next_contact_responsible"]).toBeTruthy();
    expect(run["next_contact_at"]).toBeTruthy();
  });
});
