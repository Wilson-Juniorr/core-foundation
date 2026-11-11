type Opportunity = { id: string; title: string; status: string };

/** Never choose arbitrarily between quotes, or retain a closed/deleted selection. */
export function postQuoteOpportunitySelection<T extends Opportunity>(
  opportunities: T[],
  selectedId: string,
) {
  const openOpportunities = opportunities.filter((opportunity) => opportunity.status === "open");
  const selectedOpportunity =
    openOpportunities.find((opportunity) => opportunity.id === selectedId) ??
    (openOpportunities.length === 1 ? openOpportunities[0] : undefined);
  return { openOpportunities, selectedOpportunity };
}
