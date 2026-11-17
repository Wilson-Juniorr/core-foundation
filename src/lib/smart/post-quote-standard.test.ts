import { describe, expect, it, vi } from "vitest";
import { POST_QUOTE_STANDARD_MESSAGES, standardPostQuoteDecision } from "./post-quote-standard";
import { reviewMessage } from "./quality.server";
import { decideNextStep, type SmartDecisionInput } from "./decision.server";
const gateway = vi.hoisted(() => vi.fn());
vi.mock("@/lib/ai/gateway.server", () => ({ completeStructured: gateway }));
function input(extra: Partial<SmartDecisionInput> = {}): SmartDecisionInput {
  return {
    config: {
      allowed_strategies: ["LIGHT_FOLLOWUP", "SOFT_CLOSE"],
    } as SmartDecisionInput["config"],
    control: {} as SmartDecisionInput["control"],
    contactName: null,
    objective: "Acompanhar",
    deadlineAt: null,
    recentMessages: [],
    memorySummary: null,
    pendingCommitments: [],
    recentStrategies: [],
    attemptsThisWeek: 0,
    postQuoteContact: 1,
    ...extra,
  };
}
describe("post-quote fallback uses real decision and quality", () => {
  it("schedules all eight neutral templates without invented facts or repeated copy", () => {
    for (let i = 0; i < 8; i++) {
      const decision = standardPostQuoteDecision({ postQuoteContact: i + 1 }, [
        "LIGHT_FOLLOWUP",
        "SOFT_CLOSE",
      ]);
      expect(decision.action).toBe("send");
      expect(
        reviewMessage({
          message: decision.message!,
          contactName: null,
          previousOutbound: POST_QUOTE_STANDARD_MESSAGES.slice(0, i),
          inboundTexts: [],
          memorySummary: null,
          sensitivePhase: false,
        }).verdict,
      ).toBe("ok");
    }
  });
  it("works without AI or history", async () => {
    gateway.mockClear();
    expect(await decideNextStep({} as never, input())).toMatchObject({
      action: "send",
      model: "post-quote-standard",
    });
    expect(gateway).not.toHaveBeenCalled();
  });
  it("passes partial context and permits neutral follow-up", async () => {
    gateway.mockResolvedValue({
      data: {
        action: "send",
        strategy: "LIGHT_FOLLOWUP",
        message: "Posso ajudar na análise das opções?",
        confidence: 0.9,
        wait_hours: 0,
        next_responsible: "customer",
      },
    });
    await decideNextStep(
      {} as never,
      input({
        recentMessages: [
          {
            direction: "outbound",
            type: "text",
            text: "Segue o material",
            at: "2026-11-17T10:00:00Z",
          },
        ],
      }),
    );
    expect(gateway.mock.calls.at(-1)?.[0].user).toContain("Segue o material");
    expect(gateway.mock.calls.at(-1)?.[0].user).toContain(
      "histórico ausente ou parcial é permitido",
    );
  });
  it("does not replace a customer reply or a commitment with a blind template if AI fails", async () => {
    gateway.mockRejectedValue(new Error("offline"));
    for (const extra of [
      {
        recentMessages: [
          { direction: "inbound", type: "text", text: "Não quero", at: "2026-11-17T10:00:00Z" },
        ],
      },
      {
        pendingCommitments: [
          { responsible: "customer", description: "Segunda", due_at: "2026-11-23T13:00:00Z" },
        ],
      },
      { consultantNotes: ["Me mostrar antes"] },
    ])
      expect(await decideNextStep({} as never, input(extra))).toMatchObject({ action: "handoff" });
  });
  it("can continue after an AI failure when only outbound context exists", async () => {
    gateway.mockRejectedValue(new Error("offline"));
    expect(
      await decideNextStep(
        {} as never,
        input({
          recentMessages: [
            {
              direction: "outbound",
              type: "text",
              text: "Segue o material",
              at: "2026-11-17T10:00:00Z",
            },
          ],
        }),
      ),
    ).toMatchObject({ action: "send", model: "post-quote-standard" });
  });
});
