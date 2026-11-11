import { describe, expect, it } from "vitest";
import { postQuoteOpportunitySelection } from "./post-quote-opportunity";

const first = { id: "quote-1", title: "Plano A", status: "open" };
const second = { id: "quote-2", title: "Plano B", status: "open" };

describe("post-quote opportunity selection", () => {
  it("has no eligible selection with zero opportunities", () => {
    expect(postQuoteOpportunitySelection([], "").selectedOpportunity).toBeUndefined();
  });
  it("excludes closed and archived opportunities", () => {
    const selection = postQuoteOpportunitySelection(
      ["won", "lost", "archived"].map((status) => ({ ...first, status })),
      first.id,
    );
    expect(selection.openOpportunities).toEqual([]);
    expect(selection.selectedOpportunity).toBeUndefined();
  });
  it("selects the only open opportunity automatically", () => {
    expect(postQuoteOpportunitySelection([first], "").selectedOpportunity?.id).toBe("quote-1");
  });
  it("requires explicit choice when multiple opportunities are open", () => {
    expect(postQuoteOpportunitySelection([first, second], "").selectedOpportunity).toBeUndefined();
  });
  it("uses the chosen opportunity rather than the first open quote", () => {
    expect(postQuoteOpportunitySelection([first, second], "quote-2").selectedOpportunity?.id).toBe(
      "quote-2",
    );
  });
  it("invalidates a selection that closed while multiple quotes remain open", () => {
    expect(
      postQuoteOpportunitySelection([first, second, { ...first, id: "old", status: "won" }], "old")
        .selectedOpportunity,
    ).toBeUndefined();
  });
});
